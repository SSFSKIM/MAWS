// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; parent §4.7 [binding], Decision Logs 13 (4)
// and 23): the design's version history under happy-dom, over C's controller and B's api shape. The new-change pill
// counts the design's projection through C's `countChanges` hook (a cross-board move once; a deck's count is C's). A
// version previews in place of the live world, read-only: the bar's count and ↑ ↓ are the projection's, every board of
// the version drawn at its frame, a changed board edged, a moved element outlined at its destination as a move and
// ghosted where it was, a deleted board drawn where it was; Back returns to the live world, Restore asks A's restore.
// Real layout and the product's IPC are the e2e's.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import type { HistoryApi } from '../../document/editor/history/api';
import { DeckHistoryController } from '../../slides/editor/history/controller';
import { DeckSession } from '../../slides/editor/session';
import { setNotes, setStyle } from '../../slides/model';
import { applyV1, applyV2, attributionMap, contentIdsOf, encodeMap, mergeMaps, newDoc, onUpdate, stateV2, transact, type ContentMap, type Doc } from '../../yjs';
import { writeBoards, type BoardSeed } from '../fixtures/support';
import { countDesignChanges } from '../history';
import { moveElementToBoard } from '../move';
import { deleteBoard, insertBoard, setBoardFrame } from '../writers';
import { DesignWorkbench, type DesignWorkbenchProps } from './DesignWorkbench';
import { DesignView } from './viewport';

