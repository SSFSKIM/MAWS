// P3-C M8 fix wave 1 (R3; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11): the preview's change marks
// follow the slide's geometry after its first layout: a pinned design system arriving, a face loading or a picture
// changing the flow moves elements later, and each layout pass of the shown canvas re-measures them. happy-dom lays
// nothing out, so an element's box is given to its node here and moved before the next layout pass.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyV2, attributionMap, contentIdsOf, newDoc, onUpdate, stateV2, transact, type Doc } from '../../../yjs';
import { flushLayout } from '../../canvas';
import { changeStops, deckChanges, openDeckDiff } from '../../history';
import { importSlide, setStyle, writeDeckKeys } from '../../model';
import { setDeckOverride } from '../../writers';
import * as Y from '../../../yjs/slides';
import { loadSlide } from '../../parse';
import type { DeckHistoryController, DeckPreview } from './controller';
import { HistoryPreview } from './HistoryPreview';

afterEach(cleanup);

function previewOf(setup: (doc: Doc) => void = () => {}, change: (replica: Doc) => void = (replica) => setStyle(replica, 's', 'box', { color: '#ff0000' })): { preview: DeckPreview; destroy(): void } {
  const host = newDoc();
  const l = loadSlide('<section id="s"><p id="box" style="position:absolute; left:100px; top:100px; width:200px; height:100px; font-size:32px">Box</p></section>');
  if (!l.ok) throw new Error('fixture');
  transact(host, () => {
    writeDeckKeys(host, { v: 4, title: 'T', order: ['s'] });
    importSlide(host, l.slide, 'a0');
    setup(host);
  });
  const before = stateV2(host);
  const maps: ReturnType<typeof attributionMap>[] = [];
  const replica: Doc = newDoc();
  applyV2(replica, before);
  const off = onUpdate(replica, (u) => {
    applyV2(host, stateV2(replica));
    maps.push(attributionMap(contentIdsOf(u), { insertActor: 'human', deleteActor: 'human', at: 60_000 }));
  });
  change(replica);
  off();
  const diff = openDeckDiff({ prevState: before, nextState: stateV2(host), attributions: maps[0]! });
  const changes = deckChanges(diff);
  const preview: DeckPreview = {
    target: { kind: 'version', versionId: 2 },
    title: 'v',
    shown: diff.nextDoc,
    earlier: diff.prevDoc,
    showChanges: true,
    changes,
    stops: changeStops(changes),
    focus: null,
    slideId: 's',
    system: null,
    versionId: 2,
    requestedAt: 0,
    revision: null,
    earlierRevision: null,
  };
  return { preview, destroy: () => diff.destroy() };
}

const controller = { author: () => ({ name: 'You', color: '--author-1', when: () => '' }), showSlide: () => {} } as unknown as DeckHistoryController;
const place = (n: HTMLElement, x: number, y: number) => {
  Object.defineProperty(n, 'offsetLeft', { configurable: true, get: () => x });
  Object.defineProperty(n, 'offsetTop', { configurable: true, get: () => y });
  Object.defineProperty(n, 'offsetWidth', { configurable: true, get: () => 200 });
  Object.defineProperty(n, 'offsetHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(n, 'offsetParent', { configurable: true, get: () => n.closest('.maws-slide') });
};
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe('the preview’s change marks (R3)', () => {
  it('re-measure at every layout pass of the shown canvas, not once', async () => {
    const { preview, destroy } = previewOf();
    try {
      const drawn: number[] = [];
      const { container } = render(<HistoryPreview controller={controller} preview={preview} liveSystem={null} assets={{ shown: () => null, earlier: () => null }} faces={{ shown: new Map(), earlier: new Map() }} zoom={1} thumbnailWidth={240} onDrawn={() => drawn.push(1)} />);
      const box = () => container.querySelector<HTMLElement>('[data-history-stage] [data-eid="box"]')!;
      place(box(), 100, 100);
      await act(async () => flushLayout());
      await tick();
      const mark = () => container.querySelector<HTMLElement>('[data-history-mark="box"]');
      expect(mark()?.style.left).toBe('100px');
      expect(drawn).toEqual([1]);
      // the slide's geometry moves with no write of the deck's (the pinned system's scope style arriving): the canvas
      // lays out again
      place(box(), 400, 300);
      await act(async () => {
        const style = document.createElement('style');
        style.setAttribute('data-ds-scope-style', '');
        document.head.appendChild(style);
        await new Promise((r) => setTimeout(r, 0));
        flushLayout();
      });
      await tick();
      expect(mark()?.style.left).toBe('400px');
      expect(mark()?.style.top).toBe('300px');
      expect(drawn).toEqual([1]); // the preview's timing is reported once
    } finally {
      destroy();
    }
  });
});

// Fix wave 3: the Theme's Body or Display face set to a deck-uploaded family writes that family into the scope's
// `--ds-font-*` override; in the preview the upload is declared only under its private name, so the override must name it.
describe('the preview’s font-token overrides (fix wave 3)', () => {
  it('maps a Body override naming an uploaded family to the state’s private name in the scope’s style', async () => {
    const { preview, destroy } = previewOf((doc) => {
      Y.setDeckEntry(doc, 'faces', 'lab', { family: 'Face Lab', src: 'assets/lab.woff2' });
      setDeckOverride(doc, '--ds-font-body', '"Face Lab", sans-serif');
    });
    try {
      const aliases = new Map([['face lab', 'deck-face-test']]);
      render(<HistoryPreview controller={controller} preview={{ ...preview, system: { builtin: 'maws' } }} liveSystem={null} assets={{ shown: () => null, earlier: () => null }} faces={{ shown: aliases, earlier: new Map() }} zoom={1} thumbnailWidth={240} />);
      await tick();
      const scope = document.querySelector<HTMLElement>('[data-history-stage] [data-ds-scope]')?.getAttribute('data-ds-scope');
      const style = [...document.head.querySelectorAll('style')].map((el) => el.textContent ?? '').find((text) => scope && text.includes(scope)) ?? '';
      expect(style).toMatch(/--ds-font-body:\s*"deck-face-test", sans-serif/);
      expect(style).not.toContain('"Face Lab"');
    } finally {
      destroy();
    }
  });
});

// P4 W1-B (the tracker's "P4 version history lines"; sitting candidate 54): the banner over a version whose deck
// settings changed named deck.json's raw keys ("Deck settings changed: cover, createdOnFiles, sections, title, v").
describe('the deck’s own changes', () => {
  it('remain in the comparison without a redundant settings banner', () => {
    const { preview, destroy } = previewOf(undefined, (replica) =>
      transact(replica, () => writeDeckKeys(replica, { v: 5, createdOnFiles: { v: 1, at: '2026-10-19T09:00:00Z' }, title: 'Q4 review', cover: 's', sections: { intro: { description: 'Intro', start: 's' } }, order: ['s'] })),
    );
    try {
      const { container } = render(<HistoryPreview controller={controller} preview={preview} liveSystem={null} assets={{ shown: () => null, earlier: () => null }} faces={{ shown: new Map(), earlier: new Map() }} zoom={1} thumbnailWidth={240} />);
      expect(preview.changes.deck?.keys.map((k) => k.key)).toEqual(['cover', 'createdOnFiles', 'sections', 'title', 'v']);
      expect(container.querySelector('.deck-history-deck')).toBeNull();
    } finally {
      destroy();
    }
  });
});
