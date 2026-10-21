// P4-B2 K6 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D10): the Edit menu's Undo and Redo in the page.
// Main sends `layout.edit` to the app page holding the focus (src/main/menu.ts); the first registered claimant that
// claims the focused element runs the op on its own stack, and an op nobody claims goes back to main as
// `layout.nativeEdit`, which runs the native command in this page, so inputs, the composer and the document editor
// behave as under the role items. A claimant claims by the editable surface that has focus, never by its root's
// containment alone (the plan review's P1): a deck's or a design's editor claims its stage, a slide text box on it and
// the deck's notes, and leaves an inspector field, a reply, a rail or an iframe inside it native.
import type { MawsBridge } from '@shared/ipc/schema';
import type { EditOp } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';

export interface EditClaimant {
  /** Whether the page's focused element is one of this claimant's own editable surfaces. */
  claims(active: Element): boolean;
  undo(): void;
  redo(): void;
}

const claimants: EditClaimant[] = [];

/** Registers a claimant until the returned disposer runs (an editor's lifetime, or while it takes edits). */
export function registerEditClaimant(claimant: EditClaimant): () => void {
  claimants.push(claimant);
  return () => {
    const at = claimants.indexOf(claimant);
    if (at !== -1) claimants.splice(at, 1);
  };
}

/** Answers an Edit menu op in this page: a claimant's, else main's native command. */
export function runEdit(op: EditOp, client: MawsBridge = ipc, doc: Document = document): void {
  const active = doc.activeElement;
  const claimant = active === null ? undefined : claimants.find((c) => c.claims(active));
  if (claimant) {
    try {
      claimant[op]();
    } catch (error) {
      console.error(`[edit] ${op} failed`, error);
    }
    return;
  }
  void client.invoke('layout.nativeEdit', { op }).then((result) => {
    if (!result.ok) console.warn(`[edit] layout.nativeEdit ${op} failed`, result.error);
  });
}

export function connectEditClaimants(client: MawsBridge = ipc, doc: Document = document): () => void {
  return client.on('layout.edit', ({ op }) => runEdit(op, client, doc));
}
