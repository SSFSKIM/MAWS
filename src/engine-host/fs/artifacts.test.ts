import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreFixture } from '../../../test/support/store-fixture';
import { readSpill, SPILL_DEFAULT_LENGTH } from './artifacts';
import { resolveStorePaths } from './paths';

const S1 = '11111111-1111-4111-8111-111111111111';
const OUTSIDE = 'path outside the engine store';

describe('fs.readSpill reads engine artifacts by the path the engine reported', () => {
  let fixture: StoreFixture;
  let spill: string;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
    await fixture.addTranscript('/work/a', S1, ['{"type":"queue-operation"}']);
    spill = await fixture.addSidecar(S1, 'tool-results/b95u0622n.txt', 'x'.repeat(3000));
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  it('reads a spill whole, or a bounded window of it with truncated set and bytes the file size', async () => {
    expect(await readSpill(fixture.paths, { path: spill })).toEqual({ content: 'x'.repeat(3000), bytes: 3000, offset: 0, length: 3000, truncated: false });
    expect(await readSpill(fixture.paths, { path: spill, length: 1000 })).toEqual({ content: 'x'.repeat(1000), bytes: 3000, offset: 0, length: 1000, truncated: true });
    expect(await readSpill(fixture.paths, { path: spill, offset: 2500, length: 1000 })).toEqual({ content: 'x'.repeat(500), bytes: 3000, offset: 2500, length: 500, truncated: false });
    expect(SPILL_DEFAULT_LENGTH).toBe(1024 * 1024);
  });

  it('ends a page on a UTF-8 character boundary and answers the bytes it consumed, so the next page starts at offset + length (C8b\'s ask)', async () => {
    // 'ab' then '€' (E2 82 AC) at bytes 2..4, then 'cd': a 4-byte request cuts the euro sign after its second byte.
    const text = await fixture.addSidecar(S1, 'tool-results/utf8.txt', 'ab€cd');
    const first = await readSpill(fixture.paths, { path: text, length: 4 });
    expect(first).toEqual({ content: 'ab', bytes: 7, offset: 0, length: 2, truncated: true });
    const second = await readSpill(fixture.paths, { path: text, offset: first.offset + first.length, length: 4 });
    expect(second).toEqual({ content: '€c', bytes: 7, offset: 2, length: 4, truncated: true });
    const third = await readSpill(fixture.paths, { path: text, offset: second.offset + second.length, length: 4 });
    expect(third).toEqual({ content: 'd', bytes: 7, offset: 6, length: 1, truncated: false });
    for (const page of [first, second, third]) expect(page.content).not.toContain('�');
    // Four-byte and two-byte sequences are backed up the same way.
    const wide = await fixture.addSidecar(S1, 'tool-results/wide.txt', 'a😀é');
    expect(await readSpill(fixture.paths, { path: wide, length: 3 })).toMatchObject({ content: 'a', length: 1 });
    expect(await readSpill(fixture.paths, { path: wide, offset: 1, length: 5 })).toMatchObject({ content: '😀', length: 4 });
  });

  it('never backs up the file\'s tail, and reads forward to finish a character a request is too short to hold', async () => {
    // A file that itself ends mid-character (an engine write in progress): the tail page keeps every byte.
    const torn = await fixture.addSidecar(S1, 'tool-results/torn.txt', '');
    await writeFile(torn, Buffer.from([0x61, 0x62, 0xe2, 0x82])); // 'ab' and the first two bytes of '€'
    expect(await readSpill(fixture.paths, { path: torn })).toMatchObject({ bytes: 4, length: 4, truncated: false, content: 'ab�' });
    expect(await readSpill(fixture.paths, { path: torn, length: 4 })).toMatchObject({ length: 4, truncated: false });
    // One byte of a three-byte character: backing up would consume nothing and a pager would never advance, so the page
    // reads forward to the character's end; `length` then exceeds the request.
    const euro = await fixture.addSidecar(S1, 'tool-results/euro.txt', '€x');
    expect(await readSpill(fixture.paths, { path: euro, length: 1 })).toEqual({ content: '€', bytes: 4, offset: 0, length: 3, truncated: true });
    expect(await readSpill(fixture.paths, { path: euro, offset: 3, length: 1 })).toEqual({ content: 'x', bytes: 4, offset: 3, length: 1, truncated: false });
    const emoji = await fixture.addSidecar(S1, 'tool-results/emoji.txt', '😀');
    expect(await readSpill(fixture.paths, { path: emoji, length: 2 })).toEqual({ content: '😀', bytes: 4, offset: 0, length: 4, truncated: false });
    // A file that ends before the character does: the forward read stops at the end and answers what is there.
    await writeFile(euro, Buffer.from([0xe2, 0x82]));
    expect(await readSpill(fixture.paths, { path: euro, length: 1 })).toMatchObject({ bytes: 2, length: 2, truncated: false });
  });

  it('reads task outputs and job files, the other two roots', async () => {
    const output = await fixture.addSidecar(S1, 'tasks/ad286defbc77bc090.output', 'ONE');
    expect((await readSpill(fixture.paths, { path: output })).content).toBe('ONE');
    const job = await fixture.addJob('bdb23713', { state: 'done', sessionId: S1 });
    expect((await readSpill(fixture.paths, { path: job })).content).toContain('"state":"done"');
  });

  it('reads a background task\'s output under the engine\'s task-output root, and nothing beside it', async () => {
    // CLAUDE_CODE_TMPDIR points at a directory the test owns, so nothing touches the real /tmp/claude-<uid>.
    const tmp = await mkdtemp(join(tmpdir(), 'maws-task-output-'));
    try {
      const paths = resolveStorePaths({ CLAUDE_CONFIG_DIR: fixture.configHome, CLAUDE_CODE_TMPDIR: tmp });
      const uid = process.getuid!();
      const output = join(tmp, `claude-${uid}`, '-private-tmp-maws-probe2-1RzDNs', S1, 'tasks', 'wayue3on6.output');
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, 'workflow done');
      expect(await readSpill(paths, { path: output })).toEqual({ content: 'workflow done', bytes: 13, offset: 0, length: 13, truncated: false });

      await writeFile(join(tmp, 'outside.txt'), 'no');
      await expect(readSpill(paths, { path: join(tmp, `claude-${uid}`, '..', 'outside.txt') })).rejects.toThrow(OUTSIDE);
      const neighbour = join(tmp, `claude-${uid + 1}`, 'x.output');
      await mkdir(dirname(neighbour), { recursive: true });
      await writeFile(neighbour, 'another user');
      await expect(readSpill(paths, { path: neighbour })).rejects.toThrow(OUTSIDE);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('refuses anything outside projects/, tasks/ and jobs/ under the config home, however the path is spelled', async () => {
    const outside = join(fixture.configHome, '..', 'outside.txt');
    await expect(readSpill(fixture.paths, { path: outside })).rejects.toThrow(OUTSIDE); // does not exist: refused, not "not found"
    await writeFile(join(fixture.configHome, 'settings.json'), '{}');
    await expect(readSpill(fixture.paths, { path: join(fixture.configHome, 'settings.json') })).rejects.toThrow(OUTSIDE);
    await expect(readSpill(fixture.paths, { path: join(fixture.paths.projects, '..', 'settings.json') })).rejects.toThrow(OUTSIDE);
    await expect(readSpill(fixture.paths, { path: 'projects/x.txt' })).rejects.toThrow(OUTSIDE); // relative
    // A symlink inside the store that points out of it is judged by its target.
    const link = join(dirname(spill), 'escape.txt');
    await symlink(join(fixture.configHome, 'settings.json'), link);
    await expect(readSpill(fixture.paths, { path: link })).rejects.toThrow(OUTSIDE);
  });

  it('reports a spill that is gone by its path', async () => {
    const missing = join(dirname(spill), 'gone.txt');
    await expect(readSpill(fixture.paths, { path: missing })).rejects.toThrow(`spill not found: ${missing}`);
    await mkdir(join(dirname(spill), 'dir.txt'));
    await expect(readSpill(fixture.paths, { path: join(dirname(spill), 'dir.txt') })).rejects.toThrow('not a file');
  });
});
