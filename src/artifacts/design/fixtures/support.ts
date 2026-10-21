// P3-E1 M1: the design model's test fixtures (E0's `spikes/p3-design/model/support.ts`, rebuilt on the module): a design
// written straight into C's roots, replicas under chosen clientIDs, and their exchange. No test framework here.
import { importSlide } from '../../slides/model';
import { loadSlide } from '../../slides/parse';
import type { SlideIR } from '../../slides/ir';
import { adoptClientId, applyV1, applyV2, diffV1, mergeUpdates, newDoc, onUpdate, stateV2, stateVector, transact, type Doc } from '../../yjs';
import type { BoardFrame } from '../canvas';
import { writeBoardEntry, writeCanvasKeys } from '../model';

export const defaultBody = (id: string): string => `<h1 id="title" style="font-size:72px">Title ${id}</h1><p id="body" style="font-size:32px">Body of ${id}</p>`;

/** A board's file in C's slide dialect, loaded to IR. */
export function boardIR(id: string, body = defaultBody(id), notes = ''): SlideIR {
  const l = loadSlide(`<section id="${id}" style="background:#ffffff">${body}${notes ? `<aside>${notes}</aside>` : ''}</section>`, { fileId: id });
  if (!l.ok) throw new Error(`fixture ${id}: ${l.held.reasons.join('; ')}`);
  return l.slide;
}

export interface BoardSeed {
  id: string;
  at: BoardFrame;
  body?: string;
  title?: string;
  notes?: string;
}

export const BOARDS: BoardSeed[] = [
  { id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone' },
  { id: 'b2', at: { x: 500, y: 0, w: 1440, h: 1024 } },
  { id: 'b3', at: { x: 2000, y: 0, w: 1080, h: 8192 } },
];

/** Writes a design's manifest keys and boards inside the caller's transaction. */
export function writeBoards(doc: Doc, boards: BoardSeed[], title = 'Design'): void {
  writeCanvasKeys(doc, { v: 1, title, boards: {}, order: [] });
  boards.forEach((b, i) => {
    importSlide(doc, boardIR(b.id, b.body, b.notes), `a${i}`);
    writeBoardEntry(doc, b.id, { ...b.at, ...(b.title !== undefined && { title: b.title }) });
  });
}

/** A design doc under a known clientID (so concurrency tests can order clientIDs). */
export function design(boards: BoardSeed[] = BOARDS, clientId = 100): Doc {
  const doc = newDoc();
  adoptClientId(doc, clientId);
  transact(doc, () => writeBoards(doc, boards));
  return doc;
}

/** A replica loaded from `doc`'s state, then writing under `clientId`. */
export function replicaFrom(doc: Doc, clientId: number): Doc {
  const r = newDoc();
  applyV2(r, stateV2(doc));
  adoptClientId(r, clientId);
  return r;
}

/** Exchange what each lacks, both ways. */
export function sync(a: Doc, b: Doc): void {
  const toB = diffV1(a, stateVector(b));
  const toA = diffV1(b, stateVector(a));
  applyV1(b, toB, 'remote');
  applyV1(a, toA, 'remote');
}

/** The V1 updates `edit` produced on `doc`. */
export function updatesOf(doc: Doc, edit: () => void): Uint8Array[] {
  const out: Uint8Array[] = [];
  const off = onUpdate(doc, (u) => out.push(u));
  try {
    edit();
  } finally {
    off();
  }
  return out;
}

/**
 * P4-B2 (D17): an agent's replica of `owner` under `clientId`, its writes reaching `owner` (origin 'agent') as the port
 * provider delivers them: on arrival, or buffered in order while `holdRemote(true)` stands and applied merged at its
 * release. Each write first takes what `owner` has, as the host relays the owner's frames before the agent writes.
 */
export function heldPeer(owner: Doc, clientId: number) {
  const agent = replicaFrom(owner, clientId);
  let held = false;
  const buffer: Uint8Array[] = [];
  const holds: boolean[] = [];
  return {
    agent,
    /** Every hold set and released, in order. */
    holds,
    buffered: () => buffer.length,
    holdRemote(on: boolean): void {
      holds.push(on);
      held = on;
      if (!on && buffer.length > 0) applyV1(owner, mergeUpdates(buffer.splice(0)), 'agent');
    },
    write(edit: (agent: Doc) => void): void {
      applyV1(agent, diffV1(owner, stateVector(agent)), 'host');
      const before = stateVector(agent);
      transact(agent, () => edit(agent), 'agent');
      const update = diffV1(agent, before);
      if (held) buffer.push(update);
      else applyV1(owner, update, 'agent');
    },
  };
}
