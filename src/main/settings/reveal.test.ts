import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealPath } from './reveal';

// The real realpath, counted, so a test can see how many paths the guard resolves.
const fsCalls = vi.hoisted(() => ({ realpath: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, realpath: (path: string) => (fsCalls.realpath.push(path), actual.realpath(path)) };
});

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

// `show` stands for Finder: the client port's reveal records each path it shows.
const deps = (show = vi.fn()) => ({ configHome: () => configHome, sessionDirectories: () => [session, extra], port: { reveal: async (_client: unknown, path: string) => (show(path), { revealed: true as const }) } });

describe('settings.reveal refuses paths outside the guard', () => {
  it('refuses /etc/passwd, a .. escape out of the config home, and a path outside the session directories', async () => {
    const show = vi.fn();
    for (const path of ['/etc/passwd', `${configHome}/../.ssh/id_rsa`, join(elsewhere, 'CLAUDE.md')]) {
      expect(await revealPath(path, null, deps(show)), path).toEqual({ revealed: false });
    }
    expect(show).not.toHaveBeenCalled();
  });

  it("accepts ~/.claude/settings.json and a file under a session record's directory or additional directory", async () => {
    const show = vi.fn();
    expect(await revealPath(join(configHome, 'settings.json'), null, deps(show))).toEqual({ revealed: true });
    expect(await revealPath(join(session, 'CLAUDE.md'), null, deps(show))).toEqual({ revealed: true });
    expect(await revealPath(join(extra, 'notes.md'), null, deps(show))).toEqual({ revealed: true });
    expect(show.mock.calls).toEqual([[join(configHome, 'settings.json')], [join(session, 'CLAUDE.md')], [join(extra, 'notes.md')]]);
  });

  it('refuses a symlink inside a root that points outside it, and follows one that stays inside', async () => {
    symlinkSync(join(home, '.ssh', 'id_rsa'), join(session, 'key'));
    symlinkSync(join(session, 'CLAUDE.md'), join(configHome, 'project-notes'));
    const show = vi.fn();
    expect(await revealPath(join(session, 'key'), null, deps(show))).toEqual({ revealed: false });
    expect(await revealPath(join(configHome, 'project-notes'), null, deps(show))).toEqual({ revealed: true });
    expect(show.mock.calls).toEqual([[join(session, 'CLAUDE.md')]]);
  });

  it('refuses a relative path, a path that does not exist, and a sibling whose name only begins with a root', async () => {
    mkdirSync(`${session}-evil`);
    writeFileSync(join(`${session}-evil`, 'x'), 'x');
    const show = vi.fn();
    for (const path of ['.claude/settings.json', join(session, 'missing.md'), join(`${session}-evil`, 'x')]) {
      expect(await revealPath(path, null, deps(show)), path).toEqual({ revealed: false });
    }
    expect(show).not.toHaveBeenCalled();
  });

  it('resolves each distinct root once, however many sessions share it', async () => {
    fsCalls.realpath.length = 0;
    const many = { ...deps(), sessionDirectories: () => [session, extra, session, session, extra] };
    expect(await revealPath(join(session, 'CLAUDE.md'), null, many)).toEqual({ revealed: true });
    expect(fsCalls.realpath.sort()).toEqual([join(session, 'CLAUDE.md'), configHome, extra, session].sort());
  });

  it('reveals a root itself, and survives a root that does not exist', async () => {
    const show = vi.fn();
    expect(await revealPath(session, null, { ...deps(show), sessionDirectories: () => ['/nonexistent/maws', session] })).toEqual({ revealed: true });
    expect(show).toHaveBeenCalledExactlyOnceWith(session);
  });
});
