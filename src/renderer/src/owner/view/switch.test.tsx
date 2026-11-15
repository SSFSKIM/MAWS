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
import { useTranscriptStore } from '../../stores/transcript';
import { mainShowing } from '../../test-support/panel';
import { resetShellStores } from '../../test-support/shell-stores';
import { toggleView, ViewSwitch } from './Switch';

const APP = 'app-switch' as AppSessionId;
type Ui = { ownerLane?: boolean; noTurnFold?: boolean; view?: 'report' | 'transcript'; modDraws?: boolean };
const withUi = (ui: Ui) => useTranscriptStore.setState({ entries: { [APP]: { state: { ui } } } as never });
const viewOf = () => useTranscriptStore.getState().entries[APP]?.state.ui.view;

afterEach(() => {
  cleanup();
  useTranscriptStore.setState({ entries: {} });
  resetShellStores();
});

describe('the switch', () => {
  it.each<[string, Ui | null]>([
    ['no transcript of the session', null],
    ['the lane off', { ownerLane: false }],
    ['the lane on, no message yet', { ownerLane: true }],
    ['the lane off, a message held', { ownerLane: false, noTurnFold: false }],
    ['the mod drawing the view', { ownerLane: true, noTurnFold: true, modDraws: true }],
  ])('is absent, not disabled, with %s', (_name, ui) => {
    if (ui !== null) withUi(ui);
    const view = render(<ViewSwitch appSessionId={APP} />);
    expect(view.container.innerHTML).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads its two words for the two views, and a press switches the tab’s view', () => {
    withUi({ ownerLane: true, noTurnFold: true });
    const view = render(<ViewSwitch appSessionId={APP} />);
    expect(view.container.textContent).toBe('to-human view · full transcript ›');
    fireEvent.click(screen.getByRole('button', { name: 'full transcript ›' }));
    expect(viewOf()).toBe('transcript');
    expect(view.container.textContent).toBe('to-human view · report only ›');
    fireEvent.click(screen.getByRole('button', { name: 'report only ›' }));
    expect(viewOf()).toBe('report');
    expect(view.container.textContent).toBe('to-human view · full transcript ›');
  });

  it('stands in the band’s bordered frame, its caption and its button one size, with no row above it', () => {
    withUi({ ownerLane: true, noTurnFold: true });
    const view = render(<ViewSwitch appSessionId={APP} />);
    const frame = view.container.querySelector('[data-view-switch]')!;
    for (const name of ['rounded-lg', 'border', 'border-border', 'bg-bg-raised', 'px-3', 'py-2']) expect(frame.classList.contains(name), name).toBe(true);
    const css = readFileSync(join(__dirname, 'view.css'), 'utf8');
    const rule = (selector: string) => new RegExp(String.raw`(?:^|\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*\{([^}]*)\}`).exec(css)?.[1] ?? '';
    expect(rule('.owner-view-switch')).toMatch(/font-size:\s*var\(--text-ui\)/);
    expect(rule('.owner-view-switch > button')).toMatch(/font-size:\s*inherit/);
    expect(rule('.owner-view-switch')).not.toMatch(/margin|padding-top/);
  });
});

describe('the action "Toggle report and transcript"', () => {
  it('switches the focused pane’s session between its two views while its lane is on, and does nothing otherwise', () => {
    act(() => useLayout.setState({ main: mainShowing(APP) }));
    withUi({ ownerLane: true, noTurnFold: true });
    toggleView();
    expect(viewOf()).toBe('transcript');
    toggleView();
    expect(viewOf()).toBe('report');
    withUi({ ownerLane: false });
    toggleView();
    expect(viewOf()).toBeUndefined();
  });
});
