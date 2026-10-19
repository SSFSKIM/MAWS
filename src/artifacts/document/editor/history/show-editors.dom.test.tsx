// Show editors' list (happy-dom; P3-F, sitting candidate 29, F3's document part): the popover stacks its header over its
// rows, its title on one line with the × at the header's far end, away from the pointer that chose Show editors at the
// popover's corner (the generic popover lays its children in a row, which squeezed the title to a word a line and put
// the × under the pointer). Layout is read from chrome.css's computed rules; the e2e measures it.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import tokensCss from '../../../../renderer/src/styles/tokens.css?raw';
import chromeCss from '../chrome.css?raw';
import { ShowEditorsMenu } from './ShowEditors';

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${chromeCss}`;
  document.head.append(style);
});
afterEach(cleanup);

describe('the editors of a selection', () => {
  it('stack under a one-line title whose × is at the header’s far end', () => {
    const editors = [{ key: 'human', name: 'Owner', color: '--author-1', at: 0, when: 'just now', kinds: [] }];
    render(<ShowEditorsMenu open={{ x: 40, y: 20, from: 1, to: 5, asked: true, editors, error: null }} onShow={() => {}} onClose={() => {}} />);
    const popover = screen.getByRole('dialog', { name: 'Editors' });
    expect(getComputedStyle(popover).flexDirection).toBe('column');
    expect(getComputedStyle(popover).alignItems).toBe('stretch');
    const header = popover.querySelector<HTMLElement>('.doc-editors-header')!;
    const [title, close] = [...header.children] as HTMLElement[];
    expect(title.textContent).toBe('Editors of the selection');
    expect(getComputedStyle(title).whiteSpace).toBe('nowrap');
    expect(close).toBe(screen.getByRole('button', { name: 'Close editors' }));
    expect(getComputedStyle(header).justifyContent).toBe('space-between');
  });
});
