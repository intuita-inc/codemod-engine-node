import { execSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

export const isGitDirectory = (directoryPath: string): boolean => {
	const gitPath = join(directoryPath, '.git');
	return existsSync(gitPath) && lstatSync(gitPath).isDirectory();
};

export const isFileInGitDirectory = (filePath: string): boolean => {
	try {
		execSync(`git ls-files --error-unmatch ${filePath}`);
		return true;
	} catch (error) {
		return false;
	}
};

export const getGitDiffForFile = (
	commitHash: string,
	filePath: string,
): { removedCode: string; addedCode: string } | null => {
	try {
		const diff = execSync(`git diff ${commitHash} --unified=1 ${filePath}`);
		const output = diff.toString();
		const lines = output.split('\n');

		let removedCode = '';
		let addedCode = '';
		let codeSnippetStarted = false;

		for (const line of lines) {
			if (line.startsWith('@@')) {
				codeSnippetStarted = true;

				const firstLineOfCode = (
					line.substring(line.lastIndexOf('@@') + 2) ?? ''
				).trimEnd();
				if (firstLineOfCode) {
					removedCode += firstLineOfCode + '\n';
					addedCode += firstLineOfCode + '\n';
				}
				continue;
			}

			if (!codeSnippetStarted) {
				continue;
			}

			if (line.startsWith('-')) {
				removedCode += line.substring(1).trimEnd() + '\n';
			} else if (line.startsWith('+')) {
				addedCode += line.substring(1).trimEnd() + '\n';
			} else {
				removedCode += line.trimEnd() + '\n';
				addedCode += line.trimEnd() + '\n';
			}
		}

		return { removedCode, addedCode };
	} catch (error) {
		if (!(error instanceof Error)) {
			return null;
		}
		console.error('Error while getting Git diff for file:', error.message);
		return null;
	}
};

export const getLatestCommitHash = (directoryPath: string): string | null => {
	try {
		const gitLog = execSync(`git -C ${directoryPath} log -n 1 --format=%H`);
		return gitLog.toString().trim();
	} catch (error) {
		if (!(error instanceof Error)) {
			return null;
		}
		console.error('Error while getting latest commit hash:', error.message);
		return null;
	}
};

export const findModifiedFiles = (): string[] | null => {
	try {
		const modifiedFiles = execSync('git ls-files --modified', {
			encoding: 'utf-8',
		});
		return modifiedFiles.trim().split('\n');
	} catch (error) {
		console.error('Error finding the modified files:', error);
		return null;
	}
};
