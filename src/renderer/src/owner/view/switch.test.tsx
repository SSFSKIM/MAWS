// The view's switch where MAWS draws the view (UX wave U2b; the execution document, A14, decision 16 and M2): one line
// in the band's frame, `to-human view · full transcript ›` in the report and `to-human view · report only ›` in the full
// transcript, drawn only while MAWS draws a view in force; absent, not disabled, everywhere else. Its `toggleView` is
// the handler of the action "Toggle report and transcript", on the focused pane's session. Every text is invented.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useLayout } from '../../stores/layout';
import { useNotices } from '../../stores/notices';
import { useTranscriptStore } from '../../stores/transcript';
import { mainShowing } from '../../test-support/panel';
import { resetShellStores } from '../../test-support/shell-stores';
import { builder } from '../../transcript/model/test-events';
import { MOD_DRAWS_NOTICE } from './copy';
import { toggleView, ViewSwitch } from './Switch';

const APP = 'app-switch' as AppSessionId;
type Scene = { lane: boolean; message: boolean; modDraws?: boolean };
// The session's transcript in the store, as its slot leaves it: one turn whose answer holds a message or not, the lane
// as the slot tells it, and the mod drawing or not.
async function withSession({ lane, message, modDraws }: Scene) {
  const b = builder();
  b.turn('u1', 'Count the files');
  b.text('m1', 0, message ? '<message>Three files.</message>' : 'Three files.');
  b.end(['u1']);
  const events = b.events;
  await act(() => useTranscriptStore.getState().attach(APP, { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) }));
  act(() => useTranscriptStore.getState().setToHumanView(APP, { lane, tailMessage: false, ...(modDraws !== undefined && { modDraws }) }));
}
const viewOf = () => useTranscriptStore.getState().entries[APP]?.state.ui.view;

afterEach(() => {
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  resetShellStores();
});

describe('the switch', () => {
  it.each<[string, Scene | null]>([
    ['no transcript of the session', null],
    ['the lane off, no message', { lane: false, message: false }],
    ['the lane off, a message held', { lane: false, message: true }],
    ['the lane on, no message yet', { lane: true, message: false }],
    ['the mod drawing the view', { lane: true, message: true, modDraws: true }],
  ])('is absent, not disabled, with %s', async (_name, scene) => {
    if (scene !== null) await withSession(scene);
    const view = render(<ViewSwitch appSessionId={APP} />);
    expect(view.container.innerHTML).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads its two words for the two views, and a press switches the tab’s view', async () => {
    await withSession({ lane: true, message: true });
    expect(useTranscriptStore.getState().entries[APP]?.state.ui.noTurnFold).toBe(true);
    const view = render(<ViewSwitch appSessionId={APP} />);
    expect(view.container.textContent).toBe('to-human view · full transcript ›');
    fireEvent.click(screen.getByRole('button', { name: 'full transcript ›' }));
    expect(viewOf()).toBe('transcript');
    expect(view.container.textContent).toBe('to-human view · report only ›');
    fireEvent.click(screen.getByRole('button', { name: 'report only ›' }));
    expect(viewOf()).toBe('report');
    expect(view.container.textContent).toBe('to-human view · full transcript ›');
  });

  it('stands in the band’s bordered frame, its caption and its button one size, with no row above it', async () => {
    await withSession({ lane: true, message: true });
    const view = render(<ViewSwitch appSessionId={APP} />);
    const frame = view.container.querySelector('[data-view-switch]')!;
    for (const name of ['rounded-lg', 'border', 'border-border', 'bg-bg-raised', 'px-3', 'py-2']) expect(frame.classList.contains(name), name).toBe(true);
    const css = readFileSync(join(__dirname, 'view.css'), 'utf8');
    const rule = (selector: string) => new RegExp(String.raw`(?:^|\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*\{([^}]*)\}`).exec(css)?.[1] ?? '';
    expect(rule('.owner-view-switch')).toMatch(/font-size:\s*var\(--text-ui\)/);
    expect(rule('.owner-view-switch > button')).toMatch(/font-size:\s*inherit/);
    expect(rule('.owner-view-switch')).not.toMatch(/margin|padding-top/);
    // the caption's trailing space is drawn: a flex item drops it unless the span keeps white space (a drawn example
    // showed "·full transcript"; `textContent` above cannot see it)
    expect(rule('.owner-view-switch > span')).toMatch(/white-space:\s*pre/);
  });
});

describe('the action "Toggle report and transcript"', () => {
  it('switches the focused pane’s session between its two views while its lane is on, and does nothing otherwise', async () => {
    act(() => useLayout.setState({ main: mainShowing(APP) }));
    await withSession({ lane: true, message: true });
    act(() => toggleView());
    expect(viewOf()).toBe('transcript');
    act(() => toggleView());
    expect(viewOf()).toBe('report');
    act(() => useTranscriptStore.getState().setToHumanView(APP, { lane: false, tailMessage: false }));
    act(() => toggleView());
    expect(viewOf()).toBe('report');
  });

  // UX wave U2b (M5, "the action's notice"; decision 20): where the mod draws the view, the switch is the mod's, above
  // the composer; the action changes nothing of the tab's and says so, once however often it is pressed.
  it('in a session the mod draws, changes nothing and says in one notice where the mod’s switch is', async () => {
    act(() => useLayout.setState({ main: mainShowing(APP) }));
    useNotices.setState({ notices: [] });
    await withSession({ lane: true, message: true, modDraws: true });
    const before = viewOf();
    act(() => toggleView());
    act(() => toggleView());
    expect(viewOf()).toBe(before);
    expect(useNotices.getState().notices.map((n) => [n.kind, n.text])).toEqual([['toast', MOD_DRAWS_NOTICE]]);
    act(() => useTranscriptStore.getState().setToHumanView(APP, { lane: true, tailMessage: false, modDraws: false }));
    act(() => toggleView());
    expect(viewOf()).toBe('transcript'); // MAWS draws again: the action is the switch's
    expect(useNotices.getState().notices).toHaveLength(1);
  });
});
