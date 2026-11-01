// One installer of render-install.test.ts's two-process race (P5 O5 M6, fix wave 1): `installRenderRuntime` in a process
// of its own, from the zip a pack carries, with `unzip` and `sudo` faked (the helper's root ownership a marker file
// beside it, since a test cannot chown to root) and each checkpoint a barrier the parent releases over IPC, so the two
// installers reach each step together. Bundled by the test with esbuild and forked twice.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installRenderRuntime } from './render-install';
import type { ElectronPin } from './render-runtime';

const [home, zip, pinText] = process.argv.slice(2) as [string, string, string];
const pin = JSON.parse(pinText) as ElectronPin;
const released = new Map<string, () => void>();
process.on('message', (message: { go?: string }) => {
  if (message.go !== undefined) released.get(message.go)?.();
});
const barrier = (step: string) =>
  new Promise<void>((resolve) => {
    released.set(step, resolve);
    process.send!({ at: step });
  });
const ok = { status: 0, stdout: '', stderr: '' };
const gone = { status: 1, stdout: '', stderr: 'No such file or directory' };

installRenderRuntime({
  home,
  arch: 'x64',
  uid: 1000,
  pin,
  packZip: zip,
  run: (command, args) => {
    if (command === 'unzip') {
      const into = args[args.indexOf('-d') + 1]!;
      for (const name of ['electron', 'chrome-sandbox']) writeFileSync(join(into, name), name);
      return ok;
    }
    if (command === 'sudo') {
      const helper = args[3]!;
      if (!existsSync(helper)) return gone;
      if (args[1] === 'chmod') writeFileSync(`${helper}.suid`, '');
      return ok;
    }
    return { status: 127, stdout: '', stderr: `${command}: not faked` };
  },
  download: () => Promise.reject(new Error('the racer installs from the pack’s zip')),
  processes: () => [],
  helperConfigured: (path) => existsSync(`${path}.suid`),
  now: () => Date.parse('2026-10-31T12:00:00Z'),
  checkpoint: barrier,
}).then(
  (outcome) => process.send!({ outcome }),
  (error: unknown) => process.send!({ error: error instanceof Error ? error.message : String(error) }),
);
