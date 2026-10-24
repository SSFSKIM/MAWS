// P4-B2 K6 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D10; the plan review's P1): the Edit menu's Undo
// and Redo, told to the page as `layout.edit`, are answered by the editor whose own editable surface holds the focus (a
// deck's stage, a slide text box on it, the deck's notes; a design's world) on its session's one stack. Anything else in
// the page, inside a claimed editor or not, goes back to main as `layout.nativeEdit`, and an editor claims nothing
// read-only or while a version of its history shows.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { CommandName, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { EditOp } from '@shared/ipc/schema/layout';
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import { encodeMap, mergeMaps, newDoc, stateV2, transact, type Doc } from '@artifacts/yjs';
import { importSlide, readSlide, setNotes, setStyle, writeDeckKeys } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { addThread } from '@artifacts/slides/threads';
import { DeckEditor } from '@artifacts/slides/editor/DeckEditor';
import { DeckSession } from '@artifacts/slides/editor/session';
import { DesignWorkbench } from '@artifacts/design/editor/DesignWorkbench';
import { DesignView } from '@artifacts/design/editor/viewport';
import { design } from '@artifacts/design/fixtures/support';
import { connectEditClaimants, registerEditClaimant } from './edit-claimants';

const SLIDE = `<section id="s">
<h2 id="title" style="font-size:64px">Title</h2>
<div id="a" style="position:absolute; left:300px; top:300px; width:200px; height:100px"></div>
<aside>Notes</aside>
</section>`;

