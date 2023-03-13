import { Worker } from 'node:worker_threads';
import fastGlob from 'fast-glob';
import * as readline from 'node:readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
	FinishMessage,
	MessageKind,
	ProgressMessage,
	WorkerMessage,
	WorkerMessageKind,
} from './messages';
import { NewGroup, oldGroupCodec, newGroupCodec } from './groups';

const buildNewGroups = (
	groups: ReadonlyArray<string> | null,
): ReadonlyArray<NewGroup> => {
	if (!groups) {
		return [];
	}

	return groups.map((group): NewGroup => {
		const isOldGroup = oldGroupCodec.is(group);

		if (isOldGroup) {
			switch (group) {
				case 'nextJs':
					return 'next_13';
				case 'mui':
					return 'mui';
				case 'reactrouterv4':
					return 'react-router_4';
				case 'reactrouterv6':
					return 'react-router_6';
				case 'immutablejsv4':
					return 'immutable_4';
				case 'immutablejsv0':
					return 'immutable_0';
			}
		}

		const isNewGroup = newGroupCodec.is(group);

		if (isNewGroup) {
			return group;
		}

		throw new Error(
			`The group "${group}" is neither the old group nor the new group`,
		);
	});
};

const WORKER_COUNT = 1;

export const executeMainThread = async () => {
	const {
		pattern,
		group,
		filePath: codemodFilePath,
		outputDirectoryPath,
		limit,
	} = await Promise.resolve<{
		pattern: ReadonlyArray<string>;
		group?: ReadonlyArray<string>;
		filePath?: string;
		outputDirectoryPath?: string;
		limit?: number;
	}>(
		yargs(hideBin(process.argv))
			.option('pattern', {
				alias: 'p',
				describe: 'Pass the glob pattern for file paths',
				array: true,
				type: 'string',
			})
			.option('group', {
				alias: 'g',
				describe: 'Pass the group(s) of codemods for execution',
				array: true,
				type: 'string',
			})
			.option('filePath', {
				alias: 'f',
				describe:
					'Pass the file path of a single codemod for execution',
				array: false,
				type: 'string',
			})
			.option('limit', {
				alias: 'l',
				describe: 'Pass the limit for the number of files to inspect',
				array: false,
				type: 'number',
			})
			.option('outputDirectoryPath', {
				alias: 'o',
				describe:
					'Pass the output directory path to save output files within in',
				type: 'string',
			})
			.demandOption(
				['pattern'],
				'Please provide the pattern argument to work with nora-node-engine',
			)
			.help()
			.alias('help', 'h').argv,
	);

	const newGroups = buildNewGroups(group ?? null);

	const interfase = readline.createInterface(process.stdin);

	const lineHandler = async (line: string) => {
		if (line !== 'shutdown') {
			return;
		}

		process.exit(0);
	};

	interfase.on('line', lineHandler);

	const filePaths = await fastGlob(pattern.slice());

	const totalFileCount = Math.min(limit ?? 0, filePaths.length);

	const progressMessage: ProgressMessage = {
		k: MessageKind.progress,
		p: 0,
		t: totalFileCount,
	};

	console.log(JSON.stringify(progressMessage));

	const workers: Worker[] = [];

	const idleWorkerIds = Array.from({ length: WORKER_COUNT }, (_, i) => i);

	let finished = false;

	const finish = async (): Promise<void> => {
		for (const worker of workers) {
			worker.postMessage('exit');
		}

		interfase.off('line', lineHandler);

		const finishMessage: FinishMessage = {
			k: MessageKind.finish,
		};
		console.log(JSON.stringify(finishMessage));
	};

	const work = (): void => {
		if (finished) {
			return;
		}

		const filePath = filePaths.pop();

		if (filePath === undefined) {
			if (idleWorkerIds.length === WORKER_COUNT) {
				finished = true;
				finish();
			}

			return;
		}

		const id = idleWorkerIds.pop();

		if (id === undefined) {
			return;
		}

		workers[id]?.postMessage({
			codemodFilePath,
			filePath,
			newGroups,
			outputDirectoryPath,
			totalFileCount,
			fileCount: filePaths.length,
		});

		work();
	};

	const buildOnWorkerMessage = (i: number) => (message: WorkerMessage) => {
		if (message.kind === WorkerMessageKind.idlessness) {
			const progressMessage: ProgressMessage = {
				k: MessageKind.progress,
				p: totalFileCount - filePaths.length,
				t: totalFileCount,
			};

			console.log(JSON.stringify(progressMessage));

			idleWorkerIds.push(i);
			work();
		}

		if (message.kind === WorkerMessageKind.message) {
			console.log(JSON.stringify(message.message));
		}
	};

	for (let i = 0; i < WORKER_COUNT; ++i) {
		const worker = new Worker(__filename);

		worker.on('message', buildOnWorkerMessage(i));

		workers.push(worker);
	}

	work();
};
