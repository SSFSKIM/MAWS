// `pnpm --filter desk-hub deployment <command> …`: the deployment's commands (deploy/README.md). Node's own type
// stripping cannot load the protocol module (its imports name no extension), so, as fake-machine/bin.ts does, this
// launcher bundles the command with esbuild first and runs its `main`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const COMMANDS = ['deploy', 'probe', 'fake-check', 'redeploy-check', 'measure', 'frame-cost', 'counts', 'access-sync', 'relay-measure', 'acceptance', 'admin'];
const [command, ...args] = process.argv.slice(2);
if (!COMMANDS.includes(command)) {
  console.error(`usage: deployment <${COMMANDS.join('|')}> [options]; see apps/desk-hub/deploy/README.md`);
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), 'desk-deployment-'));
const outfile = join(dir, `${command}.mjs`);
await build({
  entryPoints: [resolve(import.meta.dirname, `${command}.ts`)],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'error',
  // The bundle runs from a temporary directory; a command finds the app's files from here.
  define: { 'process.env.DESK_HUB_APP': JSON.stringify(resolve(import.meta.dirname, '..')) },
});
const { main } = (await import(pathToFileURL(outfile).href)) as { main: (argv: string[]) => Promise<number> };
rmSync(dir, { recursive: true, force: true });
// The command's status ends the process once its own cleanup has run, so nothing it started (a socket, a reconnect, a
// timer) can outlive it; stdout is flushed first.
const status = await main(args);
process.stdout.write('', () => process.exit(status));
