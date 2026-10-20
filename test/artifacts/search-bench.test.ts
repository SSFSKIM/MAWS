// `artifact_search`'s timing at a library's scale (P4-B4 M2: docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md;
// X34's guard holds the tool to 1,000 ms a call). Gated, as the writer's bench is:
//   MAWS_SEARCH_BENCH=1 pnpm exec vitest run test/artifacts/search-bench.test.ts --silent=false
// (the numbers are wall time, so run at low load). Over A's real store with the document kind registered: a library of
// LIBRARY artifacts (html pages and small documents, Korean and English) already mirrored, and S7b's 200-page document
// (e2e/support/document-seed.ts) changed in its last section since its row was written, so a search's catch-up
// re-extracts the whole document (the mirror's 2 MiB cap, Decision Log 16) before the query. Printed: the search with that catch-up, a search with nothing to catch up, a cold search over a library the
// migration left unmirrored (the budget's hint), a human's typed word in the 200-page document through the document
// port until a search finds it, a 50-hit answer over 55 copies of the 200-page document, and the 50-hit answer's size.
import { describe, expect, it } from 'vitest';
import { DocIndex } from '@artifacts/document/block-index';
import { listTabs, tabBody } from '@artifacts/document/tabs';
import { applyV2, type Node } from '@artifacts/yjs';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { ArtifactSearchResultSchema } from '@shared/maws/search-tools';
import { HUMAN, openDocumentWorld } from '../../src/engine-host/documents/kinds/document-world.fixture';
import { artifactSearchTool } from '../../src/engine-host/tool-server/artifact-search';
import { ArtifactSession } from '../../src/engine-host/tool-server/artifact-context';
import type { McpToolResult } from '../../src/engine-host/tool-server/server';
import { SEED_TAB, seedDocument } from '../../e2e/support/document-seed';

const bench = process.env.MAWS_SEARCH_BENCH === '1' ? it : it.skip;
const LIBRARY = Number(process.env.MAWS_SEARCH_BENCH_LIBRARY ?? 300);
const SECTIONS = Number(process.env.MAWS_SEARCH_BENCH_SECTIONS ?? 160); // 160 ≈ 200 pages
const RUNS = 9;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const round = (ms: number) => +ms.toFixed(1);
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;

