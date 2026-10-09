// The popups' placement (E11 M7.2 F2b, plan 2.1): out of the document's flow and hidden from the moment they attach,
// opened above the anchor with the room above as their height cap (never flipped below), and the active row revealed
// by scrolling the list alone.
import { PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import type { SuggestionMount, SuggestionProps } from '@tiptap/suggestion';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorEnv } from '../editor/env';
import { EMPTY_CATALOG } from '../../stores/catalog';
import { Listbox, placeAbove, revealInList, suggestionRenderer, type PopupItem } from './popup';

afterEach(cleanup);

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe('placeAbove', () => {
  it('pins the popup bottom just above the anchor, capped by the room above, inside the viewport horizontally', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: 300 });
    placeAbove(el, rect(100, 500, 2, 16), { width: 1000, height: 800 });
    expect(el.style.position).toBe('fixed');
    expect(el.style.top).toBe('auto');
    expect(el.style.bottom).toBe('306px'); // 800 - 500 + 6
    expect(el.style.left).toBe('100px');
    expect(el.style.getPropertyValue('--popup-available-height')).toBe('486px'); // 500 - 6 - 8
    expect(el.style.visibility).toBe('');
  });

  it('shifts left to stay in the viewport and never offers a negative height', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: 300 });
    placeAbove(el, rect(900, 4, 2, 16), { width: 1000, height: 800 });
    expect(el.style.left).toBe('692px'); // 1000 - 300 - 8
    expect(el.style.getPropertyValue('--popup-available-height')).toBe('0px');
  });
});

describe('the suggestion renderer', () => {
  it('attaches the popup already fixed and hidden, then places it above the caret when Floating UI reports', () => {
    const seen: { connected: boolean; position: string; visibility: string; top: string }[] = [];
    let onPosition: ((p: { x: number; y: number }) => void) | undefined;
    const mount: SuggestionMount = (element, options) => {
      seen.push({ connected: element.isConnected, position: element.style.position, visibility: element.style.visibility, top: element.style.top });
      onPosition = options?.onPosition as typeof onPosition;
      document.body.appendChild(element);
      return () => element.remove();
    };
    const env = () => ({ cwd: '', additionalDirectories: [], catalog: EMPTY_CATALOG, widgets: new Set<string>(), openWidget: () => {} }) as unknown as EditorEnv;
    const handlers = suggestionRenderer(() => null, env, new PluginKey('test-popup'))();
    const editor = { isEditorContentInitialized: false } as unknown as Editor;
    const props = { query: '', range: { from: 1, to: 2 }, editor, command: () => {}, items: [], text: '/', decorationNode: null, clientRect: () => rect(40, 600, 2, 16), mount, loading: false } as unknown as SuggestionProps<PopupItem, PopupItem>;
    handlers.onStart!(props);
    expect(seen).toEqual([{ connected: false, position: 'fixed', visibility: 'hidden', top: '0px' }]);
    const element = document.body.lastElementChild as HTMLElement;
    expect(element.dataset.keySink).toBe('composer');
    expect(onPosition, 'the renderer applies the position itself').toBeTypeOf('function');
    onPosition!({ x: 40, y: 0 });
    expect(element.style.visibility).toBe('');
    expect(element.style.bottom).toBe(`${window.innerHeight - 600 + 6}px`);
    handlers.onExit!(props);
    expect(element.isConnected).toBe(false);
  });
});

describe('the list reveal', () => {
  it('scrolls only the list to bring the row into view', () => {
    const list = document.createElement('div');
    const row = document.createElement('div');
    list.appendChild(row);
    list.getBoundingClientRect = () => rect(0, 100, 200, 200);
    list.scrollTop = 40;
    const scrollIntoView = vi.fn();
    row.scrollIntoView = scrollIntoView;
    row.getBoundingClientRect = () => rect(0, 300, 200, 24); // 24px below the list's bottom
    revealInList(list, row);
    expect(list.scrollTop).toBe(64);
    row.getBoundingClientRect = () => rect(0, 80, 200, 24); // 20px above its top
    revealInList(list, row);
    expect(list.scrollTop).toBe(44);
    row.getBoundingClientRect = () => rect(0, 150, 200, 24); // in view
    revealInList(list, row);
    expect(list.scrollTop).toBe(44);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('the listbox caps its height by the room above and never calls the document-wide scrollIntoView', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { rerender, getByRole } = render(
      <Listbox label="L" activeId="row-1" size="slash">
        <div id="row-0" role="option" aria-selected={false} />
        <div id="row-1" role="option" aria-selected />
      </Listbox>,
    );
    expect(getByRole('listbox').className).toContain('max-h-[min(24rem,var(--popup-available-height,24rem))]');
    rerender(
      <Listbox label="L" activeId="row-0" size="slash">
        <div id="row-0" role="option" aria-selected />
        <div id="row-1" role="option" aria-selected={false} />
      </Listbox>,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
