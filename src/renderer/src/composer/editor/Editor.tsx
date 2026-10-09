// The composer's editor (C7 execution document, M3): the Tiptap instance with its keys, draft, history, paste and drop,
// the `@` menu and `/` palette, the `!` and `#` decoration and the prefill intake (the behaviour is `controller.ts`'s).
// The root is the one element that carries `data-key-sink="composer"` (with the popups it portals), so C5's dispatcher
// delivers the composer's chords here (⌘Enter sends; W10: no ⌥Enter) and never a pane's Enter or Esc. Enter sends a
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
import { useRegisteredWidgets } from '../mentions/widgets';
import { ModeChrome } from '../modes/ModeChrome';
import { EditorController, ipcDrafts, type ControllerInputs, type DraftPort, type EditorHandle } from './controller';
import { emptyDoc, type ComposerDoc } from './doc';
import { composerExtensions } from './extensions';
import type { Serialized } from './serialize';

export type { DraftPort, EditorHandle };

export interface EditorProps {
  appSessionId: AppSessionId;
  cwd: string;
  additionalDirectories?: readonly string[];
  sessionId: string | null; // the engine session id, for the pasted tags' id
  disabled?: string | null; // read-only, for this reason
  drafts?: DraftPort;
  // What a submission does, and whether it was accepted (the editor then clears and drops the draft). Given, the
  // editor dispatches nothing itself, so the Composer decides through its submit state (W10: while a turn runs a Send
  // is a `next` steer); absent, the default (`submitSerialized`) sends.
  onSubmit?(s: Serialized): Promise<boolean>;
  onPrefill?(prefill: Prefill): void; // a prefill the editor took (the Composer keeps its `editing`)
  onDocChange?(doc: ComposerDoc): void;
  onEscape?(): boolean;
  onRestore?(doc: ComposerDoc): void; // a stored draft was restored
  suggestion?: string | null; // R2: a plugin's suggested prompt, shown as the empty box's placeholder; Tab takes it
  onSuggestionTaken?(): void;
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
    suggestion: props.suggestion ?? null, // R2
    onSuggestionTaken: props.onSuggestionTaken,
  };
  const [controller] = useState(() => new EditorController(client, props.drafts ?? ipcDrafts(client, appSessionId), { setMode, setCommandEmpty, setBusy }, inputs));
  useLayoutEffect(() => controller.update(inputs));

  // Options that never change, so Tiptap's per-render comparison leaves the instance alone (a fresh extension list or
  // props object on every render would have it reapply its options, and its view props, on every keystroke).
  const [options] = useState(() => ({
    extensions: composerExtensions(() => controller.env()),
    content: emptyDoc(),
    immediatelyRender: true,
    editorProps: {
      attributes: { 'aria-label': 'Message', 'aria-multiline': 'true', role: 'textbox', class: 'min-h-5 px-1 outline-none' }, // W2: one 20px line at rest
      handleKeyDown: (view: EditorView, event: KeyboardEvent) => controller.keyDown(view, event),
    },
  }));
  const editor = useEditor({ ...options, onUpdate: ({ editor: e, transaction }) => controller.updated(e, transaction), onBlur: () => controller.blurred() });
  useLayoutEffect(() => controller.attach(editor), [controller, editor]);
  useEffect(() => controller.mount(), [controller, editor]);
  useEffect(() => controller.setDisabled(disabled), [controller, editor, disabled]);

  const prefill = useComposerStore((s) => s.prefills.get(appSessionId) ?? null);
  useEffect(() => {
    if (prefill) controller.takePrefill();
  }, [controller, editor, prefill]);

  useKeyChord('composer.send', () => void controller.submit(), { within: rootRef });
  useImperativeHandle(props.handle, () => controller.handle(), [controller]);

  // W3 (C6): a widget the palette opens is the app's floating dialog (`WidgetDialog.tsx`), never in the box
  return (
    <>
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
        {/* W2 (C1, Codex's): the prose's size on a 20px line, growing to a quarter of the window before it scrolls */}
        <EditorContent editor={editor} className={`max-h-[25vh] overflow-y-auto text-prose leading-5 text-fg ${mode === 'bash' ? 'font-mono' : ''} ${PLACEHOLDER}`} />
      </div>
    </>
  );
}
