// The formatting toolbar (D1's `Toolbar.tsx`; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): undo and
// redo, the block style, the marks and a link, the lists, quote and code, the Insert menu for every other block kind of
// the schema, the table's row and column controls while the caret is in a table, a code block's language, Comment and
// the comments rail (M4), version history (M5), and Find.
// P3-F1: one row in any width, the tools scrolling in a strip and the comment, history and find controls after it, the
// menus placed by the toolbar so the strip does not clip them (toolbar-strip.ts).
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5; G331 to G337): comment, comments, history and
// find are named glyphs (the shared NamedGlyph: the word its name and tooltip, with its chord), the table's commands one
// Table menu, and a button whose word shows (Insert, Table) draws no tooltip repeating it.
// An inserted atom (math, a diagram, a chip, a pending section) is selected with its field focused, so the person types
// its content next, wherever the keyboard was as the Insert menu was used (P3-F).
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { useEffect, useRef, useState, type ComponentType, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode, type Ref } from 'react';
import { actorKey } from '@shared/artifacts/actor';
import { formatChord } from '@shared/keymap/chord';
import { NamedGlyph } from '../../../renderer/src/ui/glyph';
import { CommentPlusIcon, CommentsIcon, HistoryIcon, SearchIcon } from '../../ui/icons';
import { nanoid8 } from '../schema';
import type { EditorHost } from './host-types';
import { MentionPicker, type MentionSource } from './MentionPicker';
import { tableJSON } from './nodes/table';
import { useToolbarStrip } from './toolbar-strip'; // P3-F1
import type { CommentsView } from '../../comments/view'; // P4-B1

const BLOCK_STYLES = [
  ['p', 'Normal text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
] as const;
const LANGUAGES = ['', 'bash', 'css', 'go', 'html', 'java', 'javascript', 'json', 'markdown', 'python', 'rust', 'sql', 'typescript', 'yaml'];
const STATUSES = ['Not started', 'In progress', 'Done'];
const DIAGRAM = 'graph TD\n  A[Start] --> B[Finish]';
// the glyphs' chords, as the editor binds them (comments/plugins.ts's Mod-Alt-M; DocumentEditor's find and history keys)
const CHORDS = { comment: formatChord('Cmd+Alt+M'), history: formatChord('Cmd+Alt+Shift+H'), find: formatChord('Cmd+F') };
// why Add comment is greyed (the shared NamedGlyph keeps a greyed glyph focusable, its reason the tooltip)
const COMMENT_UNAVAILABLE = { readOnly: 'Read-only', noSelection: 'Select text to comment on' };

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function blockStyle(editor: Editor): string {
  for (const level of [1, 2, 3]) if (editor.isActive('heading', { level })) return `h${level}`;
  return 'p';
}

/** Whether a change may be written now: a control drawn while the page was editable may be used after it stopped being. */
const writable = (editor: Editor): boolean => !editor.isDestroyed && editor.isEditable;

function positionOf(editor: Editor, id: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.attrs.id === id) at = pos;
    return at < 0;
  });
  return at;
}

// The page takes the keyboard now, before an insert (P3-F, sitting candidates 14 and 16). Tiptap's `focus()` run while
// the keyboard is outside the page (in the Insert menu, another atom's field, a toolbar control) defers the page's focus
// to the next animation frame, which then took the keyboard back from the field an inserted atom had just given it: the
// next keys went to the page with the atom selected (the LaTeX typed as text, a Return splitting the line).
function focusPage(editor: Editor): void {
  if (!editor.view.hasFocus()) editor.view.focus();
}

// Selects the atom at `pos` and puts the caret in its field.
function editAtom(editor: Editor, pos: number): void {
  if (pos < 0) return;
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
  dom?.querySelector<HTMLElement>('.doc-atom-field input, .doc-atom-field textarea')?.focus();
}

function insertInline(editor: Editor, node: JSONContent, edit: boolean): void {
  if (!writable(editor)) return;
  focusPage(editor);
  editor.chain().insertContent(node).scrollIntoView().run();
  const pos = editor.state.selection.from - 1;
  if (edit && editor.state.doc.nodeAt(pos)?.type.name === node.type) editAtom(editor, pos);
}

