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
import { closeInterim, dictationStart, inlineFragment, interimOf, needsLeadingSpace, openInterim, replaceInterim, settleFinal, syncSelectionFromDOM } from './dictation-plugin'; // E9
import { createDraftWriter, docOfDraft, isEmptyDoc, registerLiveDraft, type DraftWriter } from './drafts';
import type { EditorEnv } from './env';
import { closeSuggestions, suggesting } from './extensions';
import { historyNavigation, recallDoc, recallEntries, type HistoryNav, type Recall } from './history';
import { classifyFile, classifyText, mentionPath } from './paste';
import { mentionLabel, prefillToDoc } from './recall';
import { modeOf, plainTextOf, serializeDraft, type Serialized } from './serialize';
import { submitSerialized } from './submit';

// Where the draft lives: C4's `session.drafts.*` by default; C10's intent on an unstarted session (M4 passes it).
export interface DraftPort {
  load(): Promise<Draft | null>;
  save(draft: Draft | null): void;
  // Whether an accepted submission clears the stored draft (C4's drafts: yes). C10's intent while unstarted: no, the
  // accepted first message is C10's to hold and the intent refuses a patch while its start runs (M4).
  clearsOnSend?(): boolean;
}

// P3-G: `separated` text (Mark-up's label) gets a space before it when it would otherwise join the text before the caret
// (a word or a chip), and none at the start of a line, after whitespace or after a line break (dictation's rule).
export interface InsertOptions {
  separated?: boolean;
}

// A submission is asked for one way (W10): Enter and ⌘Enter, and the Composer's Send, reach the caller's `onSubmit`
// through the same path, which decides what it does (while a turn runs the Composer makes it a `next` steer).
export interface EditorHandle {
  focus(): void;
  submit(): void; // the submit control: as a key would (refused while one is in flight)
  insertText(text: string, options?: InsertOptions): void; // at the caret, the one it left when not focused, else at the end (C11's insertComposerText)
  doc(): ComposerDoc;
  serialize(): Serialized;
  clear(): void;
  removeAttachment(id: string): void;
  attachPicked(files: PickedFile[]): Promise<void>; // `layout.pickFiles`'s answer: bytes attach, a path is mentioned
  // P3-G (§D4.3): as a drop of the files at the caret, once the stored draft is restored (Mark-up's Add to chat, the
  // composer store's attachment queue); whether the editor took them (false while busy, or once unmounted)
  attachFiles(files: File[]): Promise<boolean>;
  openSlash(): void; // the "+" menu's Slash commands: the palette at `/`
  openWidget(name: string, args?: string): boolean; // whether a widget is registered for the name (C11: `args`, default '')
  // R2: the engine's prompt requests on a plugin's behalf: the box as it stands (its text as sent, the caret at its end:
  // MAWS does not map the caret into the flattened text), a fill (`replace` the draft, `append` after it, `insert` at
  // the caret), and the placeholder redrawn after the suggestion changed
  promptBox(): { text: string; cursor: number };
  fill(text: string, mode: 'replace' | 'append' | 'insert'): boolean; // false while the draft is locked or disabled
  refreshPlaceholder(): void;
  // E9: a dictation's words at the caret (Design §7); null while busy or disabled. `onEnded` fires once when the editor
  // ends the sink itself (an edit inside the words, a submission, a replaced document, disabled, unmounted, or
  // `settleDictation`); the sink's own `final` and `cancel` do not fire it.
  beginDictation(onEnded: () => void): DictationSink | null;
  settleDictation(): void; // the interim words become ordinary text where they stand and the sink ends (a card covered the box)
}

// E9: what one capture writes through; every method is a no-op once the sink ended.
export interface DictationSink {
  partial(text: string): void;
  final(text: string): void;
  cancel(): void;
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

// E3 start: the composer's refusals of a `/btw` draft it will not ask (submit below)
const BTW_UNAVAILABLE = 'Side questions are not available here';
const BTW_TEXT_ONLY = 'Side questions take text only; remove the attachment';
// E3 end

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

// E9: the open dictation sink's bookkeeping.
interface Dictation { ended: boolean; onEnded(): void }

export class EditorController {
  private inputs: ControllerInputs;
  private editor: TiptapEditor | null = null;
  private readonly writer: DraftWriter;
  private silent = false;
  private busy = false;
  private loaded = false;
  private restoring: Promise<void> = Promise.resolve(); // P3-G: this mount's draft restoration
  private revision = 0; // local edits and submission invalidate pending restoration
  private lifetime = 0;
  private live = false;
  private attachmentEpoch = 0;
  private nav: HistoryNav = { index: null, draft: null };
  private recalls: Recall[] = [];
  private listed: HistoryEntry[] = [];
  private dictation: Dictation | null = null; // E9: the open sink, if any
  // P2-B M6: whether the selection is a caret the human left: the editor lost focus since its document was last set
  // while unfocused. A dialog widget's insertion (C11's insertComposerText, "Use in chat") runs while the dialog holds
  // the keyboard, and lands there, not at the end.
  private caretLeft = false;

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

