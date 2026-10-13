// The patch writer's headless bench (D6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md: p95 under 40 ms in
// Node at 200 pages for a five-op batch, the pre-gate for M9's 50 ms host-loop bound; parent Decision Log 37). Gated:
//   MAWS_DOC_BENCH=1 pnpm exec vitest run test/artifacts/document-writer-bench.test.ts --silent=false
// (vitest prints a passing test's console only with --silent=false; the numbers are wall time, so run at low load)
// On S7b's 200-page seed (e2e/support/document-seed.ts): an agent replica applies batches mixing a quoted word edit,
// a block rewrite, an inserted paragraph after a heading, a table cell and, alternately, an unscoped quote or the
// deletion of an earlier insert (S7b's agents' mix); the host side applies each batch's update as A's service would
// (the binding check, the apply, the document adapter's hooks, the attribution map). Printed: p50, p95 and max of the
// writer, of the host's frame and of both together, and the cold costs paid once per replica (the block index, the
// first unscoped search reading every block's text).
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { applyV1, applyV2, attributionMap, checkUpdate, contentIdsOf, newDoc, onUpdate, transact } from '@artifacts/yjs';
import { documentAdapter } from '@artifacts/document/adapter';
import { DocIndex } from '@artifacts/document/block-index';
import type { Op } from '@artifacts/document/edit-ops';
import { applyEdit } from '@artifacts/document/patch-writer';
import { prng, SEED_TAB, seedDocument, sentence } from '../../e2e/support/document-seed';

const bench = process.env.MAWS_DOC_BENCH === '1' ? it : it.skip;
const SECTIONS = Number(process.env.MAWS_DOC_BENCH_SECTIONS ?? 160); // 160 ≈ 200 pages; fewer for a quick functional run
const RUNS = 40;
const WARMUP = 5;

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const summary = (values: number[]) => ({ p50: +percentile(values, 50).toFixed(1), p95: +percentile(values, 95).toFixed(1), max: +Math.max(...values).toFixed(1) });

describe('the patch writer at 200 pages', () => {
  bench('a five-op batch: writer p95 under 40 ms', { timeout: 600_000 }, () => {
    const { state, stats } = seedDocument(SECTIONS);
    const agent = newDoc();
    applyV2(agent, state);
    const live = newDoc();
    applyV2(live, state);
    const replica = newDoc();
    applyV2(replica, state);
    const adapter = documentAdapter();
    const actor = { kind: 'session', appSessionId: 'bench' } as Actor;

    let t0 = performance.now();
    const index = DocIndex.of(agent);
    index.tops(SEED_TAB);
    const coldIndex = performance.now() - t0;
    let updates: Uint8Array[] = [];
    onUpdate(agent, (update) => updates.push(update));
    t0 = performance.now();
    applyEdit(agent, [{ op: 'replace_text', old: 'Start.', new: 'Begin.' }]);
    const coldSearch = performance.now() - t0;
    for (const update of updates) [live, replica].forEach((doc) => applyV1(doc, update));
    DocIndex.of(live).tabIds();
    DocIndex.of(replica).tabIds();

    const r = prng(5);
    const pick = (n: number) => Math.floor(r() * n);
    const markdownOf = (id: string) => index.md(index.find(id)!.top); // what the agent read and quotes
    const writer: number[] = [];
    const host: number[] = [];
    const total: number[] = [];
    const inserted: string[] = [];
    for (let run = 0; run < WARMUP + RUNS; run++) {
      const a = pick(SECTIONS);
      const first = markdownOf(`s${a}p2`).split('.')[0];
      const words = first.split(' ');
      const plain = words.findIndex((word, k) => k >= 2 && /^[a-z]+$/.test(word));
      words[plain >= 0 ? plain : words.length - 1] = `agentword${run}`;
      const t = 1 + 3 * pick(Math.floor((SECTIONS - 2) / 3) + 1); // a section with a table (s % 3 === 1)
      const ops: Op[] = [
        { op: 'replace_text', block: `s${a}p2`, old: first, new: words.join(' ') },
        { op: 'replace_block', id: `s${pick(SECTIONS)}p4`, markdown: `Agent ${run} rewrote this block. ${sentence(r)} ${sentence(r)} ${sentence(r)}` },
        { op: 'insert', after: `s${pick(SECTIONS)}h`, markdown: `Agent ${run} inserted this paragraph. ${sentence(r)} ${sentence(r)}` },
        { op: 'set_cell', table: `s${t}t`, row: 1 + pick(3), col: pick(3), markdown: String(pick(10_000)) },
        run % 2 === 1 && inserted.length > 0 ? { op: 'delete', id: inserted.shift()! } : { op: 'replace_text', old: `Agent ${run - 1} inserted this paragraph.`, new: `Agent ${run - 1} added this paragraph.` },
      ];
      if (run === 0) ops[4] = { op: 'replace_text', old: 'Begin.', new: 'Start.' };
      updates = [];
      t0 = performance.now();
      const applied = applyEdit(agent, ops);
      const wrote = performance.now() - t0;
      adapter.registerCarries('bench', applied.carries);
      inserted.push(applied.results[2].newIds[0]);
      t0 = performance.now();
      for (const update of updates) {
        if (checkUpdate(live, update)) throw new Error('the binding check refused a writer update');
        const forward = adapter.beforeApply!(live, update, { actor, step2: false });
        applyV1(live, update);
        applyV1(replica, update);
        transact(replica, () => {
          forward?.(replica);
          adapter.afterUpdate!(replica, { update, actor });
        });
        attributionMap(contentIdsOf(update), { insertActor: 'session:bench', deleteActor: 'session:bench', at: Date.now() });
      }
      const framed = performance.now() - t0;
      if (run >= WARMUP) {
        writer.push(wrote);
        host.push(framed);
        total.push(wrote + framed);
      }
    }
    const result = {
      seed: stats,
      coldMs: { index: +coldIndex.toFixed(1), firstUnscopedSearch: +coldSearch.toFixed(1) },
      writer: summary(writer),
      hostFrame: summary(host),
      batchTotal: summary(total),
      runs: RUNS,
    };
    console.log(`document writer bench: ${JSON.stringify(result)}`);
    expect(result.writer.p95).toBeLessThan(40);
  });
});
