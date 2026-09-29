// The `@` and `/` popups' glue to Tiptap's suggestion plugin (C7 execution document, M3 decisions): the plugin's
// `render` mounts a React component through `ReactRenderer` and positions it with the plugin's own Floating UI support
// (`mount`); arrows, Enter, Tab and Escape reach the component through its handle while focus stays in the editor. The
// mounted element carries `data-key-sink="composer"`, so a key that lands in it never reaches C5's pane actions.
// Shared parts of the two lists live here: the item a row applies, the listbox and its keyboard.
import type { Editor, Range } from '@tiptap/core';
import type { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { exitSuggestion, type SuggestionKeyDownProps, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from 'react';
import type { EditorEnv, PopupContext } from '../editor/env';

// A row of either list: what it shows and what choosing it does to the document.
export interface PopupItem {
  key: string;
  disabled: boolean;
  apply(editor: Editor, range: Range): void;
}

export interface PopupHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

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
    return {
      onStart: (p) => {
        renderer = new ReactRenderer<PopupHandle, PopupProps>(Component, { editor: p.editor, props: propsOf(p) });
        renderer.element.dataset.keySink = 'composer';
        renderer.element.style.zIndex = '50';
        unmount = p.mount(renderer.element);
      },
      onUpdate: (p) => renderer?.updateProps(propsOf(p)),
      onKeyDown: ({ event }: SuggestionKeyDownProps) => renderer?.ref?.onKeyDown(event) ?? false,
      onExit: () => {
        unmount?.();
        renderer?.destroy();
        renderer = null;
        unmount = null;
      },
    };
  };
}

// The keyboard of a list: arrows move over enabled and disabled rows alike, Enter and Tab choose the active row (a
// disabled row stays put), Escape closes the popup without the key going anywhere else.
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
  useImperativeHandle(props.ref, () => ({
    onKeyDown(event) {
      if (event.key === 'Escape') {
        exitSuggestion(props.editor.view, props.pluginKey);
        return true;
      }
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

export function Listbox({ label, activeId, children }: { label: string; activeId: string | undefined; children: ReactNode }) {
  return (
    <div
      role="listbox"
      aria-label={label}
      aria-activedescendant={activeId}
      className="max-h-80 w-[min(28rem,80vw)] overflow-y-auto rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-lg"
      onMouseDown={(event) => event.preventDefault()} // keep focus (and the selection) in the editor
    >
      {children}
    </div>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1.5 pb-0.5 text-ui-sm text-fg-faint">{children}</div>;
}
