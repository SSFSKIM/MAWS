import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAWS_SERVER_INSTRUCTIONS } from './instructions';
import {
  ARTIFACT_SEARCH_DEFAULTS,
  ArtifactSearchInputSchema,
  ArtifactSearchResultSchema,
  SEARCH_HINTS,
  SEARCH_LIMITS,
  SEARCH_REFUSALS,
  SEARCH_TOOL_NAMES,
  searchHint,
} from './search-tools';
import { artifactRefusalOf, MAWS_TOOL_NAMES, mawsToolList, parseToolArguments } from './tools';

const UUID = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('artifact_search (X33, P4-B4)', () => {
  it('takes a query of 2 to 200 characters, a kind, a Space, a scope and a limit of 1 to 50, strictly and never defaulted', () => {
    expect(SEARCH_TOOL_NAMES).toEqual(['artifact_search']);
    expect(SEARCH_LIMITS).toEqual({ queryMin: 2, queryMax: 200, limitMax: 50 });
    expect(ARTIFACT_SEARCH_DEFAULTS).toEqual({ scope: 'all', limit: 10 });
    expect(ArtifactSearchInputSchema.parse({ query: '로드맵' })).toEqual({ query: '로드맵' });
    const full = { query: 'budget 2027', kind: 'document', spaceId: UUID, scope: 'session', limit: 50 };
    expect(parseToolArguments('artifact_search', full)).toEqual({ ok: true, data: full });
    expect(ArtifactSearchInputSchema.safeParse({ query: 'x'.repeat(200), scope: 'all', limit: 1 }).success).toBe(true);
    for (const bad of [{ query: 'a' }, { query: 'x'.repeat(201) }, { query: 'ab', limit: 0 }, { query: 'ab', limit: 51 }, { query: 'ab', limit: 1.5 }, { query: 'ab', scope: 'lineage' }, { query: 'ab', spaceId: 'Work' }, { query: 'ab', kind: 'deck' }, { query: 'ab', cursor: 'x' }, {}]) {
      expect(ArtifactSearchInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses a short or long query and a large limit as the schema’s invalid arguments', () => {
    for (const [args, field] of [[{ query: 'a' }, 'query'], [{ query: 'x'.repeat(201) }, 'query'], [{ query: 'ab', limit: 51 }, 'limit']] as const) {
      const refused = parseToolArguments('artifact_search', args);
      expect(refused.ok === false && refused.error, field).toMatch(new RegExp(`^artifact_search: invalid arguments: ${field}: `));
    }
  });

  it('refuses a query with no words in the artifact tools’ refusal format, its reason machine-readable', () => {
    const text = SEARCH_REFUSALS.noTerms('"" ""');
    expect(text).toBe('artifact_search: the query has no words to search for; give one or more words {"reason":"invalid","query":"\\"\\" \\"\\""}');
    expect(artifactRefusalOf(text)).toEqual({ reason: 'invalid', query: '"" ""' });
    expect(SEARCH_REFUSALS.noTerms('   ')).toBe('artifact_search: the query has no words to search for; give one or more words {"reason":"invalid","query":"   "}');
  });

  it('carries the hints word for word, and speaks only when there is something to say', () => {
    expect(SEARCH_HINTS.noMatchInSession).toBe('No match among this session\'s artifacts; scope "all" searches the whole library.');
    expect(SEARCH_HINTS.noMatch).toBe('No match; try fewer or other words, or the other language.');
    expect(SEARCH_HINTS.searchedAsBefore(3)).toBe('3 artifacts changed moments ago and were searched as they were before; search again shortly to include their changes.');
    expect(SEARCH_HINTS.searchedAsBefore(1)).toBe('1 artifact changed moments ago and was searched as it was before; search again shortly to include its changes.');
    expect(searchHint({ scope: 'session', hits: 0, searchedAsBefore: 0 })).toBe(SEARCH_HINTS.noMatchInSession);
    expect(searchHint({ scope: 'all', hits: 0, searchedAsBefore: 2 })).toBe(SEARCH_HINTS.noMatch);
    expect(searchHint({ scope: 'all', hits: 4, searchedAsBefore: 2 })).toBe(SEARCH_HINTS.searchedAsBefore(2));
    expect(searchHint({ scope: 'session', hits: 4, searchedAsBefore: 0 })).toBeUndefined();
  });

  it('answers hits that are listed artifacts with a snippet and the place to read them at; no score, no cursor', () => {
    const listed = { id: UUID, kind: 'document', title: 'Q3 로드맵', revision: 42, updatedAt: '2026-10-19T00:00:00.000Z', lastEditor: { by: 'user', at: '2026-10-19T00:00:00.000Z' }, spaceId: UUID, spaceName: 'Work' };
    const answer = (hits: unknown[], extra: Record<string, unknown> = {}) => ArtifactSearchResultSchema.safeParse({ status: 'found', hits, more: false, ...extra }).success;
    expect(answer([{ ...listed, snippet: '… 로드맵을 검토 …', read: { tab: 't1', from: 'b7' } }])).toBe(true);
    expect(answer([{ ...listed, kind: 'presentation', snippet: 'x', read: { paths: ['project/slides/s1.html'] } }])).toBe(true);
    expect(answer([listed, { ...listed, lastEditor: null }], { hint: SEARCH_HINTS.searchedAsBefore(1) })).toBe(true);
    expect(answer([], { hint: SEARCH_HINTS.noMatch })).toBe(true);
    expect(answer([{ ...listed, score: 1.2 }])).toBe(false);
    expect(answer([{ ...listed, read: { tab: 't1', paths: ['a'] } }])).toBe(false);
    expect(answer([listed], { cursor: 'x' })).toBe(false);
    expect(ArtifactSearchResultSchema.safeParse({ status: 'found', hits: [] }).success).toBe(false); // more is always said
  });
});

describe('the maws server’s instructions (X33, route (b))', () => {
  it('is the one paragraph, word for word', () => {
    expect(MAWS_SERVER_INSTRUCTIONS).toBe(
      "MAWS artifacts are the user's documents, presentations, designs, dashboards, html pages and files. When you name one to the user, write a Markdown link to it, [its title](maws-artifact:<artifactId>): a click opens it in MAWS, so the user never has to ask where it is. To open it at a place, add a fragment: #block=<blockId> for a document's block, #tab=<tabId> for a document's tab, #slide=<slideId> for a presentation's slide, #v<version> for a retained version, with the ids mcp__maws__artifact_read and mcp__maws__artifact_search return. Call mcp__maws__show_pane only when the user should see it now. To find an artifact you did not make or open in this session, call mcp__maws__artifact_search.",
    );
  });

  it('names only tools the server lists', () => {
    const named = [...MAWS_SERVER_INSTRUCTIONS.matchAll(/mcp__maws__(\w+)/g)].map((m) => m[1]);
    expect(new Set(named)).toEqual(new Set(['artifact_read', 'artifact_search', 'show_pane']));
    for (const name of named) expect(MAWS_TOOL_NAMES as readonly string[], name).toContain(name);
  });
});

// The probe (spikes/protocol-probe/scenarios/pass3/p4-b4-surface.mjs) serves this snapshot as the maws server's
// initialize instructions and `tools/list`, so its fixtures record exactly what MAWS sends. After a change to the
// tools or the paragraph, regenerate it and re-record the probe (M3):
//   MAWS_WRITE_PROBE_TOOLS=1 pnpm vitest run src/shared/maws/search-tools.test.ts
const PROBE_TOOLS = fileURLToPath(new URL('../../../spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json', import.meta.url));
const probeTools = () => `${JSON.stringify({ instructions: MAWS_SERVER_INSTRUCTIONS, tools: mawsToolList() }, null, 2)}\n`;

// P4-R7z (the P4 spec's Decision Log 92) took P4-R7's `message` off the server after the probe recorded its fixtures
// against this snapshot, which keeps it so the fixtures still match what they were served; less that one tool it is the
// source. Re-recording the probe drops it (the tracker's row).
describe('the probe’s snapshot of the maws server', () => {
  it('is the paragraph and tools/list as the source has them, less the message tool P4-R7z took out', () => {
    if (process.env.MAWS_WRITE_PROBE_TOOLS === '1') writeFileSync(PROBE_TOOLS, probeTools());
    const snapshot = JSON.parse(readFileSync(PROBE_TOOLS, 'utf8')) as { instructions: string; tools: { name: string }[] };
    expect(snapshot.tools.map((tool) => tool.name).filter((name) => !MAWS_TOOL_NAMES.includes(name as never))).toEqual(['message']);
    expect(`${JSON.stringify({ instructions: snapshot.instructions, tools: snapshot.tools.filter((tool) => tool.name !== 'message') }, null, 2)}\n`).toBe(probeTools());
  });
});
