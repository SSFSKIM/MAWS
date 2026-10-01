// The composer's editor (C7 execution document, M3): the Tiptap instance with its keys, draft, history, paste and drop,
// the `@` menu and `/` palette, the `!` and `#` decoration and the prefill intake (the behaviour is `controller.ts`'s).
// The root is the one element that carries `data-key-sink="composer"` (with the popups it portals), so C5's dispatcher
// delivers the composer's chords here (⌘Enter sends, ⌥Enter holds: W1) and never a pane's Enter or Esc. Enter sends a
// one-line document and breaks the line once there are more (§5.8), Shift+Enter breaks the line, a composing IME key
// never sends; ArrowUp on an empty editor (or while recalling) walks
// history. Mount one Editor per session (key it by the session): its draft and history are that session's. What a
// submission does is the caller's (`onSubmit`); the default dispatches by mode (`submit.ts`). The frame around it, the
// attachment strip and the submit control are the Composer's (M4), which drives the editor through its handle.
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { useKeyChord } from '../../keymap/useKeyChord';
import { useSessionCatalog } from '../../stores/catalog';
import { useComposerStore, type Prefill } from '../../stores/composer';
import { useTranscriptStore } from '../../transcript';
import { slashWidget, useRegisteredWidgets } from '../mentions/widgets';
import { ModeChrome } from '../modes/ModeChrome';
import { EditorController, ipcDrafts, type ControllerInputs, type DraftPort, type EditorHandle, type SubmitHow } from './controller';
import { emptyDoc, type ComposerDoc } from './doc';
import { composerExtensions } from './extensions';
import type { Serialized } from './serialize';

export type { DraftPort, EditorHandle, SubmitHow };

export interface EditorProps {
  appSessionId: AppSessionId;
  cwd: string;
  additionalDirectories?: readonly string[];
  sessionId: string | null; // the engine session id, for the pasted tags' id
  disabled?: string | null; // read-only, for this reason
  drafts?: DraftPort;
  // What a submission does, and whether it was accepted (the editor then clears and drops the draft). `how` is the
  // chord: 'send' for Enter and ⌘Enter, 'hold' for ⌥Enter (the handle's `submit` adds the caret menu's). Given, the editor dispatches nothing itself, so the
  // Composer maps the chord through its submit state (W1: Enter while a turn runs is a `next` steer, ⌥Enter with no
  // turn open is a Send); absent, the default (`submitSerialized`) sends, or steers with priority 'next' for 'queue'.
  onSubmit?(s: Serialized, how: SubmitHow): Promise<boolean>;
  onPrefill?(prefill: Prefill): void; // a prefill the editor took (the Composer keeps its `editing`)
  onDocChange?(doc: ComposerDoc): void;
  onEscape?(): boolean;
  onRestore?(doc: ComposerDoc): void; // a stored draft was restored
  handle?: Ref<EditorHandle>;
  client?: MawsBridge;
}

const NO_DIRECTORIES: readonly string[] = [];
const PLACEHOLDER = [
  '[&_.is-editor-empty:first-child]:before:pointer-events-none',
  '[&_.is-editor-empty:first-child]:before:float-left',
  '[&_.is-editor-empty:first-child]:before:h-0',
  '[&_.is-editor-empty:first-child]:before:text-fg-faint',
  '[&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
].join(' ');

export function Editor(props: EditorProps) {
  const { appSessionId, cwd, sessionId, disabled = null, client = ipc } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const catalog = useSessionCatalog(appSessionId, client);
  const widgets = useRegisteredWidgets();
  const followUp = useTranscriptStore((s) => (s.entries[appSessionId]?.rows ?? []).some((r) => r.kind === 'user'));
  const [mode, setMode] = useState<Serialized['mode']>('send');
  const [commandEmpty, setCommandEmpty] = useState(true);
  const [widget, setWidget] = useState<{ name: string; args: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(0);

  const inputs: ControllerInputs = {
    appSessionId,
    cwd,
    additionalDirectories: props.additionalDirectories ?? NO_DIRECTORIES,
    sessionId,
    disabled,
    catalog,
    widgets,
    followUp,
    onSubmit: props.onSubmit,
    onPrefill: props.onPrefill,
    onDocChange: props.onDocChange,
    onEscape: props.onEscape,
    onRestore: props.onRestore,
  };
  const [controller] = useState(() => new EditorController(client, props.drafts ?? ipcDrafts(client, appSessionId), { setMode, setCommandEmpty, setWidget, setBusy }, inputs));
  useLayoutEffect(() => controller.update(inputs));

  // Options that never change, so Tiptap's per-render comparison leaves the instance alone (a fresh extension list or
  // props object on every render would have it reapply its options, and its view props, on every keystroke).
  const [options] = useState(() => ({
    extensions: composerExtensions(() => controller.env()),
    content: emptyDoc(),
    immediatelyRender: true,
    editorProps: {
      attributes: { 'aria-label': 'Message', 'aria-multiline': 'true', role: 'textbox', class: 'min-h-6 px-1 py-0.5 outline-none' },
      handleKeyDown: (view: EditorView, event: KeyboardEvent) => controller.keyDown(view, event),
    },
  }));
  const editor = useEditor({ ...options, onUpdate: ({ editor: e, transaction }) => controller.updated(e, transaction) });
  useLayoutEffect(() => controller.attach(editor), [controller, editor]);
  useEffect(() => controller.mount(), [controller, editor]);
  useEffect(() => controller.setDisabled(disabled), [controller, editor, disabled]);

  const prefill = useComposerStore((s) => s.prefills.get(appSessionId) ?? null);
  useEffect(() => {
    if (prefill) controller.takePrefill();
  }, [controller, editor, prefill]);

  useKeyChord('composer.send', () => void controller.submit('send'), { within: rootRef });
  useKeyChord('composer.steer', () => void controller.submit('hold'), { within: rootRef }); // W1: ⌥Enter holds until the turn ends (the action id predates W1; overrides are keyed by it)
  useImperativeHandle(props.handle, () => controller.handle(), [controller]);

  const open = widget ? slashWidget(widget.name) : null;
  const Widget = open?.component;
  return (
    <>
      {open && Widget && widget ? (
        <section aria-label={open.title} className="mb-2 rounded-md border border-border bg-bg-raised p-2 text-ui">
          <Widget appSessionId={appSessionId} args={widget.args} close={() => setWidget(null)} />
        </section>
      ) : null}
      <div
        ref={rootRef}
        data-key-sink="composer"
        data-mode={mode}
        aria-busy={busy || undefined}
        className={`relative min-w-0 rounded-sm ${dragging > 0 ? 'ring-2 ring-accent' : ''}`}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) setDragging((n) => n + 1);
        }}
        onDragLeave={() => setDragging((n) => Math.max(0, n - 1))}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          setDragging(0);
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          void controller.addFiles([...event.dataTransfer.files]);
        }}
      >
        <ModeChrome appSessionId={appSessionId} mode={mode} empty={commandEmpty} />
        <EditorContent editor={editor} className={`max-h-44 overflow-y-auto text-ui text-fg ${mode === 'bash' ? 'font-mono' : ''} ${PLACEHOLDER}`} />
      </div>
    </>
  );
}
