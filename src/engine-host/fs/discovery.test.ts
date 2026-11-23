import { appendFile, chmod, mkdir, open, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionId } from '@shared/graph/ids';
import type { TranscriptSummary } from '@shared/wire/store';
import { StoreFixture } from '../../../test/support/store-fixture';
import { Discovery } from './discovery';
import { resolveStorePaths } from './paths';
import { HEAD_TAIL_BYTES } from './summarize';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';
const S4 = '44444444-4444-4444-8444-444444444444';
const S5 = '55555555-5555-4555-8555-555555555555';

const user = (uuid: string, parentUuid: string | null, cwd: string, content: string) => ({
  type: 'user',
  uuid,
  parentUuid,
  cwd,
  timestamp: '2026-09-28T10:00:00.000Z',
  message: { role: 'user', content },
});

async function collect(iterable: AsyncIterable<TranscriptSummary>): Promise<TranscriptSummary[]> {
  const out: TranscriptSummary[] = [];
  for await (const summary of iterable) out.push(summary);
  return out;
}

describe('discovery lists and summarises the store', () => {
  let fixture: StoreFixture;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  it('lists UUID-named transcripts per slug, never quarantined or superseded files, memory or sidecar directories', async () => {
    const p1 = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'one')]);
    const p2 = await fixture.addTranscript('/work/a', S2, [user('u1', null, '/work/a', 'two')]);
    const p3 = await fixture.addTranscript('/work/b', S3, [user('u1', null, '/work/b', 'three')]);
    const slugA = join(fixture.paths.projects, '-work-a');
    await writeFile(join(slugA, `${S1}.orphaned-1727500000000-abcdef12.jsonl`), '{}\n');
    await writeFile(join(slugA, `${S2}.superseded-1727500000000.jsonl`), '{}\n');
    await writeFile(join(slugA, 'notes.jsonl'), '{}\n');
    await mkdir(join(slugA, 'memory'));
    await fixture.addSidecar(S1, 'custom-title.json', { customTitle: 'x' });

    const listed = await new Discovery(fixture.paths).list();
    expect(listed.map((f) => f.path).sort()).toEqual([p1, p2, p3].sort());
    const first = listed.find((f) => f.sessionId === S1)!;
    expect(first.slug).toBe('-work-a');
    expect(first.size).toBeGreaterThan(0);
    expect(first.mtimeMs).toBeGreaterThan(0);
  });

  it('lists nothing, without failing, when projects/ does not exist', async () => {
    const paths = resolveStorePaths({ CLAUDE_CONFIG_DIR: join(fixture.configHome, 'absent') });
    expect(await new Discovery(paths).list()).toEqual([]);
  });

  it('summarises one transcript, folding custom-title.json between the tail and the head', async () => {
    const path = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'first prompt')]);
    const discovery = new Discovery(fixture.paths);
    const plain = await discovery.summarizeOne(path);
    expect(plain).toMatchObject({ sessionId: S1, slug: '-work-a', directory: '/work/a', customTitle: null, firstPrompt: 'first prompt', hasMessages: true });

    await fixture.addSidecar(S1, 'custom-title.json', { customTitle: 'Named in the sidecar' });
    expect((await discovery.summarizeOne(path))?.customTitle).toBe('Named in the sidecar');

    await fixture.appendLines(path, [JSON.stringify({ type: 'custom-title', customTitle: 'Renamed in the tail', sessionId: S1 })]);
    expect((await discovery.summarizeOne(path))?.customTitle).toBe('Renamed in the tail');
  });

  it('keeps the previous sidecar title when custom-title.json is rewritten torn and stays that way, and drops it once the file is gone', async () => {
    const path = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'first prompt')]);
    const sidecar = await fixture.addSidecar(S1, 'custom-title.json', { customTitle: 'Named in the sidecar' });
    const discovery = new Discovery(fixture.paths);
    expect((await discovery.summarizeOne(path))?.customTitle).toBe('Named in the sidecar');

    await writeFile(sidecar, '{"customTit'); // a torn write the engine never finishes
    expect((await discovery.summarizeOne(path))?.customTitle).toBe('Named in the sidecar');

    await rm(sidecar);
    expect((await discovery.summarizeOne(path))?.customTitle).toBeNull();
  });

  it('keeps the previous sidecar title when custom-title.json becomes unreadable, logging it once', async () => {
    const path = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'first prompt')]);
    const sidecar = await fixture.addSidecar(S1, 'custom-title.json', { customTitle: 'Named in the sidecar' });
    const discovery = new Discovery(fixture.paths);
    expect((await discovery.summarizeOne(path))?.customTitle).toBe('Named in the sidecar');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await chmod(sidecar, 0o000); // the fixture's own temp file
    try {
      expect((await discovery.summarizeOne(path))?.customTitle).toBe('Named in the sidecar');
      expect((await discovery.summarizeOne(path))?.customTitle).toBe('Named in the sidecar');
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0].join(' ')).toContain('EACCES');
    } finally {
      await chmod(sidecar, 0o644);
      errors.mockRestore();
    }
  });

  it('reads only the first and last 64 KiB of a large transcript', async () => {
    const big = { type: 'attachment', uuid: 'f1', parentUuid: 'u1', attachment: { type: 'x', text: 'y'.repeat(3 * HEAD_TAIL_BYTES) } };
    const leaf = { type: 'assistant', uuid: 'a1', parentUuid: 'f1', message: { role: 'assistant', content: [{ type: 'text', text: 'the end' }] } };
    const path = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'hi'), big, leaf]);
    const summary = await new Discovery(fixture.paths).summarizeOne(path);
    expect(summary).toMatchObject({ directory: '/work/a', leafUuid: 'a1', lastAssistantText: 'the end' });
  });

  // Seen 2026-11-23: a transcript that opens with file-history snapshots of ~58 KiB each, its first `cwd` far past the
  // head window, was stored with no folder, and the renderer threw on the empty one.
  describe('the launch folder past the head window', () => {
    const snapshot = (n: number) => ({ type: 'file-history-snapshot', messageId: `m${n}`, snapshot: { trackedFileBackups: { f: 'z'.repeat(58 * 1024) } } });
    const snapshots = (count: number) => Array.from({ length: count }, (_, n) => snapshot(n));
    const filler = (cwd: string) => ({ type: 'attachment', uuid: 'f1', parentUuid: 'u1', cwd, attachment: { type: 'x', text: 'y'.repeat(2 * HEAD_TAIL_BYTES) } });
    const nested = { type: 'progress', toolInput: { cwd: '/not/the/record' } }; // a nested `cwd` is no record's folder

    // Every read a summary makes (position, length), through the file handle's prototype.
    async function spyReads(path: string) {
      const probe = await open(path, 'r');
      const proto = Object.getPrototypeOf(probe) as { read: (...args: unknown[]) => Promise<{ bytesRead: number }> };
      await probe.close();
      const reads: { position: number; length: number }[] = [];
      const original = proto.read;
      const read = vi.spyOn(proto, 'read').mockImplementation(function (this: unknown, ...args: unknown[]) {
        reads.push({ position: args[3] as number, length: args[2] as number });
        return original.apply(this, args);
      });
      return { reads, read, original };
    }
    afterEach(() => vi.restoreAllMocks());

    it('finds the folder, past the head and before the tail, never a nested one; an unchanged file is not scanned again', async () => {
      const path = await fixture.addTranscript('/work/launched', S1, [...snapshots(2), nested, snapshot(9), user('u1', null, '/work/launched', 'hi'), filler('/work/later')]);
      const discovery = new Discovery(fixture.paths);
      expect((await discovery.summarizeOne(path))?.directory).toBe('/work/launched');
      const spy = await spyReads(path);
      expect((await discovery.summarizeOne(path))?.directory).toBe('/work/launched');
      expect(spy.reads.length).toBe(2); // the head and the tail: the folder is remembered
    });

    it('remembers a scan that found no folder: an unchanged file is not read past its head again, an append only past where it stopped', async () => {
      const path = await fixture.addTranscript('/work/none', S2, [...snapshots(4)]);
      const discovery = new Discovery(fixture.paths);
      expect((await discovery.summarizeOne(path))?.directory).toBeNull();
      const spy = await spyReads(path);
      expect((await discovery.summarizeOne(path))?.directory).toBeNull();
      expect(spy.reads.length).toBe(2); // the head and the tail only
      const before = (await stat(path)).size;
      await appendFile(path, JSON.stringify(user('u1', null, '/work/none', 'hi')) + '\n');
      spy.reads.length = 0;
      expect((await discovery.summarizeOne(path))?.directory).toBe('/work/none');
      const scanned = spy.reads.slice(2); // past the head and the tail: the scan
      expect(scanned.length).toBeGreaterThan(0);
      expect(Math.min(...scanned.map((r) => r.position))).toBeGreaterThanOrEqual(before);
    });

    it('scans afresh a transcript replaced at the same path, and one that shrank', async () => {
      const path = await fixture.addTranscript('/work/a', S3, [...snapshots(2), user('u1', null, '/work/a', 'hi'), filler('/work/a')]);
      const discovery = new Discovery(fixture.paths);
      expect((await discovery.summarizeOne(path))?.directory).toBe('/work/a');
      // replaced: a new file renamed over it (a new inode), as large or larger
      const next = `${path}.next`;
      await writeFile(next, [...snapshots(3), user('u1', null, '/work/b', 'hi'), filler('/work/b')].map((r) => JSON.stringify(r)).join('\n') + '\n');
      await rename(next, path);
      expect((await discovery.summarizeOne(path))?.directory).toBe('/work/b');
      // shrank in place (same inode): shorter than where the scan found its folder
      await writeFile(path, [...snapshots(2), user('u1', null, '/work/c', 'hi'), filler('/work/c')].map((r) => JSON.stringify(r)).join('\n') + '\n');
      expect((await discovery.summarizeOne(path))?.directory).toBe('/work/c');
    });

    it('a file that shrinks under the scan is read again from its new stat, and leaves no handle open', async () => {
      const handles = () => readdirSync('/dev/fd').length;
      const path = await fixture.addTranscript('/work/t', S4, [...snapshots(2), user('u1', null, '/work/t', 'hi'), filler('/work/t')]);
      const spy = await spyReads(path);
      const open0 = handles();
      let truncations = 1;
      spy.read.mockImplementation(function (this: unknown, ...args: unknown[]) {
        const [buffer] = args as [Buffer];
        spy.reads.push({ position: args[3] as number, length: args[2] as number });
        if (buffer.length !== HEAD_TAIL_BYTES && truncations > 0) { // the scan's chunk (the head's and the tail's are 64 KiB)
          truncations -= 1;
          return Promise.resolve({ bytesRead: 0, buffer });
        }
        return spy.original.apply(this, args);
      });
      expect((await new Discovery(fixture.paths).summarizeOne(path))?.directory).toBe('/work/t');
      expect(spy.reads.filter((r) => r.length !== HEAD_TAIL_BYTES)).toHaveLength(2); // the scan's chunk, read again
      // a file that keeps shrinking: no summary of a stale stat, an error after the retries, never a loop
      truncations = Infinity;
      spy.reads.length = 0;
      await expect(new Discovery(fixture.paths).summarizeOne(path)).rejects.toThrow(/shrank/);
      expect(spy.reads.filter((r) => r.length !== HEAD_TAIL_BYTES)).toHaveLength(3); // one per attempt
      expect(handles()).toBe(open0);
    });
  });

  it('answers null for a transcript that no longer exists', async () => {
    expect(await new Discovery(fixture.paths).summarizeOne(join(fixture.paths.projects, '-x', `${S1}.jsonl`))).toBeNull();
  });

  it('scan summarises every listed transcript except those whose size and mtime match `known`', async () => {
    await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'one')]);
    await fixture.addTranscript('/work/a', S2, [user('u1', null, '/work/a', 'two')]);
    await fixture.addTranscript('/work/b', S3, [user('u1', null, '/work/b', 'three')]);
    const discovery = new Discovery(fixture.paths);
    const all = await collect(discovery.scan(new Map()));
    expect(all.map((s) => s.sessionId).sort()).toEqual([S1, S2, S3]);

    const s1 = all.find((s) => s.sessionId === S1)!;
    const s2 = all.find((s) => s.sessionId === S2)!;
    const known = new Map<SessionId, { size: number; mtimeMs: number }>([
      [S1 as SessionId, { size: s1.size, mtimeMs: s1.mtimeMs }],
      [S2 as SessionId, { size: s2.size + 1, mtimeMs: s2.mtimeMs }], // stale: summarised again
    ]);
    expect((await collect(discovery.scan(known))).map((s) => s.sessionId).sort()).toEqual([S2, S3]);
  });
  // U8c-1 (M1 decision 4): the look a removal waits for. One readdir per project folder, the names alone.
  describe('find looks a session’s transcript up under every project folder', () => {
    it('answers the path of each transcript asked for, wherever it lies, and nothing for one that is nowhere', async () => {
      const p1 = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'one')]);
      const p3 = await fixture.addTranscript('/work/b', S3, [user('u1', null, '/work/b', 'three')]);
      await fixture.addTranscript('/work/b', S2, [user('u1', null, '/work/b', 'not asked for')]);
      await fixture.addSidecar(S3, 'subagents/agent-a1.jsonl', ''); // a session's folder is no transcript
      await mkdir(join(fixture.paths.projects, '-work-c', `${S4}.jsonl`), { recursive: true }); // nor is a folder named like one
      const found = await new Discovery(fixture.paths).find(new Set([S1, S3, S4, S5] as SessionId[]));
      expect(found).toEqual(new Map([[S1, p1], [S3, p3]]));
    });

    it('answers the one written last when a transcript lies under two project folders', async () => {
      const older = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'one')]);
      const newer = await fixture.addTranscript('/work/b', S1, [user('u1', null, '/work/b', 'one, moved')]);
      await utimes(older, new Date('2026-11-13T10:00:00Z'), new Date('2026-11-13T10:00:00Z'));
      await utimes(newer, new Date('2026-11-13T10:00:05Z'), new Date('2026-11-13T10:00:05Z'));
      const discovery = new Discovery(fixture.paths);
      expect(await discovery.find(new Set([S1 as SessionId]))).toEqual(new Map([[S1, newer]]));
      await utimes(older, new Date('2026-11-13T10:00:09Z'), new Date('2026-11-13T10:00:09Z'));
      expect(await discovery.find(new Set([S1 as SessionId]))).toEqual(new Map([[S1, older]]));
    });

    it('answers nothing, without failing, when projects/ does not exist or nothing is asked for', async () => {
      const paths = resolveStorePaths({ CLAUDE_CONFIG_DIR: join(fixture.configHome, 'absent') });
      expect(await new Discovery(paths).find(new Set([S1 as SessionId]))).toEqual(new Map());
      await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'one')]);
      expect(await new Discovery(fixture.paths).find(new Set())).toEqual(new Map());
    });
  });
});
