// `pnpm --filter desk-hub fake-machine <enroll|run> …`: bundles the command with esbuild and runs it. Node's own type
// stripping cannot load the protocol module (its imports name no extension), so this launcher, which it can load,
// bundles cli.ts first, as the suites' setup bundles the Worker.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const dir = mkdtempSync(join(tmpdir(), 'fake-machine-'));
const outfile = join(dir, 'cli.mjs');
await build({ entryPoints: [resolve(import.meta.dirname, 'cli.ts')], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'error' });
const { main } = (await import(pathToFileURL(outfile).href)) as { main: (argv: string[], defaults: { recording: string }) => Promise<number> };
rmSync(dir, { recursive: true, force: true });
process.exitCode = await main(process.argv.slice(2), { recording: resolve(import.meta.dirname, 'recordings', 'two-subagents') });
