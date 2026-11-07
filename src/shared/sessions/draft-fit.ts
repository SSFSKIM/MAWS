// A composer draft over a machine link (P5 O8 M6a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces
// §P; M6a's branch review, F3). The composer keeps up to 4 MiB of attachments in a draft, their bytes base64 in its
// document's attributes (`attrs.attachments`), more than one act or answer of RL2 carries (REMOTE_INLINE_MAX_BYTES, the
// channel's message less headroom). So a draft crossing a link keeps its text whatever its attachments weigh, and the
// attachments that fit, in order, measured as they travel (UTF-8 JSON, base64 included); the rest are left out by name.
// A draft read from a machine names those its machine left out (`WITHHELD_ATTACHMENTS`, in the document's attributes),
// which the reading device says and takes off.
import { REMOTE_INLINE_MAX_BYTES } from '@shared/ipc/schema/remote';
import type { Draft } from '@shared/ipc/schema/session';

export const WITHHELD_ATTACHMENTS = 'withheldAttachments';

type Doc = { attrs?: Record<string, unknown> } & Record<string, unknown>;

const encoder = new TextEncoder();
const sizeOf = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;
const nameOf = (attachment: unknown): string => {
  const name = (attachment as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : 'an attachment';
};
const docOf = (draft: Draft): Doc | null => (draft.doc !== null && typeof draft.doc === 'object' && !Array.isArray(draft.doc) ? (draft.doc as Doc) : null);
const withAttrs = (draft: Draft, doc: Doc, attrs: Record<string, unknown>): Draft => ({ ...draft, doc: { ...doc, attrs } });

/** The draft as it fits `maxBytes`: its text and the attachments that fit, and the names of those left out. */
export function fitDraft(draft: Draft, maxBytes: number = REMOTE_INLINE_MAX_BYTES): { draft: Draft; withheld: string[] } {
  const doc = docOf(draft);
  const all = doc?.attrs?.attachments;
  if (doc === null || !Array.isArray(all) || sizeOf(draft) <= maxBytes) return { draft, withheld: [] };
  const kept: unknown[] = [];
  const withheld: string[] = [];
  for (const attachment of all) {
    if (sizeOf(withAttrs(draft, doc, { ...doc.attrs, attachments: [...kept, attachment] })) <= maxBytes) kept.push(attachment);
    else withheld.push(nameOf(attachment));
  }
  return { draft: withAttrs(draft, doc, { ...doc.attrs, attachments: kept }), withheld };
}

/** A draft as a machine answers it over a link: fitted, naming what it left out. */
export function draftForLink(draft: Draft): Draft {
  const { draft: fitted, withheld } = fitDraft(draft);
  const doc = docOf(fitted);
  return withheld.length === 0 || doc === null ? fitted : withAttrs(fitted, doc, { ...doc.attrs, [WITHHELD_ATTACHMENTS]: withheld });
}

/** A draft read over a link, without its machine's note, and the names that note gave. */
export function takeWithheld(draft: Draft): { draft: Draft; withheld: string[] } {
  const doc = docOf(draft);
  const named = doc?.attrs?.[WITHHELD_ATTACHMENTS];
  if (doc === null || !Array.isArray(named)) return { draft, withheld: [] };
  const { [WITHHELD_ATTACHMENTS]: _note, ...attrs } = doc.attrs!;
  void _note;
  return { draft: withAttrs(draft, doc, attrs), withheld: named.filter((name): name is string => typeof name === 'string') };
}
