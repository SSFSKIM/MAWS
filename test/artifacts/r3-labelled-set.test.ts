// R-3 (P4-B4 M5: docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "R-3 — the labelled set"): the labelled set's
// queries through the shipped `artifact_search` tool (scope all, limit 10), offline, over A's real store with the kinds'
// adapters registered as the engine host registers them. The corpus (test/fixtures/search/r3-labelled-set.json) is
// seeded as the store makes each kind: a document's and a dashboard's text as one paragraph block per line, created by
// the owner; a deck, a design and a design system through `artifact_create` with their files (a slide or a board per
// paragraph, a slide's "Speaker notes:" line as its notes, a board's title in the canvas manifest, a system's text as
// its DESIGN.md with the house system's tokens); an html page as a heading and paragraphs; a file as its text.
//
// Per query: found or missed (an expected artifact among the ten hits), the rank of the first right answer, and the
// misses by class. The assertion pins the matcher on the queries the set designs to be found, the ones whose every
// word, as the shared parser splits the query, appears in an expected artifact's title or text (case-folded, NFC,
// whitespace collapsed): the literal oracle, independent of the matcher. Every other query is a designed miss (a
// particle the text writes otherwise, the other language, a concept the words never name), measured and never asserted.
//   MAWS_R3_WRITE=1 pnpm exec vitest run --project node test/artifacts/r3-labelled-set.test.ts
// writes docs/doperpowers/evidence/p4-b4/r3-misses.json and r3-misses.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDesignAdapter } from '@artifacts/design/adapter';
import { createDesignSystemAdapter } from '@artifacts/design-system/model';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { parseQuery } from '@shared/artifacts/search-query';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { ArtifactSearchResultSchema, type ArtifactSearchResult } from '@shared/maws/search-tools';
import { registerDashboards, type Dashboards } from '../../src/engine-host/dashboards';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../../src/engine-host/documents/kinds/document-world.fixture';
import { AskTable } from '../../src/engine-host/tool-server/asks';
import { HostBridge } from '../../src/engine-host/tool-server/bridge';
import { PaneBridge } from '../../src/engine-host/tool-server/panes';
import type { McpToolDefinition, McpToolResult } from '../../src/engine-host/tool-server/server';
import { mawsTools } from '../../src/engine-host/tool-server/tools';

const ROOT = join(__dirname, '../..');
const EVIDENCE = join(ROOT, 'docs/doperpowers/evidence/p4-b4');
const HOUSE_TOKENS = readFileSync(join(ROOT, 'src/artifacts/types/design_system/defaults/maws/tokens.tokens.json'), 'utf8');
const LIMIT = 10;

interface CorpusEntry { key: string; kind: 'document' | 'presentation' | 'design' | 'dashboard' | 'html' | 'file' | 'design_system'; title: string; text: string }
interface LabelledQuery { q: string; intent: string; expect: string[]; class: string; source: string }
const SET = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/search/r3-labelled-set.json'), 'utf8')) as { corpus: CorpusEntry[]; queries: LabelledQuery[] };

// ---- the corpus as the store makes it -------------------------------------------------------------------------------

const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
const paragraphs = (text: string) => text.split(/\n\s*\n/).map(lines).filter((group) => group.length > 0);
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// one paragraph block per line, a list item's marker dropped (an editor's list item holds its text, not the dash)
function blocksOf(text: string) {
  return schemaFor().nodeFromJSON({
    type: 'doc',
    content: lines(text).map((line, i) => ({ type: 'paragraph', attrs: { id: `b${i + 1}` }, content: [{ type: 'text', text: line.replace(/^- /, '') }] })),
  });
}

