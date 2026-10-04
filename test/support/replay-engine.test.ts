import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { writeReplayEngine } from './replay-engine';

it('provides the fixture version without an installed engine and refuses all other invocations', () => {
  const root = mkdtempSync(join(tmpdir(), 'maws-replay-engine-'));
  try {
    const bin = writeReplayEngine(root);
    expect(execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim()).toBe('2.1.283 (Claude Code)');
    for (const args of [[], ['-p', 'hello'], ['--version', '-p', 'hello']]) {
      const result = spawnSync(bin, args, { encoding: 'utf8' });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('replay-only');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