function insertBlock(editor: Editor, node: JSONContent, then: 'edit' | 'inside'): void {
  if (!writable(editor)) return;
  const id = nanoid8();
  focusPage(editor);
  editor
    .chain()
    .insertContent({ ...node, attrs: { ...node.attrs, id } })
    .scrollIntoView()
    .run();
  const pos = positionOf(editor, id);
  if (then === 'edit') editAtom(editor, pos);
  else if (pos >= 0) editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos + 1))).scrollIntoView()); // the first textblock inside
}

/** The toolbar's comment controls (M4): Comment the selection (absent when commenting is not offered), and the rail. */
export interface CommentControls {
  comment: (() => void) | null;
  railOpen: boolean;
  openCount: number;
  toggleRail(): void;
  /** P4-B1 (the P4 spec §4.3): View › Comments, Expand, Minimize or Hide, when the host persists it. */
  view?: { value: CommentsView; set(view: CommentsView): void };
}

// P4-B1: the view menu's items, Docs' names
const VIEWS: ReadonlyArray<[CommentsView, string]> = [
  ['expand', 'Expand'],
  ['minimize', 'Minimize'],
  ['hide', 'Hide'],
];

/** The toolbar's history control (M5): the version history rail, when the editor has a history to show. */
export interface HistoryControls {
  open: boolean;
  toggle(): void;
}

export interface SectionControls { add(): void; disabled: boolean; reason?: string }

