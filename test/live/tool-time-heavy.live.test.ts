// P4-A2 (X34; the P4 spec §4.2 "The tool-time guard", P4-A2's execution document R11 and M7): the guard's heavy-case
// fixture. The heaviest known cases drive the real `maws` tool server over the wire through the conformance scripted
// transport (`scriptedSession`), on a temporary artifact store with the host's kinds registered as the engine host
// registers them, so the session's journal carries the `tools/call` and `control_response` frames the guard reads:
// E1's 24-board bench design created, read and published whole (row 187's board), S6's 100-slide bench deck created,
// read and published whole, and S7b's 200-page document (e2e/support/document-seed.ts, seeded as the scale gate's seam
// seeds it) read whole, then edited by one 20-op batch spread across it, then searched for a paragraph the batch
// inserted (P4-B4: `artifact_search` re-extracting the changed document). One session runs the three cases in turn, as
// one agent would: each case holds every call under the bound and prints its numbers with the 1-minute load, and the
// run ends with `guardToolTime` over the session's whole journal, as a live spec ends (the median is the spec's).
// A vitest file of the `live` project rather than the ledger's `e2e/tool-time-heavy-live.spec.ts`: the tool server
// imports the kinds' guides as Vite `?raw` modules (src/artifacts/types/guides.ts), which Playwright's loader cannot
// resolve. It runs under MAWS_LIVE=1 (`pnpm e2e:tool-time-heavy-live`, gate.yml's LIVE_E2E group
// `tool-time-heavy-live`; `pnpm test:live` too), so on every gate that runs the live specs, and spends nothing.
import { mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boardPath } from '@artifacts/design/canvas';
import { benchBoards, benchDesignFiles } from '@artifacts/design/fixtures/bench';
import { TABS } from '@artifacts/document/tabs';
import { benchDeckFiles } from '@artifacts/slides/fixtures/bench';
import { applyV2 } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { JournalRow } from '@shared/wire/journal';
import { seedDocument } from '../../e2e/support/document-seed';
import { scriptedSession } from '../../src/engine-host/conformance/session-harness';
import { registerDesigns } from '../../src/engine-host/designs';
import { openDocuments, type Documents } from '../../src/engine-host/documents';
import { registerDocumentKind } from '../../src/engine-host/documents/kinds/document';
import { registerPresentations } from '../../src/engine-host/presentations';
import { expectToolTime, guardToolTime, readToolSpans, RENDER_TOOL_TIME_BOUND_MS, TOOL_TIME_BOUND_MS, TOOL_TIME_MEDIAN_MS } from './support/tool-time';

const HUMAN: Actor = { kind: 'human' };
const DOCUMENT_SECTIONS = 160; // ≈ 200 pages, as e2e/document-scale.spec.ts seeds them
const BATCH_SECTIONS = [4, 40, 76, 112, 148]; // spread across the document, each with a table (s % 3 === 1)

type Mcp = { result?: { content?: { type: string; text?: string }[]; isError?: boolean }; error?: { message: string } };
type Read = { revision: number; files?: Record<string, string>; markdown?: string };
type Publish = { revision: number; changed: string[] };
type Annotate = (message: string, type?: string) => Promise<unknown>;

