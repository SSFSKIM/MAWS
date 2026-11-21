// The `@` menu (C7 execution document, "Mentions, palette and the "+" menu"): Files from main's `git.lsFiles` over the
// session's directory (debounced 80 ms, relative paths, directories last), and in path mode (a query starting with
// `/`, `~` or `..`) over the additional directories too, every path then absolute; Agents from the catalogue, inserting an agent
// mention; Skills from the catalogue, whose choice puts the skill's real invocation `/<skill> ` at the start of the
// message (the engine has no `@skill` mention). While the file search has not answered the query as it stands (the
// debounce, a request in flight), the Files group is one disabled row named `Searching files…`, a quiet spinner (the word
// cut, C56): the menu holds Enter and the arrows, so Enter neither sends the half-typed `@token` nor picks a row an older
// query found. The word cut (C54): an agent's or a skill's description shows on the highlighted row alone, by the arrow
// keys or the pointer, and is the row's description at all times; the Skills group ends at its last skill (C55).
import type { Editor, Range } from '@tiptap/core';
import { useEffect, useMemo, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { pathTarget } from '../../ipc/machine';
import { toast } from '../../stores/notices'; // ticket 733a
import { mentionNode, textNode } from '../editor/doc';
import { MENTION_BREAKS, slashText } from '../editor/mention-text'; // ticket 733a (slashText); board ticket 739 (MENTION_BREAKS)
import { pathRefusal } from '../editor/paste'; // ticket 733a
import { mentionLabel } from '../editor/recall';
import { QuietSpinner } from '../../ui/spinner';
import { SEARCHING_FILES_NAME } from '../copy';
import { atItems, type AtItem } from './items';
import { GroupLabel, Listbox, useDebounced, useListKeys, type PopupItem, type PopupProps } from './popup';

const FILE_LIMIT = 30;
const ROW_LIMIT = 40;
type Row = PopupItem & { item: AtItem | null }; // null: the searching row
const SEARCHING: Row = { key: 'files:searching', disabled: true, item: null, apply: () => {} };

function insertMention(editor: Editor, range: Range, id: string, kind: 'file' | 'agent') {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [mentionNode({ id, label: kind === 'file' ? mentionLabel(id) : id, kind }), textNode(' ')])
    .run();
}

// Ticket 733a (its document, Design 3, §E): a file whose path a drop or a pick would refuse (a line break in it, or the
// grant's opening) is refused here too, with the same words, and the query typed for it goes as a choice's would
function chooseFile(editor: Editor, range: Range, item: Extract<AtItem, { group: 'files' }>) {
  const refusal = pathRefusal(item.path.split('/').filter(Boolean).at(-1) ?? item.path, item.path); // named as a drop names it
  if (refusal === null) return insertMention(editor, range, item.path, 'file');
  editor.chain().focus().deleteRange(range).run();
  toast({ level: 'warning', text: refusal, actions: [], dismissible: true });
}

function rowOf(item: AtItem): Row {
  const key = `${item.group}:${item.group === 'files' ? item.path : item.name}`;
  if (item.group === 'files') return { key, disabled: false, item, apply: (editor, range) => chooseFile(editor, range, item) };
  if (item.group === 'agents') return { key, disabled: false, item, apply: (editor, range) => insertMention(editor, range, item.name, 'agent') };
  return {
    key,
    disabled: false,
    item,
    apply: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContentAt(1, textNode(slashText(item.name))).run(); // ticket 733a: the name's rule, as text (never parsed as HTML)
    },
  };
}

const PATH_MODE = /^(\/|~|\.\.)/;

const rootsFor = (cwd: string, additional: readonly string[], query: string) => [...(cwd === '' ? [] : [cwd]), ...(PATH_MODE.test(query) ? additional : [])];

