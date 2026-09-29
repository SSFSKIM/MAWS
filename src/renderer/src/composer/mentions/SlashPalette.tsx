// The `/` palette (C7 execution document, "Mentions, palette and the "+" menu"): the union of the engine's catalogue,
// the declared widget catalogue and MAWS's actions, each row badged by origin, ranked by `rank.ts`, at most 40 rows,
// the item list memoised per catalogue and registered widgets. Choosing a row follows the one dispatch rule: a
// registered widget opens; a headless command is inserted as `/<name> ` for the engine to parse from the prompt; a MAWS
// action runs; an unavailable row stays listed and disabled with its hint.
import type { Editor, Range } from '@tiptap/core';
import { useMemo, useState, useSyncExternalStore } from 'react'; // C11: useState
import { enabledActions, runAction, subscribeActions } from '../../keymap/actions-runtime';
import { mawsItems, ORIGIN_LABEL, ORIGIN_ORDER, slashItems, type SlashItem, type SlashOrigin } from './items'; // C11: ORIGIN_ORDER, SlashOrigin
import { GroupLabel, Listbox, useListKeys, type PopupItem, type PopupProps } from './popup'; // C11: GroupLabel
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

// C11 start: the group headings (C7's ask of C11; mockup 04 vignette 4). The ranked rows, capped first, are shown under
// their origin's heading in ORIGIN_ORDER with rank order kept inside each group, so the arrows follow the display
// order; the heading names the origin in place of each row's badge (`data-origin` stays). The list opens on the
// best-ranked row wherever its group sits, so Enter still takes the best match.
type Group = { origin: SlashOrigin; rows: { row: Row; index: number }[] };

function grouped(ranked: Row[]): { rows: Row[]; groups: Group[] } {
  const members = ORIGIN_ORDER.map((origin) => ({ origin, rows: ranked.filter((row) => row.item.origin === origin) })).filter((g) => g.rows.length > 0);
  let index = 0;
  return { rows: members.flatMap((g) => g.rows), groups: members.map((g) => ({ origin: g.origin, rows: g.rows.map((row) => ({ row, index: index++ })) })) };
}

export function SlashPalette(props: PopupProps) {
  const { catalog, widgets, openWidget } = props.ctx;
  const enabled = useSyncExternalStore(subscribeActions, enabledKey); // the MAWS rows follow action registrations
  const all = useMemo(() => slashItems(catalog, widgets, mawsItems((id) => enabled.split(' ').includes(id))), [catalog, widgets, enabled]);
  const ranked = useMemo(() => rankItems(props.query, all).slice(0, ROW_LIMIT).map((item) => rowOf(item, (name) => openWidget(name, ''))), [all, props.query, openWidget]);
  const { rows, groups } = useMemo(() => grouped(ranked), [ranked]);
  const { active, setActive, choose } = useListKeys(props, rows);
  // useListKeys starts each query on the first row shown; the list opens on the best-ranked one instead
  const [aimedAt, setAimedAt] = useState<string | null>(null);
  if (aimedAt !== props.query && rows.length > 0) {
    setAimedAt(props.query);
    setActive(rows.indexOf(ranked[0]));
  }
  if (rows.length === 0) return null;
  const optionId = (i: number) => `composer-slash-${i}`;
  return (
    <Listbox label="Commands" activeId={optionId(active)}>
      {groups.map((group) => (
        <div key={group.origin} role="group" aria-label={ORIGIN_LABEL[group.origin]}>
          <GroupLabel>{ORIGIN_LABEL[group.origin]}</GroupLabel>
          {group.rows.map(({ row, index }) => (
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
            </div>
          ))}
        </div>
      ))}
    </Listbox>
  );
}
// C11 end