const SESSION = '00000000-0000-4000-8000-0000000000e2' as AppSessionId;
const AGENT: Actor = { kind: 'session', appSessionId: SESSION };
const HUMAN: Actor = { kind: 'human' };
const SEEDS: BoardSeed[] = [
  { id: 'a', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone', body: '<h1 id="title" style="font-size:72px">Phone</h1><p id="e1" style="font-size:32px">Moved text</p>' },
  { id: 'b', at: { x: 500, y: 0, w: 1440, h: 1024 }, title: 'Desktop', body: '<h1 id="title" style="font-size:72px">Desktop</h1>' },
  { id: 'c', at: { x: 2000, y: 0, w: 800, h: 600 }, title: 'Spare', body: '<p id="spare">Spare</p>' },
];

afterEach(cleanup);

/** A design host as an editor sees it: provenance per landed update by actor, a minute apart; versions as states. */
function host() {
  const doc = newDoc();
  const maps: ContentMap[] = [];
  let now = Date.UTC(2026, 9, 16, 9, 0);
  const versions: (ArtifactVersion & { state: Uint8Array })[] = [];
  let viewedAt: number | null = null;
  const land = (actor: Actor, edit: (d: Doc) => void) => {
    const replica = newDoc();
    applyV2(replica, stateV2(doc));
    const updates: Uint8Array[] = [];
    const off = onUpdate(replica, (u) => updates.push(u));
    edit(replica);
    off();
    for (const u of updates) {
      applyV1(doc, u);
      now += 60_000;
      const key = actor.kind === 'human' ? 'human' : `session:${actor.appSessionId}`;
      maps.push(attributionMap(contentIdsOf(u), { insertActor: key, deleteActor: key, at: now }));
    }
  };
  const version = (actor: Actor, kind: ArtifactVersion['kind'], label?: string) => {
    const v = { id: versions.length + 1, seq: maps.length, at: now, actor, kind, assetRefs: [], ...(label && { label }), state: stateV2(doc) } as ArtifactVersion & { state: Uint8Array };
    versions.push(v);
    return v;
  };
  land(HUMAN, (d) => transact(d, () => writeBoards(d, SEEDS)));
  const restore = vi.fn(async (versionId: number) => ({ revision: 0, versionId }));
  const api: HistoryApi = {
    versions: async () => versions.map((v) => ({ id: v.id, seq: v.seq, at: v.at, actor: v.actor, kind: v.kind, assetRefs: v.assetRefs, ...(v.label !== undefined && { label: v.label }) }) as ArtifactVersion),
    lastViewedAt: async () => viewedAt,
    versionState: async (id) => versions.find((v) => v.id === id)!.state,
    attributions: async (from, to) => encodeMap(mergeMaps(maps.slice(from, to))),
    saveVersion: async () => ({ versionId: 0 }),
    restore,
    duplicate: async () => ({ artifactId: 'copy' }),
    markViewed: async () => {},
  };
  const handle = { doc, onRestored: () => () => {} };
  return { doc, land, version, api, handle, restore, view: () => (viewedAt = now) };
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

describe('the new-change pill (C’s `countChanges` hook)', () => {
  it('counts an agent’s cross-board move once with the design’s projection, twice as C reads it without the hook', async () => {
    const h = host();
    h.version(HUMAN, 'named', 'Before');
    h.view();
    h.land(AGENT, (d) => moveElementToBoard(d, 'a', 'b', 'e1'));
    h.version(AGENT, 'auto');
    const design = new DeckHistoryController(h.handle, h.api, { countChanges: countDesignChanges });
    const deck = new DeckHistoryController(h.handle, h.api);
    const stops = [design.attach(), deck.attach()];
    for (let i = 0; i < 20 && (design.getSnapshot().pill?.count == null || deck.getSnapshot().pill?.count == null); i++) await new Promise((r) => setTimeout(r, 0));
    expect(design.getSnapshot().pill?.count).toBe(1);
    expect(deck.getSnapshot().pill?.count).toBe(2);
    stops.forEach((stop) => stop());
  });
});

describe('a version’s preview in the workbench', () => {
  function mount(props: Partial<DesignWorkbenchProps> = {}) {
    const h = host();
    h.version(HUMAN, 'named', 'Draft');
    let moved = '';
    h.land(AGENT, (d) => (moved = moveElementToBoard(d, 'a', 'b', 'e1').ids.get('e1')!));
    h.land(HUMAN, (d) => setStyle(d, 'b', moved, { color: '#00aa00' })); // the owner restyles what the agent moved
    h.land(HUMAN, (d) => setBoardFrame(d, 'b', { x: 600 }));
    h.land(HUMAN, (d) => setStyle(d, 'b', 'title', { color: '#ff0000' }));
    h.land(HUMAN, (d) => deleteBoard(d, 'c'));
    h.version(HUMAN, 'named', 'Reviewed');
    return { ...open(h, props), moved };
  }
  /** The workbench over a host, its history rail open. */
  function open(h: ReturnType<typeof host>, props: Partial<DesignWorkbenchProps> = {}) {
    const session = new DeckSession(h.doc, 0);
    session.toggleRail('history');
    const view = new DesignView();
    view.setRoom({ w: 1000, h: 800 });
    view.setViewport({ zoom: 0.5, x: 0, y: 0 });
    const utils = render(<DesignWorkbench session={session} view={view} assetUrl={() => null} system={null} readOnly={false} history={{ api: h.api, handle: h.handle, countChanges: countDesignChanges }} {...props} />);
    return { ...h, session, view, ...utils };
  }

  it('draws the version in place of the live world with the projection’s count, edges, a move’s marks and a deleted board', async () => {
    const { container, session, moved } = mount();
    await settle();
    const rail = screen.getByRole('complementary', { name: 'Version history' });
    fireEvent.click(within(rail).getByRole('button', { name: /^Version Reviewed/ }));
    await settle();
    const bar = screen.getByRole('toolbar', { name: 'Version preview' });
    // the move (once), b's frame, its title's restyle, c deleted: four, where C reads five
    expect(bar.querySelector('[data-history-count]')!.textContent).toBe('4 changes');
    expect(screen.queryByRole('toolbar', { name: 'Design' })).toBeNull(); // the editor's tools are gone: read-only
    expect(container.querySelector('[data-active-board]')).toBeNull(); // no overlay
    expect(session.writable()).toBe(false); // writes held behind the version
    const world = screen.getByRole('region', { name: 'Design in this version' });
    expect([...world.querySelectorAll('[data-history-board]')].map((b) => [b.getAttribute('data-history-board'), b.getAttribute('data-history-change')])).toEqual([
      ['a', 'changed'],
      ['b', 'changed'],
      ['c', 'removed'],
    ]);
    expect(world.querySelector<HTMLElement>('[data-history-board="b"]')!.style.left).toBe('600px'); // the version's frame
    const list = screen.getByRole('navigation', { name: 'Boards in this version' });
    expect(within(list).getByRole('button', { name: 'Spare, deleted' })).toBeTruthy();
    // the ghost of the move's old place on a, from the earlier state
    await settle();
    expect(world.querySelector('[data-history-board="a"] .deck-history-ghosts [data-eid="e1"][data-ghost]')).not.toBeNull();
    expect(world.querySelector(`[data-history-board="b"] [data-eid="${moved}"]`)).not.toBeNull();
  });

  it('credits a move to its mover and each later edit of the moved element to its own author, in the mark’s words', async () => {
    // happy-dom lays nothing out: every element of a board places against its board's slide, so its mark is measured
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get(this: HTMLElement) { return this.classList.contains('maws-slide') ? null : this.closest('.maws-slide'); } });
    onTestFinished(() => void (own && Object.defineProperty(HTMLElement.prototype, 'offsetParent', own)));
    const { moved } = mount();
    await settle();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Version history' })).getByRole('button', { name: /^Version Reviewed/ }));
    await settle();
    await settle();
    const mark = screen.getByRole('region', { name: 'Design in this version' }).querySelector<HTMLElement>(`[data-history-mark="${moved}"]`)!;
    expect(mark.getAttribute('data-kind')).toBe('moved');
    const title = mark.getAttribute('title')!;
    expect(title).toMatch(/^Moved from Phone — Claude · [^;]+; /); // the move, the agent's
    expect(title).toMatch(/; color — You · /); // the restyle since, the owner's
    expect(title).not.toMatch(/Moved from Phone; color/); // never one author for both
  });

  it('steps through the projection’s changes, and Back returns to the live world', async () => {
    const { session } = mount();
    await settle();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Version history' })).getByRole('button', { name: /^Version Reviewed/ }));
    await settle();
    const bar = screen.getByRole('toolbar', { name: 'Version preview' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Next change' }));
    expect(screen.getByRole('region', { name: 'Design in this version' }).querySelector('[data-history-board="b"][data-focused]')).not.toBeNull(); // b's frame first
    fireEvent.click(within(bar).getByRole('button', { name: 'Back to design' }));
    await settle();
    expect(screen.getByRole('toolbar', { name: 'Design' })).toBeTruthy();
    expect(session.writable()).toBe(true);
  });

  it('steps through each run of a board’s (hidden) notes on its board, as many stops as the bar counts (L240)', async () => {
    const h = host();
    h.land(HUMAN, (d) => setNotes(d, 'c', 'notes for the spare'));
    h.version(HUMAN, 'named', 'Draft');
    h.land(HUMAN, (d) => setBoardFrame(d, 'b', { x: 600 }));
    h.land(HUMAN, (d) => setBoardFrame(d, 'c', { x: 2100 }));
    h.land(AGENT, (d) => setNotes(d, 'c', 'first, notes for the spare'));
    h.land(HUMAN, (d) => setNotes(d, 'c', 'first, notes for the spare, last'));
    h.version(HUMAN, 'named', 'Reviewed');
    open(h);
    await settle();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Version history' })).getByRole('button', { name: /^Version Reviewed/ }));
    await settle();
    const bar = screen.getByRole('toolbar', { name: 'Version preview' });
    expect(bar.querySelector('[data-history-count]')!.textContent).toBe('4 changes'); // b's frame, c's frame, c's two notes runs
    const reached: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      fireEvent.click(within(bar).getByRole('button', { name: 'Next change' }));
      reached.push(screen.getByRole('region', { name: 'Design in this version' }).querySelector('[data-history-board][data-focused]')?.getAttribute('data-history-board') ?? null);
    }
    expect(reached).toEqual(['b', 'c', 'c', 'c', 'b']); // b's frame, c's frame, c's notes run by run, then round again
  });

  it('M5 (Decision Log 31): the tab’s view says what is shown for its Export: the version alone, Compare, then live again; unmounted, live', async () => {
    const { view, unmount } = mount();
    await settle();
    expect(view.snapshot().shown).toBeNull();
    const rail = screen.getByRole('complementary', { name: 'Version history' });
    fireEvent.click(within(rail).getByRole('button', { name: /^Version Draft/ }));
    await settle();
    expect(view.snapshot().shown).toEqual({ versionId: 1, board: 'a', label: 'Phone' }); // the live selection, which the version holds
    fireEvent.click(within(rail).getByRole('button', { name: /^Version Reviewed/ }), { shiftKey: true });
    await settle();
    expect(screen.getByRole('toolbar', { name: 'Version preview' }).querySelector('.deck-history-heading')!.textContent).toContain('→');
    expect(view.snapshot().shown).toBe('compare');
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Version preview' })).getByRole('button', { name: 'Back to design' }));
    await settle();
    expect(view.snapshot().shown).toBeNull();
    fireEvent.click(within(rail).getByRole('button', { name: /^Version Reviewed/ }));
    await settle();
    expect(view.snapshot().shown).toEqual({ versionId: 2, board: 'a', label: 'Phone' });
    unmount();
    expect(view.snapshot().shown).toBeNull();
  });

  it('M5 fix wave: the version’s own board for its Export: the live selection when the version holds it, else its first; the board navigated to; the live selection kept for Back', async () => {
    const { view, session, land } = mount();
    await settle();
    // a board added live after both versions, and selected
    act(() => land(HUMAN, (d) => insertBoard(d, { id: 'n', frame: { x: 3000, y: 0, w: 300, h: 200 }, title: 'New' }, 'b')));
    act(() => {
      session.show('n');
      view.selectFrame('n');
    });
    const rail = screen.getByRole('complementary', { name: 'Version history' });
    fireEvent.click(within(rail).getByRole('button', { name: /^Version Draft/ }));
    await settle();
    expect(view.snapshot().shown).toEqual({ versionId: 1, board: 'a', label: 'Phone' }); // the version lacks the new board
    const list = screen.getByRole('navigation', { name: 'Boards in this version' });
    fireEvent.click(within(list).getByRole('button', { name: /^Desktop/ }));
    expect(view.snapshot().shown).toEqual({ versionId: 1, board: 'b', label: 'Desktop' });
    expect(list.querySelector('[data-history-board-row="b"] .design-board-row')!.getAttribute('aria-current')).toBe('true');
    // a deleted board's row fits it but is not the version's to export
    fireEvent.click(within(rail).getByRole('button', { name: /^Version Reviewed/ }));
    await settle();
    expect(view.snapshot().shown).toEqual({ versionId: 2, board: 'a', label: 'Phone' }); // a new comparison starts from the selection again
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Boards in this version' })).getByRole('button', { name: /^Spare/ }));
    expect(view.snapshot().shown).toEqual({ versionId: 2, board: 'a', label: 'Phone' });
    // a change reached with ↓ is its board's
    const bar = screen.getByRole('toolbar', { name: 'Version preview' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Next change' }));
    const focused = screen.getByRole('region', { name: 'Design in this version' }).querySelector('[data-history-board][data-focused]')!.getAttribute('data-history-board');
    expect(focused).toBe('b');
    expect(view.snapshot().shown).toEqual({ versionId: 2, board: 'b', label: 'Desktop' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Back to design' }));
    await settle();
    expect(view.snapshot().shown).toBeNull();
    expect([view.snapshot().frame, session.snapshot().currentSlide]).toEqual(['n', 'n']); // the live selection as it was
  });

  it('Restore asks A’s restore for the version shown, after a confirmation', async () => {
    const { restore } = mount();
    await settle();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Version history' })).getByRole('button', { name: /^Version Draft/ }));
    await settle();
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Version preview' })).getByRole('button', { name: 'Restore this version' }));
    const ask = screen.getByRole('alertdialog', { name: 'Restore this version?' });
    expect(ask.textContent).toContain('its boards, their places and sizes');
    fireEvent.click(within(ask).getByRole('button', { name: 'Restore' }));
    await settle();
    expect(restore).toHaveBeenCalledWith(1);
  });

  it('(design-workbench sweep#2) gives its owner the live world for Mark-up again after Back, never the world the version replaced', async () => {
    const stage = vi.fn<(element: HTMLElement | null) => void>();
    mount({ onStage: stage });
    await settle();
    const live = () => screen.getByRole('region', { name: 'Design canvas' });
    expect(stage).toHaveBeenLastCalledWith(live());
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Version history' })).getByRole('button', { name: /^Version Reviewed/ }));
    await settle();
    expect(screen.queryByRole('region', { name: 'Design canvas' })).toBeNull();
    expect(stage).toHaveBeenLastCalledWith(null); // no live world while the version shows
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Version preview' })).getByRole('button', { name: 'Back to design' }));
    await settle();
    const shown = stage.mock.lastCall![0];
    expect(shown).toBe(live());
    expect(shown!.isConnected).toBe(true);
  });
});
