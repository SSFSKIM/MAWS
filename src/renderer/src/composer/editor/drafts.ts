// Drafts (C7 execution document, "Drafts"): the composer's document is written as C4's `Draft` 750 ms after the last
// change and on unmount, the attachment strip riding in the document's attributes (bytes kept up to the draft's budget)
// and the path-backed mention chips listed as `{ path, kind }`; an empty document with no attachments writes `null`. A
// draft is per app session, survives tab switches and reloads, and is cleared by a successful send. The writer is the
// timing only; where it writes (C4's `session.drafts.set`, or C10's intent on an unstarted session) is its caller's.
import type { AppSessionId } from '@shared/graph/ids';
import type { JSONContent } from '@tiptap/core';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { readerRowsOf } from '../../lane-b/reader-rows';
import { dropRemoteDraftSaves, loadRemoteDraft, resetRemoteDraftSaves, saveRemoteDraft, saveRemoteDraftOnce, unsavedRemoteDraft } from '../../lane-b/remote-drafts';
import { markPersisted } from './attachments';
import { attachmentsOf, MENTION, type ComposerDoc, type MentionAttrs } from './doc';

export const DRAFT_DELAY_MS = 750;

const nodesOf = (doc: JSONContent): JSONContent[] => (doc.content ?? []).flatMap((paragraph) => paragraph.content ?? []);

export function isEmptyDoc(doc: ComposerDoc): boolean {
  return attachmentsOf(doc).length === 0 && nodesOf(doc).every((node) => node.type === 'hardBreak' || (node.type === 'text' && (node.text ?? '').trim() === ''));
}

// UX wave U4a (decision 13): a take-back's stage keeps every attachment's bytes (`whole`); the draft's budget is the
// editor's writer's.
export function draftOf(doc: ComposerDoc, updatedAt: string, options: { whole?: boolean } = {}): Draft | null {
  if (isEmptyDoc(doc)) return null;
  const kept = options.whole ? attachmentsOf(doc) : markPersisted(attachmentsOf(doc)).filter((a) => a.persisted);
  const attachments = nodesOf(doc)
    .filter((node) => node.type === MENTION && (node.attrs as MentionAttrs).kind === 'file')
    .map((node) => ({ path: (node.attrs as MentionAttrs).id, kind: 'file' }));
  return { doc: { ...doc, attrs: { ...doc.attrs, attachments: kept } }, attachments, updatedAt };
}

// W3: a draft written before W3 may carry the composer's retired edit mode (`attrs.editing`); only the attachments
// are the document's own attributes now.
export function docOfDraft(draft: Draft | null): ComposerDoc | null {
  const doc = draft?.doc as JSONContent | undefined;
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return null;
  if (doc.attrs === undefined || !('editing' in doc.attrs)) return doc;
  const { editing: _retired, ...attrs } = doc.attrs;
  void _retired;
  return { ...doc, attrs };
}

export interface DraftWriter {
  change(doc: ComposerDoc): void; // schedules a write DRAFT_DELAY_MS after the last change
  flush(): void; // writes a pending change now (unmount)
  cancel(): void; // forgets a pending change (a send cleared the draft)
}

export function createDraftWriter(save: (draft: Draft | null) => void, options: { delayMs?: number; now?: () => string } = {}): DraftWriter {
  const delay = options.delayMs ?? DRAFT_DELAY_MS;
  const now = options.now ?? (() => new Date().toISOString());
  let pending: ComposerDoc | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const write = () => {
    clear();
    if (pending === null) return;
    const doc = pending;
    pending = null;
    save(draftOf(doc, now()));
  };
  return {
    change(doc) {
      pending = doc;
      clear();
      timer = setTimeout(write, delay);
    },
    flush: write,
    cancel() {
      clear();
      pending = null;
    },
  };
}

// P5 O7 M2 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Reads"): a draft for a lane B session on another
// machine is kept in this app's memory for its run, never on that machine. `remote` is asked at each load and save, so a
// session's drafts go where its machine is as the stores know it then. P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, Interfaces §P): a machine that offers `session.drafts.*` keeps each member's own, so the draft goes
// there (../../lane-b/remote-drafts.ts) and the memory holds only what the machine doesn't: everything, for a machine that
// refuses them (an endpoint older than M6a, ../../lane-b/reader-rows.ts), and a spawn's handed document until the first save.
const remoteDrafts = new Map<AppSessionId, Draft>();
export const resetRemoteDrafts = (): void => {
  remoteDrafts.clear();
  resetRemoteDraftSaves();
}; // for suites
// P5 O7 M4: a session spawned on another machine from a New chat tab takes that tab's document as its draft, whole (its
// attachments go up from the new session's composer, so no byte budget applies to a draft that lives in this memory)
export function rememberRemoteDraft(appSessionId: AppSessionId, doc: ComposerDoc): void {
  remoteDrafts.set(appSessionId, { doc, attachments: [], updatedAt: new Date().toISOString() });
}
export function rememberingRemoteDrafts<P extends { load(): Promise<Draft | null>; save(draft: Draft | null, replaces?: string | null): Promise<boolean> }>(port: P, appSessionId: AppSessionId, remote: () => boolean, client: MawsBridge): P {
  const remember = (draft: Draft | null) => {
    if (draft === null) remoteDrafts.delete(appSessionId);
    else remoteDrafts.set(appSessionId, draft);
  };
  const remembered = () => remoteDrafts.get(appSessionId) ?? null;
  return {
    ...port,
    load: () => {
      if (!remote()) return port.load();
      // the newest save first, wherever it is: one still going to the machine, then the memory
      const unsaved = unsavedRemoteDraft(appSessionId);
      if (unsaved !== undefined) return Promise.resolve(unsaved);
      if (remoteDrafts.has(appSessionId) || readerRowsOf(appSessionId) === 'refused') return Promise.resolve(remembered());
      return loadRemoteDraft(client, appSessionId, remembered);
    },
    save: async (draft: Draft | null, replaces?: string | null) => {
      if (!remote()) return port.save(draft, replaces);
      if (readerRowsOf(appSessionId) === 'refused') {
        dropRemoteDraftSaves(appSessionId); // a save still out, refused later, hands nothing over this one (Task 3's review, H1)
        remember(draft);
        return true;
      }
      remoteDrafts.delete(appSessionId); // a handed document, which this save replaces
      // UX wave U4a (decision 13): a save naming a take-back's settle form goes once, in the session's order, its answer ours
      if (replaces != null) {
        const result = await saveRemoteDraftOnce(client, appSessionId, draft, replaces);
        return !('withheld' in result) && result.ok;
      }
      saveRemoteDraft(client, appSessionId, draft, remember);
      return true; // taken in hand: the session's saves go one after another, again where refused stale
    },
  };
}

// Close guards read the editor before persistence catches up. Until it loads or changes, use the stored draft.
const liveDrafts = new Map<AppSessionId, () => ComposerDoc | undefined>();
export const liveDraftDoc = (id: AppSessionId): ComposerDoc | undefined => liveDrafts.get(id)?.();
export function registerLiveDraft(id: AppSessionId, read: () => ComposerDoc | undefined): () => void {
  liveDrafts.set(id, read);
  return () => { if (liveDrafts.get(id) === read) liveDrafts.delete(id); };
}