function deckFiles(entry: CorpusEntry): Record<string, string> {
  const slides = paragraphs(entry.text);
  const ids = slides.map((_, i) => `s${i + 1}`);
  const files: Record<string, string> = { 'project/deck.json': JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-19T09:00:00Z' }, title: entry.title, cover: ids[0], order: ids }) };
  slides.forEach(([heading, ...rest], i) => {
    const id = ids[i]!;
    const notes = rest.filter((line) => line.startsWith('Speaker notes: ')).map((line) => line.slice('Speaker notes: '.length));
    const body = rest.filter((line) => !line.startsWith('Speaker notes: ')).map((line, k) => `<p id="${id}p${k + 1}" style="font-size:32px">${escape(line)}</p>`);
    files[`project/slides/${id}.html`] = [`<section id="${id}" style="background:#ffffff; padding:128px">`, `<h2 id="${id}h" style="font-size:64px">${escape(heading!)}</h2>`, ...body, ...notes.map((note) => `<aside>${escape(note)}</aside>`), '</section>'].join('\n');
  });
  return files;
}

// a board per paragraph: its first line the board's title with its size ("Phone screen (390 x 844)"), in the manifest
function designFiles(entry: CorpusEntry): Record<string, string> {
  const boards = paragraphs(entry.text).map(([titled, ...rest], i) => {
    const size = /^(.*?)\s*\((\d+) x (\d+)\)$/.exec(titled!);
    return { id: `b${i + 1}`, title: size ? size[1]! : titled!, w: size ? Number(size[2]) : 1440, h: size ? Number(size[3]) : 900, rest };
  });
  let x = 0;
  const frames = Object.fromEntries(boards.map((b) => [b.id, { x: (x += b.w + 200) - b.w - 200, y: 0, w: b.w, h: b.h, title: b.title }]));
  const files: Record<string, string> = { 'project/canvas.json': JSON.stringify({ v: 1, title: entry.title, boards: frames, order: boards.map((b) => b.id) }) };
  for (const b of boards) files[`project/boards/${b.id}.html`] = [`<section id="${b.id}" style="background:#ffffff; padding:64px">`, ...b.rest.map((line, k) => `<p id="${b.id}p${k + 1}" style="font-size:24px">${escape(line)}</p>`), '</section>'].join('\n');
  return files;
}

function pageHtml(entry: CorpusEntry): string {
  const [heading, ...rest] = lines(entry.text);
  return `<!doctype html><html><body><h1>${escape(heading!)}</h1>\n${rest.map((line) => `<p>${escape(line)}</p>`).join('\n')}</body></html>`;
}

// ---- the oracle ------------------------------------------------------------------------------------------------------

const folded = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').toLowerCase();
const holdsEveryWord = (query: string, entry: CorpusEntry) => {
  const haystack = folded(`${entry.title}\n${entry.text}`);
  return parseQuery(query).terms.every((term) => haystack.includes(folded(term.text)));
};
const designedFound = (query: LabelledQuery) => query.expect.some((key) => holdsEveryWord(query.q, SET.corpus.find((entry) => entry.key === key)!));

// ---- the run ---------------------------------------------------------------------------------------------------------

interface Outcome { q: string; class: string; expected: string[]; designed: 'found' | 'miss'; found: boolean; rank: number | null; hits: string[]; more: boolean; hint?: string }

let world: DocumentWorld;
let dashboards: Dashboards;
let tools: Map<string, McpToolDefinition>;
const keyOf = new Map<string, string>(); // artifact id → corpus key
const outcomes: Outcome[] = [];
let calls = 0;

const call = (name: string, args: unknown) =>
  tools.get(name)!.call(args, { appSessionId: 'app-r3' as AppSessionId, cwd: world.dir, toolUseId: `toolu_r3_${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
const answered = (result: McpToolResult, what: string) => {
  if (result.isError) throw new Error(`${what} was refused: ${text(result).slice(0, 600)}`);
  return JSON.parse(text(result)) as Record<string, unknown>;
};

async function seed(entry: CorpusEntry): Promise<string> {
  switch (entry.kind) {
    case 'document':
    case 'dashboard':
      return (await world.store.create({ kind: entry.kind, title: entry.title, initial: (doc) => void createDocument(doc, { title: '', id: 't1', body: blocksOf(entry.text) }) }, HUMAN)).id;
    case 'html':
      return (await world.store.create({ kind: 'html', title: entry.title, content: { bytes: new TextEncoder().encode(pageHtml(entry)), name: 'index.html' } }, HUMAN)).id;
    case 'file': {
      const path = join(world.dir, `${entry.key}.txt`); // a file artifact's content is a file on disk
      writeFileSync(path, entry.text);
      return (await world.store.create({ kind: 'file', title: entry.title, content: { path } }, HUMAN)).id;
    }
    case 'presentation':
    case 'design':
    case 'design_system': {
      const files = entry.kind === 'presentation' ? deckFiles(entry) : entry.kind === 'design' ? designFiles(entry) : { 'DESIGN.md': entry.text, 'tokens.tokens.json': HOUSE_TOKENS };
      return answered(await call('artifact_create', { kind: entry.kind, title: entry.title, files }), `artifact_create of ${entry.key}`).artifactId as string;
    }
  }
}

beforeAll(async () => {
  world = openDocumentWorld();
  world.store.registerAdapter(createPresentationAdapter());
  world.store.registerAdapter(createDesignAdapter());
  world.store.registerAdapter(createDesignSystemAdapter());
  dashboards = registerDashboards({ documents: world });
  tools = new Map(mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => world.store }).map((tool) => [tool.name, tool]));
  const at = world.storage.db.prepare('UPDATE artifacts SET updatedAt = ? WHERE id = ?');
  for (const [i, entry] of SET.corpus.entries()) {
    const id = await seed(entry);
    keyOf.set(id, entry.key);
    at.run(Date.UTC(2026, 9, 19, 12, i), id); // recency in the corpus's order, a minute apart, so a tie in rank never turns on the clock
  }
  for (const query of SET.queries) {
    const result: ArtifactSearchResult = ArtifactSearchResultSchema.parse(answered(await call('artifact_search', { query: query.q, scope: 'all', limit: LIMIT }), `artifact_search "${query.q}"`));
    const hits = result.hits.map((hit) => keyOf.get(hit.id) ?? hit.id);
    const at = hits.findIndex((key) => query.expect.includes(key));
    outcomes.push({ q: query.q, class: query.class, expected: query.expect, designed: designedFound(query) ? 'found' : 'miss', found: at >= 0, rank: at >= 0 ? at + 1 : null, hits, more: result.more, ...(result.hint !== undefined && { hint: result.hint }) });
  }
}, 120_000);

afterAll(() => {
  dashboards?.close();
  world?.close();
});

describe('R-3: the labelled set through the shipped artifact_search (P4-B4 M5)', () => {
  it('seeds every corpus artifact and runs every query', () => {
    expect(keyOf.size).toBe(SET.corpus.length);
    expect(outcomes).toHaveLength(SET.queries.length);
  });

  it('designs the title, body, short-term and phrase queries to be found (the oracle agrees with the set’s classes)', () => {
    const literal = new Set(['title', 'body', 'short-term', 'phrase']);
    expect(outcomes.filter((o) => literal.has(o.class) && o.designed !== 'found').map((o) => o.q)).toEqual([]);
  });

  it('finds every query the set designs to be found among its ten hits', () => {
    expect(outcomes.filter((o) => o.designed === 'found' && !o.found).map((o) => ({ q: o.q, expected: o.expected, hits: o.hits }))).toEqual([]);
  });

  it('records the measurement (the designed misses never asserted)', () => {
    const classes = [...new Set(outcomes.map((o) => o.class))];
    const byClass = Object.fromEntries(
      classes.map((name) => {
        const of = outcomes.filter((o) => o.class === name);
        return [name, { queries: of.length, found: of.filter((o) => o.found).length, missed: of.filter((o) => !o.found).length, designedMisses: of.filter((o) => o.designed === 'miss').length }];
      }),
    );
    const misses = outcomes.filter((o) => !o.found);
    console.log(`[R-3] ${outcomes.length - misses.length}/${outcomes.length} found; misses by class ${JSON.stringify(Object.fromEntries(classes.map((name) => [name, byClass[name]!.missed])))}`);
    for (const o of outcomes) console.log(`[R-3] ${o.found ? `found at ${o.rank}` : 'missed'.padEnd(10)} ${o.class.padEnd(14)} ${o.q}  (expected ${o.expected.join(', ')}; hits ${o.hits.join(', ') || 'none'})`);
    if (process.env.MAWS_R3_WRITE !== '1') return;
    mkdirSync(EVIDENCE, { recursive: true });
    const about = 'R-3 (P4-B4 M5): test/fixtures/search/r3-labelled-set.json through the shipped artifact_search (scope all, limit 10) over a real store seeded by test/artifacts/r3-labelled-set.test.ts. found: an expected artifact among the ten hits; rank: the first right answer’s place; designed: the literal oracle’s verdict (every word of the query in an expected artifact’s title or text), asserted only when found.';
    writeFileSync(join(EVIDENCE, 'r3-misses.json'), `${JSON.stringify({ about, limit: LIMIT, found: outcomes.length - misses.length, queries: outcomes.length, byClass, misses: misses.map(({ q, class: c, expected, designed, hits }) => ({ q, class: c, expected, designed, hits })), outcomes }, null, 2)}\n`);
    const designed = outcomes.filter((o) => o.designed === 'found');
    const cell = (value: string) => value.replace(/\|/g, '\\|');
    const md = [
      '# R-3: the labelled set’s misses (P4-B4 M5)',
      '',
      `${about} Regenerate with \`MAWS_R3_WRITE=1 pnpm exec vitest run --project node test/artifacts/r3-labelled-set.test.ts\`.`,
      '',
      `${outcomes.length - misses.length} of ${outcomes.length} queries found. Designed to be found: ${designed.length}, found ${designed.filter((o) => o.found).length}, at rank 1 ${designed.filter((o) => o.rank === 1).length}. Designed misses: ${outcomes.length - designed.length}, found anyway ${outcomes.filter((o) => o.designed === 'miss' && o.found).length}.`,
      '',
      '| Class | Queries | Found | Missed | Designed misses |',
      '|---|---|---|---|---|',
      ...classes.map((name) => `| ${name} | ${byClass[name]!.queries} | ${byClass[name]!.found} | ${byClass[name]!.missed} | ${byClass[name]!.designedMisses} |`),
      '',
      '| Query | Class | Expected | Found | Rank |',
      '|---|---|---|---|---|',
      ...outcomes.map((o) => `| ${cell(o.q)} | ${o.class} | ${o.expected.join(', ')} | ${o.found ? 'yes' : `no${o.hits.length > 0 ? ` (hits: ${o.hits.join(', ')})` : ''}`} | ${o.rank ?? '–'} |`),
      '',
    ].join('\n');
    writeFileSync(join(EVIDENCE, 'r3-misses.md'), md);
  });
});
