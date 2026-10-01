// The scratch shell home (shell-home.ts) against real shells, with the owner's HOME left in place as an app launch
// leaves it. Each shell runs one `-c` command with its input closed, so nothing is typed and nothing joins a history.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROFILE_VARIABLE, writeScratchShellHome } from './shell-home';

describe('a scratch shell home', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'maws-shell-home-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  // The last line the shell printed (a system startup file may print before it).
  const answer = (shell: string, args: string[], env: Record<string, string>) =>
    execFileSync(shell, args, { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4_000 }).trimEnd().split('\n').at(-1);

  it('gives a zsh login shell its own profile and history file instead of the owner home’s', () => {
    const { env } = writeScratchShellHome(dir);
    expect(answer('/bin/zsh', ['-ilc', `print -r -- "$${PROFILE_VARIABLE}|$HISTFILE"`], env)).toBe(`.zprofile|${dir}/.zsh_history`);
  });

  it('gives an interactive sh its history file', () => {
    const { env } = writeScratchShellHome(dir);
    expect(answer('/bin/sh', ['-ic', 'printf "%s\\n" "$HISTFILE"'], env)).toBe(`${dir}/.sh_history`);
  });
});
