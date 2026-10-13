// The library's derived index (the P3-L document, Decision Log 6 and 9; index migration 9): the rows main keeps of the
// host's live artifacts, their links and Spaces, and the search over titles and extracted text. A real index in a temp
// directory, so the side-thread lineage, the session titles and the project names are the index's own.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactSessionLink, Space } from '@shared/artifacts/entity';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { LibraryEntry } from '@shared/ipc/schema/library';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const SPACE_A = uuid(0xa1);
const SPACE_B = uuid(0xb1);

function entry(n: number, over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: uuid(n),
    kind: 'document',
    title: `Artifact ${n}`,
    createdBy: { kind: 'human' },
    createdAt: 1_000 + n,
    updatedAt: 2_000 + n,
    lastViewedAt: null,
    pinned: false,
    agentEditsAsSuggestions: false,
    revision: 1,
    lastEditor: { kind: 'human' },
    lastEditedAt: 2_000 + n,
    ...over,
  };
}

const space = (id: string, name: string, linkedDir?: string): Space => ({ id, name, createdAt: 5, ...(linkedDir ? { linkedDir } : {}) });

describe('LibraryStore', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });
  const session = (title: string) => index.sessions.upsertFromSummary(summary({ customTitle: title })).record.appId;
  const link = (n: number, appSessionId: AppSessionId, role: ArtifactSessionLink['role'] = 'created', lastAt = 10): ArtifactSessionLink => ({ artifactId: uuid(n), appSessionId, role, lastAt });
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  it('reconciles a snapshot into rows ordered by updatedAt, newest first, with their sessions, Space and project', () => {
    const maker = session('Make the deck');
    const reviewer = session('Review it');
    const project = index.projects.add(dir.path);
    index.library.reconcile({
      artifacts: [
        entry(1, { updatedAt: 3_000, spaceId: SPACE_A, projectId: project.id, lastEditor: { kind: 'session', appSessionId: reviewer }, lastEditedAt: 2_900 }),
        entry(2, { updatedAt: 5_000, kind: 'html', handle: 'landing-page' }),
        entry(3, { updatedAt: 4_000, pinned: true }),
      ],
      links: [link(1, maker, 'created', 10), link(1, maker, 'edited', 30), link(1, reviewer, 'commented', 20)],
      spaces: [space(SPACE_A, 'Work', '/tmp/work')],
    });

    const { rows } = index.library.list();
    expect(ids(rows)).toEqual([uuid(2), uuid(3), uuid(1)]);
    expect(rows[2]).toEqual({
      ...entry(1, { updatedAt: 3_000, spaceId: SPACE_A, projectId: project.id, lastEditor: { kind: 'session', appSessionId: reviewer }, lastEditedAt: 2_900 }),
      sessions: [
        { appSessionId: maker, title: 'Make the deck', roles: ['created', 'edited'], lastAt: 30 },
        { appSessionId: reviewer, title: 'Review it', roles: ['commented'], lastAt: 20 },
      ],
      space: { id: SPACE_A, name: 'Work' },
      project: { id: project.id, name: project.name },
    });
    expect(rows[0]).toMatchObject({ handle: 'landing-page', sessions: [] });
    expect(rows[0]).not.toHaveProperty('space');
    expect(rows[0]).not.toHaveProperty('project');
    expect(index.library.get(uuid(3))).toMatchObject({ id: uuid(3), pinned: true });
    expect(index.library.get(uuid(9))).toBeNull();
  });

  it('a session the index has no record of is listed with an empty title; a project it lacks is left out', () => {
    index.library.reconcile({ artifacts: [entry(1, { projectId: 'gone' as ProjectId })], links: [link(1, 'unknown-session' as AppSessionId)], spaces: [] });
    const row = index.library.get(uuid(1))!;
    expect(row.sessions).toEqual([{ appSessionId: 'unknown-session', title: '', roles: ['created'], lastAt: 10 }]);
    expect(row).not.toHaveProperty('project');
    expect(row.projectId).toBe('gone');
  });

  it('filters by kind, Space (none included), pinned and session, and counts each kind over the same filter without the kind', () => {
    const a = session('A');
    const b = session('B');
    index.library.reconcile({
      artifacts: [
        entry(1, { kind: 'html', spaceId: SPACE_A }),
        entry(2, { kind: 'html', pinned: true }),
        entry(3, { kind: 'document', spaceId: SPACE_A, pinned: true }),
        entry(4, { kind: 'file' }),
      ],
      links: [link(1, a), link(3, a), link(4, b)],
      spaces: [space(SPACE_A, 'Work')],
    });
    const zero = { document: 0, presentation: 0, design: 0, design_system: 0, dashboard: 0, html: 0, file: 0 };

    expect(index.library.list({ kind: 'html' })).toMatchObject({ counts: { ...zero, html: 2, document: 1, file: 1 } });
    expect(ids(index.library.list({ kind: 'html' }).rows).sort()).toEqual([uuid(1), uuid(2)]);
    const inA = index.library.list({ spaceId: SPACE_A, kind: 'document' });
    expect([ids(inA.rows), inA.counts]).toEqual([[uuid(3)], { ...zero, html: 1, document: 1 }]);
    expect(ids(index.library.list({ spaceId: null }).rows).sort()).toEqual([uuid(2), uuid(4)]);
    expect(ids(index.library.list({ pinned: true }).rows).sort()).toEqual([uuid(2), uuid(3)]);
    expect(ids(index.library.list({ pinned: false }).rows).sort()).toEqual([uuid(1), uuid(4)]);
    const ofA = index.library.list({ appSessionId: a });
    expect([ids(ofA.rows).sort(), ofA.counts]).toEqual([[uuid(1), uuid(3)], { ...zero, html: 1, document: 1 }]);
    expect(index.library.list({ appSessionId: a, pinned: true, kind: 'document' }).rows.map((r) => r.id)).toEqual([uuid(3)]);
  });

  it('the lineage filter adds the artifacts of a side thread’s ancestors, up the side-thread chain to the family root, and never a descendant’s', () => {
    const root = session('Root');
    const thread = session('Thread');
    const threadOfThread = session('Thread of thread');
    const other = session('Other');
    index.sideThreads.opened(thread, root, 't1');
    index.sideThreads.opened(threadOfThread, thread, 't2');
    index.library.reconcile({
      artifacts: [entry(1), entry(2), entry(3), entry(4)],
      links: [link(1, root), link(2, thread), link(3, threadOfThread), link(4, other)],
      spaces: [],
    });

    expect(ids(index.library.list({ appSessionId: threadOfThread, lineage: true }).rows).sort()).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(ids(index.library.list({ appSessionId: threadOfThread }).rows)).toEqual([uuid(3)]);
    expect(ids(index.library.list({ appSessionId: thread, lineage: true }).rows).sort()).toEqual([uuid(1), uuid(2)]);
    expect(ids(index.library.list({ appSessionId: root, lineage: true }).rows)).toEqual([uuid(1)]);
  });

  describe('search', () => {
    beforeEach(() => {
      index.library.reconcile({
        artifacts: [
          entry(1, { title: 'Quarterly report', updatedAt: 3_000 }),
          entry(2, { title: '회의록 정리', updatedAt: 2_000 }),
          entry(3, { title: 'Landing page', kind: 'html', updatedAt: 1_000 }),
        ],
        links: [],
        spaces: [],
      });
      index.library.setText(uuid(1), 1, 'Revenue grew in the third quarter. The parseConfigFile helper moved to src/config.');
      index.library.setText(uuid(2), 1, '오늘 회의에서 논의한 내용은 다음과 같습니다. 다음 회의는 금요일입니다.');
      index.library.setText(uuid(3), 1, 'Welcome to the launch of our product');
    });
    const search = (query: string, filter = {}) => index.library.list({ ...filter, query }).rows.map((row) => [row.id, row.snippet ?? null]);

    it('finds a word inside the text with the matched passage, and a title match with no passage', () => {
      expect(search('parseConfig')).toEqual([[uuid(1), expect.stringContaining('parseConfigFile helper')]]);
      expect(search('LANDING')).toEqual([[uuid(3), null]]);
      expect(search('the')).toEqual([
        [uuid(1), expect.stringContaining('the third quarter')],
        [uuid(3), expect.stringContaining('the launch')],
      ]);
    });

    it('matches Korean by substring, inside a word and across the title', () => {
      expect(search('회의에서')).toEqual([[uuid(2), expect.stringContaining('회의에서 논의한')]]);
      expect(search('논의한 내용')).toEqual([[uuid(2), expect.stringContaining('논의한 내용은')]]);
      expect(search('회의록')).toEqual([[uuid(2), null]]);
    });

    it('falls back to a substring scan for a query under three characters, with a passage around the match', () => {
      expect(search('회의')).toEqual([[uuid(2), expect.stringContaining('회의에서')]]);
      expect(search('Re')).toEqual([[uuid(1), expect.stringContaining('Revenue')]]);
      expect(search('q')).toEqual([[uuid(1), expect.stringContaining('quarter')]]);
      expect(search('zz')).toEqual([]);
    });

    it('counts per kind under the search and ignores a blank query', () => {
      expect(index.library.list({ query: 'the', kind: 'document' }).counts).toMatchObject({ document: 1, html: 1 });
      expect(index.library.list({ query: '   ' }).rows).toHaveLength(3);
    });

    it('takes a query’s quotes and operators as text', () => {
      expect(search('"report')).toEqual([]);
      expect(search('AND OR')).toEqual([]);
      index.library.setText(uuid(3), 2, 'a "quoted" word, and NEAR(x y)');
      expect(search('"quoted"')).toEqual([[uuid(3), expect.stringContaining('"quoted"')]]);
      expect(search('NEAR(x')).toEqual([[uuid(3), expect.stringContaining('NEAR(x y)')]]);
    });

    it('cuts a long passage around the match', () => {
      index.library.setText(uuid(1), 2, `${'lorem ipsum '.repeat(200)}needle${' dolor sit'.repeat(200)}`);
      const [[, snippet]] = search('needle');
      expect(snippet).toContain('needle');
      expect((snippet as string).length).toBeLessThan(200);
      expect(snippet).toMatch(/^….*…$/);
    });
  });

  it('a reconciliation replaces the whole set: unlisted rows go with their text, links and spaces are replaced, text survives an unchanged row', () => {
    const a = session('A');
    index.library.reconcile({ artifacts: [entry(1), entry(2)], links: [link(1, a), link(2, a)], spaces: [space(SPACE_A, 'Work'), space(SPACE_B, 'Home')] });
    index.library.setText(uuid(1), 1, 'kept text');
    index.library.setText(uuid(2), 1, 'gone text');

    index.library.reconcile({ artifacts: [entry(1, { title: 'Renamed' }), entry(3)], links: [link(3, a, 'edited')], spaces: [space(SPACE_B, 'House')] });
    expect(ids(index.library.list().rows).sort()).toEqual([uuid(1), uuid(3)]);
    expect(index.library.get(uuid(1))).toMatchObject({ title: 'Renamed', sessions: [] });
    expect(index.library.get(uuid(3))!.sessions).toMatchObject([{ appSessionId: a, roles: ['edited'] }]);
    expect(index.library.spaces()).toEqual([{ ...space(SPACE_B, 'House'), count: 0 }]);
    expect(ids(index.library.list({ query: 'kept' }).rows)).toEqual([uuid(1)]);
    expect(ids(index.library.list({ query: 'Renamed' }).rows)).toEqual([uuid(1)]);
    expect(index.library.list({ query: 'gone' }).rows).toEqual([]);
    expect(index.library.list({ query: 'Artifact 2' }).rows).toEqual([]);
    expect(index.library.needingText()).toEqual([uuid(3)]);
  });

  it('a reconciled row whose revision fell (a host store recreated) has its text fetched again', () => {
    index.library.reconcile({ artifacts: [entry(1, { revision: 7 })], links: [], spaces: [] });
    index.library.setText(uuid(1), 7, 'old text');
    expect(index.library.needingText()).toEqual([]);
    index.library.reconcile({ artifacts: [entry(1, { revision: 2 })], links: [], spaces: [] });
    expect(index.library.needingText()).toEqual([uuid(1)]);
  });

  it('applies an entry and its links, drops one older than the indexed revision, and removes a gone one', () => {
    const a = session('A');
    const b = session('B');
    index.library.reconcile({ artifacts: [entry(1, { revision: 5 })], links: [link(1, a)], spaces: [] });

    expect(index.library.apply(uuid(1), { artifact: entry(1, { revision: 5, title: 'Same revision, new title' }), links: [link(1, a), link(1, b, 'viewed', 5)] })).toBe('applied');
    expect(index.library.get(uuid(1))).toMatchObject({ title: 'Same revision, new title', sessions: [{ appSessionId: a }, { appSessionId: b, roles: ['viewed'] }] });
    expect(index.library.apply(uuid(1), { artifact: entry(1, { revision: 4, title: 'Older' }), links: [] })).toBe('stale');
    expect(index.library.get(uuid(1))).toMatchObject({ title: 'Same revision, new title', revision: 5 });
    expect(index.library.apply(uuid(2), { artifact: entry(2, { revision: 1 }), links: [link(2, b)] })).toBe('applied');
    expect(index.library.apply(uuid(1), { artifact: null, links: [] })).toBe('removed');
    expect(ids(index.library.list().rows)).toEqual([uuid(2)]);
    expect(index.library.apply(uuid(1), { artifact: null, links: [] })).toBe('absent');
    expect(index.library.remove(uuid(2))).toBe(true);
    expect(index.library.list().rows).toEqual([]);
  });

  it('keeps the text of the newest revision it was given, and wants text for a row whose revision moved past it', () => {
    index.library.reconcile({ artifacts: [entry(1, { revision: 3 })], links: [], spaces: [] });
    expect(index.library.needingText()).toEqual([uuid(1)]);
    expect(index.library.setText(uuid(1), 3, 'third')).toBe(true);
    expect(index.library.needingText()).toEqual([]);
    expect(index.library.setText(uuid(1), 2, 'second')).toBe(false);
    expect(index.library.setText(uuid(1), 3, 'third again')).toBe(false);
    expect(ids(index.library.list({ query: 'third' }).rows)).toEqual([uuid(1)]);
    index.library.apply(uuid(1), { artifact: entry(1, { revision: 4 }), links: [] });
    expect(index.library.needingText()).toEqual([uuid(1)]);
    expect(index.library.setText(uuid(9), 1, 'no row')).toBe(false);
  });

  it('lists the Spaces by name with their live artifacts counted', () => {
    index.library.reconcile({ artifacts: [entry(1, { spaceId: SPACE_B }), entry(2, { spaceId: SPACE_B }), entry(3, { spaceId: SPACE_A })], links: [], spaces: [space(SPACE_B, 'beta'), space(SPACE_A, 'Alpha', '/tmp/a')] });
    expect(index.library.spaces()).toEqual([
      { ...space(SPACE_A, 'Alpha', '/tmp/a'), count: 1 },
      { ...space(SPACE_B, 'beta'), count: 2 },
    ]);
    index.library.replaceSpaces([space(SPACE_A, 'Alpha')]);
    expect(index.library.spaces()).toEqual([{ ...space(SPACE_A, 'Alpha'), count: 1 }]);
    expect(index.library.get(uuid(1))).not.toHaveProperty('space'); // its Space is gone until the host's update moves it
  });

  it('tells each committed change once, after its commit, with a revision that rises, and nothing for a dropped entry', () => {
    const told: number[] = [];
    index.library.onChange((revision) => told.push(revision));
    index.library.reconcile({ artifacts: [entry(1, { revision: 2 })], links: [], spaces: [] });
    index.transaction(() => {
      index.library.setText(uuid(1), 2, 'x');
      index.library.replaceSpaces([]);
      expect(told).toEqual([1]);
    });
    expect(told).toEqual([1, 2]);
    index.library.apply(uuid(1), { artifact: entry(1, { revision: 1 }), links: [] });
    expect(told).toEqual([1, 2]);
    expect(index.library.revision).toBe(2);
  });
});
