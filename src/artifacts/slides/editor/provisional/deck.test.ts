// P4-A2 G2.3 (docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md, G-R1, G-R2, G-R5): the deck's provisional
// model over the layers' store: each slide a publish writes, named from the frame that names its file, drawn once it
// differs (into a scratch doc the canvases draw, never into the live one), followed as the live slide changes, a new
// slide placed by the streamed index, and every trace gone at a refusal or once the replica holds the write.
import { describe, expect, it } from 'vitest';
import { stateVector } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { DECK_PATH, slidePath } from '../../deck';
import { deleteSlide, readSlide, setText, slideOrder } from '../../model';
import { DeckProvisional, writtenOrder } from './deck';
import { deckWorld, publishFrame, replica } from './testing';

const ONE = '<section id="s1" style="background:#ffffff; padding:96px"><h1 id="title" style="font-size:80px">Launch review</h1><p id="date" style="font-size:40px">Friday, 24 October</p></section>';
const TWO = '<section id="s2" style="background:#ffffff"><h2 id="t2" style="font-size:64px">Numbers</h2></section>';

function world() {
  const deck = deckWorld({ s1: ONE, s2: TWO });
  const live = replica(deck.doc);
  const stopLayers = live.layers.attach();
  const provisional = new DeckProvisional(live.layers, deck.doc);
  const stop = provisional.attach();
  let told = 0;
  provisional.subscribe(() => (told += 1));
  return { ...deck, live, provisional, told: () => told, stop: () => (stop(), stopLayers()) };
}

