// P4-B4 M5's live run (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, Plan of Work M5; Decision Log 10): the
// agent's `artifact_search` and the always-on link paragraph against the installed Claude Code (`binary: null`), through
// MAWS's own engine host (LiveHost) on the host's artifact store, under the shared harness's scratch config home, on
// Haiku in default permission mode with every permission allowed once.
// Case 1: the owner's Korean meeting note, created by the owner (no session in the asking session's lineage is linked to
// it), holds its answer in one block that is not its first; three distractors beside it (another session's Korean
// draft on the same subject, an English plan, a Korean html page). A fresh session asked about it in the owner's words
// passes when the journal shows its `artifact_search` call, its answer links the note as
// `[…](maws-artifact:<id>#block=<the answer's block>)`, and the answer carries the fact.
// Case 2: a fresh session handed an artifact's id and title, told to call no tool, answers with the link form
// `[…](maws-artifact:<id>)` and calls no `maws` tool. Under MAWS's launch every `maws` tool is deferred (the spec's
// Surprise 3), so with no ToolSearch call in its journal the session had no artifact tool loaded: only the server's
// instructions told it the form.
// Each case ends with the X34 guard over its journal and the shared export `finally` (A-15 checked). The run's record
// (engine, model, spend, A-15 before and after, the tool-time lines, the search calls and the answers) is printed and
// written to `<userData>/exports/artifact-search-live.txt`, and to MAWS_LIVE_RECORD when set (the evidence copies under
// docs/doperpowers/evidence/p4-b4/live-run-<n>.txt). Spend: haiku, at most US$0.30 a run (the two sessions' caps).
// `MAWS_LIVE=1 pnpm exec vitest run --project live test/live/artifact-search.live.test.ts`
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import type { Actor } from '@shared/artifacts/actor';
import { parseArtifactLink } from '@shared/artifacts/link';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { ArtifactSearchResultSchema } from '@shared/maws/search-tools';
import type { JournalRow } from '@shared/wire/journal';
import { openDocuments, type Documents } from '../../src/engine-host/documents';
import { registerDocumentKind } from '../../src/engine-host/documents/kinds/document';
import { liveSpec } from './support/live';
import { LiveHost } from './support/live-host';
import { a15, answerWhileRunning, closeSession, liveCase, openGate, readJournal, scratchRepo, type GateResult, type LiveGate } from './support/harness';
import { guardToolTime } from './support/tool-time';

const TURN_MS = 480_000; // the MacBook's load runs in the hundreds: generous waits
const CASE_MS = 900_000;
const SEARCH_MAX_USD = 0.22; // the two sessions' caps: US$0.30 a run
const LINK_MAX_USD = 0.08;
const PIN = 'f58cc516bff6dbc6bd8e59f9a61ceb0610c3d3f9'; // the P4 composite spec's blob at master 709656396 (this child's parent pin)
const PROVENANCE = { charter: 'docs/charter.md', child: 'P4-B4', pin: PIN, document: 'docs/doperpowers/plans/2026-10-19-p4-smoothing.md', executionDocument: 'docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md' };

const HUMAN: Actor = { kind: 'human' };
const ELSEWHERE: Actor = { kind: 'session', appSessionId: 'app-p4b4-elsewhere' as AppSessionId };

// The target: the owner's note, its answer in its third block (opaque ids, so no id is guessed from its words).
const TARGET = {
  title: '하반기 제품 로드맵 회의록',
  blocks: [
    ['Rk3vQ8aT', '지난주 목요일 회의에서 하반기 제품 로드맵을 팀장들과 함께 검토했다.'],
    ['Lm2xW7cN', '모바일 앱 개편은 디자인 시안이 늦어져 11월 첫째 주로 미루기로 했다.'],
    ['Zp9dH4sE', '검색 기능 출시일은 12월 9일로 확정했고, 출시 담당자는 박서연 매니저다.'],
    ['Qy6bJ1uF', '다음 회의는 다음 달 둘째 주 화요일 오후 2시에 연다.'],
  ],
} as const;
const ANSWER_BLOCK = TARGET.blocks[2][0];
const DISTRACTORS = [
  { actor: ELSEWHERE, kind: 'document', title: '상반기 로드맵 초안', blocks: [['Ha1Ka2La', '상반기 로드맵 초안이다. 확정된 내용은 없다.'], ['Ma3Na4Oa', '검색 기능은 하반기 회의에서 다시 논의하기로 했다.']] },
  { actor: HUMAN, kind: 'document', title: 'Q4 marketing plan', blocks: [['Pa5Qa6Ra', 'The Q4 campaign launches with the holiday sale.'], ['Sa7Ta8Ua', 'Search ads get a third of the budget.']] },
  { actor: HUMAN, kind: 'html', title: '팀 점심 메뉴', html: '<h1>팀 점심 메뉴</h1><p>화요일은 비빔밥, 목요일은 칼국수.</p>' },
] as const;

