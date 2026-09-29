// The `@` menu (C7 execution document, "Mentions, palette and the "+" menu"): Files from main's `git.lsFiles` over the
// session's directory (debounced 80 ms, relative paths, directories last), or over the additional directories as
// absolute paths when the query starts with `/`, `~` or `..` (path mode); Agents from the catalogue, inserting an agent
// mention; Skills from the catalogue, whose choice puts the skill's real invocation `/<skill> ` at the start of the
// message (the engine has no `@skill` mention).
import type { Editor, Range } from '@tiptap/core';
import { useEffect, useMemo, useState } from 'react';
import { ipc } from '../../ipc/client';
import { mentionNode, textNode } from '../editor/doc';
import { mentionLabel } from '../editor/recall';
import { atItems, type AtItem } from './items';
import { GroupLabel, Listbox, useDebounced, useListKeys, type PopupItem, type PopupProps } from './popup';

const FILE_LIMIT = 30;
const ROW_LIMIT = 40;
type Row = PopupItem & { item: AtItem };

function insertMention(editor: Editor, range: Range, id: string, kind: 'file' | 'agent') {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [mentionNode({ id, label: kind === 'file' ? mentionLabel(id) : id, kind }), textNode(' ')])
    .run();
}

function rowOf(item: AtItem): Row {
  const key = `${item.group}:${item.group === 'files' ? item.path : item.name}`;
  if (item.group === 'files') return { key, disabled: false, item, apply: (editor, range) => insertMention(editor, range, item.path, 'file') };
  if (item.group === 'agents') return { key, disabled: false, item, apply: (editor, range) => insertMention(editor, range, item.name, 'agent') };
  return {
    key,
    disabled: false,
    item,
    apply: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContentAt(1, `/${item.name} `).run();
    },
  };
}

const PATH_MODE = /^(\/|~|\.\.)/;

// Files for the query: the session's directory, or in path mode each additional directory (absolute paths).
function useFiles(cwd: string, additional: readonly string[], query: string): AtItem[] {
  const settled = useDebounced(query, 80);
  const [files, setFiles] = useState<{ query: string; items: AtItem[] }>({ query: '', items: [] });
  useEffect(() => {
    let live = true;
    const pathMode = PATH_MODE.test(settled);
    const roots = pathMode ? additional : cwd === '' ? [] : [cwd];
    const q = pathMode ? settled.replace(/^(~\/?|\.\.\/?|\/)/, '') : settled;
    void Promise.all(
      roots.map(async (root) => {
        const result = await ipc.invoke('git.lsFiles', { directory: root, query: q, limit: FILE_LIMIT });
        if (!result.ok) return [];
        return result.value.paths.map((path): AtItem => {
          const directory = path.endsWith('/');
          const bare = directory ? path.slice(0, -1) : path;
          return { group: 'files', name: bare, path: pathMode ? `${root.replace(/\/$/, '')}/${bare}` : bare, directory };
        });
      }),
    ).then((lists) => {
      if (!live) return;
      const all = lists.flat();
      setFiles({ query: settled, items: [...all.filter((f) => f.group === 'files' && !f.directory), ...all.filter((f) => f.group === 'files' && f.directory)] });
    });
    return () => {
      live = false;
    };
  }, [cwd, additional, settled]);
  return files.items;
}

const GROUPS: { group: AtItem['group']; label: string }[] = [
  { group: 'files', label: 'Files' },
  { group: 'agents', label: 'Agents' },
  { group: 'skills', label: 'Skills' },
];

export function AtMenu(props: PopupProps) {
  const { cwd, additionalDirectories, catalog } = props.ctx;
  const files = useFiles(cwd, additionalDirectories, props.query);
  const others = useMemo(() => atItems(catalog, props.query), [catalog, props.query]);
  const rows = useMemo(() => [...files, ...others].slice(0, ROW_LIMIT).map(rowOf), [files, others]);
  const { active, setActive, choose } = useListKeys(props, rows);
  if (rows.length === 0) return null;
  const optionId = (i: number) => `composer-at-${i}`;
  return (
    <Listbox label="Mention" activeId={optionId(active)}>
      {GROUPS.map(({ group, label }) => {
        const inGroup = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.item.group === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} role="group" aria-label={label}>
            <GroupLabel>{label}</GroupLabel>
            {inGroup.map(({ row, index }) => (
              <div
                key={row.key}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(row)}
                className={`flex min-w-0 cursor-default items-baseline gap-2 rounded-sm px-2 py-1 ${index === active ? 'bg-bg-active' : ''}`}
              >
                <span className="truncate">{row.item.group === 'files' ? row.item.path + (row.item.directory ? '/' : '') : row.item.name}</span>
                {row.item.group !== 'files' && row.item.description ? <span className="truncate text-ui-sm text-fg-faint">{row.item.description}</span> : null}
              </div>
            ))}
            {group === 'skills' ? <div className="px-2 pb-1 text-ui-sm text-fg-faint">A skill runs as /name at the start of the message</div> : null}
          </div>
        );
      })}
    </Listbox>
  );
}
