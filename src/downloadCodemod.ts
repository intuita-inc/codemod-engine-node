import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { downloadFile } from './fileSystemUtilities.js';
import { inflate } from 'node:zlib';
import { promisify } from 'node:util';

import { Printer } from './printer.js';
import { Codemod, codemodConfigSchema } from './codemod.js';

import * as S from '@effect/schema/Schema';

const promisifiedInflate = promisify(inflate);
const CODEMOD_REGISTRY_URL =
	'https://intuita-public.s3.us-west-1.amazonaws.com/codemod-registry';

export class CodemodDownloader {
	public constructor(private readonly __printer: Printer) {}

	public async download(
		name: string,
		cache: boolean,
	): Promise<Codemod & { source: 'registry' }> {
		this.__printer.info(
			'Downloading the "%s" codemod, %susing cache',
			name,
			cache ? '' : 'not ',
		);

		// make the intuita directory
		const intuitaDirectoryPath = join(homedir(), '.intuita');

		await mkdir(intuitaDirectoryPath, { recursive: true });

		// make the codemod directory
		const hashDigest = createHash('ripemd160')
			.update(name)
			.digest('base64url');
		const directoryPath = join(intuitaDirectoryPath, hashDigest);

		await mkdir(directoryPath, { recursive: true });

		// download the config
		const configPath = join(directoryPath, 'config.json');

		const buffer = await downloadFile(
			`${CODEMOD_REGISTRY_URL}/${hashDigest}/config.json`,
			configPath,
			cache,
		);

		const parsedConfig = JSON.parse(buffer.toString('utf8'));

		const config = S.parseSync(codemodConfigSchema)(parsedConfig);

		{
			const descriptionPath = join(directoryPath, 'description.md');

			try {
				await downloadFile(
					`${CODEMOD_REGISTRY_URL}/${hashDigest}/description.md`,
					descriptionPath,
					cache,
				);
			} catch {
				// do nothing, descriptions might not exist
			}
		}

		if (config.engine === 'piranha') {
			const rulesPath = join(directoryPath, 'rules.toml');

			await downloadFile(
				`${CODEMOD_REGISTRY_URL}/${hashDigest}/rules.toml`,
				rulesPath,
				cache,
			);

			return {
				source: 'registry',
				name,
				engine: config.engine,
				directoryPath,
			};
		}

		if (
			config.engine === 'jscodeshift' ||
			config.engine === 'repomod-engine' ||
			config.engine === 'ts-morph'
		) {
			const deflatedIndexPath = join(directoryPath, 'index.cjs.z');

			const compressedData = await downloadFile(
				`${CODEMOD_REGISTRY_URL}/${hashDigest}/index.cjs.z`,
				deflatedIndexPath,
				cache,
			);

			const inflatedData = await promisifiedInflate(compressedData);

			const indexPath = join(directoryPath, 'index.cjs');

			await writeFile(indexPath, inflatedData);

			return {
				source: 'registry',
				name,
				engine: config.engine,
				indexPath,
				directoryPath,
			};
		}

		if (config.engine === 'recipe') {
			const codemods: Codemod[] = [];

			for (const name of config.names) {
				const codemod = await this.download(name, cache);
				codemods.push(codemod);
			}

			return {
				source: 'registry',
				name,
				engine: config.engine,
				codemods,
				directoryPath,
			};
		}

		throw new Error('Unsupported engine');
	}
}
