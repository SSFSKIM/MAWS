// P3-C M8 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; M8's acceptance): the history preview of a
// 3-month-old version of S7a's heavy deck, headless, on the soak's own data, and S7a's pitfall 10 on it. The soak
// (P3-0's `spikes/p3-store/s7/soak`, run as `node soak/soak.mjs --kind deck --profile heavy --encoding delta --months 3`
// with `--export <dir>` for the final month's preview inputs, P3-F) writes the version's state as its store reconstructs it
// (`stateAt`, keyframe plus deltas), the live state and the merged provenance since the version (`attributions`); this
// reads them and times what the deck's history controller does with them: the provenance decoded, the two gc-off docs
// and the renderer (`openDeckDiff`), the per-slide change set (`deckChanges`). S7a's own walk (`s7/soak/deck/sim.ts`'s
// `walk` phase, copied below) runs on the same delta beside it, and the slide ids the version and today share are
// counted: pitfall 10's per-element 0 is the heavy profile's churn (no kept slide but a restore's) plus S7a's walk
// skipping a slide a restore re-created under its id. Timing and external data, so it runs on request:
// `node spikes/p3-store/s7/soak/soak.mjs --kind deck --profile heavy --encoding delta --months 3 --export <dir>`, then
// `MAWS_DECK_HISTORY=<dir> pnpm exec vitest run src/engine-host/presentations/history-bench.test.ts`.
import { existsSync, readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { deckChanges, openDeckDiff } from '@artifacts/slides/history';
import { decodeMap } from '@artifacts/yjs';
import { SLIDES_ROOT } from '@artifacts/yjs/slides';
import { slideOrder } from '@artifacts/slides/model';

const DIR = process.env.MAWS_DECK_HISTORY ?? '';
const RUNS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const report = (name: string, value: unknown) => console.log(`[deck history bench] ${name}: ${JSON.stringify(value)} (load ${loadavg()[0]!.toFixed(1)})`);

/* eslint-disable @typescript-eslint/no-explicit-any -- S7a's walk, copied as the spike wrote it */
function s7aWalk(delta: any): { slides: number; elements: number } {
  const slides = new Set<string>();
  const els = new Set<string>();
  const any = (d: any): boolean => {
    let hit = false;
    for (const op of Object.values(d?.attrs ?? {}) as any[]) {
      if (op.attribution) hit = true;
      if (op.value && typeof op.value === 'object' && any(op.value)) hit = true;
    }
    for (const op of d?.children ?? []) {
      if (op.attribution) hit = true;
      if (Array.isArray(op.insert)) for (const c of op.insert) if (c && typeof c === 'object' && any(c)) hit = true;
    }
    return hit;
  };
  for (const [sid, op] of Object.entries(delta.attrs ?? {}) as any[]) {
    if (op.attribution) {
      slides.add(sid);
      continue;
    }
    if (any(op.value)) slides.add(sid);
    for (const [eid, eop] of Object.entries(op.value?.attrs?.elements?.value?.attrs ?? {}) as any[]) if (eop.attribution || any(eop.value)) els.add(`${sid}/${eid}`);
  }
  return { slides: slides.size, elements: els.size };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe.skipIf(!DIR || !existsSync(join(DIR, 'next.bin')))('the deck history preview on S7a’s heavy deck', () => {
  it('times a 3-month-old version’s preview and reads its changes beside S7a’s walk', () => {
    const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf8')) as { versionAt: string; kind: string; provenanceRows: number; s7aWalk: unknown; ms: Record<string, number> };
    const prevState = new Uint8Array(readFileSync(join(DIR, 'prev.bin')));
    const nextState = new Uint8Array(readFileSync(join(DIR, 'next.bin')));
    const attrs = new Uint8Array(readFileSync(join(DIR, 'attrs.bin')));
    report('version', { at: meta.versionAt, kind: meta.kind, provenanceRows: meta.provenanceRows, prevBytes: prevState.length, nextBytes: nextState.length, provenanceBytes: attrs.length });
    report('the soak’s own headless preview (state reconstruction, live encode, provenance merge, docs, render, walk), ms', meta.ms);
    report('S7a’s walk, as the soak recorded it', meta.s7aWalk);

    const run = () => {
      const t0 = performance.now();
      const diff = openDeckDiff({ prevState, nextState, attributions: decodeMap(attrs) });
      const t1 = performance.now();
      const changes = deckChanges(diff);
      const t2 = performance.now();
      const walk = s7aWalk(diff.nextDoc.get(SLIDES_ROOT).toDeltaDeep({ renderer: diff.renderer }).toJSON());
      const kept = slideOrder(diff.prevDoc).filter((id) => slideOrder(diff.nextDoc).includes(id)).length;
      diff.destroy();
      return { open: t1 - t0, changes: t2 - t1, total: t2 - t0, result: changes, walk, kept };
    };
    run(); // warm-up
    const runs = Array.from({ length: RUNS }, run);
    const last = runs.at(-1)!;
    const elements = last.result.slides.reduce((n, s) => n + s.elements.length, 0);
    const notes = last.result.slides.reduce((n, s) => n + s.notes.length, 0);
    const byKind = Object.fromEntries(['added', 'removed', 'changed'].map((k) => [k, last.result.slides.filter((s) => s.kind === k).length]));
    report('this walk: slides by kind, elements, notes runs, N changes', { slides: byKind, elements, notes, count: last.result.count, deck: last.result.deck?.keys.map((k) => k.key) ?? null });
    report('slide ids the version and today share', last.kept);
    report('S7a’s walk on the same delta', last.walk);
    report(`decode + openDeckDiff, ms median of ${RUNS}`, Math.round(median(runs.map((r) => r.open)) * 10) / 10);
    report(`deckChanges, ms median of ${RUNS}`, Math.round(median(runs.map((r) => r.changes)) * 10) / 10);
    report(`the controller's preview compute, ms median of ${RUNS}`, Math.round(median(runs.map((r) => r.total)) * 10) / 10);
    expect(last.result.count).toBeGreaterThan(0);
    if (last.kept > 0) expect(elements).toBeGreaterThan(0); // a kept slide (a restore's) has its elements read
  });
});
