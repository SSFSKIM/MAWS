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
import { memoryTargetOf, requestChipWidget, takePrefill, useComposerStore, type Prefill } from '../../stores/composer';
import { toast } from '../../stores/notices';
import { useTranscriptStore } from '../../transcript';
import { popupTakesKeys } from '../mentions/popup';
import { slashWidget } from '../mentions/widgets';
import { openWidgetDialog } from '../WidgetDialog'; // W3 (C6)
import { downscaleImage, fileBase64, imageRefusal, markPersisted } from './attachments';
import { atomId, attachmentsOf, docOf, emptyDoc, hardBreak, isMultiline, mentionNode, paragraph, pastedNode, textNode, type Attachment, type ComposerDoc } from './doc';
import { createDraftWriter, docOfDraft, isEmptyDoc, registerLiveDraft, type DraftWriter } from './drafts';
import type { EditorEnv } from './env';
import { closeSuggestions, suggesting } from './extensions';
import { historyNavigation, recallDoc, recallEntries, type HistoryNav, type Recall } from './history';
import { classifyFile, classifyText, mentionPath } from './paste';
import { mentionLabel, prefillToDoc } from './recall';
import { modeOf, serializeDraft, type Serialized } from './serialize';
import { submitSerialized } from './submit';

// Where the draft lives: C4's `session.drafts.*` by default; C10's intent on an unstarted session (M4 passes it).
export interface DraftPort {
  load(): Promise<Draft | null>;
  save(draft: Draft | null): void;
  // Whether an accepted submission clears the stored draft (C4's drafts: yes). C10's intent while unstarted: no, the
  // accepted first message is C10's to hold and the intent refuses a patch while its start runs (M4).
  clearsOnSend?(): boolean;
}

// A submission is asked for one way (W10): Enter and ⌘Enter, and the Composer's Send, reach the caller's `onSubmit`
// through the same path, which decides what it does (while a turn runs the Composer makes it a `next` steer).
export interface EditorHandle {
  focus(): void;
  submit(): void; // the submit control: as a key would (refused while one is in flight)
  insertText(text: string): void; // at the caret when focused, else at the end (C11's insertComposerText)
  doc(): ComposerDoc;
  serialize(): Serialized;
  clear(): void;
  removeAttachment(id: string): void;
  attachPicked(files: PickedFile[]): Promise<void>; // `layout.pickFiles`'s answer: bytes attach, a path is mentioned
  openSlash(): void; // the "+" menu's Slash commands: the palette at `/`
  openWidget(name: string, args?: string): boolean; // whether a widget is registered for the name (C11: `args`, default '')
  // R2: the engine's prompt requests on a plugin's behalf: the box as it stands (its text as sent, the caret at its end:
  // MAWS does not map the caret into the flattened text), a fill (`replace` the draft, `append` after it, `insert` at
  // the caret), and the placeholder redrawn after the suggestion changed
  promptBox(): { text: string; cursor: number };
  fill(text: string, mode: 'replace' | 'append' | 'insert'): boolean; // false while the draft is locked or disabled
  refreshPlaceholder(): void;
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
  onSubmit?(s: Serialized): Promise<boolean>;
  onPrefill?(prefill: Prefill): void;
  onDocChange?(doc: ComposerDoc): void;
  onEscape?(): boolean;
  onRestore?(doc: ComposerDoc): void; // a draft was restored into the editor
  suggestion?: string | null; // R2: a plugin's suggested prompt, the empty box's placeholder; Tab takes it
  onSuggestionTaken?(): void;
}

// The component's state the controller sets.
export interface ControllerView {
  setMode(mode: Serialized['mode']): void;
  setCommandEmpty(empty: boolean): void;
  setBusy(busy: boolean): void;
}

const HISTORY_LIMIT = 200;
const warn = (text: string) => void toast({ level: 'warning', text, actions: [], dismissible: true });

// C4's drafts, which need the session's index record: a session the index does not hold has no draft to restore, and
// its writes fail (said once per mount, not on every pause).
export function ipcDrafts(client: MawsBridge, appSessionId: AppSessionId): DraftPort {
  let warned = false;
  return {
    load: async () => {
      const result = await client.invoke('session.drafts.get', { appSessionId });
      return result.ok ? result.value : null;
    },
    save: (draft) =>
      void client.invoke('session.drafts.set', { appSessionId, draft }).then((result) => {
        if (result.ok || warned) return;
        warned = true;
        console.warn('[composer] session.drafts.set failed; the draft is not kept', result.error.message);
      }),
  };
}