describe('artifact_search at scale (P4-B4 M2)', () => {
  bench(`a search over ${LIBRARY} artifacts with the catch-up of a ${SECTIONS}-section document`, { timeout: 600_000 }, async () => {
    const world = openDocumentWorld();
    try {
      const tool = artifactSearchTool({ artifacts: () => world.store, session: new ArtifactSession() });
      let calls = 0;
      const run = async (args: Record<string, unknown>) => {
        const started = performance.now();
        const result = await tool.call(args, { appSessionId: 'app-bench' as AppSessionId, cwd: world.dir, toolUseId: `toolu_b${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
        const ms = performance.now() - started;
        if (result.isError) throw new Error(text(result));
        return { ms, answer: text(result), result: ArtifactSearchResultSchema.parse(JSON.parse(text(result))) };
      };

      const seeded = performance.now();
      const space = await world.store.createSpace({ name: 'Research' }); // half the library, the 200-page document among it
      const korean = '우리는 지난주 회의에서 다음 분기의 제품 로드맵과 예산 계획을 함께 검토했고 각 팀의 일정과 위험 요소를 정리했다 ';
      const english = 'the plan ships quarterly with design review notes owners budget risks timeline metrics agents draft final ';
      for (let n = 0; n < LIBRARY; n++) {
        const body = (n % 2 === 0 ? korean : english).repeat(10 + (n % 30)) + ` item${n}`;
        if (n % 3 === 0) await world.store.create({ kind: 'html', title: `Page ${n}`, ...(n % 2 === 0 && { spaceId: space.id }), content: { bytes: new TextEncoder().encode(`<p>${body}</p>`), name: 'index.html' } }, HUMAN);
        else {
          const created = await world.store.create({ kind: 'document', title: `Doc ${n}`, ...(n % 2 === 0 && { spaceId: space.id }) }, HUMAN);
          await world.service.writeAs(created.id, HUMAN, (doc) => (tabBody(doc, listTabs(doc)[0]!.id)!.toArray()[0] as Node).insert(0, body));
        }
      }
      const { state, stats } = seedDocument(SECTIONS);
      const big = await world.store.create({ kind: 'document', title: '200-page plan', spaceId: space.id, initial: (doc) => applyV2(doc, state) }, HUMAN);
      const seedMs = performance.now() - seeded;

      // cold: nothing mirrored yet (the migration's state before the sweep)
      const cold = await run({ query: 'budget' });
      const coldAgain = await run({ query: 'budget' });

      // warm the whole mirror (no budget), then change the 200-page document only
      for (let k = 0; k < 100 && (await run({ query: 'item1' })).result.hint !== undefined; k++);
      // M2's review: a Space filter must not move the FTS table off the outer loop (one term and two)
      const inSpace: number[] = [];
      const inSpaceTwo: number[] = [];
      for (let k = 0; k < RUNS; k++) {
        const one = await run({ query: '로드맵', spaceId: space.id });
        expect(one.result.hits.length).toBeGreaterThan(0);
        inSpace.push(one.ms);
        inSpaceTwo.push((await run({ query: 'budget review', spaceId: space.id })).ms);
      }
      const quiet: number[] = [];
      for (let k = 0; k < RUNS; k++) quiet.push((await run({ query: '로드맵' })).ms);

      const withCatchUp: number[] = [];
      for (let k = 0; k < RUNS; k++) {
        await world.service.writeAs(big.id, HUMAN, (doc) => DocIndex.of(doc).find(`s${SECTIONS - 1}p1`)!.node.insert(0, `bench${k} `));
        const { ms, result } = await run({ query: `bench${k}` });
        expect(result.hits.map((hit) => hit.id)).toEqual([big.id]); // a word in its last section
        expect(result.hits[0]!.read).toEqual({ tab: SEED_TAB, from: `s${SECTIONS - 1}p1` });
        withCatchUp.push(ms);
      }

      // a human's typed word through the document port (the editor's provider), to the first search that finds it
      const end = world.connect(big.id, HUMAN);
      const typed: number[] = [];
      for (let k = 0; k < RUNS; k++) {
        const started = performance.now();
        end.edit((doc) => DocIndex.of(doc).find(`s${Math.floor(SECTIONS / 8)}p1`)!.node.insert(0, `typed${k} `));
        const { result } = await run({ query: `typed${k}` });
        typed.push(performance.now() - started);
        expect(result.hits.map((hit) => hit.id)).toEqual([big.id]);
        expect(result.hits[0]!.read).toEqual({ tab: SEED_TAB, from: expect.stringMatching(new RegExp(`^s${Math.floor(SECTIONS / 8)}`)) });
      }

      // the mirror's 2 MiB cap (Decision Log 16): how far into the document its body reaches
      const mirrored = world.storage.db.prepare('SELECT length(t.body) AS chars, r.sections FROM artifact_text t JOIN artifact_text_rows r ON r.textRowid = t.rowid WHERE r.artifactId = ?').get(big.id) as { chars: number; sections: string };
      const places = JSON.parse(mirrored.sections) as [number, { from?: string } | null][];
      const reach = { bodyChars: mirrored.chars, lastBlock: [...places].reverse().find(([, place]) => place?.from)?.[1]?.from, sections: SECTIONS };
      const fifty = await run({ query: '로드맵', limit: 50 });

      // a 50-hit answer over large documents: copies of the 200-page one, mirrored, a two-word query whose snippet and
      // read are found in each whole body (Decision Log 17's walk over its sections)
      for (let n = 0; n < 54; n++) await world.store.duplicate(big.id, { title: `Copy ${n}` }, HUMAN);
      let warming = 0;
      for (; warming < 400 && (await run({ query: 'item1' })).result.hint !== undefined; warming++);
      const large: number[] = [];
      let largeAnswer = '';
      for (let k = 0; k < RUNS; k++) {
        const { ms, answer, result } = await run({ query: 'onboarding forecast', limit: 50 });
        expect(result.hits).toHaveLength(50);
        expect(result.hint).toBeUndefined();
        large.push(ms);
        largeAnswer = answer;
      }
      const nonAscii = [...fifty.answer].filter((char) => char.charCodeAt(0) > 0x7f).length;
      console.log(
        JSON.stringify(
          {
            library: LIBRARY + 1, sections: SECTIONS, docBytesV2: stats.v2Bytes, seedMs: round(seedMs), reach,
            cold: { ms: round(cold.ms), hint: cold.result.hint, hits: cold.result.hits.length, againMs: round(coldAgain.ms), againHint: coldAgain.result.hint },
            quietMedianMs: round(median(quiet)), quietMaxMs: round(Math.max(...quiet)),
            spaceFiltered: { oneTermMedianMs: round(median(inSpace)), oneTermMaxMs: round(Math.max(...inSpace)), twoTermsMedianMs: round(median(inSpaceTwo)), twoTermsMaxMs: round(Math.max(...inSpaceTwo)) },
            catchUpMedianMs: round(median(withCatchUp)), catchUpMaxMs: round(Math.max(...withCatchUp)),
            typedToFoundMedianMs: round(median(typed)), typedToFoundMaxMs: round(Math.max(...typed)),
            largeFifty: { docs: 55, warmingSearches: warming, medianMs: round(median(large)), maxMs: round(Math.max(...large)), chars: [...largeAnswer].length, utf8Bytes: new TextEncoder().encode(largeAnswer).length },
            fifty: { hits: fifty.result.hits.length, chars: [...fifty.answer].length, utf8Bytes: new TextEncoder().encode(fifty.answer).length, nonAscii, ms: round(fifty.ms) },
          },
          null,
          2,
        ),
      );
      expect(Math.max(...withCatchUp)).toBeLessThan(1_000);
      expect(Math.max(...large)).toBeLessThan(1_000);
      expect(Math.max(...inSpace, ...inSpaceTwo)).toBeLessThan(1_000);
    } finally {
      world.close();
    }
  });
});
