// The formatting toolbar (D1's `Toolbar.tsx`; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): undo and
// redo, the block style, the marks and a link, the lists, quote and code, the Insert menu for every other block kind of
// the schema, the table's row and column controls while the caret is in a table, a code block's language, and Find.
// An inserted atom (math, a diagram, a chip, a pending section) is selected with its field focused, so the person types
// its content next.
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { actorKey } from '@shared/artifacts/actor';
import { nanoid8 } from '../schema';
import type { EditorHost } from './host-types';
import { tableJSON } from './nodes/table';

const BLOCK_STYLES = [
  ['p', 'Normal text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
] as const;
const LANGUAGES = ['', 'bash', 'css', 'go', 'html', 'java', 'javascript', 'json', 'markdown', 'python', 'rust', 'sql', 'typescript', 'yaml'];
const STATUSES = ['Not started', 'In progress', 'Done'];
const DIAGRAM = 'graph TD\n  A[Start] --> B[Finish]';

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function blockStyle(editor: Editor): string {
  for (const level of [1, 2, 3]) if (editor.isActive('heading', { level })) return `h${level}`;
  return 'p';
}

function positionOf(editor: Editor, id: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.attrs.id === id) at = pos;
    return at < 0;
  });
  return at;
}

// Selects the atom at `pos` and puts the caret in its field.
function editAtom(editor: Editor, pos: number): void {
  if (pos < 0) return;
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
  dom?.querySelector<HTMLElement>('.doc-atom-field input, .doc-atom-field textarea')?.focus();
}

function insertInline(editor: Editor, node: JSONContent, edit: boolean): void {
  editor.chain().focus().insertContent(node).run();
  const pos = editor.state.selection.from - 1;
  if (edit && editor.state.doc.nodeAt(pos)?.type.name === node.type) editAtom(editor, pos);
}

function insertBlock(editor: Editor, node: JSONContent, then: 'edit' | 'inside'): void {
  const id = nanoid8();
  editor
    .chain()
    .focus()
    .insertContent({ ...node, attrs: { ...node.attrs, id } })
    .run();
  const pos = positionOf(editor, id);
  if (then === 'edit') editAtom(editor, pos);
  else if (pos >= 0) editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos + 1)))); // the first textblock inside
}