const until = async (check: () => boolean, what: string, ms = 60_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

// A started scripted session whose `maws` tools write through a fresh store with the host's kinds registered, and a
// `call` that sends one `tools/call` as the engine does and resolves with the tool's JSON answer once its
// `control_response` is journaled.
async function heavySession() {
  const userData = mkdtempSync(join(tmpdir(), 'maws-tool-time-heavy-'));
  const documents: Documents = openDocuments(userData, () => {})!;
  registerDocumentKind(documents.store);
  const presentations = registerPresentations({ documents, chain: null, refresh: () => {} });
  const designs = registerDesigns({ documents, chain: null, refresh: () => {} });
  const run = scriptedSession({ session: { artifacts: () => documents.store } });
  await run.session.start();
  let n = 0;
  const answerOf = (requestId: string) =>
    run.journal.rows.find((row) => row.direction === 'out' && (row.frame as { type?: string }).type === 'control_response' && (row.frame as { response?: { request_id?: string } }).response?.request_id === requestId);
  const call = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> => {
    const requestId = `heavy-${++n}`;
    run.transport.push({ type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': `toolu_heavy_${n}`, progressToken: n } } } } });
    await until(() => answerOf(requestId) !== undefined, `the answer to ${name}`);
    const rpc = (answerOf(requestId)!.frame as { response: { response: { mcp_response: Mcp } } }).response.response.mcp_response;
    const text = rpc.result?.content?.find((block) => block.type === 'text')?.text ?? rpc.error?.message ?? '';
    if (rpc.error || rpc.result?.isError) throw new Error(`${name} was refused: ${text.slice(0, 2_000)}`);
    return JSON.parse(text) as T;
  };
  const close = async () => {
    run.transport.exit(0);
    await run.session.exited;
    designs.close();
    presentations.close();
    documents.close();
    rmSync(userData, { recursive: true, force: true });
  };
  return { documents, rows: (): JournalRow[] => run.journal.rows, call, close };
}

const load = () => loadavg()[0]!.toFixed(1);
const report = async (line: string, annotate: Annotate) => {
  console.log(`[tool-time heavy] ${line}`);
  await annotate(line, 'tool-time');
};

describe.skipIf(process.env.MAWS_LIVE !== '1')(`the tool-time guard's heavy cases (bound ${TOOL_TIME_BOUND_MS} ms per call, the median ${TOOL_TIME_MEDIAN_MS} ms, render ${RENDER_TOOL_TIME_BOUND_MS} ms)`, () => {
  let s: Awaited<ReturnType<typeof heavySession>>;
  beforeAll(async () => {
    s = await heavySession();
  });
  afterAll(async () => {
    await s?.close();
  });

  // A case's calls (the journal's rows from `from` on), their numbers printed, then each held under the bound; the
  // median is the whole run's, read by the last case.
  const perCall = async (label: string, from: number, annotate: Annotate) => {
    const spans = readToolSpans(s.rows().slice(from));
    await report(`${label}: ${spans.map((span) => `${span.name} ${span.ms} ms`).join(', ')}; load ${load()}`, annotate);
    return expectToolTime(spans, { median: Number.POSITIVE_INFINITY });
  };

  it('E1’s 24-board design: created, read and published whole, each call under the bound', async ({ annotate }) => {
    const from = s.rows().length;
    const created = await s.call<{ artifactId: string }>('artifact_create', { kind: 'design', title: 'Heavy 24', files: benchDesignFiles('Heavy 24') });
    const read = await s.call<Read>('artifact_read', { artifact: created.artifactId });
    // every board's first card restyled, the manifest as read: the whole design in one publish
    const files = Object.fromEntries(Object.entries(read.files!).map(([path, text]) => [path, path.startsWith('project/boards/') ? text.replace(/(id="c0"[^>]*?background:\s*)#ffffff/i, '$1#fff4d6') : text]));
    const published = await s.call<Publish>('artifact_publish', { artifact: created.artifactId, baseRevision: read.revision, files });
    expect(published.changed.sort()).toEqual(benchBoards().map((b) => boardPath(b.id)).sort());
    expect((await perCall('design, 24 boards', from, annotate)).calls).toBe(3);
  });

  it('S6’s 100-slide deck: created, read and published whole, each call under the bound', async ({ annotate }) => {
    const from = s.rows().length;
    const created = await s.call<{ artifactId: string }>('artifact_create', { kind: 'presentation', title: 'Heavy 100', files: benchDeckFiles(100) });
    const read = await s.call<Read>('artifact_read', { artifact: created.artifactId });
    // one property changed on every slide (P3-C M2's whole-deck publish), the deck manifest as read
    const files = Object.fromEntries(Object.entries(read.files!).map(([path, text]) => [path, path.startsWith('project/slides/') ? text.replace(/^<section id="([^"]+)"/, '<section id="$1" data-transition="push"') : text]));
    const published = await s.call<Publish>('artifact_publish', { artifact: created.artifactId, baseRevision: read.revision, files });
    expect(published.changed).toHaveLength(100);
    expect((await perCall('deck, 100 slides', from, annotate)).calls).toBe(3);
  });

  it('S7b’s 200-page document: read whole, then one 20-op batch across it and a search for what it inserted, each call under the bound', async ({ annotate }) => {
    const { state, stats } = seedDocument(DOCUMENT_SECTIONS);
    // created by the owner, its first tab replaced by the seed's in one write as the human (the scale gate's seam)
    const { id } = await s.documents.store.create({ kind: 'document', title: 'Heavy 200' }, HUMAN);
    await s.documents.store.service.writeAs(id, HUMAN, (doc) => {
      const tabs = doc.get(TABS);
      for (const [key] of [...tabs.attrEntries()]) tabs.deleteAttr(String(key));
      applyV2(doc, state);
    });
    const from = s.rows().length;
    // the agent reads it all as the scale gate's agents do: the first 200 blocks, then 1,000 at a time
    const blocks = new Map<string, string>();
    const learn = (markdown: string) => {
      const ids: string[] = [];
      for (const line of markdown.split('\n')) {
        const marker = /(?:^| )\^([0-9a-z]+)$/.exec(line); // a table's marker stands on a line of its own
        if (!marker) continue;
        blocks.set(marker[1]!, line.slice(0, marker.index));
        ids.push(marker[1]!);
      }
      return ids;
    };
    const first = await s.call<Read>('artifact_read', { artifact: id });
    let last = learn(first.markdown!).at(-1);
    for (let k = 0; k < 10 && last; k++) {
      const ids = learn((await s.call<Read>('artifact_read', { artifact: id, from: last, count: 1_000 })).markdown!);
      if (ids.length <= 1) break;
      last = ids.at(-1);
    }
    expect(blocks.size, 'the whole first tab read').toBeGreaterThanOrEqual(stats.topBlocks);
    // four ops in each of five sections: a quoted phrase, a block rewritten, a paragraph inserted, a table cell set
    const ops = BATCH_SECTIONS.flatMap((k) => {
      const line = blocks.get(`s${k}p2`)!;
      const words = line.split(' ');
      const phrase = (i: number) => words.slice(i, i + 6).join(' ');
      const at = words.findIndex((_, i) => words.slice(i, i + 6).every((w) => /^[a-z]+$/.test(w)) && line.split(phrase(i)).length === 2);
      if (at < 0) throw new Error(`no plain six-word phrase to quote once in ^s${k}p2: ${line}`);
      return [
        { op: 'replace_text', block: `s${k}p2`, old: phrase(at), new: phrase(at).replace(/^(\S+)/, '$1 (heavy)') },
        { op: 'replace_block', id: `s${k}p4`, markdown: `The heavy batch rewrote section ${k + 1}'s fourth paragraph.` },
        { op: 'insert', after: `s${k}h3`, markdown: `A paragraph the heavy batch inserted in section ${k + 1}.` },
        { op: 'set_cell', table: `s${k}t`, row: 1, col: 1, markdown: `heavy ${k}` },
      ];
    });
    const edited = await s.call<{ status: string }>('artifact_edit', { artifact: id, baseRevision: first.revision, ops });
    expect(edited.status).toBe('edited');
    // P4-B4 M5: a search right after the batch, for the paragraph it inserted in the last section, re-extracts the whole
    // document into the mirror (it changed since its row was written) before it answers, inside the same bound
    const lastSection = BATCH_SECTIONS.at(-1)! + 1;
    const searched = await s.call<{ hits: { id: string; read?: { tab?: string; from?: string } }[] }>('artifact_search', { query: `"heavy batch inserted in section ${lastSection}"` });
    expect(searched.hits.map((hit) => hit.id), 'the search finds the batch’s paragraph in the 200-page document').toEqual([id]);
    expect(searched.hits[0]!.read?.from, 'at its block').toEqual(expect.any(String));
    const label = `document, ${stats.sections} sections (${stats.topBlocks} top blocks, ${stats.words} words) read whole, then a ${ops.length}-op batch, then a search`;
    expect((await perCall(label, from, annotate)).calls).toBeGreaterThanOrEqual(3);
  });

  it('the whole run under the guard, as a live spec reads it after its last turn', async ({ annotate }) => {
    const summary = guardToolTime(s.rows());
    await report(`the run: ${summary.line}; load ${load()}`, annotate);
    expect(summary.render).toBe(0);
    expect(summary.guarded).toBe(summary.spans.length);
  });
});
