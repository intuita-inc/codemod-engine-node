import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { Repomod, executeRepomod } from '@intuita-inc/repomod-engine-api';
import { buildApi } from '@intuita-inc/repomod-engine-api';
import { UnifiedFileSystem } from '@intuita-inc/repomod-engine-api';
import { FileSystemManager } from '@intuita-inc/repomod-engine-api';
import jscodeshift from 'jscodeshift';
import rehypeParse from 'rehype-parse';
import { unified } from 'unified';
import hastToBabelAst from '@svgr/hast-util-to-babel-ast';
import tsmorph from 'ts-morph';
import { ModCommand } from './modCommands.js';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown, mdxToMarkdown } from 'mdast-util-mdx';
import { visit } from 'unist-util-visit';

const parseMdx = (data: string) =>
	fromMarkdown(data, {
		extensions: [mdxjs()],
		mdastExtensions: [mdxFromMarkdown()],
	});

const stringifyMdx = (tree: Root) =>
	toMarkdown(tree, { extensions: [mdxToMarkdown()] });

type Root = ReturnType<typeof fromMarkdown>;

export type Dependencies = Readonly<{
	jscodeshift: typeof jscodeshift;
	unified: typeof unified;
	rehypeParse: typeof rehypeParse;
	hastToBabelAst: typeof hastToBabelAst;
	tsmorph: typeof tsmorph;
	parseMdx: typeof parseMdx;
	stringifyMdx: typeof stringifyMdx;
	visitMdxAst: typeof visit;
}>;

export const runRepomod = async (
	repomod: Repomod<Dependencies>,
	inputPath: string,
	formatWithPrettier: boolean,
): Promise<readonly ModCommand[]> => {
	const fileSystemManager = new FileSystemManager(
		fsPromises.readdir,
		fsPromises.readFile,
		fsPromises.stat,
	);
	const unifiedFileSystem = new UnifiedFileSystem(fs, fileSystemManager);

	const api = buildApi<Dependencies>(unifiedFileSystem, () => ({
		jscodeshift,
		unified,
		rehypeParse,
		hastToBabelAst,
		tsmorph,
		parseMdx,
		stringifyMdx,
		visitMdxAst: visit,
	}));

	const externalFileCommands = await executeRepomod(
		api,
		repomod,
		inputPath,
		{},
	);

	return Promise.all(
		externalFileCommands.map(async (externalFileCommand) => {
			if (externalFileCommand.kind === 'upsertFile') {
				try {
					await fsPromises.stat(externalFileCommand.path);

					return {
						kind: 'updateFile',
						oldPath: externalFileCommand.path,
						oldData: '', // TODO get the old data from the repomod
						newData: externalFileCommand.data,
						formatWithPrettier,
					};
				} catch (error) {
					return {
						kind: 'createFile',
						newPath: externalFileCommand.path,
						newData: externalFileCommand.data,
						formatWithPrettier,
					};
				}
			}

			return {
				kind: 'deleteFile',
				oldPath: externalFileCommand.path,
			};
		}),
	);
};
