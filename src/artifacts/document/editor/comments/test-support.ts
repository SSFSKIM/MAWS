// The comment suites' world (happy-dom; M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md), S5's
// (`spikes/p3-store/s5/lib/world.mjs`) over this child's in-memory host: two editor replicas of one document (the
// owner's panel A and main tab B) with the comment plugins, and a bare replica standing for the agent, all real
// `PortProvider`s on real `MessageChannel`s; three comments made from A's editor, t1 and t2 overlapping. Test support
// only.
import type { Editor, JSONContent } from '@tiptap/core';
import type { Actor } from '@shared/artifacts/actor';
import { stateVector, type Doc } from '../../../yjs';
import { createRelativePositionFromJSON } from '../../../yjs/document';
import { relativePositionsToResolvedPositions, ynodeToPmnode } from '../../../yjs/prosemirror';
import { schemaFor } from '../../schema';
import { tabBody } from '../../tabs';
import { getThread, listThreads, liveThreadIds, threadStates } from '../../threads';
import type { DocumentHandleWithHold } from '../host-types';
import { TAB, World, ticks, until, type Replica } from '../test-world';
import { Comments, commentSelection, liveRanges } from './plugins';

export const owner: Actor = { kind: 'human' };
export const agentActor = { kind: 'session', appSessionId: 'a1111111-1111-4111-8111-111111111111' } as Actor;
let clock = 1_760_000_000_000;
export const now = (): number => (clock += 1000);

export const P1 = 'The plan ships quarterly with design review notes. Owners track the budget.';
export const seedJSON = (): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, id: 'h1' }, content: [{ type: 'text', text: 'Plan' }] },
    { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: P1 }] },
    { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Second paragraph keeps going here.' }] },
    { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: 'Third paragraph.' }] },
  ],
});
export const BASE_COVER = { t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' };

export interface CommentWorld {
  world: World;
  A: Replica;
  B: Replica;
  agent: DocumentHandleWithHold;
  /** Every replica holds the host's state and every editor shows its replica's body. */
  settle(): Promise<void>;
  /** A fresh pair of editors over the same host (a reload). */
  reload(): Promise<{ A: Replica; B: Replica }>;
}

const pmJSON = (doc: Doc): string => JSON.stringify(ynodeToPmnode(tabBody(doc, TAB)!, schemaFor()).toJSON());
const contentOf = (doc: Doc): string => pmJSON(doc) + JSON.stringify(listThreads(doc));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** A world; `paste: false` builds the editors without the paste dedupe (S5's contrast). */
export async function commentWorld({ paste = true, seed = seedJSON() }: { paste?: boolean; seed?: JSONContent } = {}): Promise<CommentWorld> {
  const world = new World(seed);
  const withComments = (handle: DocumentHandleWithHold) => [Comments.configure({ doc: handle.doc, tabId: TAB, paste })];
  const A = await world.replica('a', withComments);
  const B = await world.replica('b', withComments);
  const agent = await world.bare();
  const editors = [A, B];
  const settle = async () => {
    await until(() => {
      const host = stateVector(world.host.doc);
      const content = contentOf(world.host.doc);
      const docs = [...editors.map((r) => r.handle.doc), agent.doc];
      // a deletion moves no state vector: the content is compared too
      return docs.every((doc) => same(stateVector(doc), host) && contentOf(doc) === content) && editors.every((r) => JSON.stringify(r.editor.getJSON()) === pmJSON(r.handle.doc));
    }, 'the replicas to converge');
    await ticks(3); // the display plugin redraws a microtask after a threads-map change
  };
  const reload = async () => {
    const pair = { A: await world.replica('a2', withComments), B: await world.replica('b2', withComments) };
    editors.push(pair.A, pair.B);
    return pair;
  };
  await settle();
  return { world, A, B, agent, settle, reload };
}

/** S5's base: t1 "ships quarterly with design review" and t2 "design review notes" (overlapping) on p1, t3 "keeps going" on p2. */
export async function baseWorld(options?: { paste?: boolean }): Promise<CommentWorld> {
  const w = await commentWorld(options);
  for (const [id, needle, body] of [
    ['t1', 'ships quarterly with design review', 'Should this be monthly?'],
    ['t2', 'design review notes', 'Which notes?'],
    ['t3', 'keeps going', 'Too vague.'],
  ] as const) {
    select(w.A.editor, needle);
    commentSelection(w.A.editor, w.A.handle.doc, { threadId: id, tabId: TAB, by: owner, at: now(), body });
  }
  await w.settle();
  return w;
}

// ── helpers over an editor replica (S5's) ──
export const textOf = (editor: Editor): string => editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');

/** The position of the `nth` occurrence of `needle` in some textblock. */
export function findPos(editor: Editor, needle: string, nth = 0): number {
  let at = -1;
  let seen = 0;
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (!node.isTextblock) return true;
    const text = node.textContent;
    for (let i = text.indexOf(needle); i >= 0 && at < 0; i = text.indexOf(needle, i + 1)) if (seen++ === nth) at = pos + 1 + i;
    return false;
  });
  if (at < 0) throw new Error(`not found: ${needle}`);
  return at;
}
export function select(editor: Editor, needle: string): { from: number; to: number } {
  const from = findPos(editor, needle);
  const to = from + needle.length;
  editor.commands.setTextSelection({ from, to });
  return { from, to };
}
/** Typing as ProseMirror types: insertText at the position with the marks the cursor carries. */
export function type(editor: Editor, pos: number, text: string): void {
  editor.commands.setTextSelection(pos);
  editor.view.dispatch(editor.state.tr.insertText(text));
}
export function key(editor: Editor, pos: number, name: string): boolean {
  editor.commands.setTextSelection(pos);
  return editor.commands.keyboardShortcut(name);
}
/** threadId → the text its live mark covers (ranges joined by '|', a block break inside a range as '¶'). */
export function covered(editor: Editor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, ranges] of liveRanges(editor.state.doc)) out[id] = ranges.map((r) => editor.state.doc.textBetween(r.from, r.to, '¶')).join('|');
  return Object.fromEntries(Object.entries(out).sort());
}
/** The threads the display plugin highlights in the rendered DOM, id → text. */
export function highlighted(editor: Editor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of editor.view.dom.querySelectorAll('.comment'))
    for (const name of el.classList) if (name.startsWith('comment-') && name !== 'comment-active') out[name.slice(8)] = (out[name.slice(8)] ?? '') + el.textContent;
  return Object.fromEntries(Object.entries(out).sort());
}
export const blockTypes = (editor: Editor): string[] => {
  const out: string[] = [];
  editor.state.doc.forEach((node) => out.push(`${node.type.name}#${String(node.attrs.id ?? '-')}`));
  return out;
};
/** `t1:open t2:open:orphan …` over a replica's doc. */
export const states = (doc: Doc): string =>
  threadStates(doc, liveThreadIds(doc))
    .map((t) => `${t.id}:${t.status}${t.orphan ? ':orphan' : ''}`)
    .join(' ');