const SEARCH_PROMPT =
  '지난주 회의에서 정한 하반기 로드맵 말이야, 검색 기능 출시일이 언제로 정해졌고 담당자가 누구였지? ' +
  '그 내용이 적힌 곳을 내가 바로 열어볼 수 있게 해줘. 도구는 에이전트를 시키지 말고 직접 호출해.' +
  // a diagnostic variant (MAWS_P4B4_POINTED=1, live-run-3): the owner names the place as the paragraph holding the answer
  (process.env.MAWS_P4B4_POINTED === '1' ? ' 링크는 그 내용이 적힌 문단으로 바로 열리게 걸어줘.' : '');
const linkPrompt = (id: string, title: string) =>
  `There is a MAWS artifact titled "${title}" with the id ${id}. Do not call any tool: reply with one sentence telling me where I can open it.`;

type Kind = SessionEvent['kind'];
type Ev<K extends Kind> = Extract<SessionEvent, { kind: K }>;
const ofKind = <K extends Kind>(events: SessionEvent[], kind: K): Ev<K>[] => events.filter((e): e is Ev<K> => e.kind === kind);
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// The answer's Markdown links to artifacts, read by the shipped grammar (`parseArtifactLink`), with their text.
const artifactLinks = (answer: string) =>
  [...answer.matchAll(/\[([^\]]+)\]\((maws-artifact:[^)\s]+)\)/g)].flatMap(([, text, href]) => {
    const target = parseArtifactLink(href!);
    return target ? [{ text: text!, href: href!, ...target }] : [];
  });

// The journal's `tools/call`s to the maws server, each with its arguments and the host's answer text.
type CallFrame = { type?: string; request_id?: string; request?: { subtype?: string; message?: { method?: string; params?: { name?: string; arguments?: unknown } } } };
type AnswerFrame = { type?: string; response?: { request_id?: string; response?: { mcp_response?: { result?: { content?: { type: string; text?: string }[] } } } } };
function mawsCalls(rows: JournalRow[]): { name: string; args: unknown; answer: string | null }[] {
  return rows.flatMap((row) => {
    const frame = row.frame as CallFrame;
    if (row.direction !== 'in' || frame.type !== 'control_request' || frame.request?.subtype !== 'mcp_message' || frame.request.message?.method !== 'tools/call') return [];
    const answer = rows.find((r) => r.direction === 'out' && (r.frame as AnswerFrame).type === 'control_response' && (r.frame as AnswerFrame).response?.request_id === frame.request_id);
    const text = (answer?.frame as AnswerFrame | undefined)?.response?.response?.mcp_response?.result?.content?.find((block) => block.type === 'text')?.text ?? null;
    return [{ name: String(frame.request.message.params?.name ?? ''), args: frame.request.message.params?.arguments, answer: text }];
  });
}

const blocksOf = (blocks: readonly (readonly [string, string])[]) =>
  schemaFor().nodeFromJSON({ type: 'doc', content: blocks.map(([id, text]) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] })) });
// the first tab titled with the document's title, as a real create titles it (the document adapter's `initial`,
// artifact_create's document path), so a query naming the title meets the tab title in the mirror as it would
const seedDocument = async (documents: Documents, title: string, blocks: readonly (readonly [string, string])[], actor: Actor) =>
  (await documents.store.create({ kind: 'document', title, initial: (doc) => void createDocument(doc, { title, body: blocksOf(blocks) }) }, actor)).id;

let gate: GateResult;
const record: string[] = [];
const note = (line: string) => {
  record.push(line);
  console.log(`   ${line}`);
};

