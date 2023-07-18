import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import * as ts from 'typescript';
import * as tsmorph from 'ts-morph';
import { Codemod } from './codemodRunner.js';
import {
	buildFormattedInternalCommands,
	handleFormattedInternalCommand,
	ModCommand,
} from './modCommands.js';
import { CompositeMod, runCompositeMod } from './compositeModRunner.js';
import { WorkerThreadMessage } from './workerThreadMessages.js';
import { decodeMainThreadMessage } from './mainThreadMessages.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

type CodemodExecutionErrorType = 'unrecognizedCodemod' | 'errorRunningCodemod';
class CodemodExecutionError extends Error {
	public readonly kind: CodemodExecutionErrorType;
	constructor(message: string, kind: CodemodExecutionErrorType) {
		super(message);
		this.kind = kind;
	}
}

// eslint-disable-next-line @typescript-eslint/ban-types
export const filterNeitherNullNorUndefined = <T>(value: T): value is T & {} =>
	value !== undefined && value !== null;

const getOldData = async (oldPath: string): Promise<string> => {
	const data = await readFile(oldPath, { encoding: 'utf8' });

	return data.replace(/\n\n/gm, '\n/** **/\n');
};

export const executeWorkerThread = () => {
	const messageHandler = async (m: unknown) => {
		const message = decodeMainThreadMessage(m);

		if (message.kind === 'exit') {
			parentPort?.off('message', messageHandler);
			return;
		}

		const {
			codemodFilePath,
			codemodHashDigests,
			filePath,
			outputDirectoryPath,
			formatWithPrettier,
		} = message;

		const oldData = await getOldData(filePath);

		const mods: (Codemod | CompositeMod)[] = [];

		if (codemodFilePath != null) {
			try {
				if (codemodFilePath.endsWith('.tsm.ts')) {
					const source = readFileSync(codemodFilePath, {
						encoding: 'utf8',
					});
					const compiledCode = ts.transpileModule(source, {
						compilerOptions: { module: ts.ModuleKind.CommonJS },
					});

					type Exports =
						| {
								__esModule?: true;
								default?: unknown;
								handleSourceFile?: unknown;
						  }
						// eslint-disable-next-line @typescript-eslint/ban-types
						| Function;

					const exports: Exports = {};
					const module = { exports };
					const req = (name: string) => {
						if (name === 'ts-morph') {
							return tsmorph;
						}
					};

					const keys = ['module', 'exports', 'require'];
					const values = [module, exports, req];

					// eslint-disable-next-line prefer-spread
					new Function(...keys, compiledCode.outputText).apply(
						null,
						values,
					);

					const transformer =
						typeof exports === 'function'
							? exports
							: exports.__esModule &&
							  typeof exports.default === 'function'
							? exports.default
							: typeof exports.handleSourceFile === 'function'
							? exports.handleSourceFile
							: null;

					if (transformer === null) {
						throw new Error(
							'Could not compile the provided codemod',
						);
					}

					mods.push({
						engine: 'ts-morph',
						caseTitle: codemodFilePath,
						transformer,
					});
				} else if (codemodFilePath.endsWith('.ts')) {
					// eslint-disable-next-line @typescript-eslint/no-var-requires
					const requireFromString = require('require-from-string');

					const source = readFileSync(codemodFilePath, {
						encoding: 'utf8',
					});
					const compiledCode = ts.transpileModule(source, {
						compilerOptions: { module: ts.ModuleKind.CommonJS },
					});

					const mod = requireFromString(compiledCode.outputText);

					const transformer = 'default' in mod ? mod.default : mod;

					mods.push({
						engine: 'jscodeshift',
						caseTitle: codemodFilePath,
						transformer,
						withParser: 'tsx',
					});
				} else {
					mods.push({
						engine: 'jscodeshift',
						caseTitle: codemodFilePath,
						transformer: require(codemodFilePath),
						withParser: 'tsx',
					});
				}
			} catch (error) {
				if (error instanceof Error) {
					console.error(
						JSON.stringify({
							message: error.message,
						}),
					);
				}
			}
		}

		for (const mod of mods) {
			// TODO: in the future, the hash digest will be embedded in the codemods
			if (
				codemodHashDigests.length > 0 &&
				!codemodHashDigests.includes(
					createHash('ripemd')
						.update(mod.caseTitle)
						.digest('base64url'),
				)
			) {
				continue;
			}

			let commands: ModCommand[];

			try {
				if (
					(mod.engine === 'jscodeshift' ||
						mod.engine === 'ts-morph') &&
					typeof mod.transformer === 'function' &&
					mod.transformer
				) {
					commands = [];
					// commands = runCodemod(
					// 	mod,
					// 	filePath,
					// 	oldData,
					// 	formatWithPrettier,
					// ).slice();
				} else if (mod.engine === 'composite-mod-engine') {
					const subMods = (mod.mods as unknown as string[])
						.map((caseTitle) =>
							mods.find((m) => caseTitle.endsWith(m.caseTitle)),
						)
						.filter(filterNeitherNullNorUndefined);

					const newMod = { ...mod, mods: subMods };

					commands = await runCompositeMod(
						newMod as any,
						filePath,
						oldData,
						formatWithPrettier,
					);
				} else {
					throw new CodemodExecutionError(
						`Unrecognized mod`,
						'unrecognizedCodemod',
					);
				}

				const formattedInternalCommands =
					await buildFormattedInternalCommands(commands);

				for (const formattedInternalCommand of formattedInternalCommands) {
					const message = await handleFormattedInternalCommand(
						outputDirectoryPath,
						formattedInternalCommand,
						true,
					);

					parentPort?.postMessage({
						kind: 'message',
						message,
					} satisfies WorkerThreadMessage);
				}
			} catch (error) {
				if (
					error instanceof CodemodExecutionError ||
					error instanceof Error
				) {
					console.error(
						JSON.stringify({
							message: error.message,
							caseTitle: mod.caseTitle,
							filePath,
							...('kind' in error ? { kind: error.kind } : {}),
						}),
					);
				}
			}
		}

		parentPort?.postMessage({
			kind: 'idleness',
		} satisfies WorkerThreadMessage);
	};

	parentPort?.on('message', messageHandler);
};
