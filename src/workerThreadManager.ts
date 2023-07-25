import { Worker } from 'node:worker_threads';
import { MainThreadMessage } from './mainThreadMessages.js';
import { Message } from './messages.js';
import { decodeWorkerThreadMessage } from './workerThreadMessages.js';
import { FormattedFileCommand } from './fileCommands.js';

const WORKER_THREAD_TIME_LIMIT = 10000;

export class WorkerThreadManager {
	private __finished = false;
	private __idleWorkerIds: number[] = [];
	private __workers: Worker[] = [];
	private __workerTimestamps: number[] = [];
	private __totalFileCount: number;
	private readonly __interval: NodeJS.Timeout;

	public constructor(
		private readonly __workerCount: number,
		private readonly __codemodEngine: 'jscodeshift' | 'ts-morph',
		private readonly __codemodSource: string,
		private readonly __formatWithPrettier: boolean,
		private readonly __filePaths: string[],
		private readonly __onPrinterMessage: (message: Message) => void,
		private readonly __onCommand: (
			command: FormattedFileCommand,
		) => Promise<void>,
	) {
		this.__totalFileCount = __filePaths.length;

		for (let i = 0; i < __workerCount; ++i) {
			this.__idleWorkerIds.push(i);
			this.__workerTimestamps.push(Date.now());

			const worker = new Worker(__filename);

			worker.on('message', this.__buildOnWorkerMessage(i));

			this.__workers.push(worker);
		}

		this.__onPrinterMessage({
			kind: 'progress',
			processedFileNumber: 0,
			totalFileNumber: this.__totalFileCount,
		});

		this.__work();

		this.__interval = setInterval(() => {
			const now = Date.now();

			for (let i = 0; i < __workerCount; ++i) {
				const timestamp = this.__workerTimestamps[i] ?? Date.now();

				if (now > timestamp + WORKER_THREAD_TIME_LIMIT) {
					// hanging promise on purpose
					this.__workers[i].terminate();

					const worker = new Worker(__filename);
					worker.on('message', this.__buildOnWorkerMessage(i));

					this.__workers[i] = worker;

					this.__idleWorkerIds.push(i);

					this.__workerTimestamps[i] = Date.now();
				}
			}
		}, 1000);
	}

	private __work(): void {
		if (this.__finished) {
			return;
		}

		const filePath = this.__filePaths.pop();

		if (filePath === undefined) {
			if (this.__idleWorkerIds.length === this.__workerCount) {
				this.__finished = true;

				this.__finish();
			}

			return;
		}

		const id = this.__idleWorkerIds.pop();

		if (id === undefined) {
			this.__filePaths.push(filePath);

			return;
		}

		this.__workers[id]?.postMessage({
			kind: 'runCodemod',
			path: filePath,
			data: '', // TODO get it,
			codemodSource: this.__codemodSource,
			codemodEngine: this.__codemodEngine,
			formatWithPrettier: this.__formatWithPrettier,
		} satisfies MainThreadMessage);

		this.__workerTimestamps[id] = Date.now();

		this.__work();
	}

	private __finish(): void {
		clearInterval(this.__interval);

		for (const worker of this.__workers) {
			worker.postMessage({ kind: 'exit' } satisfies MainThreadMessage);
		}

		this.__onPrinterMessage({
			kind: 'finish',
		});
	}

	private __buildOnWorkerMessage(i: number) {
		return async (m: unknown): Promise<void> => {
			const workerThreadMessage = decodeWorkerThreadMessage(m);

			if (workerThreadMessage.kind === 'commands') {
				const commands =
					workerThreadMessage.commands as FormattedFileCommand[];

				for (const command of commands) {
					await this.__onCommand(command);
				}

				return;
			}

			if (workerThreadMessage.kind === 'idleness') {
				this.__onPrinterMessage({
					kind: 'progress',
					processedFileNumber:
						this.__totalFileCount - this.__filePaths.length,
					totalFileNumber: this.__totalFileCount,
				});

				this.__idleWorkerIds.push(i);
				this.__work();

				return;
			}
		};
	}
}