/** Where thread `id`'s stored pair points in an editor, as text ('∅' unresolvable). */
export function anchorText(editor: Editor, doc: Doc, id: string): string {
  const anchor = getThread(doc, id)?.anchor;
  const [start, end] = relativePositionsToResolvedPositions(editor.view, [anchor?.start, anchor?.end].map((json) => (json == null ? null : createRelativePositionFromJSON(json))));
  if (!start || !end) return '∅';
  return start.pos <= end.pos ? editor.state.doc.textBetween(start.pos, end.pos, '¶') : `(inverted ${start.pos}>${end.pos})`;
}

/** Undoes everything this editor's binding can undo. */
export function undoAll(editor: Editor): void {
  for (let i = 0; i < 50 && editor.storage.collaboration.undoManager?.canUndo(); i += 1) editor.commands.undo();
}

// ── the clipboard, through ProseMirror's own DOM handlers (S5's `dom.mjs`) ──
/** Fires `copy` or `cut` on the view: ProseMirror serialises the selection into clipboardData (and a cut deletes it). */
export function clip(editor: Editor, kind: 'copy' | 'cut'): { html: string; text: string } {
  const data = new DataTransfer();
  editor.view.dom.dispatchEvent(new ClipboardEvent(kind, { clipboardData: data, bubbles: true, cancelable: true }));
  return { html: data.getData('text/html'), text: data.getData('text/plain') };
}
/** Pastes HTML as a user paste arrives: a `paste` event with clipboardData. */
export function pasteHTML(editor: Editor, html: string, text = ''): void {
  const data = new DataTransfer();
  data.setData('text/html', html);
  data.setData('text/plain', text);
  editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}