// Files for the query: the session's directory, and in path mode each additional directory (absolute paths); `null`
// while the search has not answered this query yet.
// P5 O7 M4: the search is made from the composer's session (another machine's checkout is read by its session).
// UX wave U8c-2 (M4 decision 8): the items are kept with the folder they were listed for, and shown only while that is
// the folder asked about, so a list of the folder the agent left is never offered for the one it is in now.
function useFiles(appSessionId: AppSessionId, cwd: string, additional: readonly string[], query: string): AtItem[] | null {
  const machine = machineOf(appSessionId);
  const settled = useDebounced(query, 80);
  const [files, setFiles] = useState<{ query: string | null; cwd: string; items: AtItem[] }>({ query: null, cwd: '', items: [] });
  useEffect(() => {
    let live = true;
    const pathMode = PATH_MODE.test(settled);
    const roots = rootsFor(cwd, additional, settled);
    const q = pathMode ? settled.replace(/^(~\/?|\.\.\/?|\/)/, '') : settled;
    void Promise.all(
      roots.map(async (root) => {
        const result = await ipc.invoke('git.lsFiles', { directory: root, query: q, limit: FILE_LIMIT }, pathTarget(machine, appSessionId));
        if (!result.ok) return [];
        // board ticket 739: a path that holds a control character, the root's included, is offered by no row: its mention
        // would name no file
        return result.value.paths.flatMap((path): AtItem[] => {
          const directory = path.endsWith('/');
          const bare = directory ? path.slice(0, -1) : path;
          const mentioned = pathMode ? `${root.replace(/\/$/, '')}/${bare}` : bare;
          return MENTION_BREAKS.test(mentioned) ? [] : [{ group: 'files', name: bare, path: mentioned, directory }];
        });
      }),
    ).then((lists) => {
      if (!live) return;
      const all = lists.flat();
      setFiles({ query: settled, cwd, items: [...all.filter((f) => f.group === 'files' && !f.directory), ...all.filter((f) => f.group === 'files' && f.directory)] });
    });
    return () => {
      live = false;
    };
  }, [machine, appSessionId, cwd, additional, settled]);
  if (rootsFor(cwd, additional, query).length === 0) return []; // nowhere to search: known empty at once
  return files.query === query && files.cwd === cwd ? files.items : null;
}

const GROUPS: { group: AtItem['group']; label: string }[] = [
  { group: 'files', label: 'Files' },
  { group: 'agents', label: 'Agents' },
  { group: 'skills', label: 'Skills' },
];

const NO_DIRECTORIES: readonly string[] = [];

// One row: a file by its path; an agent or a skill by its name, its description in view while the row is highlighted and
// its accessible description throughout (the name stays the row's name, so the description is outside it).
function AtRow({ id, item, active, onPoint, onChoose }: { id: string; item: AtItem; active: boolean; onPoint(): void; onChoose(): void }) {
  const name = item.group === 'files' ? item.path + (item.directory ? '/' : '') : item.name;
  const description = item.group !== 'files' && item.description ? item.description : null;
  const descriptionId = `${id}-description`;
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-label={description === null ? undefined : name}
      aria-describedby={description === null ? undefined : descriptionId}
      onMouseEnter={onPoint}
      onClick={onChoose}
      className={`flex min-w-0 cursor-default items-baseline gap-2 rounded-sm px-2 py-1 ${active ? 'bg-bg-active' : ''}`}
    >
      <span className="truncate">{name}</span>
      {description !== null && (
        <span id={descriptionId} hidden={!active} className="truncate text-ui-sm text-fg-faint">
          {description}
        </span>
      )}
    </div>
  );
}

export function AtMenu(props: PopupProps) {
  const { appSessionId, cwd, additionalDirectories, catalog, searchesFiles = true } = props.ctx;
  // P5 O7 M4 (fix wave 1): a chat to start on another machine is offered none of this Mac's files
  const files = useFiles(appSessionId, searchesFiles ? cwd : '', searchesFiles ? additionalDirectories : NO_DIRECTORIES, props.query);
  const others = useMemo(() => atItems(catalog, props.query), [catalog, props.query]);
  const rows = useMemo(() => (files === null ? [SEARCHING, ...others.slice(0, ROW_LIMIT - 1).map(rowOf)] : [...files, ...others].slice(0, ROW_LIMIT).map(rowOf)), [files, others]);
  const { active, setActive, choose } = useListKeys(props, rows);
  if (rows.length === 0) return null;
  const optionId = (i: number) => `composer-at-${i}`;
  return (
    <Listbox label="Mention" activeId={optionId(active)} editor={props.editor} revealKey={rows}>
      {GROUPS.map(({ group, label }) => {
        const inGroup = rows.map((row, index) => ({ row, index })).filter(({ row }) => (row.item?.group ?? 'files') === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} role="group" aria-label={label}>
            <GroupLabel>{label}</GroupLabel>
            {inGroup.map(({ row, index }) =>
              row.item === null ? (
                <div key={row.key} id={optionId(index)} role="option" aria-label={SEARCHING_FILES_NAME} aria-selected={index === active} aria-disabled aria-busy className={`flex h-7 items-center rounded-sm px-2 ${index === active ? 'bg-bg-active' : ''}`}>
                  <QuietSpinner label={SEARCHING_FILES_NAME} />
                </div>
              ) : (
                <AtRow key={row.key} id={optionId(index)} item={row.item} active={index === active} onPoint={() => setActive(index)} onChoose={() => choose(row)} />
              ),
            )}
          </div>
        );
      })}
    </Listbox>
  );
}
