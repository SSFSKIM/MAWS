import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadJournal } from '../../test/support/fixtures';
import { handshakeResponder, scriptedSession } from './conformance/session-harness';
import { memoryAppend } from './memory-append';

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

  it('refuses a symlink escape: a file link or a directory link inside a listed folder (M4 review)', async () => {
    const s = await session();
    const outside = join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.md'), 'secret\n');
    await mkdir(join(root, 'auto-memory'), { recursive: true });
    await symlink(join(outside, 'secret.md'), join(root, 'auto-memory', 'escape.md'));
    await symlink(outside, join(root, 'auto-memory', 'linked-dir'));
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'escape.md') } })).rejects.toThrow(/not one of the memory files/);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', 'linked-dir', 'new.md') } })).rejects.toThrow(/not one of the memory files/);
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('secret\n');
    await expect(readFile(join(outside, 'new.md'), 'utf8')).rejects.toThrow();
    // a listed folder reached through a symlink still accepts what is really inside it
    await symlink(join(root, 'auto-memory'), join(root, 'memory-link'));
    expect(await memoryAppend(s.session, { text: 'ok', target: { kind: 'path', path: join(root, 'memory-link', 'notes.md') } })).toMatchObject({ created: true });
    expect(await readFile(join(root, 'auto-memory', 'notes.md'), 'utf8')).toBe('\n- ok\n');
  });

  it('refuses a path outside the listed files and folders, writing nothing', async () => {
    const s = await session();
    const outside = join(root, 'elsewhere.md');
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: outside } })).rejects.toThrow(/not one of the memory files/);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: join(root, 'auto-memory', '..', 'escape.md') } })).rejects.toThrow(/not one of the memory files/);
    await expect(memoryAppend(s.session, { text: 'x', target: { kind: 'path', path: null } })).rejects.toThrow(/path/);
    await expect(readFile(outside, 'utf8')).rejects.toThrow();
  });
});
