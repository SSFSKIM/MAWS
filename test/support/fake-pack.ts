// A `mawsd` pack as `pnpm mawsd:pack` assembles it (P5 O2 M8; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The
// pack"), for the Linux release directory's tests (src/mawsd/release.ts) and the installer's: `out/main/mawsd.js`, a
// stand-in of the externals' closure, its package.json naming the release, and, unless asked not to, `runtime/bin/node`.
// The release is `0.0.0-<commit>`, with `-<content>` when given: the pack's own names end in its content's hash.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function fakePack(where: string, commit: string, { runtime = true, content }: { runtime?: boolean; content?: string } = {}): string {
  const release = `0.0.0-${commit}${content === undefined ? '' : `-${content}`}`;
  const root = join(where, release);
  mkdirSync(join(root, 'out', 'main'), { recursive: true });
  writeFileSync(join(root, 'out', 'main', 'mawsd.js'), `// mawsd ${commit}${content === undefined ? '' : ` ${content}`}\n`);
  mkdirSync(join(root, 'out', 'main', 'assets'), { recursive: true });
  writeFileSync(join(root, 'out', 'main', 'assets', `asset-${content ?? commit}.css`), `/* ${release} */\n`); // a hashed ?asset file, as the engine host reads at run time
  mkdirSync(join(root, 'node_modules', 'zod'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'zod', 'package.json'), '{"name":"zod"}');
  if (runtime) {
    mkdirSync(join(root, 'runtime', 'bin'), { recursive: true });
    writeFileSync(join(root, 'runtime', 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 });
  }
  const manifest = { name: 'maws-mawsd', version: '0.0.0', private: true, main: 'out/main/mawsd.js', mawsd: { release, commit, platform: 'linux', arch: 'x64', node: runtime ? '24.21.0' : null } };
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

// The program a command line run from `root` is: its runtime (the pack's own, where it has one) and its entry.
export const packProgram = (root: string) => ({ runtime: join(root, 'runtime', 'bin', 'node'), entry: join(root, 'out', 'main', 'mawsd.js') });
