// Block ids (D1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4): every block carries an 8-character id the
// agent's markdown names with `^id`. UniqueID keeps them through split and paste in an editor; the host repairs what it
// cannot (writers that omit ids, concurrent splits; M2's adapter).
import { UniqueID } from '@tiptap/extension-unique-id';
import { isBindingTransaction } from '../yjs';

/**
 * True for a transaction this replica made itself. Ids are minted for local transactions only: `@y/prosemirror` 2
 * marks its remote writes `y-sync-transaction`, not v13's `y-sync$` that stock UniqueID skips, so without this every
 * peer would write ids into the blocks another replica just wrote (S1 pitfall 1).
 */
export const isLocalTransaction = (tr: { getMeta(key: string): unknown }): boolean => !isBindingTransaction(tr);

/** UniqueID on the document's block types, local transactions only. Named `uniqueID`, as Tiptap's own. */
export const uniqueId = ({ types, generateID }: { types: string[]; generateID: () => string }) =>
  UniqueID.configure({ types, generateID: () => generateID(), filterTransaction: isLocalTransaction });

/**
 * The editor's `coreExtensionOptions` (M3): Tiptap core's Delete extension also filters only v13's meta (S1 pitfall 1),
 * so it takes the same predicate.
 */
export const coreExtensionOptions = { delete: { filterTransaction: isLocalTransaction } };
