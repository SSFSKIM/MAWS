// Exercise the real builders without launching Electron or an engine. Kept in the e2e
// TypeScript project because panel-support also contains browser-evaluation callbacks.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { GitFixture } from '../test/support/git-fixture';
import { buildCodeScratch } from './support/code-scratch';
import { scratchRepository } from './support/panel-support';

for (const [name, build] of [['panel', scratchRepository], ['code', buildCodeScratch]] as const) {
  test(`${name} scratch ignores inherited Git routing and leaves the foreign repository unchanged`, async () => {
    const foreign = await GitFixture.create();
    const before = { ...process.env };
    let scratch: ReturnType<typeof build> | undefined;
    try {
      const head = await foreign.git('rev-parse', 'HEAD');
      process.env.GIT_DIR = join(foreign.root, '.git');
      process.env.GIT_WORK_TREE = foreign.root;
      for (const key of ['GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CONFIG_COUNT']) process.env[key] = 'must-not-reach-child';
      scratch = build();
      expect(scratch.git('rev-parse', '--show-toplevel')).toBe(scratch.dir);
      expect(await foreign.git('rev-parse', 'HEAD')).toBe(head);
      expect(await foreign.git('status', '--porcelain')).toBe('');
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
      scratch?.cleanup();
      foreign.dispose();
    }
  });
}
