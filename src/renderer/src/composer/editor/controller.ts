// The editor's behaviour over its Tiptap instance (C7 execution document, M3), kept out of React's render: the keys, the
// draft's restore and debounced write, history navigation, pasted and dropped files, the prefill intake, submission,
// and the imperative handle the Composer drives. One controller per mounted Editor, created once; the component hands
// it the latest props after every render, so the handlers Tiptap captured at creation always act on the current ones.
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { HistoryEntry } from '@shared/composer/history-entry';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { PickedFile } from '@shared/ipc/schema/layout';
import type { Draft } from '@shared/ipc/schema/session';
import { EMPTY_CATALOG, type SessionCatalog } from '../../stores/catalog';
import { memoryTargetOf, takePrefill, useComposerStore, type Prefill } from '../../stores/composer';
import { toast } from '../../stores/notices';
import { useTranscriptStore } from '../../transcript';
import { slashWidget } from '../mentions/widgets';
import { downscaleImage, fileBase64, imageRefusal, markPersisted } from './attachments';
import { atomId, attachmentsOf, emptyDoc, mentionNode, PASTED, pastedNode, textNode, type Attachment, type ComposerDoc } from './doc';
import { createDraftWriter, docOfDraft, isEmptyDoc, type DraftWriter } from './drafts';
import type { EditorEnv } from './env';
import { suggesting } from './extensions';
import { historyNavigation, recallDoc, recallEntries, type HistoryNav, type Recall } from './history';
import { classifyFile, classifyText, mentionPath } from './paste';
import { mentionLabel, prefillToDoc } from './recall';
import { modeOf, serializeDraft, type Serialized } from './serialize';
import { submitSerialized } from './submit';

// Where the draft lives: C4's `session.drafts.*` by default; C10's intent on an unstarted session (M4 passes it).
export interface DraftPort {
  load(): Promise<Draft | null>;
  save(draft: Draft | null): void;
}

export interface EditorHandle {
  focus(): void;
  insertText(text: string): void; // at the caret when focused, else at the end (C11's insertComposerText)
  doc(): ComposerDoc;
  serialize(): Serialized;
  clear(): void;
  removeAttachment(id: string): void;
  attachPicked(files: PickedFile[]): Promise<void>; // `layout.pickFiles`'s answer: bytes attach, a path is mentioned
  openSlash(): void; // the "+" menu's Slash commands: the palette at `/`
  openWidget(name: string): boolean; // whether a widget is registered for the name
}

// What the controller reads from the component, refreshed after every render.
export interface ControllerInputs {
  appSessionId: AppSessionId;
  cwd: string;
  additionalDirectories: readonly string[];
  sessionId: string | null;
  disabled: string | null;
  catalog: SessionCatalog;
  widgets: ReadonlySet<string>;
  followUp: boolean;
  onSubmit?(s: Serialized, how: 'send' | 'steer'): Promise<boolean>;
  onPrefill?(prefill: Prefill): void;
  onDocChange?(doc: ComposerDoc): void;
  onEscape?(): boolean;
}

// The component's state the controller sets.
export interface ControllerView {
  setMode(mode: Serialized['mode']): void;
  setCommandEmpty(empty: boolean): void;
  setWidget(widget: { name: string; args: string } | null): void;
  setBusy(busy: boolean): void;
}

const HISTORY_LIMIT = 200;
const warn = (text: string) => void toast({ level: 'warning', text, actions: [], dismissible: true });
const pastedCount = (doc: ComposerDoc) => (doc.content ?? []).flatMap((p) => p.content ?? []).filter((n) => n.type === PASTED).length;

export function ipcDrafts(client: MawsBridge, appSessionId: AppSessionId): DraftPort {
  return {
    load: async () => {
      const result = await client.invoke('session.drafts.get', { appSessionId });
      return result.ok ? result.value : null; // a session with no record has no draft to restore
    },
    save: (draft) =>
      void client.invoke('session.drafts.set', { appSessionId, draft }).then((result) => {
        if (!result.ok) console.warn('[composer] session.drafts.set failed', result.error.message);
      }),
  };
}

// The caret is on the first (or last) visual line of the first (or last) paragraph.
function atEdge(view: EditorView, direction: 'up' | 'down'): boolean {
  const { $from } = view.state.selection;
  const index = $from.index(0);
  const edgeParagraph = direction === 'up' ? index === 0 : index === view.state.doc.childCount - 1;
  return edgeParagraph && view.endOfTextblock(direction);
}

export class EditorController {
  private inputs: ControllerInputs;
  private editor: TiptapEditor | null = null;
  private readonly writer: DraftWriter;
  private silent = false;
  private busy = false;
  private nav: HistoryNav = { index: null, draft: null };
  private recalls: Recall[] = [];
  private listed: HistoryEntry[] = [];

  constructor(
    private readonly client: MawsBridge,
    private readonly drafts: DraftPort,
    private readonly view: ControllerView,
    inputs: ControllerInputs,
  ) {
    this.inputs = inputs;
    this.writer = createDraftWriter((draft) => this.drafts.save(draft));
  }

