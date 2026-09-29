import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadJournal } from '../../test/support/fixtures';
import { handshakeResponder, scriptedSession } from './conformance/session-harness';
import { memoryAppend, MemoryAppendBudgetSpent } from './memory-append';

// pass1/reads seq 69's get_memory_dialog answer, its paths moved under a temp directory (the user file is never ~/.claude)
const recorded = (loadJournal('pass1', 'reads').find((r) => r.seq === 69)!.frame as { response: { response: { files: { kind: string; path: string; exists: boolean }[]; folders: { path: string }[] } } }).response.response;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maws-memory-'));
  await mkdir(join(root, 'home', '.claude'), { recursive: true });
  await mkdir(join(root, 'project'), { recursive: true });
  await writeFile(join(root, 'home', '.claude', 'CLAUDE.md'), '# user\n');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function dialog() {
  return {
    ...recorded,
    files: [
      { ...recorded.files[0]!, path: join(root, 'home', '.claude', 'CLAUDE.md'), exists: true },
      { ...recorded.files[1]!, path: join(root, 'project', 'CLAUDE.md'), exists: false },
    ],
    folders: [{ ...recorded.folders[0]!, path: join(root, 'auto-memory') + '/' }],
  };
}

async function session() {
  const s = scriptedSession({ responder: handshakeResponder({ get_memory_dialog: () => ({ response: dialog() }) }) });
  await s.session.start();
  return s;
}

