// P3-C M2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D2, D5): S6's concurrency scenarios
// (spikes/p3-store/s6/exp/concurrency.ts), 200 trials each on two replicas with random clientIDs (Yjs breaks concurrent
// ties by clientID): every trial converges to the same deck files, and each scenario's outcome is the model's rule. The
// states only concurrency produces are resolved by the adapter's repair, run as the host runs it after an update.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { applyV1, diffV1, newDoc, stateVector, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { createPresentationAdapter } from './adapter';
import { DECK_PATH, slidePath } from './deck';
import { deckFiles, deleteElementTree, moveInto, moveSlide, readFlat, readSlide, resolveAnchor, setStyle, setText, slideOrder, zOrder } from './model';
import { publishDeck } from './publish';

const TRIALS = 200;
const HUMAN: Actor = { kind: 'human' };
const adapter = createPresentationAdapter();
const BASE_SLIDE = `<section id="s1" style="background:#ffffff; padding:128px">
  <div id="bg" style="position:absolute; left:0px; top:0px; width:1920px; height:1080px; background:#eeeeee"></div>
  <h2 id="title" style="font-size:64px">Title</h2>
  <div id="g1" style="position:absolute; left:100px; top:600px; width:800px; height:300px" data-group="g"></div>
  <div id="g2" style="position:absolute; left:1000px; top:600px; width:800px; height:300px" data-group="g"></div>
  <p id="e1" style="position:absolute; left:100px; top:300px; width:400px; color:#111111">One</p>
  <p id="e2" style="position:absolute; left:600px; top:300px; width:400px">Two</p>
</section>`;
const SLIDE = (id: string) => `<section id="${id}" style="background:#ffffff"><h2 id="h-${id}">${id}</h2></section>`;
const BASE = (() => {
  const d = newDoc();
  publishDeck(
    d,
    {},
    { [DECK_PATH]: JSON.stringify({ v: 4, title: 'T', order: ['s1', 's2', 's3', 's4'] }), [slidePath('s1')]: BASE_SLIDE, ...Object.fromEntries(['s2', 's3', 's4'].map((id) => [slidePath(id), SLIDE(id)])) },
    false,
  );
  return diffV1(d);
})();

function pair(): [Doc, Doc] {
  const a = newDoc();
  const b = newDoc();
  applyV1(a, BASE);
  applyV1(b, BASE);
  return [a, b];
}
/** Both directions of a sync; each replica then runs the host's after-update repair on what it received. */
function sync(a: Doc, b: Doc, repairing = false): void {
  const toA = diffV1(b, stateVector(a));
  const toB = diffV1(a, stateVector(b));
  applyV1(a, toA);
  applyV1(b, toB);
  if (repairing) {
    adapter.afterUpdate!(a, { artifactId: 'deck', update: toA, actor: HUMAN });
    adapter.afterUpdate!(b, { artifactId: 'deck', update: toB, actor: HUMAN });
  }
}
const files = (d: Doc) => JSON.stringify(deckFiles(d));
const el = (d: Doc, id: string, s = 's1') => readFlat(d, s).find((e) => e.id === id);
const kids = (d: Doc) => readSlide(d, 's1').children.map((c) => c.id);
const stateOf = (d: Doc) => JSON.stringify([...Y.allElementScalars(d, "s1")]) + JSON.stringify(slideOrder(d));