  update(inputs: ControllerInputs): void {
    this.inputs = inputs;
  }

  attach(editor: TiptapEditor): void {
    this.editor = editor;
  }

  env(): EditorEnv {
    const { appSessionId, cwd, additionalDirectories, catalog, widgets, followUp } = this.inputs;
    return {
      appSessionId,
      cwd,
      additionalDirectories,
      catalog: catalog ?? EMPTY_CATALOG,
      widgets,
      placeholder: followUp ? 'Ask a follow-up…' : 'Do anything',
      files: (files) => void this.addFiles(files),
      pasteText: (text) => this.pasteText(text),
      openWidget: (name, args) => {
        if (slashWidget(name)) this.view.setWidget({ name, args });
      },
    };
  }

  // ---- Tiptap's callbacks ---------------------------------------------------------------------------------------

  updated(editor: TiptapEditor, transaction: Transaction): void {
    const doc = editor.getJSON();
    const mode = modeOf(doc);
    this.view.setMode(mode);
    this.view.setCommandEmpty(mode === 'send' || serializeDraft(doc, { sessionId: null, cwd: '' }).empty);
    this.inputs.onDocChange?.(doc);
    if (this.silent || !transaction.docChanged) return;
    if (this.nav.index !== null) this.nav = historyNavigation(this.nav, 'edit', 0, doc).nav;
    this.writer.change(doc);
  }

