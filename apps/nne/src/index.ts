import {
	isMainThread, workerData, Worker
} from 'node:worker_threads';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fastGlob from 'fast-glob';
import jscodeshift, { API, FileInfo } from 'jscodeshift';
import * as readline from 'node:readline';
import { readFileSync } from 'fs';
import { buildChangeMessage } from './buildChangeMessages';
import { FinishMessage, MessageKind, ProgressMessage } from './messages';
import { createHash } from 'crypto';
import { join } from 'path';
import { buildRewriteMessage } from './buildRewriteMessage';

import { codemods as nneCodemods } from '@nne/codemods';
import { codemods as muiCodemods } from '@nne/mui-codemods';
import { writeFileSync } from 'node:fs';
import { executeWorkerThread } from './executeWorkerThread';


if (!isMainThread) {
	executeWorkerThread();
}

const argv = Promise.resolve<{
	pattern: ReadonlyArray<string>;
	group?: ReadonlyArray<string>;
	outputDirectoryPath?: string;
	limit?: number,
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



argv.then(async ({ pattern, group, outputDirectoryPath, limit }) => {
	const interfase = readline.createInterface(process.stdin);

	interfase.on('line', async (line) => {
		if (line !== 'shutdown') {
			return;
		}

		process.exit(0);
	});

	const filePaths = await fastGlob(pattern.slice());
	let fileCount = 0;

	const totalFileCount = Math.min(limit, filePaths.length);

	for (const filePath of filePaths) {
		if (limit > 0 && fileCount === limit) {
			break;
		}

		++fileCount;

		await new Promise((resolve) => {
			const worker = new Worker(__filename, {
				workerData: {
					filePath,
					group,
					outputDirectoryPath,
					totalFileCount,
					fileCount,
				},
			});

			const timeout = setTimeout(
				async () => {
					await worker.terminate();
				},
				10000,
			);

			const onEvent = () => {
				clearTimeout(timeout);
				resolve(null);
			}

			worker.on('message', onEvent);
			worker.on('error', onEvent);
			worker.on('exit', onEvent);
		});
	}

	// the client should not rely on the finish message
	const finishMessage: FinishMessage = {
		k: MessageKind.finish,
	};

	console.log(JSON.stringify(finishMessage));

	process.exit(0);
});