beforeAll(async () => {
  gate = await openGate('p4b4', note);
  if ('skip' in gate) return;
  note(`engine ${gate.bin} (${gate.version}); model haiku; scratch home ${gate.home}; userData ${gate.userData}`);
  note(`A-15 before: ${gate.a15Before.length} keys`);
  note(`case 1's prompt: ${JSON.stringify(SEARCH_PROMPT)}`);
}, 300_000);

afterAll(() => {
  if ('skip' in gate) return;
  const dir = join(gate.userData, 'exports');
  mkdirSync(dir, { recursive: true });
  const text = `${record.join('\n')}\n`;
  writeFileSync(join(dir, 'artifact-search-live.txt'), text);
  if (process.env.MAWS_LIVE_RECORD) writeFileSync(process.env.MAWS_LIVE_RECORD, text);
  console.log(`   record: ${join(dir, 'artifact-search-live.txt')}${process.env.MAWS_LIVE_RECORD ? ` and ${process.env.MAWS_LIVE_RECORD}` : ''}`);
});

// One fresh session on the store: launched, sent `prompt`, every permission allowed once, run to its first main turn's
// end and stopped; its journal read, the X34 guard's line and the export `finally` recorded whatever the outcome.
async function oneSession(g: LiveGate, documents: Documents, scenario: string, prompt: string, maxBudgetUsd: number) {
  const host = new LiveHost({ userData: g.userData, configHome: g.home, binary: null, artifacts: () => documents.store });
  const spec = liveSpec(scratchRepo(g, 'p4b4'), { model: 'haiku', permissionMode: 'default', subagentModel: null, maxBudgetUsd });
  const id = spec.appSessionId;
  let journalPath = '';
  let stopAnswering = () => {};
  try {
    const { status } = await host.launch(spec, 180_000);
    journalPath = status.journalPath;
    stopAnswering = answerWhileRunning(host, id);
    await host.call('session.send', { appSessionId: id, content: prompt });
    const init = await host.waitFor(() => ofKind(host.events(id), 'session.init')[0], 'the init', TURN_MS);
    const ended = await host.waitFor(() => mainTurnsEnded(host.events(id))[0], 'the turn', TURN_MS);
    await host.waitFor(() => host.status(id)?.turn === null && host.status(id)?.pendingRequests === 0, 'idle with nothing pending', TURN_MS);
    await delay(3_000);
    stopAnswering();
    await host.call('session.stop', { appSessionId: id, reason: 'stop' });
    const rows = readJournal(journalPath);
    const toolUses = ofKind(host.events(id), 'tool.use').map((e) => ({ name: e.toolName, input: e.input, parent: e.parentToolUseId }));
    note(`${scenario}: session ${id}; init tools hold ToolSearch ${init.tools.includes('ToolSearch')}, mcp__maws__artifact_search ${init.tools.includes('mcp__maws__artifact_search')}`);
    note(`${scenario}: tool uses ${JSON.stringify(toolUses)}`);
    const tool = guardToolTime(rows); // after the last turn; throws over the bound
    note(`${scenario}: tool time (X34): ${tool.line}`);
    note(`${scenario}: answer ${JSON.stringify(ended.resultText)}`);
    return { id, rows, toolUses, initTools: init.tools, answer: ended.resultText ?? '' };
  } finally {
    stopAnswering();
    const closed = await closeSession(host, g, { appSessionId: id, journalPath, scenario, provenance: PROVENANCE, transcript: { name: `${scenario}-transcript`, engineSessionId: spec.sessionId! } }, note);
    note(`${scenario}: spend total_cost_usd ${closed.costUsd === null ? 'unknown (no journal)' : closed.costUsd.toFixed(4)} (maxBudgetUsd ${maxBudgetUsd})`);
  }
}