// R2: plain text as a document (one paragraph a line) and as inline content (lines joined by hard breaks).
const textDoc = (text: string): ComposerDoc => docOf(text.split('\n').map((line) => paragraph(...(line ? [textNode(line)] : []))));
const inlineContent = (text: string) => text.split('\n').flatMap((line, i) => [...(i > 0 ? [hardBreak()] : []), ...(line ? [textNode(line)] : [])]);

// C11 start: how long Enter on a typed `/<widget> <args>` waits for the widget to decide before opening it
export const TYPED_DECIDE_MS = 300;
// C11 end

// A pending submission belongs to the session, not the mounted tab. A remount joins its outcome and locked document;
// only the initiating flight writes the stored draft, even if no editor remains mounted.
interface Submission { doc: ComposerDoc; done: Promise<boolean> }
const submissions = new Map<AppSessionId, Submission>();

export class EditorController {
  private inputs: ControllerInputs;
  private editor: TiptapEditor | null = null;
  private readonly writer: DraftWriter;
  private silent = false;
  private busy = false;
  private loaded = false;
  private revision = 0; // local edits and submission invalidate pending restoration
  private lifetime = 0;
  private live = false;
  private attachmentEpoch = 0;
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
      placeholder: this.inputs.suggestion ?? (followUp ? 'Ask a follow-up…' : 'Do anything'), // R2: a plugin's suggestion
      files: (files, at) => void this.addFiles(files, at),
      pasteText: (text) => this.pasteText(text),
      openWidget: (name, args) => void this.openWidget(name, args),
    };
  }

  // A registered widget opened where it belongs (W3): the selector's names in the model chip's menu, every other one as
  // the app's floating dialog, never in the box; false when none is registered.
  private openWidget(name: string, args: string): boolean {
    const widget = slashWidget(name);
    if (!widget) return false;
    if (widget.placement === 'modelChip') requestChipWidget(this.inputs.appSessionId, name, args);
    else openWidgetDialog(this.inputs.appSessionId, name, args);
    return true;
  }

  // ---- Tiptap's callbacks ---------------------------------------------------------------------------------------

  updated(editor: TiptapEditor, transaction: Transaction): void {
    const doc = editor.getJSON();
    const mode = modeOf(doc);
    this.view.setMode(mode);
    this.view.setCommandEmpty(mode === 'send' || serializeDraft(doc, { sessionId: null, cwd: '' }).empty);
    this.inputs.onDocChange?.(doc);
    if (this.silent || !transaction.docChanged) return;
    this.revision += 1;
    if (this.nav.index !== null) this.nav = historyNavigation(this.nav, 'edit', 0, doc).nav;
    this.writer.change(doc);
  }

  keyDown(view: EditorView, event: KeyboardEvent): boolean {
    const editor = this.editor;
    if (!editor) return false;
    if (event.defaultPrevented) return true; // C5's dispatcher ran a composer chord for this key (⌘Enter)
    if (event.isComposing || view.composing) return false;
    if (suggesting(editor) && popupTakesKeys(editor)) return false; // an open list takes Enter and the arrows
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (event.key === 'Enter' && plain) {
      if (isMultiline(editor.getJSON())) return false; // the line breaks (ProseMirror's own Enter); ⌘Enter sends
      void this.submit();
      return true;
    }
    // R2: Tab takes a plugin's suggestion into the empty box
    if (event.key === 'Tab' && plain && !this.busy && !submissions.has(this.inputs.appSessionId) && this.inputs.disabled === null && this.inputs.suggestion && isEmptyDoc(editor.getJSON())) {
      this.setDoc(textDoc(this.inputs.suggestion), { silently: false, caret: 'end' });
      this.inputs.onSuggestionTaken?.();
      return true;
    }
    if (event.key === 'ArrowUp' && plain) return this.history('up');
    if (event.key === 'ArrowDown' && plain) return this.history('down');
    if (event.key === 'Escape') return this.inputs.onEscape?.() ?? false;
    return false;
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------------

  // The draft is restored unless something was typed or prefilled first; a pending write is flushed on unmount.
  mount(): () => void {
    this.live = true;
    const lifetime = ++this.lifetime;
    const revision = this.revision;
    const off = registerLiveDraft(this.inputs.appSessionId, () => this.loaded || this.revision > 0 ? this.editor?.getJSON() : undefined);
    const flight = submissions.get(this.inputs.appSessionId);
    if (flight) {
      this.setDoc(flight.doc, { silently: true, caret: null });
      void this.followSubmission(flight);
    }
    void this.drafts.load().then((draft) => {
      if (!this.live || this.lifetime !== lifetime) return;
      const doc = docOfDraft(draft);
      if (this.revision === revision && !this.busy && doc && this.editor && isEmptyDoc(this.editor.getJSON())) {
        this.setDoc(doc, { silently: true, caret: null });
        this.inputs.onRestore?.(doc);
      }
      this.loaded = true;
    });
    void this.refreshHistory();
    return () => {
      this.live = false;
      this.attachmentEpoch += 1;
      off();
      this.writer.flush();
    };
  }

  // A prefill for this session (Edit prompt, edit-and-resubmit, C10's hand-back) replaces the document.
  takePrefill(): void {
    // Leave the replacement queued until the session-owned submission releases its document.
    if (this.busy || submissions.has(this.inputs.appSessionId)) return;
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

  async submit(): Promise<void> {
    const editor = this.editor;
    const { appSessionId, sessionId, cwd, disabled } = this.inputs;
    if (!editor || disabled !== null || this.busy || submissions.has(appSessionId)) return;
    const s = serializeDraft(editor.getJSON(), { sessionId, cwd });
    if (s.empty) return;
    this.revision += 1;
    this.attachmentEpoch += 1;
    // C11 start: a typed `/<name> <args>` naming a registered widget is the widget's (a registered widget wins over the
    // headless text path): an argument the widget resolves fully applies through the widget's own control path with no
    // widget shown, and otherwise the widget opens with its argument, as choosing the row does. The document and its
    // draft clear as a palette choice's do. Only a one-line document: a multi-line draft that starts with a widget's name
    // is a message, and sends as text.
    const plain =
      s.mode === 'send' && typeof s.content === 'string' && Object.keys(s.pastedContents).length === 0 && !isMultiline(editor.getJSON());
    const typed = plain ? /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(s.display.trim()) : null;
    const widget = typed ? slashWidget(typed[1]) : null;
    if (typed && widget) {
      this.writer.cancel();
      this.drafts.save(null);
      this.setDoc(emptyDoc(), { silently: true, caret: null });
      const args = typed[2] ?? '';
      const open = () => void this.openWidget(typed[1], args);
      if (!widget.apply || args.trim() === '') {
        open();
        return;
      }
      // The draft is gone already, so a decision that takes long (a catalogue read, up to its 8 s bound) opens the
      // widget after TYPED_DECIDE_MS instead of leaving nothing on screen, and `apply` is told it is too late to apply.
      const tooLate = new AbortController();
      let shown = false;
      const openOnce = () => {
        if (!shown) open();
        shown = true;
      };
      const timer = setTimeout(() => {
        tooLate.abort();
        openOnce();
      }, TYPED_DECIDE_MS);
      const decided = (applied: boolean) => {
        clearTimeout(timer);
        if (!applied) openOnce();
      };
      void widget.apply(appSessionId, args.trim(), tooLate.signal).then(decided, () => decided(false));
      return;
    }
    // C11 end
    const target = memoryTargetOf(useComposerStore.getState(), appSessionId);
    const doc = editor.getJSON();
    const onSubmit = this.inputs.onSubmit;
    this.writer.cancel(); // an unstarted session refuses draft writes while its start runs
    let settle!: (accepted: boolean) => void;
    const flight: Submission = { doc, done: new Promise((resolve) => { settle = resolve; }) };
    submissions.set(appSessionId, flight);
    const following = this.followSubmission(flight);
    let accepted = false;
    try {
      // Keep C10's synchronous start gate: it owns the first message before another event can close the tab.
      accepted = await (onSubmit ? onSubmit(s) : submitSerialized(this.client, appSessionId, s, 'send', target));
    } catch (error) {
      warn(error instanceof Error ? error.message : String(error));
    }
    if (accepted) {
      if (this.drafts.clearsOnSend?.() ?? true) this.drafts.save(null);
    } else {
      this.writer.change(doc);
      if (!this.live) this.writer.flush();
    }
    submissions.delete(appSessionId);
    settle(accepted);
    await following;
  }

  private async followSubmission(flight: Submission): Promise<void> {
    const lifetime = this.lifetime;
    const focused = this.editor?.isFocused;
    this.revision += 1;
    this.busy = true;
    this.view.setBusy(true);
    this.editor?.setEditable(false);
    const accepted = await flight.done;
    if (!this.live || this.lifetime !== lifetime) return;
    this.busy = false;
    this.view.setBusy(false);
    this.editor?.setEditable(this.inputs.disabled === null);
    if (accepted) {
      this.inputs.onSuggestionTaken?.();
      this.nav = { index: null, draft: null };
      this.setDoc(emptyDoc(), { silently: true, caret: focused ? 'end' : null });
      void this.refreshHistory();
    }
    this.takePrefill();
  }

  // Replaces the document; with a caret, also takes focus there at once (Tiptap's own focus waits a frame, and a key
  // pressed in that frame would land outside the editor).
  private setDoc(doc: ComposerDoc, options: { silently: boolean; caret: 'start' | 'end' | null }): void {
    const editor = this.editor;
    if (!editor) return;
    this.silent = options.silently;
    try {
      editor.commands.setContent(doc, { emitUpdate: true });
      // `setContent` replaces the content and keeps the document node's own attributes: the strip goes with it here
      editor.view.dispatch(editor.state.tr.setDocAttribute('attachments', attachmentsOf(doc)));
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

  private history(direction: 'up' | 'down'): boolean {
    const editor = this.editor!;
    const navigating = this.nav.index !== null;
    const doc = editor.getJSON();
    // ArrowUp from an empty editor starts; while recalling, both arrows move between entries (an edit ends it)
    if (direction === 'up' ? !navigating && !isEmptyDoc(doc) : !navigating) return false;
    if (!navigating) {
      const transcript = useTranscriptStore.getState();
      this.recalls = recallEntries(transcript.rows(this.inputs.appSessionId), transcript.activity(this.inputs.appSessionId), this.listed);
    }
    const next = historyNavigation(this.nav, direction, this.recalls.length, doc);
    this.nav = next.nav;
    if (next.show?.kind === 'entry') this.setDoc(recallDoc(this.recalls[next.show.index]), { silently: true, caret: 'end' });
    else if (next.show?.kind === 'draft') this.setDoc(next.show.doc, { silently: true, caret: 'end' });
    // The caret sits at the end of what is shown, where a recalled `/compact` would open the palette and take the next
    // arrow and Enter from the walk: a recall opens no popup.
    if (next.show) closeSuggestions(editor);
    return next.show !== null || navigating;
  }

  private pasteText(text: string): boolean {
    const editor = this.editor;
    if (!editor || classifyText(text) === 'inline') return false;
    this.insertPasted(text, 'Pasted text #1'); // the chip shows its place in the document
    return true;
  }

  private insertPasted(text: string, name: string): void {
    if (this.busy) return;
    this.editor
      ?.chain()
      .focus()
      .insertContent(pastedNode({ id: atomId('pasted'), kind: 'text', name, lines: text.split('\n').length, text }))
      .run();
  }

  private insertMention(path: string): void {
    if (this.busy) return;
    const id = mentionPath(path, this.inputs.cwd);
    this.editor
      ?.chain()
      .focus()
      .insertContent([mentionNode({ id, label: mentionLabel(id), kind: 'file' }), textNode(' ')])
      .run();
  }

  private setAttachments(next: Attachment[]): void {
    if (this.busy) return;
    const editor = this.editor;
    if (editor) editor.view.dispatch(editor.state.tr.setDocAttribute('attachments', markPersisted(next)));
  }

  private addAttachment(attachment: Attachment): void {
    if (this.editor) this.setAttachments([...attachmentsOf(this.editor.getJSON()), attachment]);
  }

  private async attachImage(name: string, blob: Blob, mediaType: string, epoch: number): Promise<void> {
    try {
      const out = await downscaleImage(blob, mediaType);
      if (!this.live || this.busy || this.attachmentEpoch !== epoch) return;
      const refusal = imageRefusal(name, out.bytes);
      if (refusal) return warn(refusal);
      this.addAttachment({ id: atomId('attachment'), kind: 'image', name, mediaType: out.mediaType, bytes: out.bytes, data: out.data, persisted: true });
    } catch {
      warn(`${name} could not be read as an image`);
    }
  }

  // `at`: the document position a drop landed on (FileHandler answers 0 when it could not tell, never a place a chip
  // can go, so the caret stays where it is then); mentions and read-in text go there, attachments to the strip.
  async addFiles(files: File[], at?: number): Promise<void> {
    if (this.busy || !this.live) return;
    const epoch = this.attachmentEpoch;
    if (at !== undefined && at > 0 && this.editor) this.editor.commands.setTextSelection(at);
    for (const file of files) {
      if (!this.live || this.busy || this.attachmentEpoch !== epoch) return;
      const action = classifyFile(file, this.client.pathForFile(file));
      if (action.kind === 'image') await this.attachImage(file.name, file, file.type, epoch);
      else if (action.kind === 'pdf') {
        const data = await fileBase64(file);
        if (!this.live || this.busy || this.attachmentEpoch !== epoch) return;
        this.addAttachment({ id: atomId('attachment'), kind: 'document', name: file.name, mediaType: 'application/pdf', bytes: file.size, data, persisted: true });
      } else if (action.kind === 'mention') this.insertMention(action.path);
      else if (action.kind === 'text') {
        const text = await file.text();
        if (!this.live || this.busy || this.attachmentEpoch !== epoch) return;
        this.insertPasted(text, file.name);
      } else warn(action.reason);
    }
  }


  handle(): EditorHandle {
    const editor = () => this.editor!;
    return {
      focus: () => void editor().commands.focus(),
      submit: () => void this.submit(),
      insertText: (text) => {
        if (this.busy) return;
        if (editor().isFocused) editor().chain().insertContent(text).run();
        else editor().chain().focus('end').insertContent(text).run();
      },
      doc: () => editor().getJSON(),
      serialize: () => serializeDraft(editor().getJSON(), { sessionId: this.inputs.sessionId, cwd: this.inputs.cwd }),
      clear: () => { if (!this.busy) this.setDoc(emptyDoc(), { silently: false, caret: null }); },
      removeAttachment: (id) => this.setAttachments(attachmentsOf(editor().getJSON()).filter((a) => a.id !== id)),
      attachPicked: async (files) => {
        if (this.busy || !this.live) return;
        const epoch = this.attachmentEpoch;
        for (const file of files) {
          if (!this.live || this.busy || this.attachmentEpoch !== epoch) return;
          if (file.data === null) this.insertMention(file.path);
          else if (file.mediaType === 'application/pdf')
            this.addAttachment({ id: atomId('attachment'), kind: 'document', name: file.name, mediaType: 'application/pdf', bytes: file.bytes, data: file.data, persisted: true });
          else {
            const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
            await this.attachImage(file.name, new Blob([bytes], { type: file.mediaType ?? '' }), file.mediaType ?? '', epoch);
          }
        }
      },
      openSlash: () => { if (!this.busy) editor().chain().focus().insertContentAt(1, '/').run(); },
      openWidget: (name, args = '' /* C11: the argument a widget opens with */) => this.openWidget(name, args),
      // R2
      promptBox: () => {
        const text = serializeDraft(editor().getJSON(), { sessionId: this.inputs.sessionId, cwd: this.inputs.cwd }).display;
        return { text, cursor: text.length };
      },
      fill: (text, mode) => {
        if (this.busy || submissions.has(this.inputs.appSessionId) || this.inputs.disabled !== null) return false;
        this.revision += 1; // even replacing an empty box with empty text supersedes a pending draft restore
        if (mode === 'replace') this.setDoc(textDoc(text), { silently: false, caret: 'end' });
        else if (mode === 'append') editor().chain().focus('end').insertContent(inlineContent(text)).run();
        else editor().chain().focus().insertContent(inlineContent(text)).run();
        return true;
      },
      refreshPlaceholder: () => {
        const view = editor().view;
        view.dispatch(view.state.tr.setMeta('placeholder', true)); // the placeholder's decoration is read again
      },
    };
  }
}