  keyDown(view: EditorView, event: KeyboardEvent): boolean {
    const editor = this.editor;
    if (!editor) return false;
    if (event.defaultPrevented) return true; // C5's dispatcher ran a composer chord for this key (⌘Enter, ⌥Enter)
    if (event.isComposing || view.composing) return false;
    if (suggesting(editor)) return false;
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (event.key === 'Enter' && plain) {
      void this.submit('send');
      return true;
    }
    if (event.key === 'ArrowUp' && plain) return this.history(view, 'up');
    if (event.key === 'ArrowDown' && plain) return this.history(view, 'down');
    if (event.key === 'Escape') return this.inputs.onEscape?.() ?? false;
    return false;
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------------

  // The draft is restored unless something was typed or prefilled first; a pending write is flushed on unmount.
  mount(): () => void {
    let live = true;
    void this.drafts.load().then((draft) => {
      const doc = docOfDraft(draft);
      if (live && doc && this.editor && isEmptyDoc(this.editor.getJSON())) this.setDoc(doc, { silently: true, caret: null });
    });
    void this.refreshHistory();
    return () => {
      live = false;
      this.writer.flush();
    };
  }

  // A prefill for this session (Edit prompt, edit-and-resubmit, C10's hand-back) replaces the document.
  takePrefill(): void {
    const taken = takePrefill(this.inputs.appSessionId);
    if (!taken) return;
    this.nav = { index: null, draft: null };
    this.setDoc(prefillToDoc(taken), { silently: false, caret: 'end' });
    this.inputs.onPrefill?.(taken);
  }

  setDisabled(disabled: string | null): void {
    if (!this.busy) this.editor?.setEditable(disabled === null);
  }

  // ---- behaviour ------------------------------------------------------------------------------------------------

  async submit(how: 'send' | 'steer'): Promise<void> {
    const editor = this.editor;
    const { appSessionId, sessionId, cwd, disabled } = this.inputs;
    if (!editor || disabled !== null || this.busy) return;
    const s = serializeDraft(editor.getJSON(), { sessionId, cwd });
    if (s.empty) return;
    const target = memoryTargetOf(useComposerStore.getState(), appSessionId);
    const focused = editor.isFocused; // read-only while in flight drops focus; it comes back with the cleared editor
    this.busy = true;
    this.view.setBusy(true);
    editor.setEditable(false);
    let accepted: boolean;
    try {
      accepted = await (this.inputs.onSubmit ? this.inputs.onSubmit(s, how) : submitSerialized(this.client, appSessionId, s, how, target));
    } finally {
      this.busy = false;
      this.view.setBusy(false);
      editor.setEditable(this.inputs.disabled === null);
    }
    if (!accepted) return;
    this.writer.cancel();
    this.drafts.save(null);
    this.nav = { index: null, draft: null };
    this.setDoc(emptyDoc(), { silently: true, caret: focused ? 'end' : null });
    void this.refreshHistory();
  }

  // Replaces the document; with a caret, also takes focus there at once (Tiptap's own focus waits a frame, and a key
  // pressed in that frame would land outside the editor).
  private setDoc(doc: ComposerDoc, options: { silently: boolean; caret: 'start' | 'end' | null }): void {
    const editor = this.editor;
    if (!editor) return;
    this.silent = options.silently;
    try {
      editor.commands.setContent(doc, { emitUpdate: true });
    } finally {
      this.silent = false;
    }
    if (options.caret === null) return;
    editor.commands.focus(options.caret);
    editor.view.focus();
  }

  private async refreshHistory(): Promise<void> {
    const result = await this.client.invoke('session.history.list', { appSessionId: this.inputs.appSessionId, limit: HISTORY_LIMIT });
    if (result.ok) this.listed = result.value.entries;
  }

  private history(view: EditorView, direction: 'up' | 'down'): boolean {
    const editor = this.editor!;
    const navigating = this.nav.index !== null;
    const doc = editor.getJSON();
    if (direction === 'up' ? !navigating && !isEmptyDoc(doc) : !navigating) return false;
    if (navigating && !atEdge(view, direction)) return false;
    if (!navigating) {
      const transcript = useTranscriptStore.getState();
      this.recalls = recallEntries(transcript.rows(this.inputs.appSessionId), transcript.activity(this.inputs.appSessionId), this.listed);
    }
    const next = historyNavigation(this.nav, direction, this.recalls.length, doc);
    this.nav = next.nav;
    // The caret goes where the next press continues the walk: to the start going back, to the end going forward.
    const caret = direction === 'up' ? 'start' : 'end';
    if (next.show?.kind === 'entry') this.setDoc(recallDoc(this.recalls[next.show.index]), { silently: true, caret });
    else if (next.show?.kind === 'draft') this.setDoc(next.show.doc, { silently: true, caret });
    return next.show !== null || navigating;
  }

  private pasteText(text: string): boolean {
    const editor = this.editor;
    if (!editor || classifyText(text) === 'inline') return false;
    this.insertPasted(text, `Pasted text #${pastedCount(editor.getJSON()) + 1}`);
    return true;
  }

  private insertPasted(text: string, name: string): void {
    this.editor
      ?.chain()
      .focus()
      .insertContent(pastedNode({ id: atomId('pasted'), kind: 'text', name, lines: text.split('\n').length, text }))
      .run();
  }

  private insertMention(path: string): void {
    const id = mentionPath(path, this.inputs.cwd);
    this.editor
      ?.chain()
      .focus()
      .insertContent([mentionNode({ id, label: mentionLabel(id), kind: 'file' }), textNode(' ')])
      .run();
  }

  private setAttachments(next: Attachment[]): void {
    const editor = this.editor;
    if (editor) editor.view.dispatch(editor.state.tr.setDocAttribute('attachments', markPersisted(next)));
  }

  private addAttachment(attachment: Attachment): void {
    if (this.editor) this.setAttachments([...attachmentsOf(this.editor.getJSON()), attachment]);
  }

  private async attachImage(name: string, blob: Blob, mediaType: string): Promise<void> {
    try {
      const out = await downscaleImage(blob, mediaType);
      const refusal = imageRefusal(name, out.bytes);
      if (refusal) return warn(refusal);
      this.addAttachment({ id: atomId('attachment'), kind: 'image', name, mediaType: out.mediaType, bytes: out.bytes, data: out.data, persisted: true });
    } catch {
      warn(`${name} could not be read as an image`);
    }
  }

  async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const action = classifyFile(file, this.client.pathForFile(file));
      if (action.kind === 'image') await this.attachImage(file.name, file, file.type);
      else if (action.kind === 'pdf')
        this.addAttachment({ id: atomId('attachment'), kind: 'document', name: file.name, mediaType: 'application/pdf', bytes: file.size, data: await fileBase64(file), persisted: true });
      else if (action.kind === 'mention') this.insertMention(action.path);
      else if (action.kind === 'text') this.insertPasted(await file.text(), file.name);
      else warn(action.reason);
    }
  }

  handle(): EditorHandle {
    const editor = () => this.editor!;
    return {
      focus: () => void editor().commands.focus(),
      insertText: (text) => {
        if (editor().isFocused) editor().chain().insertContent(text).run();
        else editor().chain().focus('end').insertContent(text).run();
      },
      doc: () => editor().getJSON(),
      serialize: () => serializeDraft(editor().getJSON(), { sessionId: this.inputs.sessionId, cwd: this.inputs.cwd }),
      clear: () => this.setDoc(emptyDoc(), { silently: false, caret: null }),
      removeAttachment: (id) => this.setAttachments(attachmentsOf(editor().getJSON()).filter((a) => a.id !== id)),
      attachPicked: async (files) => {
        for (const file of files) {
          if (file.data === null) this.insertMention(file.path);
          else if (file.mediaType === 'application/pdf')
            this.addAttachment({ id: atomId('attachment'), kind: 'document', name: file.name, mediaType: 'application/pdf', bytes: file.bytes, data: file.data, persisted: true });
          else {
            const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
            await this.attachImage(file.name, new Blob([bytes], { type: file.mediaType ?? '' }), file.mediaType ?? '');
          }
        }
      },
      openSlash: () => void editor().chain().focus().insertContentAt(1, '/').run(),
      openWidget: (name) => {
        if (!slashWidget(name)) return false;
        this.view.setWidget({ name, args: '' });
        return true;
      },
    };
  }
}
