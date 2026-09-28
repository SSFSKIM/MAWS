import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
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
});