function deck(): Doc {
  const doc = newDoc();
  const l = loadSlide(SLIDE);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

/** The page's bridge: `layout.edit` delivered as main sends it, and what the page invoked back. */
function bridge() {
  const listeners = new Set<(payload: EventPayload<'layout.edit'>) => void>();
  const invoked: { name: CommandName; input: unknown }[] = [];
  const client = {
    async invoke(name: CommandName, input: unknown) {
      invoked.push({ name, input });
      return { ok: true, value: undefined };
    },
    on(name: EventName, listener: (payload: EventPayload<'layout.edit'>) => void) {
      if (name !== 'layout.edit') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as MawsBridge;
  return { client, invoked, menu: (op: EditOp) => act(() => listeners.forEach((listener) => listener({ op }))) };
}

let page: ReturnType<typeof bridge>;
let disconnect: () => void;
beforeEach(() => {
  page = bridge();
  disconnect = connectEditClaimants(page.client);
});
afterEach(() => {
  disconnect();
  cleanup();
});
const native = () => page.invoked.filter((call) => call.name === 'layout.nativeEdit').map((call) => call.input);

/** A deck editor taking the registration from the host, with one step on its stack: `a` moved from 300px to 340px. */
function mountDeck(options: { readOnly?: boolean; history?: HistoryApi } = {}) {
  const doc = deck();
  const session = new DeckSession(doc, 0);
  const history = options.history ? { api: options.history, handle: { doc, onRestored: () => () => {} } } : undefined;
  const utils = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={options.readOnly ?? false} history={history} registerEditClaimant={registerEditClaimant} />);
  if (!options.readOnly) act(() => session.edit((origin) => setStyle(doc, 's', 'a', { left: '340px' }, origin)));
  const stage = utils.container.querySelector<HTMLElement>('[data-stage-surface]')!;
  const left = () => readSlide(doc, 's').children.find((c) => c.id === 'a')!.style.left;
  return { doc, session, stage, left, ...utils };
}
function focus(element: Element) {
  act(() => (element as HTMLElement).focus());
  expect(document.activeElement).toBe(element);
}

describe('a deck’s own surfaces take the Edit menu’s Undo and Redo onto its stack', () => {
  it('on the stage: the deck’s step undone and redone, nothing sent back', () => {
    const { stage, left } = mountDeck();
    focus(stage);
    page.menu('undo');
    expect(left()).toBe('300px');
    page.menu('redo');
    expect(left()).toBe('340px');
    expect(native()).toEqual([]);
  });

  it('on a selected element’s own node, where the stage puts the focus (D15’s A3): the deck’s step', () => {
    const { session, stage, left } = mountDeck();
    focus(stage);
    act(() => session.select(['a']));
    const node = stage.querySelector<HTMLElement>('[data-eid="a"]')!;
    focus(node);
    page.menu('undo');
    expect(left()).toBe('300px');
    expect(native()).toEqual([]);
  });

  it('in a slide text box on the stage: the deck’s step, not the box’s own text', () => {
    const { session, container, left } = mountDeck();
    act(() => session.editText('title'));
    const box = container.querySelector<HTMLElement>('[data-stage-surface] [data-eid="title"] .deck-textbox')!;
    focus(box);
    page.menu('undo');
    expect(left()).toBe('300px');
    expect(native()).toEqual([]);
  });

  it('in the deck’s notes field, whose typing is the deck’s stack', () => {
    const { doc, session, container } = mountDeck();
    act(() => session.edit((origin) => setNotes(doc, 's', 'Notes, then more', origin)));
    focus(container.querySelector('.deck-notes-field')!);
    page.menu('undo');
    expect(readSlide(doc, 's').notes).toBe('Notes');
    expect(native()).toEqual([]);
  });

  it('two decks open: each claims only its own stage', () => {
    const first = mountDeck();
    const second = mountDeck();
    focus(second.stage);
    page.menu('undo');
    expect([first.left(), second.left()]).toEqual(['340px', '300px']);
  });
});

describe('everything else stays native, through layout.nativeEdit', () => {
  it('an inspector field inside the editor: the field’s own undo, the deck untouched', () => {
    const { session, left } = mountDeck();
    act(() => session.select(['a']));
    fireEvent.click(screen.getByRole('button', { name: 'Inspector' }));
    focus(screen.getByRole('textbox', { name: 'Width' }));
    page.menu('undo');
    page.menu('redo');
    expect(native()).toEqual([{ op: 'undo' }, { op: 'redo' }]);
    expect(left()).toBe('340px');
  });

  it('a comment’s reply field inside the editor', async () => {
    const { doc, session, left } = mountDeck();
    act(() => addThread(doc, { threadId: 't1', slideId: 's', elementId: 'title', quote: 'Title', by: { kind: 'human' }, at: 1 }));
    act(() => session.toggleRail('comments'));
    const reply = await screen.findByRole('textbox', { name: 'Reply' });
    fireEvent.change(reply, { target: { value: 'Cut it' } });
    focus(reply);
    page.menu('undo');
    expect(native()).toEqual([{ op: 'undo' }]);
    expect(left()).toBe('340px');
  });

  it('a focused iframe inside the stage (its frame’s own undo)', () => {
    const { stage, left } = mountDeck();
    const frame = document.createElement('iframe');
    frame.tabIndex = 0;
    stage.querySelector('[data-stage-slide]')!.append(frame);
    focus(frame);
    page.menu('undo');
    expect(native()).toEqual([{ op: 'undo' }]);
    expect(left()).toBe('340px');
  });

  it('while a version of the history shows', async () => {
    const doc = deck();
    const versions: ArtifactVersion[] = [{ id: 1, seq: 1, at: Date.UTC(2026, 9, 21, 9), actor: { kind: 'human' }, kind: 'named', label: 'Draft', assetRefs: [] }];
    const state = stateV2(doc);
    const api: HistoryApi = {
      versions: async () => versions,
      lastViewedAt: async () => null,
      versionState: async () => state,
      attributions: async () => encodeMap(mergeMaps([])),
      saveVersion: async () => ({ versionId: 2 }),
      restore: async () => ({ revision: 2, versionId: 2 }),
      duplicate: async () => ({ artifactId: 'copy' }),
      markViewed: async () => {},
    };
    const { session, container, left } = mountDeck({ history: api });
    act(() => session.toggleRail('history'));
    fireEvent.click(await screen.findByRole('button', { name: /^Version Draft by/ }));
    await screen.findByRole('button', { name: 'Back to presentation' });
    expect(container.querySelector('[data-history-previewing]')).not.toBeNull();
    focus(screen.getByRole('button', { name: 'Back to presentation' }));
    page.menu('undo');
    expect(native()).toEqual([{ op: 'undo' }]);
    expect(left()).toBe('340px');
  });

  it('read-only: the stage claims nothing', () => {
    const { stage } = mountDeck({ readOnly: true });
    focus(stage);
    page.menu('undo');
    expect(native()).toEqual([{ op: 'undo' }]);
  });

  it('outside any editor, and with nothing focused', () => {
    mountDeck();
    const input = document.createElement('input');
    document.body.append(input);
    focus(input);
    page.menu('redo');
    act(() => input.blur());
    page.menu('undo');
    expect(native()).toEqual([{ op: 'redo' }, { op: 'undo' }]);
    input.remove();
  });
});

describe('a design board’s world', () => {
  function mountDesign(readOnly = false) {
    const doc = design();
    const session = new DeckSession(doc, 0);
    const view = new DesignView();
    view.setRoom({ w: 1000, h: 800 });
    view.setViewport({ zoom: 1, x: 0, y: 0 });
    const utils = render(<DesignWorkbench session={session} view={view} assetUrl={() => null} system={null} readOnly={readOnly} registerEditClaimant={registerEditClaimant} />);
    if (!readOnly) act(() => session.edit((origin) => setStyle(doc, 'b1', 'title', { opacity: '0.5' }, origin)));
    const world = utils.container.querySelector<HTMLElement>('[data-design-world]')!;
    const opacity = () => readSlide(doc, 'b1').children.find((c) => c.id === 'title')!.style.opacity;
    return { session, world, opacity };
  }

  it('takes the design’s step on its one stack', () => {
    const { world, opacity } = mountDesign();
    focus(world);
    page.menu('undo');
    expect(opacity()).toBeUndefined();
    page.menu('redo');
    expect(opacity()).toBe('0.5');
    expect(native()).toEqual([]);
  });

  it('read-only, it claims nothing', () => {
    const { world } = mountDesign(true);
    focus(world);
    page.menu('undo');
    expect(native()).toEqual([{ op: 'undo' }]);
  });
});