export function Toolbar({ editor, artifactId, host, onFind, comments, history, mentions, newSection, highlightScope: HighlightScope }: { highlightScope?: ComponentType<{ children: ReactNode }>; editor: Editor; artifactId: string; host: EditorHost; onFind(): void; comments: CommentControls; history?: HistoryControls; mentions?: MentionSource; newSection?: SectionControls }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
      selected: !e.state.selection.empty,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      block: blockStyle(e),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      link: e.isActive('link'),
      href: String(e.getAttributes('link').href ?? ''),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      language: String(e.getAttributes('codeBlock').language ?? ''),
      table: e.isActive('table'),
    }),
  });
  const [menu, setMenu] = useState<'insert' | 'table' /* the word cut, G331 */ | 'link' | 'mention' | 'comments-view' /* P4-B1 */ | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const imageFile = useRef<HTMLInputElement>(null);
  // P3-F1: one row, its tools in a scrolling strip and the comment, history and find controls after it (toolbar-strip.ts)
  const bar = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const linkAnchor = useRef<HTMLSpanElement>(null);
  const insertAnchor = useRef<HTMLSpanElement>(null);
  const tableAnchor = useRef<HTMLSpanElement>(null);
  useToolbarStrip({ bar, strip, anchor: menu === 'link' ? linkAnchor : menu === 'table' ? tableAnchor : menu === null ? null : insertAnchor, menu, tools: `${state.table}:${state.codeBlock}:${uploadError !== null}` });
  // an upload's error is scrolled to in the strip as it appears
  const uploadErrorRow = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (uploadError) uploadErrorRow.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [uploadError]);
  // P4: a paste whose images from another document could not be copied in says why in the same row (asset-paste.ts)
  useEffect(() => {
    const failed = ({ message }: { message: string }) => setUploadError(message);
    editor.on('assetPasteFailed', failed);
    return () => void editor.off('assetPasteFailed', failed);
  }, [editor]);
  const run = () => editor.chain().focus();
  // every change is checked when it is made, not when its control was drawn (the store may have turned read-only since)
  const write = (change: () => unknown) => () => void (writable(editor) && change());
  // a popover open when the page stops being editable goes
  useEffect(() => {
    if (!state.editable) setMenu(null);
  }, [state.editable]);
  // P3-F: the Insert menu also goes on Escape in the toolbar or the page (the keyboard back on Insert when it was in the
  // menu; a click leaves it in the page) and on a press anywhere outside the menu and its button
  const insertButton = useRef<HTMLButtonElement>(null);
  const viewAnchor = useRef<HTMLSpanElement>(null); // P4-B1: the comments' view menu, closed as Insert's is
  const viewButton = useRef<HTMLButtonElement>(null);
  const tableButton = useRef<HTMLButtonElement>(null); // the word cut (G331): the Table menu, closed as Insert's is
  // the Table menu goes when the caret leaves the table
  useEffect(() => {
    if (!state.table) setMenu((open) => (open === 'table' ? null : open));
  }, [state.table]);
  useEffect(() => {
    if (menu !== 'insert' && menu !== 'comments-view' && menu !== 'table') return;
    const anchor = menu === 'insert' ? insertAnchor : menu === 'table' ? tableAnchor : viewAnchor; // P4-B1
    const button = menu === 'insert' ? insertButton : menu === 'table' ? tableButton : viewButton;
    const within = (element: Element | null, target: EventTarget | null) => target instanceof Node && Boolean(element?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if (!within(anchor.current, event.target)) setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      const inMenu = within(anchor.current, event.target);
      if (!inMenu && !within(bar.current, event.target) && !within(editor.isDestroyed ? null : editor.view.dom, event.target)) return;
      event.preventDefault();
      setMenu(null);
      if (inMenu) button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menu, editor]);

  const setStyle = (value: string) => {
    if (!writable(editor)) return;
    if (value === 'p') run().setParagraph().run();
    else run().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
  };

  // A failed read or upload inserts nothing and says so in the toolbar until dismissed or the next upload.
  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { assetId, ref } = await host.uploadAsset(artifactId, bytes, { name: file.name, mime: file.type || 'application/octet-stream' });
      if (writable(editor)) run().insertContent({ type: 'image', attrs: { src: ref, alt: file.name, assetId } }).run();
    } catch (error) {
      setUploadError(`Couldn’t upload ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const inserts: Array<[string, () => void]> = [
    ['Table', () => insertBlock(editor, tableJSON(3, 3), 'inside')],
    ['Image…', write(() => imageFile.current?.click())],
    ['Divider', write(() => run().setHorizontalRule().run())],
    ['Callout', () => insertBlock(editor, { type: 'callout', attrs: { tone: 'note' }, content: [{ type: 'paragraph' }] }, 'inside')],
    ['Math', () => insertInline(editor, { type: 'math', attrs: { latex: '' } }, true)],
    ['Equation', () => insertBlock(editor, { type: 'mathBlock', attrs: { latex: '' } }, 'edit')],
    ['Diagram', () => insertBlock(editor, { type: 'diagram', attrs: { source: DIAGRAM } }, 'edit')],
    ['Pending section', () => insertBlock(editor, { type: 'pending', attrs: { intent: '' } }, 'edit')],
    ['Date', () => insertInline(editor, { type: 'date', attrs: { iso: today() } }, true)],
    // with a source, a picker of people, sessions and artifacts; without one, the owner, named in place
    ['Mention', write(() => (mentions ? setMenu('mention') : insertInline(editor, { type: 'mention', attrs: { kind: 'person', ref: actorKey(host.identity().actor), label: host.identity().name } }, true)))],
    ['Status', () => insertInline(editor, { type: 'dropdown', attrs: { options: STATUSES, value: STATUSES[0] } }, false)],
  ];

  const tableControls: Array<[string, () => void]> = [
    ['Add row above', write(() => run().addRowBefore().run())],
    ['Add row below', write(() => run().addRowAfter().run())],
    ['Add column left', write(() => run().addColumnBefore().run())],
    ['Add column right', write(() => run().addColumnAfter().run())],
    ['Delete row', write(() => run().deleteRow().run())],
    ['Delete column', write(() => run().deleteColumn().run())],
    ['Header row', write(() => run().toggleHeaderRow().run())],
    ['Delete table', write(() => run().deleteTable().run())],
  ];

  const disabled = !state.editable;
  return (
    <div ref={bar} role="toolbar" aria-label="Formatting" className="doc-toolbar doc-format-toolbar">
      <div ref={strip} className="doc-toolbar-tools">
        <Tool label="Undo" disabled={disabled || !state.canUndo} onClick={write(() => run().undo().run())}>
          ↶
        </Tool>
        <Tool label="Redo" disabled={disabled || !state.canRedo} onClick={write(() => run().redo().run())}>
          ↷
        </Tool>
        <span className="doc-toolbar-separator" />
        <select className="doc-toolbar-select" aria-label="Block style" disabled={disabled} value={state.block} onChange={(event) => setStyle(event.target.value)}>
          {BLOCK_STYLES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="doc-toolbar-separator" />
        <Tool label="Bold" active={state.bold} disabled={disabled} onClick={write(() => run().toggleBold().run())}>
          <b>B</b>
        </Tool>
        <Tool label="Italic" active={state.italic} disabled={disabled} onClick={write(() => run().toggleItalic().run())}>
          <i>I</i>
        </Tool>
        <Tool label="Underline" active={state.underline} disabled={disabled} onClick={write(() => run().toggleUnderline().run())}>
          <u>U</u>
        </Tool>
        <Tool label="Strikethrough" active={state.strike} disabled={disabled} onClick={write(() => run().toggleStrike().run())}>
          <s>S</s>
        </Tool>
        <Tool label="Inline code" active={state.code} disabled={disabled} onClick={write(() => run().toggleCode().run())}>
          {'</>'}
        </Tool>
        <Tool label="Highlight" active={state.highlight} disabled={disabled} onClick={write(() => run().toggleHighlight().run())}>
          {HighlightScope ? <HighlightScope><span className="doc-highlight-sample" data-highlight-sample="" aria-hidden="true">H</span></HighlightScope> : <span className="doc-highlight-sample" data-highlight-sample="" aria-hidden="true">H</span>}
        </Tool>
        <span ref={linkAnchor} className="doc-menu-anchor">
          <Tool label="Link" active={state.link} disabled={disabled} expanded={menu === 'link'} onClick={() => setMenu(menu === 'link' ? null : 'link')}>
            🔗
          </Tool>
          {menu === 'link' && (
            <LinkForm
              href={state.href}
              onDone={(href) => {
                setMenu(null);
                if (href === null || !writable(editor)) return;
                if (href) run().extendMarkRange('link').setLink({ href }).run();
                else run().extendMarkRange('link').unsetLink().run();
              }}
            />
          )}
        </span>
        <span className="doc-toolbar-separator" />
        <Tool label="Bulleted list" active={state.bulletList} disabled={disabled} onClick={write(() => run().toggleBulletList().run())}>
          •
        </Tool>
        <Tool label="Numbered list" active={state.orderedList} disabled={disabled} onClick={write(() => run().toggleOrderedList().run())}>
          1.
        </Tool>
        <Tool label="Checklist" active={state.taskList} disabled={disabled} onClick={write(() => run().toggleTaskList().run())}>
          ☑
        </Tool>
        <Tool label="Quote" active={state.blockquote} disabled={disabled} onClick={write(() => run().toggleBlockquote().run())}>
          ❝
        </Tool>
        <Tool label="Code block" active={state.codeBlock} disabled={disabled} onClick={write(() => run().toggleCodeBlock().run())}>
          {'{ }'}
        </Tool>
        {state.codeBlock && (
          <select
            className="doc-toolbar-select"
            aria-label="Code language"
            disabled={disabled}
            value={state.language}
            onChange={(event) => write(() => run().updateAttributes('codeBlock', { language: event.target.value || null }).run())()}
          >
            {(LANGUAGES.includes(state.language) ? LANGUAGES : [...LANGUAGES, state.language]).map((language) => (
              <option key={language} value={language}>
                {language || 'Plain text'}
              </option>
            ))}
          </select>
        )}
        <span className="doc-toolbar-separator" />
        <span ref={insertAnchor} className="doc-menu-anchor">
          <Tool ref={insertButton} label="Insert" worded disabled={disabled} expanded={menu === 'insert'} onClick={() => setMenu(menu === 'insert' ? null : 'insert')}>
            Insert ▾
          </Tool>
          {menu === 'insert' && (
            <div role="menu" className="doc-menu">
              {newSection && <button type="button" role="menuitem" disabled={newSection.disabled} title={newSection.reason} onClick={() => { setMenu(null); if (writable(editor)) newSection.add(); }}>New section</button>}
              {inserts.map(([label, insert]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  onMouseDown={keepSelection}
                  onClick={() => {
                    setMenu(null);
                    insert();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {menu === 'mention' && mentions && (
            <MentionPicker
              source={mentions}
              onClose={() => {
                setMenu(null);
                run().run();
              }}
              onPick={({ kind, ref, label }) => {
                setMenu(null);
                insertInline(editor, { type: 'mention', attrs: { kind, ref, label } }, false);
              }}
            />
          )}
        </span>
        <input ref={imageFile} type="file" accept="image/*" aria-label="Image file" hidden onChange={(event) => void uploadImage(event)} />
        {uploadError && (
          <span ref={uploadErrorRow} className="doc-toolbar-error">
            <span role="alert">{uploadError}</span>
            <Tool label="Dismiss upload error" onClick={() => setUploadError(null)}>
              ×
            </Tool>
          </span>
        )}
        {state.table && (
          <>
            <span className="doc-toolbar-separator" />
            {/* the word cut (G331): the table's eight commands in one menu */}
            <span ref={tableAnchor} className="doc-menu-anchor">
              <Tool ref={tableButton} label="Table" worded disabled={disabled} expanded={menu === 'table'} onClick={() => setMenu(menu === 'table' ? null : 'table')}>
                Table ▾
              </Tool>
              {menu === 'table' && (
                <div role="menu" className="doc-menu" aria-label="Table">
                  {tableControls.map(([label, command]) => (
                    <button
                      key={label}
                      type="button"
                      role="menuitem"
                      onMouseDown={keepSelection}
                      onClick={() => {
                        setMenu(null);
                        command();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </span>
          </>
        )}
      </div>
      <div className="doc-toolbar-end">
        {comments.comment && (
          <Glyph label="Add comment" shortcut={CHORDS.comment} unavailable={disabled ? COMMENT_UNAVAILABLE.readOnly : state.selected ? null : COMMENT_UNAVAILABLE.noSelection} onClick={comments.comment} data-doc-glyph="comment">
            <CommentPlusIcon />
          </Glyph>
        )}
        <Glyph label={`Comments (${comments.openCount} open)`} active={comments.railOpen} onClick={comments.toggleRail} data-doc-glyph="comments">
          <CommentsIcon />
          {comments.openCount > 0 && <span className="doc-tool-count">{comments.openCount}</span>}
        </Glyph>
        {comments.view && (
          /* P4-B1: View › Comments beside the toolbar's Comments: Expand (cards in the margin), Minimize (icons), Hide */
          <span ref={viewAnchor} className="doc-menu-anchor">
            <Tool ref={viewButton} label="Comment view" expanded={menu === 'comments-view'} onClick={() => setMenu(menu === 'comments-view' ? null : 'comments-view')}>
              ▾
            </Tool>
            {menu === 'comments-view' && (
              <div role="menu" className="doc-menu" aria-label="Comment view">
                {VIEWS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={comments.view!.value === value}
                    onMouseDown={keepSelection}
                    onClick={() => {
                      setMenu(null);
                      comments.view!.set(value);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
        {history && (
          <Glyph label="Version history" shortcut={CHORDS.history} active={history.open} onClick={history.toggle} data-doc-glyph="history">
            <HistoryIcon />
          </Glyph>
        )}
        <Glyph label="Find" shortcut={CHORDS.find} onClick={onFind} data-doc-glyph="find">
          <SearchIcon />
        </Glyph>
      </div>
    </div>
  );
}

// A toolbar button keeps the editor's selection: the mousedown that would move focus off the page is cancelled.
const keepSelection = (event: MouseEvent) => event.preventDefault();

// `worded`: the button shows its word, so no tooltip repeats it (the word cut, G337); a glyph's word is its tooltip.
function Tool({ label, worded = false, active, disabled, expanded, onClick, children, ref }: { label: string; worded?: boolean; active?: boolean; disabled?: boolean; expanded?: boolean; onClick(): unknown; children: ReactNode; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      className="doc-tool"
      aria-label={label}
      title={worded ? undefined : label}
      aria-pressed={active}
      aria-expanded={expanded}
      data-active={active ? '' : undefined}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={() => void onClick()}
    >
      {children}
    </button>
  );
}

// A toolbar control whose word became a glyph (the word cut, G332 to G336): the shared NamedGlyph in the toolbar's
// look, keeping the editor's selection as every tool does; `active` is its pressed state, as a tool's.
function Glyph({ label, shortcut, unavailable, active, onClick, children, ...data }: { label: string; shortcut?: string; unavailable?: string | null; active?: boolean; onClick(): unknown; children: ReactNode; 'data-doc-glyph': string }) {
  return (
    <NamedGlyph label={label} shortcut={shortcut} unavailable={unavailable} pressed={active} data-active={active ? '' : undefined} className="doc-tool doc-tool-glyph" onMouseDown={keepSelection} onClick={() => void onClick()} {...data}>
      {children}
    </NamedGlyph>
  );
}

// The link's address: Enter applies (an empty address removes the link), Escape leaves it as it was.
function LinkForm({ href, onDone }: { href: string; onDone(href: string | null): void }) {
  const [value, setValue] = useState(href);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onDone(value.trim());
  };
  return (
    <form className="doc-popover" onSubmit={submit}>
      <input
        aria-label="Link address"
        placeholder="https://"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone(null);
        }}
      />
      <button type="submit">Apply</button>
      {href && (
        <button type="button" onClick={() => onDone('')}>
          Remove
        </button>
      )}
    </form>
  );
}
