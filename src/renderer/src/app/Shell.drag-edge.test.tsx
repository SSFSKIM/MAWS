import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../ipc/query';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { A, B, mainShowing, resetPanelStores } from '../test-support/panel';
import { Shell } from './Shell';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSidePane } from '../side/register';
import { openBtwCard, resetSideQuestions } from '../side/store';
import { resetSlots } from './slots';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

function transfer() {
  const data = new Map<string, string>();
  const types: string[] = [];
  return {
    types,
    effectAllowed: 'all',
    dropEffect: 'none',
    setData(type: string, value: string) { data.set(type, value); if (!types.includes(type)) types.push(type); },
    getData: (type: string) => data.get(type) ?? '',
  };
}
function drag(kind: 'dragStart' | 'dragOver' | 'drop', target: Element, dataTransfer: ReturnType<typeof transfer>) {
  const event = createEvent[kind](target);
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  act(() => void fireEvent(target, event));
  return event.defaultPrevented;
}
const renderShell = () => render(<QueryClientProvider client={queryClient}><Shell /></QueryClientProvider>);
const sessionTab = () => document.querySelector<HTMLElement>(`[data-chrome-tabs] [data-tab-id="session:${A}"]`)!;
const content = () => document.querySelector<HTMLElement>('[data-region="main"] > div')!;

beforeEach(() => {
  (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width: 1440 });
  resetPanelStores();
});
afterEach(() => {
  act(() => void window.dispatchEvent(new Event('dragend')));
  cleanup();
});

describe('the main split drop edge beside session cards', () => {
  it('yields the outer main edge during an accepted tab drag and restores the same cards on cancel or drop', () => {
    useLayout.setState({ main: mainShowing(A, B) });
    renderShell();
    const cards = screen.getByRole('complementary', { name: 'Session cards' });
    const regions = useLayout.getState().regions;
    expect(content().style.paddingRight).toBe('304px');
    const payload = transfer();
    drag('dragStart', sessionTab(), payload);
    expect(screen.getByTestId('drop-edge')).toBeTruthy();
    expect(cards.hidden).toBe(true);
    expect(content().style.paddingRight).toBe(''); // MainArea and its right-edge target now reach the main region's edge
    expect(useLayout.getState().regions).toBe(regions);
    act(() => void window.dispatchEvent(new Event('dragend')));
    expect(screen.getByRole('complementary', { name: 'Session cards' })).toBe(cards);
    expect(cards.hidden).toBe(false);
    expect(content().style.paddingRight).toBe('304px');
    expect(currentSet(useLayout.getState().main).panes).toHaveLength(1);

    drag('dragStart', sessionTab(), payload);
    const edge = screen.getByTestId('drop-edge');
    expect(drag('dragOver', edge, payload)).toBe(true);
    drag('drop', edge, payload);
    expect(currentSet(useLayout.getState().main).panes.map((pane) => pane.tabs.map((tab) => tab.id))).toEqual([[`session:${B}`], [`session:${A}`]]);
    expect(screen.queryByTestId('drop-edge')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Session cards' })).toBe(cards);
    expect(content().style.paddingRight).toBe('304px');
    expect(useLayout.getState().regions).toBe(regions);
  });

  it('does not yield cards for a lone tab that cannot open a split', () => {
    useLayout.setState({ main: mainShowing(A) });
    renderShell();
    const cards = screen.getByRole('complementary', { name: 'Session cards' });
    drag('dragStart', sessionTab(), transfer());
    expect(screen.queryByTestId('drop-edge')).toBeNull();
    expect(cards.hidden).toBe(false);
    expect(content().style.paddingRight).toBe('304px');
  });
});

// UX wave U4b (M2; its document's decision 4, Interfaces B; Acceptance 8): the card's place does not read the edge drag,
// so for the drag's length the card at the column's foot is hidden with the column, nothing is drawn over the pane's
// corner meanwhile, and at the drag's end the same card is shown at the foot again.
describe('the /btw card at the column’s foot during an edge drag', () => {
  const tabOf = (id: string) => document.querySelector<HTMLElement>(`[data-chrome-tabs] [data-tab-id="session:${id}"]`)!;
  const btwCards = () => [...document.querySelectorAll<HTMLElement>('[data-btw-card]')];
  beforeEach(() => {
    resetSideQuestions();
    window.maws = fakeClient({ 'side.question.list': { exchanges: [] } }).client as unknown as PreloadBridge;
    registerSidePane();
  });
  afterEach(() => {
    resetSlots();
    delete (window as { maws?: unknown }).maws;
  });

  it('is hidden with the column and drawn nowhere else while an accepted drag lasts, and is the same element at the foot when it is cancelled or dropped', () => {
    useLayout.setState({ main: mainShowing(A, B) }); // B in front: the column speaks of B
    renderShell();
    act(() => openBtwCard(B));
    const cards = screen.getByRole('complementary', { name: 'Session cards' });
    const [card] = btwCards();
    expect([btwCards().length, card.dataset.btwCard, cards.contains(card)]).toEqual([1, 'foot', true]);
    const payload = transfer();
    drag('dragStart', tabOf(A), payload);
    expect(cards.hidden).toBe(true);
    expect(btwCards()).toEqual([card]); // still inside the hidden column, and none over the pane's corner
    expect(cards.contains(card)).toBe(true);
    act(() => void window.dispatchEvent(new Event('dragend')));
    expect(cards.hidden).toBe(false);
    expect(btwCards()).toEqual([card]);

    // dropped: B's own tab opens the split, and its pane, focused, is still the one the column speaks of
    drag('dragStart', tabOf(B), payload);
    expect(btwCards()).toEqual([card]);
    const edge = screen.getByTestId('drop-edge');
    expect(drag('dragOver', edge, payload)).toBe(true);
    drag('drop', edge, payload);
    expect(currentSet(useLayout.getState().main).panes.map((pane) => pane.tabs.map((tab) => tab.id))).toEqual([[`session:${A}`], [`session:${B}`]]);
    expect(cards.hidden).toBe(false);
    expect(btwCards()).toEqual([card]);
    expect(cards.contains(card)).toBe(true);
  });
});
