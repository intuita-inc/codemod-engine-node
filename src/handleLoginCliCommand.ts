import Axios from 'axios';
import type { PrinterBlueprint } from './printer.js';
import { openURL } from './utils.js';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCESS_TOKEN_REQUESTED_BY_CLI_KEY = 'accessTokenRequestedByCLI';
const X_INTUITA_ACCESS_TOKEN = 'X-Intuita-Access-Token'.toLocaleLowerCase();

export const validateAccessToken = async (
	accessToken: string,
): Promise<boolean> => {
	try {
		const response = await Axios.post(
			'https://telemetry.intuita.io/validateAccessToken',
			{ requestFrom: 'VSCE' },
			{
				headers: {
					[X_INTUITA_ACCESS_TOKEN]: accessToken,
				},
				timeout: 5000,
			},
		);

		return response.status === 200;
	} catch (error) {
		if (!Axios.isAxiosError(error)) {
			console.error(error);
		}

		return false;
	}
};

export const handleLoginCliCommand = async (
	printer: PrinterBlueprint,
	token: string | null,
) => {
	if (token === null) {
		printer.printConsoleMessage(
			'info',
			'Opening the Codemod Studio... Please Sign in with Github!',
		);
		const success = openURL(
			`https://codemod.studio/${ACCESS_TOKEN_REQUESTED_BY_CLI_KEY}`,
		);
		if (!success) {
			printer.printOperationMessage({
				kind: 'error',
				message:
					'Unexpected error occurred while opening the Codemod Studio.',
			});
		}
		return;
	}

	const valid = await validateAccessToken(token);
	if (!valid) {
		printer.printOperationMessage({
			kind: 'error',
			message:
				'The token is incorrect. Please run `intuita login` again and sign in again in the Codemod Studio.',
		});
	}

	const globalStoragePath = join(homedir(), '.intuita');

	const buildConfigPath = join(globalStoragePath, 'accessToken.json');

	await writeFile(
		buildConfigPath,
		JSON.stringify({
			accessToken: token,
		}),
	);

	printer.printConsoleMessage(
		'info',
		'You are successfully logged in with the Intuita CLI!',
	);
};