export function Toolbar({ editor, artifactId, host, onFind }: { editor: Editor; artifactId: string; host: EditorHost; onFind(): void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
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
  const [menu, setMenu] = useState<'insert' | 'link' | null>(null);
  const imageFile = useRef<HTMLInputElement>(null);
  const run = () => editor.chain().focus();

  const setStyle = (value: string) => {
    if (value === 'p') run().setParagraph().run();
    else run().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { assetId, ref } = await host.uploadAsset(artifactId, bytes, { name: file.name, mime: file.type || 'application/octet-stream' });
    if (!editor.isDestroyed) run().insertContent({ type: 'image', attrs: { src: ref, alt: file.name, assetId } }).run();
  };

  const inserts: Array<[string, () => void]> = [
    ['Table', () => insertBlock(editor, tableJSON(3, 3), 'inside')],
    ['Image…', () => imageFile.current?.click()],
    ['Divider', () => run().setHorizontalRule().run()],
    ['Callout', () => insertBlock(editor, { type: 'callout', attrs: { tone: 'note' }, content: [{ type: 'paragraph' }] }, 'inside')],
    ['Math', () => insertInline(editor, { type: 'math', attrs: { latex: '' } }, true)],
    ['Equation', () => insertBlock(editor, { type: 'mathBlock', attrs: { latex: '' } }, 'edit')],
    ['Diagram', () => insertBlock(editor, { type: 'diagram', attrs: { source: DIAGRAM } }, 'edit')],
    ['Pending section', () => insertBlock(editor, { type: 'pending', attrs: { intent: '' } }, 'edit')],
    ['Date', () => insertInline(editor, { type: 'date', attrs: { iso: today() } }, true)],
    ['Mention', () => insertInline(editor, { type: 'mention', attrs: { kind: 'person', ref: actorKey(host.identity().actor), label: host.identity().name } }, true)],
    ['Status', () => insertInline(editor, { type: 'dropdown', attrs: { options: STATUSES, value: STATUSES[0] } }, false)],
  ];

  const tableControls: Array<[string, () => boolean]> = [
    ['Add row above', () => run().addRowBefore().run()],
    ['Add row below', () => run().addRowAfter().run()],
    ['Add column left', () => run().addColumnBefore().run()],
    ['Add column right', () => run().addColumnAfter().run()],
    ['Delete row', () => run().deleteRow().run()],
    ['Delete column', () => run().deleteColumn().run()],
    ['Header row', () => run().toggleHeaderRow().run()],
    ['Delete table', () => run().deleteTable().run()],
  ];

  const disabled = !state.editable;
  return (
    <div role="toolbar" aria-label="Formatting" className="doc-toolbar">
      <Tool label="Undo" disabled={disabled || !state.canUndo} onClick={() => run().undo().run()}>
        ↶
      </Tool>
      <Tool label="Redo" disabled={disabled || !state.canRedo} onClick={() => run().redo().run()}>
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
      <Tool label="Bold" active={state.bold} disabled={disabled} onClick={() => run().toggleBold().run()}>
        <b>B</b>
      </Tool>
      <Tool label="Italic" active={state.italic} disabled={disabled} onClick={() => run().toggleItalic().run()}>
        <i>I</i>
      </Tool>
      <Tool label="Underline" active={state.underline} disabled={disabled} onClick={() => run().toggleUnderline().run()}>
        <u>U</u>
      </Tool>
      <Tool label="Strikethrough" active={state.strike} disabled={disabled} onClick={() => run().toggleStrike().run()}>
        <s>S</s>
      </Tool>
      <Tool label="Inline code" active={state.code} disabled={disabled} onClick={() => run().toggleCode().run()}>
        {'</>'}
      </Tool>
      <Tool label="Highlight" active={state.highlight} disabled={disabled} onClick={() => run().toggleHighlight().run()}>
        ▍
      </Tool>
      <span className="doc-menu-anchor">
        <Tool label="Link" active={state.link} disabled={disabled} expanded={menu === 'link'} onClick={() => setMenu(menu === 'link' ? null : 'link')}>
          🔗
        </Tool>
        {menu === 'link' && (
          <LinkForm
            href={state.href}
            onDone={(href) => {
              setMenu(null);
              if (href === null) return;
              if (href) run().extendMarkRange('link').setLink({ href }).run();
              else run().extendMarkRange('link').unsetLink().run();
            }}
          />
        )}
      </span>
      <span className="doc-toolbar-separator" />
      <Tool label="Bulleted list" active={state.bulletList} disabled={disabled} onClick={() => run().toggleBulletList().run()}>
        •
      </Tool>
      <Tool label="Numbered list" active={state.orderedList} disabled={disabled} onClick={() => run().toggleOrderedList().run()}>
        1.
      </Tool>
      <Tool label="Checklist" active={state.taskList} disabled={disabled} onClick={() => run().toggleTaskList().run()}>
        ☑
      </Tool>
      <Tool label="Quote" active={state.blockquote} disabled={disabled} onClick={() => run().toggleBlockquote().run()}>
        ❝
      </Tool>
      <Tool label="Code block" active={state.codeBlock} disabled={disabled} onClick={() => run().toggleCodeBlock().run()}>
        {'{ }'}
      </Tool>
      {state.codeBlock && (
        <select
          className="doc-toolbar-select"
          aria-label="Code language"
          disabled={disabled}
          value={state.language}
          onChange={(event) => run().updateAttributes('codeBlock', { language: event.target.value || null }).run()}
        >
          {(LANGUAGES.includes(state.language) ? LANGUAGES : [...LANGUAGES, state.language]).map((language) => (
            <option key={language} value={language}>
              {language || 'Plain text'}
            </option>
          ))}
        </select>
      )}
      <span className="doc-toolbar-separator" />
      <span className="doc-menu-anchor">
        <Tool label="Insert" disabled={disabled} expanded={menu === 'insert'} onClick={() => setMenu(menu === 'insert' ? null : 'insert')}>
          Insert ▾
        </Tool>
        {menu === 'insert' && (
          <div role="menu" className="doc-menu">
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
      </span>
      <input ref={imageFile} type="file" accept="image/*" aria-label="Image file" hidden onChange={(event) => void uploadImage(event)} />
      {state.table && (
        <>
          <span className="doc-toolbar-separator" />
          {tableControls.map(([label, command]) => (
            <Tool key={label} label={label} disabled={disabled} onClick={command}>
              {label}
            </Tool>
          ))}
        </>
      )}
      <span className="doc-toolbar-spacer" />
      <Tool label="Find" onClick={onFind}>
        Find
      </Tool>
    </div>
  );
}

// A toolbar button keeps the editor's selection: the mousedown that would move focus off the page is cancelled.
const keepSelection = (event: MouseEvent) => event.preventDefault();

function Tool({ label, active, disabled, expanded, onClick, children }: { label: string; active?: boolean; disabled?: boolean; expanded?: boolean; onClick(): unknown; children: ReactNode }) {
  return (
    <button
      type="button"
      className="doc-tool"
      aria-label={label}
      title={label}
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
