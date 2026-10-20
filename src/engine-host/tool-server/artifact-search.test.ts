// P4-B4 M2 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md; the prior art's acceptance, research/p4-ux-prior-art.md
// §5.4, items 1 to 9): `artifact_search` through the `maws` server's registered definitions (`mawsTools`), over A's real
// store with the document kind and the deck's adapter registered, so documents are made from markdown and read at the
// hit's place as an agent would.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocIndex } from '@artifacts/document/block-index';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { DECK_PATH } from '@artifacts/slides/deck';
import { schemaFor } from '@artifacts/document/schema';
import { addTab } from '@artifacts/document/tabs';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { ArtifactSearchResultSchema, SEARCH_HINTS, type ArtifactSearchResult } from '@shared/maws/search-tools';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-searcher' as AppSessionId;
const OTHER = 'app-elsewhere' as AppSessionId;
let world: DocumentWorld;
let tools: Map<string, McpToolDefinition>;
let calls = 0;

beforeEach(() => {
  world = openDocumentWorld();
  world.store.registerAdapter(createPresentationAdapter());
  const list = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => world.store });
  tools = new Map(list.map((tool) => [tool.name, tool]));
});
afterEach(() => world.close());

const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_s${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const call = (name: string, args: unknown, over: Partial<McpToolContext> = {}) => tools.get(name)!.call(args, ctx(over));
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${text(result)}`);
  return JSON.parse(text(result)) as T;
};
const search = async (args: Record<string, unknown>, over: Partial<McpToolContext> = {}): Promise<ArtifactSearchResult> => ArtifactSearchResultSchema.parse(json(await call('artifact_search', args, over)));
const ids = (result: ArtifactSearchResult) => result.hits.map((hit) => hit.id);

const created = async (args: Record<string, unknown>, over: Partial<McpToolContext> = {}) => json<{ artifactId: string; revision: number }>(await call('artifact_create', args, over));
const document = async (title: string, markdown: string, over: Partial<McpToolContext> = {}) => (await created({ kind: 'document', title, content: markdown }, over)).artifactId;
const page = async (title: string, html: string, over: Partial<McpToolContext> = {}) => (await created({ title, content: html }, over)).artifactId;
const codePoints = (value: string) => [...value].length;

describe('artifact_search: titles, particles and short terms (acceptance 1)', () => {
  it('finds a title by a word inside it, a word inside a longer word, and a two-letter term alone and beside a longer one', async () => {
    const titled = await document('Q3 로드맵', 'Nothing about plans here. ^p1');
    const particle = await document('Notes', '다음 주에 로드맵을 검토합니다. ^p1');
    const minutes = await document('Weekly', '주간 회의록 정리했습니다 ^p1');
    expect(ids(await search({ query: '로드맵' })).sort()).toEqual([titled, particle].sort());
    expect(ids(await search({ query: '회의' }))).toEqual([minutes]);
    expect(ids(await search({ query: '회의 정리했습니다' }))).toEqual([minutes]);
    expect(ids(await search({ query: '회의 검토합니다' }))).toEqual([]);
  });
});

describe('artifact_search: AND and phrases (acceptance 2)', () => {
  it('needs every word, and a quoted phrase as one run', async () => {
    const both = await page('Plan', '<p>The budget for 2027 is set.</p>');
    await page('Budget only', '<p>A budget without a year.</p>');
    await page('Year only', '<p>2027 will be busy.</p>');
    expect(ids(await search({ query: 'budget 2027' }))).toEqual([both]);
    const phrase = await page('Review', '<p>The design review is on Friday.</p>');
    await page('Other', '<p>A review of the design came back.</p>');
    expect(ids(await search({ query: '"design review"' }))).toEqual([phrase]);
  });
});

describe('artifact_search: normalisation (acceptance 3)', () => {
  it('finds decomposed Hangul by a composed query, and matches case-insensitively', async () => {
    const decomposed = await page('Minutes', `<p>${'회의록 정리'.normalize('NFD')}</p>`);
    const latin = await page('Plans', '<p>The Roadmap for Q3</p>');
    expect(ids(await search({ query: '회의록' }))).toEqual([decomposed]);
    expect(ids(await search({ query: 'roadmap' }))).toEqual([latin]);
    expect(ids(await search({ query: 'ROADMAP' }))).toEqual([latin]);
  });
});

describe('artifact_search: filters and scope (acceptance 4)', () => {
  it('filters by kind and Space, reaches an artifact the lineage never touched only by default, and never returns a deleted one', async () => {
    const space = await world.store.createSpace({ name: 'Research' });
    const doc = await document('Launch doc', 'The launch checklist. ^p1');
    const html = await page('Launch page', '<p>The launch checklist.</p>');
    const spaced = (await created({ title: 'Launch notes', content: '<p>The launch checklist.</p>', space: space.id })).artifactId;
    const foreign = await page('Their launch', '<p>The launch checklist.</p>', { appSessionId: OTHER });
    expect(ids(await search({ query: 'launch checklist', kind: 'document' }))).toEqual([doc]);
    expect(ids(await search({ query: 'launch checklist', spaceId: space.id }))).toEqual([spaced]);
    expect(ids(await search({ query: 'launch checklist' })).sort()).toEqual([doc, html, spaced, foreign].sort());
    expect(ids(await search({ query: 'launch checklist', scope: 'session' })).sort()).toEqual([doc, html, spaced].sort());
    // a side thread's ancestors are its lineage, as artifact_list's is
    expect(ids(await search({ query: 'launch checklist', scope: 'session' }, { appSessionId: 'app-unrelated' as AppSessionId }))).toEqual([]);
    await world.store.delete(html);
    expect(ids(await search({ query: 'launch checklist' }))).not.toContain(html);
    const hit = (await search({ query: 'launch notes', spaceId: space.id })).hits[0]!;
    expect(hit).toMatchObject({ id: spaced, kind: 'html', title: 'Launch notes', spaceId: space.id, spaceName: 'Research', lastEditor: { by: 'this session' } });
  });
});

describe('artifact_search: order (acceptance 5)', () => {
  it('ranks a title match above a body match at the same time, and newest first on a tie', async () => {
    const inBody = await page('Notes', '<p>Some words about the migration plan.</p>');
    const inTitle = await page('Migration', '<p>Some words about the plan.</p>');
    const same = world.storage.db.prepare('UPDATE artifacts SET updatedAt = ? WHERE id = ?');
    same.run(1_000, inBody);
    same.run(1_000, inTitle);
    expect(ids(await search({ query: 'migration' }))).toEqual([inTitle, inBody]);
    const older = await page('Twin', '<p>identical twin text</p>');
    const newer = await page('Twin', '<p>identical twin text</p>');
    same.run(2_000, older);
    same.run(3_000, newer);
    expect(ids(await search({ query: 'identical twin' }))).toEqual([newer, older]);
  });
});

describe('artifact_search: the snippet (acceptance 6)', () => {
  it('holds the anchor within about 260 characters with ellipses, whitespace collapsed and no control characters', async () => {
    const before = 'lorem ipsum dolor sit amet '.repeat(10);
    const after = ' consectetur adipiscing elit sed do'.repeat(10);
    await page('Long', `<p>${before}the 기획안\u0007 is   here${after}</p>`);
    const [hit] = (await search({ query: '기획안' })).hits;
    expect(hit!.snippet).toContain('기획안');
    expect(hit!.snippet!.startsWith('…') && hit!.snippet!.endsWith('…')).toBe(true);
    expect(codePoints(hit!.snippet!)).toBeLessThanOrEqual(262);
    // eslint-disable-next-line no-control-regex -- the control characters are what must be absent
    expect(hit!.snippet).not.toMatch(/\s{2}|[\u0000-\u001f]/u);
    expect(hit!.snippet).toContain('기획안 is here');
    expect(hit!.snippet).not.toMatch(/<|>|\[|\]/);
  });

  it('gives a title-only hit the start of its text', async () => {
    await page('Quarterly forecast', `<p>${'Opening words of the page. '.repeat(20)}</p>`);
    const [hit] = (await search({ query: 'forecast' })).hits;
    expect(hit!.snippet!.startsWith('Opening words of the page.')).toBe(true);
    expect(hit!.snippet!.endsWith('…')).toBe(true);
    expect(codePoints(hit!.snippet!)).toBeLessThanOrEqual(241);
    expect(hit!.read).toBeUndefined();
  });
});

describe('artifact_search: read (acceptance 7)', () => {
  it('gives a document hit the snippet of the block read opens, not its neighbours’ text (Decision Log 20)', async () => {
    await document('회의록', '지난주 목요일 회의에서 하반기 제품 로드맵을 검토했다. ^p1\n\n모바일 앱 개편은 11월로 미뤘다. ^p2\n\n검색 기능 출시일은 12월 9일로 확정했다. ^p3');
    const [hit] = (await search({ query: '하반기 로드맵' })).hits;
    expect(hit).toMatchObject({ snippet: '지난주 목요일 회의에서 하반기 제품 로드맵을 검토했다.', read: { from: 'p1' } });
  });

  it('anchors a title word in the block that holds it, not in the tab title that repeats the document’s title', async () => {
    await document('하반기 로드맵', '시작하는 문단이다. ^p1\n\n다른 이야기를 한다. ^p2\n\n로드맵의 출시일은 12월 9일로 확정했다. ^p3');
    for (const query of ['로드맵', '하반기 로드맵']) {
      const [hit] = (await search({ query })).hits;
      expect(hit, query).toMatchObject({ snippet: '로드맵의 출시일은 12월 9일로 확정했다.', read: { from: 'p3' } });
    }
  });

  it('names a document hit’s tab and block, which artifact_read opens at the match', async () => {
    const id = await document('Plan', '# Plan ^h1\n\nFirst paragraph. ^p1\n\nSecond paragraph. ^p2');
    const schema = schemaFor();
    await world.service.writeAs(id, HUMAN, (doc) =>
      addTab(doc, { title: 'Notes', id: 'tabN', body: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'n1' }, content: [{ type: 'text', text: 'Opening.' }] }, { type: 'paragraph', attrs: { id: 'n2' }, content: [{ type: 'text', text: 'The 결론 is in this block.' }] }] }) }),
    );
    const [hit] = (await search({ query: '결론' })).hits;
    expect(hit!.read).toEqual({ tab: 'tabN', from: 'n2' });
    const read = json<{ markdown: string }>(await call('artifact_read', { artifact: hit!.id, ...hit!.read, count: 20 }));
    expect(read.markdown.split('\n\n')[0]).toContain('결론');
    // Decision Log 17: a multi-word query opens at the first block holding every word, not the first naming the longest
    expect((await search({ query: 'Second paragraph' })).hits[0]!.read).toEqual({ tab: expect.any(String), from: 'p2' });
    expect((await search({ query: '"Second paragraph"' })).hits[0]!.read).toEqual({ tab: expect.any(String), from: 'p2' });
  });

  it('names a deck hit’s slide by its path', async () => {
    const slide = (id: string, body: string) => `<section id="${id}" style="background:#ffffff; padding:128px">\n${body}\n</section>`;
    const files = {
      [DECK_PATH]: JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-14T09:00:00Z' }, title: 'Q3 review', cover: 's1', order: ['s1', 's2'] }),
      'project/slides/s1.html': slide('s1', '<h2 id="title" style="font-size:64px">Plan</h2>'),
      'project/slides/s2.html': slide('s2', '<h2 id="t2" style="font-size:64px">매출 numbers</h2>'),
    };
    const deck = (await created({ kind: 'presentation', title: 'Q3 review', files })).artifactId;
    const [hit] = (await search({ query: '매출' })).hits;
    expect(hit).toMatchObject({ id: deck, kind: 'presentation', read: { paths: ['project/slides/s2.html'] } });
  });
});

describe('artifact_search: limits (acceptance 8)', () => {
  it('answers 10 by default, takes 50 and refuses 51, and says more exactly when more matched than the limit', async () => {
    for (let n = 0; n < 12; n++) await page(`Page ${n}`, '<p>quarterly numbers</p>');
    expect((await search({ query: 'quarterly' })).hits).toHaveLength(10);
    expect(await search({ query: 'quarterly', limit: 12 })).toMatchObject({ more: false });
    expect(await search({ query: 'quarterly', limit: 11 })).toMatchObject({ more: true });
    expect((await search({ query: 'quarterly', limit: 50 })).hits).toHaveLength(12);
    expect(text(await call('artifact_search', { query: 'quarterly', limit: 51 }))).toMatch(/^artifact_search: invalid arguments: limit/);
  });

  it('refuses a query under 2 or over 200 characters, and one with no words, each with a message', async () => {
    expect(text(await call('artifact_search', { query: 'a' }))).toMatch(/^artifact_search: invalid arguments: query/);
    expect(text(await call('artifact_search', { query: 'a'.repeat(201) }))).toMatch(/^artifact_search: invalid arguments: query/);
    const quotes = await call('artifact_search', { query: '"" ""' });
    expect(quotes.isError).toBe(true);
    expect(text(quotes)).toBe('artifact_search: the query has no words to search for; give one or more words {"reason":"invalid","query":"\\"\\" \\"\\""}');
  });

  it('answers an empty result with the hint for its scope', async () => {
    expect(await search({ query: 'nothing matches this' })).toEqual({ status: 'found', hits: [], more: false, hint: SEARCH_HINTS.noMatch });
    expect(await search({ query: 'nothing matches this', scope: 'session' })).toEqual({ status: 'found', hits: [], more: false, hint: SEARCH_HINTS.noMatchInSession });
  });

  it('answers unavailable without a store', async () => {
    const list = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => null });
    const result = await list.find((tool) => tool.name === 'artifact_search')!.call({ query: 'plan' }, ctx());
    expect(text(result)).toBe('artifact_search: the artifact store is unavailable in this run of MAWS {"reason":"unavailable"}');
  });
});

describe('artifact_search: freshness (acceptance 9)', () => {
  it('finds a publish’s new text in the same turn, and no longer the old', async () => {
    const id = await page('Status', '<p>alpha status</p>');
    expect(ids(await search({ query: 'alpha status' }))).toEqual([id]);
    const { revision } = json<{ revision: number }>(await call('artifact_read', { artifact: id }));
    json(await call('artifact_publish', { artifact: id, baseRevision: revision, files: { 'index.html': '<p>omega status</p>' } }));
    expect(ids(await search({ query: 'omega status' }))).toEqual([id]);
    expect(ids(await search({ query: 'alpha status' }))).toEqual([]);
  });

  it('follows a rename, a delete and a copy', async () => {
    const id = await page('Old name', '<p>Shared body text.</p>');
    await search({ query: 'shared body' });
    await world.store.update(id, { title: 'Brand new name' });
    expect(ids(await search({ query: 'brand new' }))).toEqual([id]);
    expect(ids(await search({ query: 'old name' }))).toEqual([]);
    const copy = await world.store.duplicate(id, { title: 'Copied' }, HUMAN);
    expect(ids(await search({ query: 'shared body' })).sort()).toEqual([id, copy.id].sort());
    await world.store.delete(id);
    expect(ids(await search({ query: 'shared body' }))).toEqual([copy.id]);
  });

  it('finds a human’s typed edit arriving through the document port by the first search after it', async () => {
    const id = await document('Draft', 'Before the edit. ^p1');
    await search({ query: 'draft' });
    // the editor's provider: a replica of the human's that sends each local change as one update frame
    const end = world.connect(id, HUMAN);
    end.edit((doc) => DocIndex.of(doc).find('p1')!.node.insert(0, '타이핑한 '));
    expect(ids(await search({ query: '타이핑한' }))).toEqual([id]);
  });
});

describe('artifact_search: the answer’s size (acceptance 10’s third clause)', () => {
  it('keeps a 50-hit answer of long Korean text well under 25,000 tokens', async () => {
    const korean = '우리는 지난주 회의에서 다음 분기의 제품 로드맵과 예산 계획을 함께 검토했고 각 팀의 일정과 위험 요소를 정리했다 '.repeat(20);
    for (let n = 0; n < 55; n++) await page(`분기 계획 ${n}`, `<p>${korean}</p>`);
    const answer = text(await call('artifact_search', { query: '로드맵', limit: 50 }));
    const result = ArtifactSearchResultSchema.parse(JSON.parse(answer));
    expect(result.hits).toHaveLength(50);
    expect(result.more).toBe(true);
    // a generous estimate: every non-ASCII character a token, ASCII at three characters a token
    const nonAscii = [...answer].filter((char) => char.charCodeAt(0) > 0x7f).length;
    const estimate = nonAscii + Math.ceil(([...answer].length - nonAscii) / 3);
    expect(estimate).toBeLessThan(25_000 * 0.8);
  });
});