function run(scenario: (a: Doc, b: Doc) => string): Record<string, number> {
  const outcomes: Record<string, number> = {};
  let converged = 0;
  for (let i = 0; i < TRIALS; i++) {
    const [a, b] = pair();
    const outcome = scenario(a, b);
    if (files(a) === files(b)) converged++;
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  expect(converged).toBe(TRIALS);
  return outcomes;
}

describe('the model under concurrency (S6, 200 trials per scenario)', () => {
  it('a concurrent move of one element lands as one replica’s whole position, in one transaction or two', () => {
    const one = run((a, b) => {
      setStyle(a, 's1', 'e1', { left: '111px', top: '222px' });
      setStyle(b, 's1', 'e1', { left: '333px', top: '444px' });
      sync(a, b);
      const s = el(a, 'e1')!.style;
      return s.left === '111px' && s.top === '222px' ? 'A' : s.left === '333px' && s.top === '444px' ? 'B' : 'MIXED';
    });
    expect(one.MIXED).toBeUndefined();
    expect(one.A! > 0 && one.B! > 0).toBe(true);
    const two = run((a, b) => {
      setStyle(a, 's1', 'e1', { left: '111px' });
      setStyle(a, 's1', 'e1', { top: '222px' });
      setStyle(b, 's1', 'e1', { top: '444px' });
      setStyle(b, 's1', 'e1', { left: '333px' });
      sync(a, b);
      const s = el(a, 'e1')!.style;
      return s.left === '111px' && s.top === '222px' ? 'A' : s.left === '333px' && s.top === '444px' ? 'B' : 'MIXED';
    });
    expect(two.MIXED).toBeUndefined();
  });

  it('a move and a restyle of one element both land', () => {
    expect(
      run((a, b) => {
        setStyle(a, 's1', 'e1', { left: '111px', top: '222px' });
        setStyle(b, 's1', 'e1', { color: '#ff0000', 'font-size': '40px' });
        sync(a, b);
        const s = el(a, 'e1')!.style;
        return s.left === '111px' && s.color === '#ff0000' && s['font-size'] === '40px' ? 'both' : 'lost';
      }),
    ).toEqual({ both: TRIALS });
  });

  it('z-order: different maxima are deterministic; the same key minted twice is broken by id and repaired identically', () => {
    expect(
      run((a, b) => {
        zOrder(a, 's1', 'e1', 'front');
        zOrder(b, 's1', 'e2', 'front');
        sync(a, b);
        return kids(a).join(',');
      }),
    ).toEqual({ 'bg,title,g1,g2,e2,e1': TRIALS });
    expect(
      run((a, b) => {
        zOrder(a, 's1', 'e1', 'front');
        zOrder(b, 's1', 'g1', 'front');
        sync(a, b, true);
        const same = el(a, 'e1')!.z === el(a, 'g1')!.z;
        sync(a, b);
        return `${kids(a).join(',')}|identical repair ${stateOf(a) === stateOf(b)}|keys distinct ${!same}`;
      }),
    ).toEqual({ 'bg,title,g2,e2,e1,g1|identical repair true|keys distinct true': TRIALS });
  });

  it('a backdrop sent to the back stays under the flow layer while the agent publishes a new first flow child', () => {
    expect(
      run((a, b) => {
        zOrder(a, 's1', 'e2', 'back');
        const read = deckFiles(b);
        publishDeck(b, read, { [slidePath('s1')]: read[slidePath('s1')]!.replace('  <h2 id="title"', '  <p id="newfirst">New</p>\n  <h2 id="title"') }, false);
        sync(a, b, true);
        const k = kids(a);
        return k.indexOf('e2') < k.indexOf('newfirst') ? 'under' : 'OVER';
      }),
    ).toEqual({ under: TRIALS });
  });

  it('slides: one re-ordered two ways never duplicates; two into one gap mint one key, repaired identically', () => {
    const one = run((a, b) => {
      moveSlide(a, 's3', null);
      moveSlide(b, 's3', 's4');
      sync(a, b);
      const ord = slideOrder(a);
      return new Set(ord).size === 4 && ord.length === 4 ? 'no duplicate' : 'DUPLICATE';
    });
    expect(one).toEqual({ 'no duplicate': TRIALS });
    expect(
      run((a, b) => {
        moveSlide(a, 's3', 's1');
        moveSlide(b, 's4', 's1');
        sync(a, b);
        const same = Y.slideScalars(a, 's3').order === Y.slideScalars(a, 's4').order;
        const ord = slideOrder(a).join(',');
        sync(a, b, true);
        sync(a, b);
        return `${same ? 'same key' : 'distinct'}|${ord}|${slideOrder(a).join(',') === ord ? 'kept' : 'CHANGED'}|${Y.slideScalars(a, 's3').order !== Y.slideScalars(a, 's4').order}`;
      }),
    ).toEqual({ 'same key|s1,s3,s4,s2|kept|true': TRIALS });
  });

  it('a delete wins over a concurrent edit and orphans its anchor; a move into a deleted group is repaired to the section', () => {
    expect(
      run((a, b) => {
        deleteElementTree(a, 's1', 'e1');
        setStyle(b, 's1', 'e1', { color: '#ff0000' });
        setText(b, 's1', 'e1', [{ type: 'p', inline: [{ text: 'One edited', marks: {} }] }]);
        sync(a, b);
        return `${el(a, 'e1') ? 'ALIVE' : 'deleted'} ${resolveAnchor(a, { slideId: 's1', elementId: 'e1' }).live ? 'live' : 'orphaned'}`;
      }),
    ).toEqual({ 'deleted orphaned': TRIALS });
    expect(
      run((a, b) => {
        moveInto(a, 's1', 'e1', 'g1');
        deleteElementTree(b, 's1', 'e1');
        sync(a, b);
        return `${el(a, 'e1') ? 'ALIVE' : 'deleted'} ${el(a, 'g1') ? 'intact' : 'GONE'}`;
      }),
    ).toEqual({ 'deleted intact': TRIALS });
    expect(
      run((a, b) => {
        moveInto(a, 's1', 'e1', 'g1');
        deleteElementTree(b, 's1', 'g1');
        sync(a, b);
        const stored = el(a, 'e1')!.parent;
        const shown = kids(a).includes('e1');
        sync(a, b, true);
        sync(a, b);
        return `stored ${stored}|shown at section ${shown}|after ${el(a, 'e1')!.parent || 'section'}|${el(b, 'e1')!.parent || 'section'}`;
      }),
    ).toEqual({ 'stored g1|shown at section true|after section|section': TRIALS });
  });

  it('a parent cycle sends its smallest id to the section, repaired once', () => {
    expect(
      run((a, b) => {
        moveInto(a, 's1', 'g1', 'g2');
        moveInto(b, 's1', 'g2', 'g1');
        sync(a, b);
        const top = kids(a);
        sync(a, b, true);
        sync(a, b);
        return `g1 at section ${top.includes('g1')}|g2 in g1 ${el(a, 'g2')!.parent === 'g1'}|g1 stored ${el(a, 'g1')!.parent || 'section'}`;
      }),
    ).toEqual({ 'g1 at section true|g2 in g1 true|g1 stored section': TRIALS });
  });

  it('the agent’s publish (text and colour) and the human’s move of the same element merge', () => {
    expect(
      run((a, b) => {
        const read = deckFiles(a);
        publishDeck(a, read, { [slidePath('s1')]: read[slidePath('s1')]!.replace('>One<', '>One, rewritten<').replace('color:#111111', 'color:#2b7a78') }, false);
        setStyle(b, 's1', 'e1', { left: '900px', top: '100px' });
        sync(a, b, true);
        const e = el(a, 'e1')!;
        return e.style.left === '900px' && e.style.color === '#2b7a78' && JSON.stringify(e.text).includes('One, rewritten') ? 'merged' : 'lost';
      }),
    ).toEqual({ merged: TRIALS });
  });

  it('keeps one anchor on one element through a move, a z change, a slide re-order, a regroup and a republish', () => {
    const [a, b] = pair();
    setStyle(a, 's1', 'e2', { left: '1px' });
    zOrder(b, 's1', 'e2', 'back');
    moveSlide(a, 's1', 's4');
    moveInto(b, 's1', 'e2', 'g2');
    const read = deckFiles(a);
    publishDeck(a, read, { [slidePath('s1')]: read[slidePath('s1')]!.replace('>Two<', '>Deux<') }, false);
    sync(a, b, true);
    expect(resolveAnchor(a, { slideId: 's1', elementId: 'e2' })).toEqual({ live: true, tag: 'p', parent: 'g2' });
  });
});
