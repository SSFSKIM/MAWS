// The `@` and `/` popups' glue to Tiptap's suggestion plugin (C7 execution document, M3 decisions): the plugin's
// `render` mounts a React component through `ReactRenderer` and attaches it with the plugin's own Floating UI support
// (`mount`), which tracks the caret; arrows, Enter, Tab and Escape reach the component through its handle while focus
// stays in the editor. The mounted element carries `data-key-sink="composer"`, so a key that lands in it never reaches
// C5's pane actions. Shared parts of the two lists live here: the item a row applies, the listbox and its keyboard.
// E11 F2b (plan 2.1): the popup is a fixed overlay from before it is attached (hidden until placed), so it never takes a
// place in the document's flow; it opens above the caret with the room above as its height cap and never flips below
// (as Codex, Claude Desktop and T3 Code place theirs); the active row is revealed by scrolling the list alone.
import type { Editor, Range } from '@tiptap/core';
import type { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { exitSuggestion, type SuggestionKeyDownProps, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import type { EditorEnv, PopupContext } from '../editor/env';

// A row of either list: what it shows and what choosing it does to the document.
export interface PopupItem {
  key: string;
  disabled: boolean;
  apply(editor: Editor, range: Range): void;
}

export interface PopupHandle {
  onKeyDown(event: KeyboardEvent): boolean;
  hasRows(): boolean;
}

// The open popup of each editor, so the editor's keys can tell a list that takes Enter and the arrows from an open
// trigger with nothing to choose (which leaves them to the editor, as if no popup were open).
const open = new WeakMap<Editor, ReactRenderer<PopupHandle, PopupProps>>();
export const popupTakesKeys = (editor: Editor): boolean => open.get(editor)?.ref?.hasRows() ?? false;

export interface PopupProps {
  query: string;
  range: Range;
  editor: Editor;
  command: (item: PopupItem) => void;
  ctx: PopupContext;
  pluginKey: PluginKey;
  ref?: Ref<PopupHandle>;
}

type PopupComponent = (props: PopupProps) => ReactNode;

export function suggestionRenderer(Component: PopupComponent, env: () => EditorEnv, pluginKey: PluginKey): NonNullable<SuggestionOptions<PopupItem, PopupItem>['render']> {
  return () => {
    let renderer: ReactRenderer<PopupHandle, PopupProps> | null = null;
    let unmount: (() => void) | null = null;
    const propsOf = (p: SuggestionProps<PopupItem, PopupItem>): PopupProps => {
      const { cwd, additionalDirectories, catalog, widgets, openWidget } = env();
      return { query: p.query, range: p.range, editor: p.editor, command: p.command, ctx: { cwd, additionalDirectories, catalog, widgets, openWidget }, pluginKey };
    };
    let anchor: SuggestionProps<PopupItem, PopupItem>['clientRect'] = null;
    return {
      onStart: (p) => {
        anchor = p.clientRect;
        renderer = new ReactRenderer<PopupHandle, PopupProps>(Component, { editor: p.editor, props: propsOf(p) });
        const element = renderer.element;
        element.dataset.keySink = 'composer';
        Object.assign(element.style, { position: 'fixed', top: '0px', left: '0px', visibility: 'hidden', zIndex: '50' });
        // Floating UI's autoUpdate says when the caret or the popup moved; the placement is ours (above, bottom-pinned)
        unmount = p.mount(element, {
          onPosition: () => {
            const rect = anchor?.();
            if (rect) placeAbove(element, rect, { width: window.innerWidth, height: window.innerHeight });
          },
        });
        open.set(p.editor, renderer);
      },
      onUpdate: (p) => {
        anchor = p.clientRect;
        renderer?.updateProps(propsOf(p));
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => renderer?.ref?.onKeyDown(event) ?? false,
      onExit: (p) => {
        if (open.get(p.editor) === renderer) open.delete(p.editor);
        unmount?.();
        renderer?.destroy();
        renderer = null;
        unmount = null;
      },
    };
  };
}

// The keyboard of a list: arrows move over enabled and disabled rows alike, Enter and Tab choose the active row (a
// disabled row stays put), Escape closes the popup without the key going anywhere else. Rows are the ones rendered for
// `props.query`; a key that arrives after the document moved on and before the list re-rendered is held, so no row
// found for an older query is ever chosen.
export function useListKeys<T extends PopupItem>(props: PopupProps, items: readonly T[]): { active: number; setActive(i: number): void; choose(item: T): void } {
  const [active, setActive] = useState(0);
  const [lastQuery, setLastQuery] = useState(props.query);
  if (lastQuery !== props.query) {
    setLastQuery(props.query);
    setActive(0);
  }
  const bounded = items.length === 0 ? 0 : Math.min(active, items.length - 1);
  const choose = (item: T) => {
    if (!item.disabled) props.command(item);
  };
  const stale = () => {
    const live: unknown = props.pluginKey.getState(props.editor.state)?.query;
    return typeof live === 'string' && live !== props.query;
  };
  useImperativeHandle(props.ref, () => ({
    hasRows: () => items.length > 0 || stale(),
    onKeyDown(event) {
      if (event.key === 'Escape') {
        exitSuggestion(props.editor.view, props.pluginKey);
        return true;
      }
      if (stale()) return ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key);
      if (items.length === 0) return false;
      if (event.key === 'ArrowDown') setActive((bounded + 1) % items.length);
      else if (event.key === 'ArrowUp') setActive((bounded - 1 + items.length) % items.length);
      else if (event.key === 'Enter' || event.key === 'Tab') choose(items[bounded]);
      else return false;
      return true;
    },
  }));
  return { active: bounded, setActive, choose };
}

// The debounced value of `value`, `ms` after it last changed.
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const GAP = 6; // between the caret's line and the popup
const MARGIN = 8; // between the popup and the window's edges

// Places a popup above its anchor: its bottom pinned just above the anchor's top (so a list that grows or shrinks as
// the query filters it stays put against the caret), its left at the anchor's, shifted to stay inside the viewport, and
// the room above handed to the list as its height cap (`--popup-available-height`). Never below the anchor.
export function placeAbove(element: HTMLElement, anchor: DOMRect, viewport: { width: number; height: number }): void {
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - element.offsetWidth - MARGIN));
  Object.assign(element.style, { position: 'fixed', top: 'auto', bottom: `${viewport.height - anchor.top + GAP}px`, left: `${left}px`, visibility: '' });
  element.style.setProperty('--popup-available-height', `${Math.max(0, anchor.top - GAP - MARGIN)}px`);
}