describe('artifact_search and the link paragraph, live (P4-B4 M5)', () => {
  it('finds the owner’s note its lineage never touched, and links the block holding the answer', async (ctx) => {
    const g = liveCase(gate, ctx);
    const documents = openDocuments(g.userData, note)!;
    registerDocumentKind(documents.store);
    try {
      const target = await seedDocument(documents, TARGET.title, TARGET.blocks, HUMAN);
      for (const d of DISTRACTORS) {
        if (d.kind === 'html') await documents.store.create({ kind: 'html', title: d.title, content: { bytes: new TextEncoder().encode(d.html), name: 'index.html' } }, d.actor);
        else await seedDocument(documents, d.title, d.blocks, d.actor);
      }
      note(`case 1: target ${target} "${TARGET.title}", the answer in block ${ANSWER_BLOCK} (the third of four); its links before ${JSON.stringify(documents.store.links(target))}`);
      const run = await oneSession(g, documents, 'p4-b4-artifact-search', SEARCH_PROMPT, SEARCH_MAX_USD);
      const searches = mawsCalls(run.rows).filter((c) => c.name === 'artifact_search');
      for (const s of searches) note(`case 1: artifact_search ${JSON.stringify(s.args)} answered ${s.answer?.slice(0, 1_500) ?? 'nothing'}`);
      note(`case 1: maws calls ${JSON.stringify(mawsCalls(run.rows).map((c) => ({ name: c.name, args: c.args })))}`);
      note(`case 1: target links after ${JSON.stringify(documents.store.links(target))}`);
      expect(searches.length, 'the journal shows the agent’s artifact_search call').toBeGreaterThan(0);
      expect(run.toolUses.filter((u) => u.name === 'mcp__maws__artifact_search' && u.parent === null).length, 'called by the session itself, not a subagent').toBeGreaterThan(0);
      // found by the search itself, not by artifact_list's walk: some artifact_search answer holds the note among its hits
      const foundBySearch = searches.some((s) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(s.answer ?? 'null');
        } catch {
          return false; // a refusal's text
        }
        const answer = ArtifactSearchResultSchema.safeParse(parsed);
        return answer.success && answer.data.hits.some((hit) => hit.id === target);
      });
      expect(foundBySearch, 'an artifact_search answer holds the note among its hits').toBe(true);
      const links = artifactLinks(run.answer);
      note(`case 1: links in the answer ${JSON.stringify(links)}`);
      const atBlock = links.filter((link) => link.artifactId === target && link.at?.block === ANSWER_BLOCK);
      note(`case 1: verdict: searched ${searches.length > 0}; linked at the answer's block ${atBlock.length > 0} (linked blocks ${JSON.stringify(links.filter((link) => link.artifactId === target).map((link) => link.at?.block ?? null))}); the date ${/12\s*월\s*9\s*일|12\/9|December 9/.test(run.answer)}; the owner ${run.answer.includes('박서연')}`);
      expect(atBlock, 'the answer links the note at the answer’s block').not.toEqual([]);
      expect(run.answer, 'the answer carries the date').toMatch(/12\s*월\s*9\s*일|12\/9|December 9/);
      expect(run.answer, 'and the owner').toContain('박서연');
    } finally {
      documents.close();
    }
  }, CASE_MS);

  it('writes the link form with no artifact tool loaded, handed only an id and a title', async (ctx) => {
    const g = liveCase(gate, ctx);
    const documents = openDocuments(g.userData, note)!;
    registerDocumentKind(documents.store);
    try {
      const title = 'Q3 launch checklist';
      const artifact = await seedDocument(documents, title, [['Va1Wa2Xa', 'Ship the beta on the first Monday.']], HUMAN);
      note(`case 2: artifact ${artifact} "${title}"`);
      const run = await oneSession(g, documents, 'p4-b4-link-form', linkPrompt(artifact, title), LINK_MAX_USD);
      const loaded = run.toolUses.filter((u) => u.name === 'ToolSearch');
      note(`case 2: ToolSearch calls ${loaded.length} (none: no deferred maws tool was loaded); maws calls ${mawsCalls(run.rows).length}`);
      // "no artifact tool loaded" rests on the maws tools being deferred behind ToolSearch (Surprise 3)
      expect(run.initTools, 'ToolSearch among the session’s tools: the maws tools are deferred').toContain('ToolSearch');
      expect(mawsCalls(run.rows), 'no maws tool called').toEqual([]);
      expect(loaded, 'no ToolSearch call, so no artifact tool loaded').toEqual([]);
      const links = artifactLinks(run.answer);
      note(`case 2: links in the answer ${JSON.stringify(links)}`);
      note(`case 2: verdict: no maws call ${mawsCalls(run.rows).length === 0}; no ToolSearch ${loaded.length === 0}; the link form ${links.some((link) => link.artifactId === artifact)}`);
      expect(links.filter((link) => link.artifactId === artifact), 'the link form [title](maws-artifact:<id>)').not.toEqual([]);
    } finally {
      documents.close();
      note(`A-15 after the run: ${a15().length} keys`);
    }
  }, CASE_MS);
});