  blurred(): void {
    this.caretLeft = true; // ProseMirror keeps the selection across the blur
  }

  updated(editor: TiptapEditor, transaction: Transaction): void {
    // E9: the human edited inside the interim words: they stay as typed over, and the sink ends
    if (this.dictation && interimOf(editor.state)?.settledByEdit) this.endDictation(null);
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
    this.restoring = this.drafts.load().then((draft) => {
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
      this.endDictation('remove'); // E9: before the flush, so the draft keeps no provisional words
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
    if (disabled !== null) this.endDictation('keep'); // E9: the words heard so far stay
    if (!this.busy) this.editor?.setEditable(disabled === null);
  }

  // ---- behaviour ------------------------------------------------------------------------------------------------

  async submit(): Promise<void> {
    const editor = this.editor;
    const { appSessionId, sessionId, cwd, disabled } = this.inputs;
    if (!editor || disabled !== null || this.busy || submissions.has(appSessionId)) return;
    // E9: what is on screen is what is sent (and what a refused send keeps): the interim words settle first
    this.endDictation('keep');
    const s = serializeDraft(editor.getJSON(), { sessionId, cwd });
    if (s.empty) return;
    // E3 start: a `/btw` draft is a side question to the engine, never a prompt (E3 execution document, Design §7). The
    // typed seam below asks it through C11's `btw` widget, a draft it would not take (several lines, pasted text) with
    // its whole text; one holding an attachment, or with no `btw` widget registered, is refused here and kept, so no
    // `/btw` draft reaches `session.send` or `session.steer`.
    const btw = /^\/btw(?:\s|$)/.test(s.display.trim());
    if (btw) {
      const refusal = !slashWidget('btw') ? BTW_UNAVAILABLE : typeof s.content !== 'string' ? BTW_TEXT_ONLY : null;
      if (refusal !== null) {
        warn(refusal);
        return;
      }
    }
    // E3 end
    this.revision += 1;
    this.attachmentEpoch += 1;
    // C11 start: a typed `/<name> <args>` naming a registered widget is the widget's (a registered widget wins over the
    // headless text path): an argument the widget resolves fully applies through the widget's own control path with no
    // widget shown, and otherwise the widget opens with its argument, as choosing the row does. The document and its
    // draft clear as a palette choice's do. Only a one-line document: a multi-line draft that starts with a widget's name
    // is a message, and sends as text.
    const plain =
      s.mode === 'send' && typeof s.content === 'string' && Object.keys(s.pastedContents).length === 0 && !isMultiline(editor.getJSON());
    const command = plain ? s.display.trim() : btw ? plainTextOf(editor.getJSON()).trim() : null; // E3: a non-plain `/btw`
    const typed = command !== null ? /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(command) : null;
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
    this.endDictation('keep'); // E9: the document is replaced; the range goes with it
    this.silent = options.silently;
    try {
      editor.commands.setContent(doc, { emitUpdate: true });
      // `setContent` replaces the content and keeps the document node's own attributes: the strip goes with it here
      editor.view.dispatch(editor.state.tr.setDocAttribute('attachments', attachmentsOf(doc)));
    } finally {
      this.silent = false;
    }
    if (options.caret === null) {
      if (!editor.isFocused) this.caretLeft = false; // a document set behind the human's back has no caret of theirs
      return;
    }
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

  // False when the editor stopped taking attachments meanwhile (a submission, an unmount); a refused or unreadable image
  // is warned about and counts as taken.
  private async attachImage(name: string, blob: Blob, mediaType: string, epoch: number): Promise<boolean> {
    try {
      const out = await downscaleImage(blob, mediaType);
      if (!this.live || this.busy || this.attachmentEpoch !== epoch) return false;
      const refusal = imageRefusal(name, out.bytes);
      if (refusal) warn(refusal);
      else this.addAttachment({ id: atomId('attachment'), kind: 'image', name, mediaType: out.mediaType, bytes: out.bytes, data: out.data, persisted: true });
    } catch {
      warn(`${name} could not be read as an image`);
    }
    return true;
  }

  // `at`: the document position a drop landed on (FileHandler answers 0 when it could not tell, never a place a chip
  // can go, so the caret stays where it is then); mentions and read-in text go there, attachments to the strip. Whether
  // every file was taken: false when the editor was busy or unmounted, or became so before the last one landed.
  async addFiles(files: File[], at?: number): Promise<boolean> {
    if (this.busy || !this.live) return false;
    const epoch = this.attachmentEpoch;
    const taking = () => this.live && !this.busy && this.attachmentEpoch === epoch;
    if (at !== undefined && at > 0 && this.editor) this.editor.commands.setTextSelection(at);
    for (const file of files) {
      if (!taking()) return false;
      const action = classifyFile(file, this.client.pathForFile(file));
      if (action.kind === 'image') {
        if (!(await this.attachImage(file.name, file, file.type, epoch))) return false;
      } else if (action.kind === 'pdf') {
        const data = await fileBase64(file);
        if (!taking()) return false;
        this.addAttachment({ id: atomId('attachment'), kind: 'document', name: file.name, mediaType: 'application/pdf', bytes: file.size, data, persisted: true });
      } else if (action.kind === 'mention') this.insertMention(action.path);
      else if (action.kind === 'text') {
        const text = await file.text();
        if (!taking()) return false;
        this.insertPasted(text, file.name);
      } else warn(action.reason);
    }
    return true;
  }

  // P3-G (§D4.3): files from outside the editor (Mark-up's Add to chat, the attachment queue) wait for the stored draft
  // to be restored, so they join it: the restoration fills only an editor still empty, and would otherwise be skipped
  // (and the draft written over). A remount meanwhile is waited for in its turn.
  private async attachFromOutside(files: File[]): Promise<boolean> {
    for (;;) {
      const lifetime = this.lifetime;
      await this.restoring;
      if (!this.live) return false;
      if (this.lifetime === lifetime) return this.addFiles(files);
    }
  }

  // ---- E9: dictation (E9 execution document, Design §7) -----------------------------------------------------------

  // Opens the interim range at the caret (the editor takes focus first: at its selection, read from the DOM, when
  // focused, else at the caret the human left, else at the end, as `insertText` does; P2-F, L135), deleting nothing: a selection stays and the words go after it, inside its last text
  // block, so a refused or cancelled capture leaves the document exactly as it was. Whether the words get a leading
  // space is decided once, here.
  private beginDictation(onEnded: () => void): DictationSink | null {
    const editor = this.editor;
    if (!editor || editor.isDestroyed || this.busy || submissions.has(this.inputs.appSessionId) || this.inputs.disabled !== null) return null;
    this.endDictation('remove'); // one sink at a time
    if (editor.isFocused) syncSelectionFromDOM(editor.view); // the selection the arrow keys moved, which ProseMirror may not have read
    else editor.commands.focus(this.caretLeft ? null : 'end'); // `null`: the kept selection
    editor.view.focus();
    const at = dictationStart(editor.state);
    const space = needsLeadingSpace(editor.state, at);
    openInterim(editor.view, at);
    const session: Dictation = { ended: false, onEnded };
    this.dictation = session;
    const words = (text: string) => inlineFragment(editor.schema, inlineContent(text === '' || !space ? text : ` ${text}`));
    const closing = () => {
      if (session.ended) return false;
      session.ended = true;
      this.dictation = null;
      return true;
    };
    return {
      partial: (text) => {
        if (!session.ended) replaceInterim(editor.view, words(text));
      },
      final: (text) => {
        if (closing()) settleFinal(editor.view, words(text));
      },
      cancel: () => {
        if (closing()) closeInterim(editor.view, true);
      },
    };
  }

  // The editor ends the open sink itself and says so: the words kept as ordinary text (`keep`), removed (`remove`), or
  // left as an edit already settled them (null).
  private endDictation(words: 'keep' | 'remove' | null): void {
    const session = this.dictation;
    if (!session) return;
    session.ended = true;
    this.dictation = null;
    const editor = this.editor;
    if (words !== null && editor && !editor.isDestroyed) closeInterim(editor.view, words === 'remove');
    session.onEnded();
  }


  handle(): EditorHandle {
    const editor = () => this.editor!;
    return {
      focus: () => void editor().commands.focus(),
      submit: () => void this.submit(),
      insertText: (text, options) => {
        if (this.busy) return;
        const at = editor().isFocused ? editor().chain() : editor().chain().focus(this.caretLeft ? null : 'end'); // `null`: the kept selection
        if (!options?.separated) {
          at.insertContent(text).run();
          return;
        }
        at.run(); // P3-G: the caret first, so the text before it can be read
        editor().chain().insertContent(needsLeadingSpace(editor().state, editor().state.selection.from) ? ` ${text}` : text).run();
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
      attachFiles: (files) => this.attachFromOutside(files), // P3-G
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
      beginDictation: (onEnded) => this.beginDictation(onEnded), // E9
      settleDictation: () => this.endDictation('keep'), // E9
    };
  }
}
