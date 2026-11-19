// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M3; decision 15; B7): a step and
// the mounted Overview over a split. The Overview gives the keyboard back to the element that held it when it opened,
// and a pane that takes the keyboard becomes the focused pane (as `main/Pane.tsx` does); a step's target must win over
// that return, and the record must not be re-pointed by a focus move the step itself caused (M3's task review).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { EMPTY_STRIP, type TabRef } from '@shared/ipc/schema/layout';
import { at } from '../../../../test/support/machine';
import { OverviewLayer } from '../overview/OverviewPanel';
import { frontOf, useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { resetShellStores } from '../test-support/shell-stores';
import { runAction } from './actions-runtime';
import { EMPTY_RECORD, type Place, type Under } from './places';
import { connectVisits, useVisits } from './visits';

const S = (id: string) => at(id) as AppSessionId;
const tabOf = (id: string) => `session:${S(id)}`;
const T = (id: string): Under => ({ kind: 'tab', id: tabOf(id) });
const over = (place: Under): Place => ({ kind: 'overview', over: place });
const ref = (id: string): TabRef => ({ id: tabOf(id), kind: 'session', appSessionId: S(id), pinned: false });
const layout = () => useLayout.getState();
const record = () => useVisits.getState().record;
const tab = (id: string) => screen.getByRole('tab', { name: tabOf(id) });
// A whole turn: the reader's microtask, React's commit and the Overview's cleanup, and a frame for the step's own focus.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(() => requestAnimationFrame(() => setTimeout(resolve, 0)), 0)));

// The panes as the shell draws them, as far as focus goes: each pane's strip with its selected tab, and the pane taking
// the focused pane when the keyboard comes into it (`Pane`'s focus capture).
function Split() {
  const set = useLayout((s) => currentSet(s.main));
  return (
    <>
    <button type="button">Somewhere else</button>
    <section id="region-main" style={{ position: 'relative' }}>
      {set.panes.map((pane, index) => (
        <section id={`pane-${index}`} data-pane={index} key={index} onFocusCapture={() => layout().focusPane(index as 0 | 1)}>
          <div data-pane-strip>
            <div role="tablist" aria-label={`Tabs ${index}`}>
              {pane.tabs.map((t) => <button type="button" role="tab" aria-label={t.id} aria-selected={t.id === pane.activeTabId} key={t.id}>{t.id}</button>)}
            </div>
          </div>
        </section>
      ))}
      <OverviewLayer />
    </section>
    </>
  );
}

let off: () => void = () => {};
beforeEach(() => {
  resetShellStores();
  // happy-dom lays nothing out: the area the Overview moves in reads 1000 × 700, as the Overview's own suite has it
  for (const [name, value] of [['clientWidth', 1000], ['clientHeight', 700]] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return this.hasAttribute('data-overview-area') ? value : 0; } });
  }
  useLayout.setState({ main: { ...EMPTY_STRIP, panes: [{ tabs: [ref('a')], activeTabId: tabOf('a') }, { tabs: [ref('b')], activeTabId: tabOf('b') }], focusedPane: 0 } });
  useVisits.setState({ record: EMPTY_RECORD, opened: [] });
  off = connectVisits();
});
afterEach(() => {
  off();
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

describe('a step and the mounted Overview over a split', () => {
  it('Back onto the Overview over A, then Back again, lands on A: the keyboard in A’s pane, A in front, the record at A', async () => {
    render(<Split />);
    act(() => tab('a').focus());
    await settle();
    act(() => layout().setOverviewOpen(true)); // opened with the keyboard on A
    await settle();
    // B on the right chosen from inside the Overview: an act there closes it and gives B's pane the keyboard
    const panel = screen.getByRole('dialog', { name: 'Overview' });
    act(() => {
      fireEvent.click(panel);
      layout().activateTab(tabOf('b'));
    });
    await settle();
    expect(layout().overviewOpen).toBe(false);
    expect(document.activeElement).toBe(tab('b'));
    expect(record()).toEqual({ entries: [T('a'), over(T('a')), T('b')], at: 2 });

    act(() => runAction('go.back')); // the Overview over A again
    await settle();
    expect(layout().overviewOpen).toBe(true);
    expect(frontOf(layout())).toBe(tabOf('a'));
    expect(record()).toEqual({ entries: [T('a'), over(T('a')), T('b')], at: 1 });

    act(() => runAction('go.back')); // closing it gives the keyboard back: to A's pane, not to B where it was before
    await settle();
    expect(layout().overviewOpen).toBe(false);
    expect(document.activeElement).toBe(tab('a'));
    expect(frontOf(layout())).toBe(tabOf('a'));
    expect(record()).toEqual({ entries: [T('a'), over(T('a')), T('b')], at: 0 });

    act(() => runAction('go.forward')); // the control: the record still walks forward over the same entries
    await settle();
    expect(layout().overviewOpen).toBe(true);
    expect(frontOf(layout())).toBe(tabOf('a'));
    expect(record().at).toBe(1);
  });

  it('a step that closes an Overview opened from the other pane still lands on its target pane, and re-points nothing', async () => {
    render(<Split />);
    act(() => tab('a').focus());
    await settle();
    act(() => tab('b').focus()); // the keyboard to B's pane: the entry it is at becomes B
    await settle();
    expect(record()).toEqual({ entries: [T('b')], at: 0 });
    act(() => layout().setOverviewOpen(true)); // over B, its opener in B's pane
    await settle();
    expect(record()).toEqual({ entries: [T('b'), over(T('b'))], at: 1 });
    // A becomes the place under the open Overview by an act outside it (the strip's own reading: the focused pane), and
    // the record steps from a record that stands there
    act(() => layout().focusPane(0));
    await settle();
    expect(record()).toEqual({ entries: [T('b'), over(T('a'))], at: 1 });
    useVisits.setState({ record: { entries: [T('a'), over(T('a'))], at: 1 } }); // the Overview over A, A before it
    act(() => runAction('go.back'));
    await settle();
    expect(layout().overviewOpen).toBe(false);
    expect(frontOf(layout())).toBe(tabOf('a'));
    expect(document.activeElement).toBe(tab('a'));
    expect(record()).toEqual({ entries: [T('a'), over(T('a'))], at: 0 });
  });

  // Frames held until the test lets them run (the step's frame for the keyboard among them).
  function holdFrames() {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++next, callback);
      return next;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    return () => act(() => {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    });
  }
  const turn = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  it('a step superseded before its frame takes no keyboard: Back to B, Back again to the Overview over A, and the Overview keeps it', async () => {
    useLayout.setState({ main: { ...EMPTY_STRIP, panes: [{ tabs: [ref('a')], activeTabId: tabOf('a') }, { tabs: [ref('b'), ref('c')], activeTabId: tabOf('c') }], focusedPane: 1 } });
    render(<Split />);
    act(() => tab('c').focus());
    await settle();
    useVisits.setState({ record: { entries: [T('a'), over(T('a')), T('b'), T('c')], at: 3 } });
    const release = holdFrames();
    act(() => runAction('go.back')); // to B: its frame for the keyboard is queued
    await turn();
    act(() => runAction('go.back')); // to the Overview over A, before that frame
    await turn();
    const panel = screen.getByRole('dialog', { name: 'Overview' });
    expect(document.activeElement).toBe(panel);
    await release();
    await turn();
    expect(document.activeElement).toBe(panel);
    expect(layout().overviewOpen).toBe(true);
    expect(frontOf(layout())).toBe(tabOf('a'));
    expect(record()).toEqual({ entries: [T('a'), over(T('a')), T('b'), T('c')], at: 1 });
  });

  it('a step’s frame takes no keyboard after the person pressed a key and moved it elsewhere; with no press, it does', async () => {
    useLayout.setState({ main: { ...EMPTY_STRIP, panes: [{ tabs: [ref('a')], activeTabId: tabOf('a') }, { tabs: [ref('b')], activeTabId: tabOf('b') }], focusedPane: 1 } });
    render(<Split />);
    act(() => tab('b').focus());
    await settle();
    useVisits.setState({ record: { entries: [T('a'), T('b')], at: 1 } });
    let release = holdFrames();
    act(() => runAction('go.back')); // to A
    await turn();
    const elsewhere = screen.getByRole('button', { name: 'Somewhere else' });
    act(() => {
      fireEvent.keyDown(elsewhere, { key: 'Tab' });
      elsewhere.focus();
    });
    await release();
    await turn();
    expect(document.activeElement).toBe(elsewhere);
    // the control: the same step with no press between it and its frame gives A's pane the keyboard
    act(() => runAction('go.forward'));
    await turn();
    act(() => elsewhere.focus());
    release = holdFrames();
    act(() => runAction('go.back'));
    await turn();
    await release();
    await turn();
    expect(document.activeElement).toBe(tab('a'));
  });
});
