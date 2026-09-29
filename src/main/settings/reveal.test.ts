import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealPath } from './reveal';

// A fake home: ~/.claude with settings.json, ~/.ssh/id_rsa beside it, a session directory with a file, and a directory
// no session names. realpathSync: macOS's tmpdir is itself behind a symlink (/var → /private/var).
let home: string;
let configHome: string;
let session: string;
let extra: string;
let elsewhere: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'maws-reveal-')));
  configHome = join(home, '.claude');
  session = join(home, 'work', 'repo');
  extra = join(home, 'work', 'shared-docs');
  elsewhere = join(home, 'work', 'other');
  for (const d of [configHome, join(home, '.ssh'), session, extra, elsewhere]) mkdirSync(d, { recursive: true });
  writeFileSync(join(configHome, 'settings.json'), '{}');
  writeFileSync(join(home, '.ssh', 'id_rsa'), 'secret');
  writeFileSync(join(session, 'CLAUDE.md'), '# notes');
  writeFileSync(join(extra, 'notes.md'), 'x');
  writeFileSync(join(elsewhere, 'CLAUDE.md'), 'x');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const deps = (show = vi.fn()) => ({ configHome: () => configHome, sessionDirectories: () => [session, extra], showItemInFolder: show });

describe('settings.reveal refuses paths outside the guard', () => {
  it('refuses /etc/passwd, a .. escape out of the config home, and a path outside the session directories', async () => {
    const show = vi.fn();
    for (const path of ['/etc/passwd', `${configHome}/../.ssh/id_rsa`, join(elsewhere, 'CLAUDE.md')]) {
      expect(await revealPath(path, deps(show)), path).toEqual({ revealed: false });
    }
    expect(show).not.toHaveBeenCalled();
  });

  it("accepts ~/.claude/settings.json and a file under a session record's directory or additional directory", async () => {
    const show = vi.fn();
    expect(await revealPath(join(configHome, 'settings.json'), deps(show))).toEqual({ revealed: true });
    expect(await revealPath(join(session, 'CLAUDE.md'), deps(show))).toEqual({ revealed: true });
    expect(await revealPath(join(extra, 'notes.md'), deps(show))).toEqual({ revealed: true });
    expect(show.mock.calls).toEqual([[join(configHome, 'settings.json')], [join(session, 'CLAUDE.md')], [join(extra, 'notes.md')]]);
  });

  it('refuses a symlink inside a root that points outside it, and follows one that stays inside', async () => {
    symlinkSync(join(home, '.ssh', 'id_rsa'), join(session, 'key'));
    symlinkSync(join(session, 'CLAUDE.md'), join(configHome, 'project-notes'));
    const show = vi.fn();
    expect(await revealPath(join(session, 'key'), deps(show))).toEqual({ revealed: false });
    expect(await revealPath(join(configHome, 'project-notes'), deps(show))).toEqual({ revealed: true });
    expect(show.mock.calls).toEqual([[join(session, 'CLAUDE.md')]]);
  });

  it('refuses a relative path, a path that does not exist, and a sibling whose name only begins with a root', async () => {
    mkdirSync(`${session}-evil`);
    writeFileSync(join(`${session}-evil`, 'x'), 'x');
    const show = vi.fn();
    for (const path of ['.claude/settings.json', join(session, 'missing.md'), join(`${session}-evil`, 'x')]) {
      expect(await revealPath(path, deps(show)), path).toEqual({ revealed: false });
    }
    expect(show).not.toHaveBeenCalled();
  });

  it('reveals a root itself, and survives a root that does not exist', async () => {
    const show = vi.fn();
    expect(await revealPath(session, { ...deps(show), sessionDirectories: () => ['/nonexistent/maws', session] })).toEqual({ revealed: true });
    expect(show).toHaveBeenCalledExactlyOnceWith(session);
  });
});
