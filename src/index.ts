import yargs from "yargs";
import {hideBin} from "yargs/helpers"
import fastGlob from 'fast-glob';
import jscodeshift, { API, FileInfo } from "jscodeshift";
import { readFileSync } from "fs";
import transformer from "./codemods/nextJsNewLink";
import { buildChanges } from "./buildChanges";

const argv = Promise.resolve<{ pattern: string }>(yargs(hideBin(process.argv))
  .option('pattern', {
    alias: 'p',
    describe: 'Pass the glob pattern for file paths',
    type: 'string',
  })
  .demandOption(['pattern'], 'Please provide the pattern argument to work with nora-node-engine')
  .help()
  .alias('help', 'h').argv);

argv.then(async ({ pattern }) => {
    console.log(pattern);

    const stream = fastGlob.stream(pattern);

    for await (const filePath of stream) {
        const oldSource = readFileSync(filePath, { encoding: 'utf8' });

        try {
            const fileInfo: FileInfo = {
                path: String(filePath),
                source: oldSource,
            }

            const api: API = {
                j: jscodeshift,
                jscodeshift,
                stats: () => {},
                report: () => {},
            }

            const newSource = transformer(fileInfo, api);

            const changes = buildChanges(String(filePath), oldSource, newSource);

            for (const change of changes) {
                const str = JSON.stringify(change);

                console.log(str);
            }
        } catch (error) {
            console.log(error);
        }
    }

    console.log('finish');
});