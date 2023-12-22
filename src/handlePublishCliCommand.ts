import * as fs from 'fs';
import type { PrinterBlueprint } from './printer.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { object, string, parse } from 'valibot';
import { publish, validateAccessToken } from './apis.js';
import FormData from 'form-data';
import { mkdir, writeFile } from 'fs/promises';
import { createHash } from 'crypto';

const packageJsonSchema = object({
	main: string(),
	name: string(),
});

export const handlePublishCliCommand = async (
	printer: PrinterBlueprint,
	sourcePath: string,
) => {
	const intuitaDirectoryPath = join(homedir(), '.intuita');
	const tokenTxtPath = join(intuitaDirectoryPath, 'token.txt');

	const token = await fs.promises.readFile(tokenTxtPath, {
		encoding: 'utf-8',
	});

	const { username } = await validateAccessToken(token);

	if (username === null) {
		throw new Error(
			'The username of the current user is not known. Aborting the operation.',
		);
	}

	const packageJsonData = await fs.promises.readFile(
		join(sourcePath, 'package.json'),
		{
			encoding: 'utf-8',
		},
	);

	const pkg = parse(packageJsonSchema, JSON.parse(packageJsonData));

	if (
		!pkg.name.startsWith(`@${username}/`) ||
		!/[a-zA-Z0-9_/-]+/.test(pkg.name)
	) {
		throw new Error(
			'The package name must start with your username and contain allowed characters',
		);
	}

	const indexCjsData = await fs.promises.readFile(
		join(sourcePath, pkg.main),
		{
			encoding: 'utf-8',
		},
	);

	const configJsonData = JSON.stringify(
		{
			schemaVersion: '1.0.0',
			name: pkg.name,
			engine: 'jscodeshift',
		},
		null,
		2,
	);

	let descriptionMdData: string | null = null;

	try {
		descriptionMdData = await fs.promises.readFile(
			join(sourcePath, 'README.md'),
			{
				encoding: 'utf-8',
			},
		);
	} catch {
		//
	}

	const formData = new FormData();
	formData.append('index.cjs', Buffer.from(indexCjsData));
	formData.append('config.json', Buffer.from(configJsonData));

	if (descriptionMdData) {
		formData.append('description.md', descriptionMdData);
	}

	try {
		await publish(token, formData);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		printer.printConsoleMessage(
			'error',
			`Could not publish the "${pkg.name}" package: ${message}`,
		);
	}

	printer.printConsoleMessage(
		'info',
		`Published the "${pkg.name}" package successfully`,
	);

	await mkdir(intuitaDirectoryPath, { recursive: true });

	const newCodemodPath = createHash('ripemd160')
		.update(pkg.name)
		.digest('base64url');
	const syncDirectory = join(intuitaDirectoryPath, newCodemodPath);

	try {
		await writeFile(join(syncDirectory, 'config.json'), configJsonData);
		await writeFile(join(syncDirectory, 'index.cjs'), indexCjsData);
		if (descriptionMdData) {
			await writeFile(
				join(syncDirectory, 'index.cjs'),
				descriptionMdData,
			);
		}

		printer.printConsoleMessage(
			'info',
			`Sucessfully synced "${pkg.name}". Run it with "intuita ${pkg.name}"`,
		);
	} catch (err) {
		printer.printConsoleMessage(
			'error',
			`Failed performing automatic sync for "${pkg.name}": ${
				(err as Error).message
			}`,
		);

		printer.printConsoleMessage(
			'info',
			'Use the command "intuita sync ${pkg.name}" to make the package available for usage in the CLI or the VSCode Extension',
		);
	}
};
