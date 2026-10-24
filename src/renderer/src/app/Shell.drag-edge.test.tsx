import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../ipc/query';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { A, B, mainShowing, resetPanelStores } from '../test-support/panel';
import { Shell } from './Shell';

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