// Brings `row` into view by scrolling `list` alone (Element.scrollIntoView would scroll every scrollable ancestor, the
// document included).
export function revealInList(list: HTMLElement, row: HTMLElement): void {
  const box = list.getBoundingClientRect();
  const at = row.getBoundingClientRect();
  if (at.top < box.top) list.scrollTop -= box.top - at.top;
  else if (at.bottom > box.bottom) list.scrollTop += at.bottom - box.bottom;
}

// W3 (C6): the `/` list is sized as Claude Desktop's (240 to 512px wide, as its rows need, at most 384px tall); the `@`
// menu keeps its own. F2b: either cap gives way to the room above the caret.
const SIZE = {
  at: 'max-h-[min(20rem,var(--popup-available-height,20rem))] w-[min(28rem,80vw)]',
  slash: 'max-h-[min(24rem,var(--popup-available-height,24rem))] w-max max-w-[min(32rem,80vw)] min-w-60',
} as const;

// `revealKey` changes with the rows, so a filtered list reveals its active row even when its id is unchanged.
export function Listbox({ label, activeId, size = 'at', revealKey, children }: { label: string; activeId: string | undefined; size?: keyof typeof SIZE; revealKey?: unknown; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = activeId ? list.current?.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`) : null;
    if (list.current && row) revealInList(list.current, row);
  }, [activeId, revealKey]);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      aria-activedescendant={activeId}
      className={`${SIZE[size]} overflow-y-auto rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg`}
      onMouseDown={(event) => event.preventDefault()} // keep focus (and the selection) in the editor
    >
      {children}
    </div>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1.5 pb-0.5 text-ui-sm text-fg-faint">{children}</div>;
}