const textOf = (doc: Parameters<typeof readSlide>[0], slide: string, id: string) => {
  const find = (els: ReturnType<typeof readSlide>['children']): string | undefined => {
    for (const el of els) {
      if (el.id === id) return (el.text ?? []).flatMap((b) => b.inline.map((run) => ('text' in run ? run.text : '\n'))).join('');
      const inner = find(el.children);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return Y.hasSlide(doc, slide) ? find(readSlide(doc, slide).children) : undefined;
};

describe('the deck’s provisional model', () => {
  it('names a slide from the frame that names its file, draws it once it differs, into the scratch doc alone', () => {
    const w = world();
    const file = w.file('s1');
    const before = stateVector(w.doc);
    const edited = file.replace('Friday, 24 October', 'Monday, 27 October');
    const at = edited.indexOf('Monday') + 'Mon'.length;

    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: edited.slice(0, 20) }));
    const named = w.provisional.snapshot().slides.get('s1');
    expect(named, 'the slide is being written from the frame that names its file').toMatchObject({ toolUseId: 'call1', name: 'Fix the dates', color: '--author-3', isNew: false, drawn: null });

    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: edited.slice(0, at) }));
    const drawn = w.provisional.snapshot().slides.get('s1')!.drawn!;
    expect([...drawn.changed]).toEqual(['date']);
    expect(textOf(w.provisional.scratch, 's1', 'date'), 'the scratch slide holds the text so far').toBe('Mon');
    expect(textOf(w.provisional.scratch, 's1', 'title')).toBe('Launch review');
    expect(Y.slideIds(w.provisional.scratch), 'only the slides being written').toEqual(['s1']);
    expect(stateVector(w.doc), 'nothing is written into the live doc').toEqual(before);
  });

  it('keeps an untouched file’s drawing and tells nothing for a frame that changes nothing drawn', () => {
    const w = world();
    const one = w.file('s1').replace('Launch review', 'Launch plan');
    const two = w.file('s2').replace('Numbers', 'Figures');
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: one }));
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s2')]: two.slice(0, two.indexOf('Fig') + 3) }));
    const first = w.provisional.snapshot();
    expect([...first.slides.keys()]).toEqual(['s1', 's2']);
    const told = w.told();
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s2')]: two.slice(0, two.indexOf('Fig') + 3) + '<' }));
    expect(w.told(), 'a cut tag draws nothing new').toBe(told);
    expect(w.provisional.snapshot()).toBe(first);
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s2')]: two }));
    expect(w.provisional.snapshot().slides.get('s1'), 'the untouched slide keeps its entry').toBe(first.slides.get('s1'));
    expect(textOf(w.provisional.scratch, 's2', 't2')).toBe('Figures');
  });

  it('follows the live slide: a change made meanwhile is drawn under the agent’s', () => {
    const w = world();
    const edited = w.file('s1').replace('Friday, 24 October', 'Monday, 27 October');
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: edited.slice(0, edited.indexOf('</h1>')) }));
    expect(w.provisional.snapshot().slides.get('s1')!.drawn).toBeNull();
    setText(w.doc, 's1', 'date', [{ type: 'p', inline: [{ text: 'Friday, 24 Oct', marks: {} }] }]);
    expect(textOf(w.provisional.scratch, 's1', 'date') ?? null, 'nothing drawn yet: the open file has not reached the date').toBeNull();
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: edited }));
    expect([...w.provisional.snapshot().slides.get('s1')!.drawn!.changed]).toEqual(['date']);
    setText(w.doc, 's1', 'title', [{ type: 'p', inline: [{ text: 'Launch review, revised', marks: {} }] }]);
    expect(textOf(w.provisional.scratch, 's1', 'title'), 'a whole file is the slide: the agent’s title stands').toBe('Launch review');
    expect([...w.provisional.snapshot().slides.get('s1')!.drawn!.changed].sort()).toEqual(['date', 'title']);
  });

  it('draws a slide deleted meanwhile as the publish will make it again: new, whole', () => {
    const w = world();
    const two = w.file('s2');
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s2')]: two }));
    expect(w.provisional.snapshot().slides.get('s2')).toMatchObject({ isNew: false, drawn: null });
    deleteSlide(w.doc, 's2');
    const slide = w.provisional.snapshot().slides.get('s2')!;
    expect(slide.isNew).toBe(true);
    expect([...slide.drawn!.added].sort()).toEqual(['t2']);
    expect(writtenOrder(w.provisional.snapshot(), slideOrder(w.doc))).toEqual(['s1', 's2']);
  });

  it('places a new slide by the streamed index, and withdraws it in the call that brings the real slide', () => {
    const w = world();
    const index = w.index().replace('"s2"', '"s3", "s2"');
    const three = '<section id="s3" style="background:#000000"><h2 id="t3" style="font-size:64px; color:#ffffff">Risks</h2></section>';
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s3')]: three.slice(0, three.indexOf('Ri')) }));
    let snap = w.provisional.snapshot();
    expect(snap.slides.get('s3')).toMatchObject({ isNew: true });
    expect(writtenOrder(snap, ['s1', 's2']), 'last until the index names it').toEqual(['s1', 's2', 's3']);
    w.live.frame(publishFrame('call1', 'streaming', { [DECK_PATH]: index.slice(0, index.indexOf('"s3"') + 3) }));
    expect(writtenOrder(w.provisional.snapshot(), ['s1', 's2']), 'a name still streaming is not yet a name').toEqual(['s1', 's2', 's3']);
    w.live.frame(publishFrame('call1', 'streaming', { [DECK_PATH]: index }));
    snap = w.provisional.snapshot();
    expect(writtenOrder(snap, ['s1', 's2'])).toEqual(['s1', 's3', 's2']);

    const update = w.publish({ [DECK_PATH]: index, [slidePath('s3')]: three });
    w.live.frame(publishFrame('call1', 'committed', {}, 7));
    expect(w.provisional.snapshot().slides.get('s3'), 'committed: kept until the replica holds the write').toBeDefined();
    w.live.update(update, 7);
    expect(slideOrder(w.doc)).toEqual(['s1', 's3', 's2']);
    expect(w.provisional.snapshot().slides.size).toBe(0);
    expect(Y.slideIds(w.provisional.scratch), 'the scratch slide goes with it').toEqual([]);
  });

  it('places each call’s new slide by its own call’s index: two publishes streaming at once never move each other’s', () => {
    const w = world();
    const slide = (id: string) => `<section id="${id}"><h2 id="h${id}" style="font-size:64px">New ${id}</h2></section>`;
    // call A inserts sA between the slides; call B appends sB
    w.live.frame(publishFrame('callA', 'streaming', { [DECK_PATH]: w.index().replace('"s2"', '"sA", "s2"'), [slidePath('sA')]: slide('sA') }));
    expect(writtenOrder(w.provisional.snapshot(), ['s1', 's2'])).toEqual(['s1', 'sA', 's2']);
    w.live.frame(publishFrame('callB', 'streaming', { [DECK_PATH]: w.index().replace('"s2"', '"s2", "sB"'), [slidePath('sB')]: slide('sB') }));
    expect(writtenOrder(w.provisional.snapshot(), ['s1', 's2']), 'B’s index does not unplace A’s slide').toEqual(['s1', 'sA', 's2', 'sB']);
    w.live.frame(publishFrame('callA', 'streaming', { [slidePath('sA')]: slide('sA').replace('New', 'Newer') }));
    expect(writtenOrder(w.provisional.snapshot(), ['s1', 's2']), 'nor A’s next tick B’s').toEqual(['s1', 'sA', 's2', 'sB']);
  });

  it('withdraws every trace at a refusal, the live doc untouched throughout', () => {
    const w = world();
    const before = stateVector(w.doc);
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: w.file('s1').replace('Launch', 'Lunch') }));
    expect(w.provisional.snapshot().slides.get('s1')!.drawn).not.toBeNull();
    w.live.frame(publishFrame('call1', 'dropped'));
    expect(w.provisional.snapshot().slides.size).toBe(0);
    expect(Y.slideIds(w.provisional.scratch)).toEqual([]);
    expect(stateVector(w.doc)).toEqual(before);
  });

  it('keeps a concurrent drawing on its scratch doc until the last call ends, then starts the next call fresh', () => {
    const w = world();
    w.live.frame(publishFrame('one', 'streaming', { [slidePath('s1')]: w.file('s1').replace('Launch', 'Lunch') }));
    w.live.frame(publishFrame('two', 'streaming', { [slidePath('s2')]: w.file('s2').replace('Numbers', 'Figures') }));
    const scratch = w.provisional.scratch;
    w.live.frame(publishFrame('one', 'dropped'));
    expect(w.provisional.scratch).toBe(scratch);
    expect(textOf(scratch, 's2', 't2')).toBe('Figures');
    w.live.frame(publishFrame('two', 'dropped'));
    expect(w.provisional.scratch.store.clients.size).toBe(0);
    expect(scratch.isDestroyed).toBe(true);
    w.live.frame(publishFrame('three', 'streaming', { [slidePath('s1')]: w.file('s1').replace('Launch', 'Lunch') }));
    expect(w.provisional.scratch).not.toBe(scratch);
    expect(textOf(w.provisional.scratch, 's1', 'title')).toBe('Lunch review');
    w.stop();
    expect(w.provisional.scratch.store.clients.size).toBe(0);
  });

  it('draws nothing for a held file or one that is not a slide, and stops with every trace cleared', () => {
    const w = world();
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: '<section id="s1"><iframe src="x"></iframe></section>', 'project/notes.txt': 'x' }));
    expect(w.provisional.snapshot().slides.get('s1')!.drawn).toBeNull();
    expect([...w.provisional.snapshot().slides.keys()]).toEqual(['s1']);
    w.live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: w.file('s1').replace('Launch', 'Lunch') }));
    w.stop();
    expect(w.provisional.snapshot().slides.size).toBe(0);
    expect(Y.slideIds(w.provisional.scratch)).toEqual([]);
  });
});
