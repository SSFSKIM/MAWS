// The `/` palette (C7 execution document, "Mentions, palette and the "+" menu"): the union of the engine's catalogue,
// the declared widget catalogue and MAWS's actions, each row badged by origin, ranked by `rank.ts`, at most 40 rows,
// the item list memoised per catalogue and registered widgets. Choosing a row follows the one dispatch rule: a
// registered widget opens; a headless command is inserted as `/<name> ` for the engine to parse from the prompt; a MAWS
// action runs; an unavailable row stays listed and disabled with its hint.
import type { Editor, Range } from '@tiptap/core';
import { useMemo, useSyncExternalStore } from 'react';
import { enabledActions, runAction, subscribeActions } from '../../keymap/actions-runtime';
import { mawsItems, ORIGIN_LABEL, slashItems, type SlashItem } from './items';
import { Listbox, useListKeys, type PopupItem, type PopupProps } from './popup';
import { rankItems, rememberChosen } from './rank';

const ROW_LIMIT = 40;
const enabledKey = () => enabledActions().join(' '); // a string, so an unchanged set is an unchanged snapshot
type Row = PopupItem & { item: SlashItem };

function rowOf(item: SlashItem, openWidget: (name: string) => void): Row {
  const key = `${item.origin}:${item.name}`;
  const chosen = (then: (editor: Editor, range: Range) => void) => (editor: Editor, range: Range) => {
    rememberChosen(item.name);
    then(editor, range);
  };
  switch (item.action.kind) {
    case 'text':
      return { key, item, disabled: false, apply: chosen((editor, range) => void editor.chain().focus().insertContentAt(range, `/${item.name} `).run()) };
    case 'widget':
      return {
        key,
        item,
        disabled: false,
        apply: chosen((editor, range) => {
          editor.chain().focus().deleteRange(range).run();
          openWidget(item.name);
        }),
      };
    case 'maws': {
      const id = item.action.id;
      return {
        key,
        item,
        disabled: false,
        apply: chosen((editor, range) => {
          editor.chain().deleteRange(range).run();
          runAction(id);
        }),
      };
    }
    case 'unavailable':
      return { key, item, disabled: true, apply: () => {} };
  }
}

export function SlashPalette(props: PopupProps) {
  const { catalog, widgets, openWidget } = props.ctx;
  const enabled = useSyncExternalStore(subscribeActions, enabledKey); // the MAWS rows follow action registrations
  const all = useMemo(() => slashItems(catalog, widgets, mawsItems((id) => enabled.split(' ').includes(id))), [catalog, widgets, enabled]);
  const rows = useMemo(() => rankItems(props.query, all).slice(0, ROW_LIMIT).map((item) => rowOf(item, (name) => openWidget(name, ''))), [all, props.query, openWidget]);
  const { active, setActive, choose } = useListKeys(props, rows);
  if (rows.length === 0) return null;
  const optionId = (i: number) => `composer-slash-${i}`;
  return (
    <Listbox label="Commands" activeId={optionId(active)}>
      {rows.map((row, index) => (
        <div
          key={row.key}
          id={optionId(index)}
          role="option"
          aria-selected={index === active}
          aria-disabled={row.disabled || undefined}
          data-origin={row.item.origin}
          onMouseEnter={() => setActive(index)}
          onClick={() => choose(row)}
          className={`flex min-w-0 cursor-default items-baseline gap-2 rounded-sm px-2 py-1 ${index === active ? 'bg-bg-active' : ''} ${row.disabled ? 'text-fg-faint' : ''}`}
        >
          <span className="shrink-0">{row.item.title}</span>
          <span className="min-w-0 flex-1 truncate text-ui-sm text-fg-faint">{row.disabled && row.item.action.kind === 'unavailable' ? row.item.action.hint : row.item.description}</span>
          <span className="shrink-0 rounded-sm border border-border px-1 text-ui-sm text-fg-muted">{ORIGIN_LABEL[row.item.origin]}</span>
        </div>
      ))}
    </Listbox>
  );
}
