// P3-C M2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M2's bench): the deck model's costs on S6's
// 100-slide bench deck, the host-side numbers the scale gate (Acceptance 7) later judges in the product build: the
// import, a replica's first sync, a one-slide and a whole-deck publish, and the scoped repair per drag-frame update.
// Timing only, so it runs on request: `MAWS_BENCH=1 pnpm exec vitest run src/engine-host/presentations/bench.test.ts`,
// each number printed with the 1-minute load average beside it.
import { loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { DECK_PATH } from '@artifacts/slides/deck';
import { benchDeckFiles } from '@artifacts/slides/fixtures/bench';
import { deckFiles, readFlat, setStyle } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { applyV2, diffV1, newDoc, stateV2, stateVector, type Doc } from '@artifacts/yjs';

const N = 100;
const RUNS = 7;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;
const ms = (n: number) => Math.round(n * 100) / 100;
/** The median of `runs` timed runs after one untimed warm-up run. */
function time(run: () => void, runs = RUNS): number {
  run();
  const t: number[] = [];
  for (let k = 0; k < runs; k++) {
    const s = performance.now();
    run();
    t.push(performance.now() - s);
  }
  return ms(median(t));
}
const report = (name: string, value: unknown) => console.log(`[deck bench] ${name}: ${JSON.stringify(value)} (load ${loadavg()[0]!.toFixed(1)})`);

describe.skipIf(process.env.MAWS_BENCH !== '1')('the deck bench (100 slides)', () => {
  it('measures the import, the first sync, the publishes and the scoped repair', () => {
    const files = benchDeckFiles(N);
    const adapter = createPresentationAdapter();
    let doc: Doc = newDoc();
    report('import: the whole deck published onto an empty doc, ms median of 7', time(() => {
      doc = newDoc();
      publishDeck(doc, {}, files, false);
    }));
    const v2 = stateV2(doc);
    report('state: V2 bytes', v2.length);
    report('first sync: the V2 state applied into a fresh replica, ms median of 7', time(() => applyV2(newDoc(), v2)));
    let read: Record<string, string> = {};
    report('read: the deck back to files, ms median of 7', time(() => (read = deckFiles(doc))));
    report('no-op republish of all 101 files as read, ms median of 7', time(() => expect(publishDeck(doc, read, read, false).changed).toEqual([])));
    const meaningEqual = Object.fromEntries(Object.entries(read).map(([p, c]) => [p, p === DECK_PATH ? JSON.stringify(JSON.parse(c)) : c.replace(/\n\s*/g, '\n')]));
    report('republish of all 101 files equal by meaning (every slide loaded and compared, 0 writes), ms median of 7', time(() => expect(publishDeck(doc, read, meaningEqual, false).changed).toEqual([])));

    // one slide, one property: each run against its own copy, so every run writes
    const slide = 'project/slides/s006.html';
    const one = { [slide]: read[slide]!.replace('font-size:64px', 'font-size:66px') };
    expect(one[slide]).not.toBe(read[slide]);
    const copies = Array.from({ length: RUNS + 1 }, () => {
      const d = newDoc();
      applyV2(d, v2);
      return d;
    });
    let i = 0;
    report('publish one slide with one property changed, ms median of 7', time(() => expect(publishDeck(copies[i++]!, read, one, false).changed).toEqual([slide])));

    // the same publish as A's publishDoc drives it today: the base files read from a doc at the base state, the
    // publish, the live files for the answer, and the session's new base (the publish again onto a base copy)
    const hostCopies = Array.from({ length: RUNS + 1 }, () => {
      const d = newDoc();
      applyV2(d, v2);
      return d;
    });
    i = 0;
    report('one-slide publish as A’s publishDoc drives it (4 deck reads or publishes), ms median of 7', time(() => {
      const baseDoc = newDoc();
      applyV2(baseDoc, v2);
      const baseFiles = deckFiles(baseDoc);
      publishDeck(hostCopies[i++]!, baseFiles, one, false);
      deckFiles(hostCopies[i - 1]!);
      publishDeck(baseDoc, deckFiles(baseDoc), one, true);
      stateV2(baseDoc);
    }));

    // the whole deck: one property changed on every slide
    const whole = Object.fromEntries(Object.entries(read).map(([p, c]) => [p, p === DECK_PATH ? c : c.replace(/^<section id="([^"]+)"/, '<section id="$1" data-transition="push"')]));
    const wholeCopies = Array.from({ length: RUNS + 1 }, () => {
      const d = newDoc();
      applyV2(d, v2);
      return d;
    });
    i = 0;
    report('publish all 100 slides, one property changed on each, ms median of 7', time(() => expect(publishDeck(wholeCopies[i++]!, read, whole, false).changed.length).toBe(N)));

    // a drag: one frame one transaction, the host's after-update repair scoped to the slide it touched
    const pinned = readFlat(doc, 's006', false).find((e) => e.style.position === 'absolute')!;
    const frames: number[] = [];
    const full: number[] = [];
    for (let f = 0; f < 200; f++) {
      const sv = stateVector(doc);
      setStyle(doc, 's006', pinned.id, { left: `${100 + f}px`, top: `${20 + (f % 7)}px` });
      const update = diffV1(doc, sv);
      let s = performance.now();
      adapter.afterUpdate!(doc, { artifactId: 'bench', update, actor: { kind: 'human' } });
      frames.push(performance.now() - s);
      s = performance.now();
      adapter.afterRestore!(doc, { artifactId: 'bench', versionId: 0 }); // the full scan, for contrast
      full.push(performance.now() - s);
    }
    report('scoped repair per drag-frame update, ms p95 / median of 200', { p95: ms(p95(frames)), median: ms(median(frames)) });
    report('full repair of the deck (contrast), ms p95 / median of 200', { p95: ms(p95(full)), median: ms(median(full)) });
  });
});
