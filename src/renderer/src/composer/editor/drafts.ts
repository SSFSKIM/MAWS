// Drafts (C7 execution document, "Drafts"): the composer's document is written as C4's `Draft` 750 ms after the last
// change and on unmount, the attachment strip riding in the document's attributes (bytes kept up to the draft's budget)
// and the path-backed mention chips listed as `{ path, kind }`; an empty document with no attachments writes `null`. A
// draft is per app session, survives tab switches and reloads, and is cleared by a successful send. The writer is the
// timing only; where it writes (C4's `session.drafts.set`, or C10's intent on an unstarted session) is its caller's.
import type { AppSessionId } from '@shared/graph/ids';
import type { JSONContent } from '@tiptap/core';
import type { Draft } from '@shared/ipc/schema/session';
import { markPersisted } from './attachments';
import { attachmentsOf, MENTION, type ComposerDoc, type MentionAttrs } from './doc';

export const DRAFT_DELAY_MS = 750;

const nodesOf = (doc: JSONContent): JSONContent[] => (doc.content ?? []).flatMap((paragraph) => paragraph.content ?? []);

export function isEmptyDoc(doc: ComposerDoc): boolean {
  return attachmentsOf(doc).length === 0 && nodesOf(doc).every((node) => node.type === 'hardBreak' || (node.type === 'text' && (node.text ?? '').trim() === ''));
}

export function draftOf(doc: ComposerDoc, updatedAt: string): Draft | null {
  if (isEmptyDoc(doc)) return null;
  const kept = markPersisted(attachmentsOf(doc)).filter((a) => a.persisted);
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

// Close guards read the editor before persistence catches up. Until it loads or changes, use the stored draft.
const liveDrafts = new Map<AppSessionId, () => ComposerDoc | undefined>();
export const liveDraftDoc = (id: AppSessionId): ComposerDoc | undefined => liveDrafts.get(id)?.();
export function registerLiveDraft(id: AppSessionId, read: () => ComposerDoc | undefined): () => void {
  liveDrafts.set(id, read);
  return () => { if (liveDrafts.get(id) === read) liveDrafts.delete(id); };
}