describe('memoryAppend (#)', () => {
  it('creates the project file listed with exists: false, appends the note, and appends again after', async () => {
    const s = await session();
    expect(await memoryAppend(s.session, { text: 'MAWS live test note', target: { kind: 'project', path: null } })).toEqual({ path: join(root, 'project', 'CLAUDE.md'), created: true });
    expect(await readFile(join(root, 'project', 'CLAUDE.md'), 'utf8')).toBe('\n- MAWS live test note\n');
    expect(await memoryAppend(s.session, { text: 'second', target: { kind: 'project', path: null } })).toEqual({ path: join(root, 'project', 'CLAUDE.md'), created: false });
    expect(await readFile(join(root, 'project', 'CLAUDE.md'), 'utf8')).toBe('\n- MAWS live test note\n\n- second\n');
    expect(s.transport.requestsOf('get_memory_dialog')).toHaveLength(2);
  });

  it('appends to the user file, and to a path that is a listed file or inside a listed folder', async () => {
    const s = await session();
    expect(await memoryAppend(s.session, { text: 'u', target: { kind: 'user', path: null } })).toEqual({ path: join(root, 'home', '.claude', 'CLAUDE.md'), created: false });
    expect(await readFile(join(root, 'home', '.claude', 'CLAUDE.md'), 'utf8')).toBe('# user\n\n- u\n');
    const inFolder = join(root, 'auto-memory', 'notes.md');
    expect(await memoryAppend(s.session, { text: 'f', target: { kind: 'path', path: inFolder } })).toEqual({ path: inFolder, created: true });
    expect(await readFile(inFolder, 'utf8')).toBe('\n- f\n');
  });

  it('appends to a plain nested file inside a listed folder, creating its missing folders', async () => {
    const s = await session();
    await mkdir(join(root, 'auto-memory', 'topics'), { recursive: true });
    const nested = join(root, 'auto-memory', 'topics', 'build.md');
    expect(await memoryAppend(s.session, { text: 'n', target: { kind: 'path', path: nested } })).toEqual({ path: nested, created: true });
    expect(await memoryAppend(s.session, { text: 'm', target: { kind: 'path', path: nested } })).toEqual({ path: nested, created: false });
    expect(await readFile(nested, 'utf8')).toBe('\n- n\n\n- m\n');
    const deeper = join(root, 'auto-memory', 'missing', 'deeper', 'x.md');
    expect(await memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: deeper } })).toEqual({ path: deeper, created: true });
    expect(await readFile(deeper, 'utf8')).toBe('\n- x\n');
  });

  it('creates no folder outside a listed folder: not through an in-folder link to outside, not through a dangling link, not beside the folder', async () => {
    const s = await session();
    const outside = join(root, 'outside-folders');
    await mkdir(outside, { recursive: true });
    await mkdir(join(root, 'auto-memory'), { recursive: true });
    await symlink(outside, join(root, 'auto-memory', 'portal'));
    await symlink(join(outside, 'later'), join(root, 'auto-memory', 'dangling'));
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'portal', 'new', 'x.md') } })).rejects.toThrow(/not in an existing directory/);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'dangling', 'x.md') } })).rejects.toThrow(/not in an existing directory/);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'beside', 'x.md') } })).rejects.toThrow(/not in an existing directory/);
    await expect(readFile(join(outside, 'new', 'x.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(outside, 'later', 'x.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, 'beside', 'x.md'), 'utf8')).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(root)).not.toContain('beside');
  });

  // M4 review, re-review and re-review 2: nothing that is a link at the final component is followed, and a parent that
  // really lies outside a listed folder is refused, whatever the lexical path says.
  const REFUSED = /not one of the memory files|symbolic link|not in an existing directory/;

  it('refuses a file link and a directory link inside a listed folder that point outside', async () => {
    const s = await session();
    const outside = join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.md'), 'secret\n');
    await mkdir(join(root, 'auto-memory'), { recursive: true });
    await symlink(join(outside, 'secret.md'), join(root, 'auto-memory', 'escape.md'));
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'escape.md') } })).rejects.toThrow(/symbolic link/);
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('secret\n');
  });

  it('refuses a symlinked parent directory that resolves outside the listed folder', async () => {
    const s = await session();
    const outside = join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await mkdir(join(root, 'auto-memory'), { recursive: true });
    await symlink(outside, join(root, 'auto-memory', 'linked-dir'));
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'linked-dir', 'new.md') } })).rejects.toThrow(/not one of the memory files/);
    await expect(readFile(join(outside, 'new.md'), 'utf8')).rejects.toThrow();
    // a listed folder reached through a symlink still accepts what is really inside it
    await symlink(join(root, 'auto-memory'), join(root, 'memory-link'));
    expect(await memoryAppend(s.session, { text: 'ok', target: { kind: 'path', path: join(root, 'memory-link', 'notes.md') } })).toMatchObject({ created: true });
    expect(await readFile(join(root, 'auto-memory', 'notes.md'), 'utf8')).toBe('\n- ok\n');
  });

  it('refuses dangling links at the final component, pointing outside or inside the folder, creating nothing', async () => {
    const s = await session();
    const outside = join(root, 'outside-dangling');
    await mkdir(outside, { recursive: true });
    await mkdir(join(root, 'auto-memory'), { recursive: true });
    await symlink(join(outside, 'not-yet.md'), join(root, 'auto-memory', 'dangling.md'));
    await symlink(join(outside, 'missing-dir'), join(root, 'auto-memory', 'dangling-dir'));
    await symlink(join(root, 'auto-memory', 'later.md'), join(root, 'auto-memory', 'inside.md')); // stays inside, still a link: refused
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'dangling.md') } })).rejects.toThrow(/symbolic link/);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'dangling-dir', 'new.md') } })).rejects.toThrow(REFUSED);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'inside.md') } })).rejects.toThrow(/symbolic link/);
    await expect(readFile(join(outside, 'not-yet.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(outside, 'missing-dir', 'new.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, 'auto-memory', 'later.md'), 'utf8')).rejects.toThrow();
  });

  it('refuses the reviewer\'s nested dangling link (outer -> inner/../escaped.md with inner -> outside/sub), creating nothing outside', async () => {
    const s = await session();
    const allowed = join(root, 'auto-memory');
    await mkdir(join(root, 'outside', 'sub'), { recursive: true });
    await mkdir(allowed, { recursive: true });
    await symlink(join(root, 'outside', 'sub'), join(allowed, 'inner'));
    await symlink('inner/../escaped.md', join(allowed, 'outer')); // dangling; the kernel would resolve it to outside/escaped.md
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(allowed, 'outer') } })).rejects.toThrow(/symbolic link/);
    await expect(readFile(join(root, 'outside', 'escaped.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(allowed, 'escaped.md'), 'utf8')).rejects.toThrow();
  });

  it('refuses a path outside the listed files and folders, writing nothing', async () => {
    const s = await session();
    const outside = join(root, 'elsewhere.md');
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: outside } })).rejects.toThrow(/not one of the memory files/);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', '..', 'escape.md') } })).rejects.toThrow(/not one of the memory files/);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: null } })).rejects.toThrow(/path/);
    await expect(readFile(outside, 'utf8')).rejects.toThrow();
  });

  // M5 review (Important 3): the bridge answers `timeout` at the host's 8 s budget, so nothing may change on disk after it.
  it('refuses to create or append once the budget is spent while the dialog was read, and commits inside it', async () => {
    let clock = 1_000;
    const slow = scriptedSession({
      responder: handshakeResponder({
        get_memory_dialog: () => {
          clock += 8_000; // the read took the whole budget
          return { response: dialog() };
        },
      }),
    });
    await slow.session.start();
    const now = () => clock;
    const spent = memoryAppend(slow.session, { text: 'late', target: { kind: 'project', path: null } }, { budgetMs: 8_000, now });
    await expect(spent).rejects.toBeInstanceOf(MemoryAppendBudgetSpent);
    await expect(readFile(join(root, 'project', 'CLAUDE.md'), 'utf8')).rejects.toThrow(); // not even created
    await expect(memoryAppend(slow.session, { text: 'late', target: { kind: 'user', path: null } }, { budgetMs: 8_000, now })).rejects.toBeInstanceOf(MemoryAppendBudgetSpent);
    expect(await readFile(join(root, 'home', '.claude', 'CLAUDE.md'), 'utf8')).toBe('# user\n'); // unchanged

    // the budget runs out between the read and the write (after the file was opened, just before the commit): no bytes
    // land, a file this call created is removed, and an existing file is left as it was (M5 re-review)
    const atCommit = await session();
    const clockAt = (spentFromCall: number) => {
      let calls = 0;
      return () => (++calls >= spentFromCall ? 20_000 : 1_000); // calls: deadline, read budget, before open, before commit
    };
    await expect(memoryAppend(atCommit.session, { text: 'late', target: { kind: 'project', path: null } }, { budgetMs: 8_000, now: clockAt(4) })).rejects.toBeInstanceOf(MemoryAppendBudgetSpent);
    await expect(readFile(join(root, 'project', 'CLAUDE.md'), 'utf8')).rejects.toThrow();
    await expect(memoryAppend(atCommit.session, { text: 'late', target: { kind: 'user', path: null } }, { budgetMs: 8_000, now: clockAt(4) })).rejects.toBeInstanceOf(MemoryAppendBudgetSpent);
    expect(await readFile(join(root, 'home', '.claude', 'CLAUDE.md'), 'utf8')).toBe('# user\n');

    const quick = await session();
    expect(await memoryAppend(quick.session, { text: 'in time', target: { kind: 'project', path: null } }, { budgetMs: 8_000, now: () => clock })).toEqual({ path: join(root, 'project', 'CLAUDE.md'), created: true });
    expect(quick.transport.requestsOf('get_memory_dialog')).toHaveLength(1);
  });
});
