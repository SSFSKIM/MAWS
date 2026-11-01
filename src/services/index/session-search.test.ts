import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { Index } from './index';
import { Db } from './db';
import { summary, tempDir } from '../../../test/support/index-fixture';
let dir: ReturnType<typeof tempDir>;
let index: Index;
beforeEach(() => { dir = tempDir(); index = new Index(join(dir.path, 'index.sqlite')); });
afterEach(() => { index.close(); dir.dispose(); });
describe('conversation search', () => {
  // P5 O7 M6: a remote member's search names the sessions it views, so 50 title hits of other sessions can't spend the
  // limit before a viewed session's transcript match.
  it('searches only the named sessions, before the limit, in titles and transcripts alike', () => {
    const shared = index.sessions.upsertFromSummary(summary({ customTitle: 'Shared notes' })).record;
    index.sessionSearch.replace(shared.appId, shared.engineSessionId!, 100, 1000, 'a needle inside the shared conversation');
    const titled = index.sessions.upsertFromSummary(summary({ customTitle: 'needle in a viewed title' })).record;
    const others = Array.from({ length: 50 }, (_, n) => index.sessions.upsertFromSummary(summary({ customTitle: `needle private ${n}` })).record);
    expect(index.sessionSearch.search('needle').map((hit) => hit.appSessionId)).not.toContain(shared.appId);
    const named = index.sessionSearch.search('needle', undefined, [shared.appId, titled.appId]);
    expect(named.map((hit) => hit.appSessionId)).toEqual([titled.appId, shared.appId]);
    expect(named[1].snippet).toContain('needle inside the shared conversation');
    expect(index.sessionSearch.search('needle', undefined, [])).toEqual([]);
    // A short query takes the substring path: the same restriction.
    expect(index.sessionSearch.search('ne', undefined, [shared.appId]).map((hit) => hit.appSessionId)).toEqual([shared.appId]);
    expect(others).toHaveLength(50);
  });

  it('searches only the displayed override text, not its JSON keys or source', () => {
    const record = index.sessions.upsertFromSummary(summary({ customTitle: 'Old title' })).record;
    index.sessions.update(record.appId, { title: { text: 'Release notes', source: 'user' } });
    expect(index.sessionSearch.search('Release').map((hit) => hit.appSessionId)).toEqual([record.appId]);
    for (const query of ['text', 'source', 'user', 'Old title']) expect(index.sessionSearch.search(query)).toEqual([]);
    index.sessionSearch.replace(record.appId, record.engineSessionId!, 100, 1000, 'The source is in the repository');
    expect(index.sessionSearch.search('source')[0].snippet).toContain('source is in the repository');
  });

  it('searches across chunk boundaries, deduplicates sessions, and distinguishes terminal failure from indexing', () => {
    const transcript = summary();
    const record = index.sessions.upsertFromSummary(transcript).record;
    index.sessionSearch.replace(record.appId, transcript.sessionId, transcript.size, transcript.mtimeMs, 'A needle cross-', false);
    index.sessionSearch.append(record.appId, transcript.sessionId, 'boundary needle in the last page', true);
    expect(index.sessionSearch.search('needle')).toHaveLength(1);
    expect(index.sessionSearch.search('cross-boundary')[0].snippet).toContain('cross-boundary');
    expect(index.sessionSearch.indexing()).toBe(false);
    expect(index.sessionSearch.incomplete()).toBe(false);
    index.sessionSearch.fail(record.appId, transcript.sessionId, transcript.size, transcript.mtimeMs);
    expect(index.sessionSearch.current(record.appId, transcript.sessionId, transcript.size, transcript.mtimeMs)).toBe(false);
    expect(index.sessionSearch.indexing()).toBe(false);
    expect(index.sessionSearch.incomplete()).toBe(true);
    index.sessionSearch.retryFailures();
    expect(index.sessionSearch.indexing()).toBe(true);
    expect(index.sessionSearch.incomplete()).toBe(false);
  });

  it('extends a ready text only from its stored checkpoint, and never resumes a pass cut short', () => {
    const transcript = summary();
    const record = index.sessions.upsertFromSummary(transcript).record;
    const { appId } = record;
    const checkpoint = (offset: number) => ({ offset, ino: '1', head: 'h', started: true });
    expect(index.sessionSearch.resume(appId, transcript.sessionId)).toBeNull();
    index.sessionSearch.replace(appId, transcript.sessionId, 100, 1000, 'First needle-a', true, checkpoint(100));
    expect(index.sessionSearch.resume(appId, transcript.sessionId)).toEqual(checkpoint(100));
    // A checkpoint other than the stored one is refused and changes nothing.
    expect(index.sessionSearch.extend(appId, transcript.sessionId, 150, 1500, 90, '\nnever', true, checkpoint(150))).toBe(false);
    expect(index.sessionSearch.search('never')).toEqual([]);
    expect(index.sessionSearch.current(appId, transcript.sessionId, 100, 1000)).toBe(true);
    // A two-page extension: the checkpoint is gone while it is part-appended, back with the last page.
    expect(index.sessionSearch.extend(appId, transcript.sessionId, 150, 1500, 100, '\nsecond needle-', false)).toBe(true);
    expect(index.sessionSearch.resume(appId, transcript.sessionId)).toBeNull();
    expect(index.sessionSearch.current(appId, transcript.sessionId, 150, 1500)).toBe(false);
    index.sessionSearch.append(appId, transcript.sessionId, 'b done', true, checkpoint(150));
    expect(index.sessionSearch.resume(appId, transcript.sessionId)).toEqual(checkpoint(150));
    expect(index.sessionSearch.current(appId, transcript.sessionId, 150, 1500)).toBe(true);
    expect(index.sessionSearch.search('needle-a')).toHaveLength(1);
    expect(index.sessionSearch.search('needle-b')).toHaveLength(1); // across the page edge
    // A full pass, or a failed one, leaves no checkpoint to resume.
    index.sessionSearch.replace(appId, transcript.sessionId, 200, 2000, 'Again', false, checkpoint(200));
    expect(index.sessionSearch.resume(appId, transcript.sessionId)).toBeNull();
    index.sessionSearch.append(appId, transcript.sessionId, '', true, null);
    expect(index.sessionSearch.resume(appId, transcript.sessionId)).toBeNull();
  });

  it('reports terminal failure even when SQLite cannot persist the failure stamp', () => {
    const transcript = summary();
    const record = index.sessions.upsertFromSummary(transcript).record;
    const write = vi.spyOn(Db.prototype, 'run').mockImplementationOnce(() => { throw new Error('disk full'); });
    try {
      expect(() => index.sessionSearch.fail(record.appId, transcript.sessionId, transcript.size, transcript.mtimeMs)).toThrow('disk full');
      expect(index.sessionSearch.indexing()).toBe(false);
      expect(index.sessionSearch.incomplete()).toBe(true);
      expect(index.sessionSearch.failed(record.appId, transcript.sessionId, transcript.size, transcript.mtimeMs)).toBe(true);
    } finally { write.mockRestore(); }
    index.sessionSearch.retryFailures();
    expect(index.sessionSearch.indexing()).toBe(true);
    expect(index.sessionSearch.incomplete()).toBe(false);
  });

  it('ranks titles before text, updates snippets, searches literals and forgets deleted sessions', () => {
    const first = index.sessions.upsertFromSummary(summary({ customTitle: 'Deployment notes' })).record;
    const second = index.sessions.upsertFromSummary(summary({ customTitle: 'needle in title' })).record;
    index.sessionSearch.replace(first.appId, first.engineSessionId!, 100, 1000, 'We found the needle in the build. 회의에서 논의한 내용');
    index.sessionSearch.replace(second.appId, second.engineSessionId!, 100, 1000, 'Something else');
    expect(index.sessionSearch.search('needle').map((r) => r.appSessionId)).toEqual([second.appId, first.appId]);
    expect(index.sessionSearch.search('needle')[1].snippet).toContain('needle in the build');
    expect(index.sessionSearch.search('회의')[0].appSessionId).toBe(first.appId);
    expect(index.sessionSearch.search('" OR "')).toEqual([]);
    index.sessionSearch.replace(first.appId, first.engineSessionId!, 200, 2000, 'Different words');
    expect(index.sessionSearch.search('needle')).toHaveLength(1);
    index.sessions.update(second.appId, { archived: true });
    expect(index.sessionSearch.search('needle')).toEqual([]);
  });
});
