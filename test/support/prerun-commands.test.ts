import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { hookStartedCommand, terminalPwdCommand } from './prerun-commands';

test('pre-run commands accept spaces and shell metacharacters without losing PPID expansion', () => {
  const temp = mkdtempSync(join(tmpdir(), 'maws-shell-test-'));
  const root = join(temp, "root with space ' $HOME ; `echo nope`");
  mkdirSync(join(root, 'hooks'), { recursive: true });
  try {
    const ppid = execFileSync('/bin/sh', ['-c', `${hookStartedCommand(root)}; printf '%s' "$PPID"`], { cwd: root, encoding: 'utf8' });
    expect(existsSync(join(root, 'hooks', `started-${ppid}`))).toBe(true);
    const file = join(root, 'terminal pwd.txt');
    execFileSync('/bin/sh', ['-c', terminalPwdCommand(file)], { cwd: root });
    expect(readFileSync(file, 'utf8').trim()).toBe(execFileSync('/bin/pwd', [], { cwd: root, encoding: 'utf8' }).trim());
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
