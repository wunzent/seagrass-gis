// Load gis-web/.env before the Next CLI starts so PORT applies to `next dev`/`next start`.
// `node --env-file --run` does not pass the file to the script on Node 22, and Next's own
// .env loader runs after the port is chosen. Values already in the environment win.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

if (existsSync('.env')) process.loadEnvFile('.env');

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
