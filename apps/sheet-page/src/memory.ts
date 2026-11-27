// The surface's memory of each session's sheet, kept in the browser's storage for the page's origin (§P; T19): one
// entry a thing, never one value a session, so a tab writes only what the person just changed in it and two tabs editing
// different cards never overwrite each other, whatever each last read.
//
//   maws.sheet.draft.<session>.<question>    { v: 1, touchedAt, draft }            a QuestionDraft
//   maws.sheet.seen.<session>.<question>     { v: 1, touchedAt, revision, marked } what was seen, and the "Updated" mark
//   maws.sheet.header.<session>.<question>   { v: 1, touchedAt, header }           the header SheetMemory.headers keeps
//   maws.sheet.act.<session>.<key>           { v: 1, touchedAt, act }              a SentAct
//   maws.sheet.send.<session>.<a name>       { v: 1, touchedAt, at, lines, state, note }   a Send, from its press to its end
//
// Every change is an update (C3's `onMemory`), applied to the memory read from storage at that moment and never to a
// copy a tab held; `writeMemory` then writes the difference between the two, and nothing a tab merely still holds. A
// Send's entry is written at its press, before its request leaves, and nothing but that Send's own end removes it. It
// stores its press's identity (C3's attempt, unique to one window and one press) beside its lines' keys: a press again,
// from this window or another, is a new press over the same keys, written into the same entry under the same key. This
// window remembers the presses it made; a Send it did not make (another tab's, or its own before a reload) is named by an attempt no window
// makes, which C3's sheet reads as a call whose answer will not come, and the page's own 35-second rule stands in front
// of that (availability.ts). An update that changes nothing of the Send the memory shows is tried against this window's
// other stored Sends, so a press's answer settles its own entry whichever is shown. A tab removes an entry only for a
// question its model knows (`known`). What C3's `reconcile` makes of the memory against a model is written only by
// `writeReconciled`, and only while that model was read after the last write of another tab this tab adopted (the
// store's `settled`); a person's act or a Send's lifecycle is applied to the tab's reconciled view (`base`) and written
// as the difference it makes to that view, whatever model it was made on (§P, "What a tab writes of `reconcile`"). A draft is
// compared by identity in C3's memory, so a read gives an act whose stored draft equals its question's stored draft that
// same object. A refusal deletes nothing here; only the person's Unpair does (credential.ts).
import type { SheetLine } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { EMPTY_MEMORY, type SentAct, type SheetMemory } from '../../../src/renderer/src/sheet';
import { CREDENTIAL_KEY, STORAGE_PREFIX } from './credential';

type Kind = 'draft' | 'seen' | 'header' | 'act' | 'send';
const KINDS: readonly Kind[] = ['draft', 'seen', 'header', 'act', 'send'];
export const SWEEP_MS = 30 * 24 * 60 * 60 * 1000; // an entry untouched this long goes (T19)
export const ELSEWHERE = 'elsewhere:'; // the attempt of a Send this window did not make: C3's attempts never hold a colon

const prefixOf = (kind: Kind, session: string) => `${STORAGE_PREFIX}${kind}.${session}.`;
const keyOf = (kind: Kind, session: string, name: string) => prefixOf(kind, session) + name;
const randomName = () => [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

// The presses this window made, by their attempt
const pressedHere = new Set<string>();
const pressOf = (attempt: string) => (attempt.startsWith(ELSEWHERE) ? attempt.slice(ELSEWHERE.length) : attempt);
const attemptOf = (press: string) => (pressedHere.has(press) ? press : `${ELSEWHERE}${press}`);

interface Stored {
  key: string;
  name: string;
  value: Record<string, unknown>;
}
interface StoredSend {
  key: string;
  press: string; // the attempt that pressed it
  at: number;
  lines: SheetLine[];
  state: 'sending' | 'failed';
  note: string | null;
}

function entriesOf(storage: Storage, kind: Kind, session: string): Stored[] {
  const prefix = prefixOf(kind, session);
  const found: Stored[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null || !key.startsWith(prefix)) continue;
    const name = key.slice(prefix.length);
    if (name === '' || (kind !== 'act' && kind !== 'send' && name.includes('.'))) continue;
    const value = parsed(storage.getItem(key));
    if (value !== null) found.push({ key, name, value });
  }
  return found;
}

function parsed(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    return entry.v === 1 && typeof entry.touchedAt === 'number' ? entry : null;
  } catch {
    return null;
  }
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
function isDraft(value: unknown): value is QuestionDraft {
  const draft = value as Partial<QuestionDraft> | null;
  return (
    typeof draft === 'object' &&
    draft !== null &&
    typeof draft.revision === 'number' &&
    isStrings(draft.picks) &&
    typeof draft.text === 'string' &&
    isStrings(draft.images) &&
    (draft.replaces === undefined || typeof draft.replaces === 'string')
  );
}
function isAct(value: unknown): value is SentAct {
  const act = value as Partial<SentAct> | null;
  return (
    typeof act === 'object' &&
    act !== null &&
    typeof act.key === 'string' &&
    typeof act.kind === 'string' &&
    (act.id === null || typeof act.id === 'string') &&
    (act.draft === null || isDraft(act.draft)) &&
    typeof act.sentAt === 'number' &&
    typeof act.state === 'string' &&
    (act.note === null || typeof act.note === 'string')
  );
}
const sameDraft = (a: QuestionDraft, b: QuestionDraft) =>
  a.revision === b.revision && a.text === b.text && a.replaces === b.replaces && a.picks.join('\n') === b.picks.join('\n') && a.images.join('\n') === b.images.join('\n') && a.picks.length === b.picks.length && a.images.length === b.images.length;

function sendsOf(storage: Storage, session: string): StoredSend[] {
  const sends: StoredSend[] = [];
  for (const { key, value } of entriesOf(storage, 'send', session)) {
    const { press, at, lines, state, note } = value;
    if (typeof press !== 'string' || press === '' || typeof at !== 'number' || !Array.isArray(lines) || lines.length === 0 || (state !== 'sending' && state !== 'failed') || (note !== null && typeof note !== 'string')) continue;
    if (!lines.every((line) => typeof (line as SheetLine | null)?.key === 'string')) continue;
    sends.push({ key, press, at, lines: lines as SheetLine[], state, note });
  }
  return sends.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
}

const sendingOf = (send: StoredSend): NonNullable<SheetMemory['sending']> => ({ attempt: attemptOf(send.press), lines: send.lines, state: send.state, note: send.note });

/** One session's memory, assembled from its entries; EMPTY_MEMORY with none. An entry that does not parse is skipped. */
export function readMemory(session: string, storage: Storage = localStorage): SheetMemory {
  const drafts = new Map<string, QuestionDraft>();
  for (const { name, value } of entriesOf(storage, 'draft', session)) if (isDraft(value.draft)) drafts.set(name, value.draft);
  const seen = new Map<string, number>();
  const marked = new Set<string>();
  for (const { name, value } of entriesOf(storage, 'seen', session)) {
    if (typeof value.revision === 'number') seen.set(name, value.revision);
    if (value.marked === true) marked.add(name);
  }
  const headers = new Map<string, string>();
  for (const { name, value } of entriesOf(storage, 'header', session)) if (typeof value.header === 'string') headers.set(name, value.header);
  const acts: SentAct[] = [];
  for (const { value } of entriesOf(storage, 'act', session)) {
    if (!isAct(value.act)) continue;
    const act = value.act;
    const shown = act.id === null || act.draft === null ? undefined : drafts.get(act.id);
    acts.push(shown !== undefined && sameDraft(shown, act.draft!) ? { ...act, draft: shown } : act); // C3 compares drafts by identity
  }
  acts.sort((a, b) => a.sentAt - b.sentAt || (a.key < b.key ? -1 : 1));
  const held = sendsOf(storage, session)[0];
  const sending = held === undefined ? null : sendingOf(held);
  if (drafts.size + seen.size + marked.size + headers.size + acts.length === 0 && sending === null) return EMPTY_MEMORY;
  return { drafts, seen, marked, headers, acts, sending };
}

/** Since when the Send a session's memory shows has been held (its press, or its last press again), or null. */
export function sendingSince(session: string, storage: Storage = localStorage): number | null {
  return sendsOf(storage, session)[0]?.at ?? null;
}

/** Whether the Send a memory holds is one this window did not make. */
export const madeElsewhere = (memory: SheetMemory): boolean => memory.sending?.attempt.startsWith(ELSEWHERE) ?? false;

/**
 * Writes and removes exactly the entries that differ between the two memories, and touches no other; a removal of a
 * question's entry only where `known` says the tab's model holds that question. Whether anything was written.
 */
export function writeMemory(session: string, before: SheetMemory, after: SheetMemory, now: number = Date.now(), storage: Storage = localStorage, known: (question: string) => boolean = () => true): boolean {
  return writeDiff(session, before, after, now, storage, known, false).wrote;
}

// An entry's value as the memory holds it, in the shape `writeDiff` stores it, or null where it holds none
function shapeOf(kind: Kind, memory: SheetMemory, name: string): Record<string, unknown> | null {
  if (kind === 'draft') return memory.drafts.has(name) ? { draft: memory.drafts.get(name) } : null;
  if (kind === 'seen') return memory.seen.has(name) || memory.marked.has(name) ? { revision: memory.seen.get(name) ?? null, marked: memory.marked.has(name) } : null;
  if (kind === 'header') return memory.headers.has(name) ? { header: memory.headers.get(name) } : null;
  const act = memory.acts.find((entry) => entry.key === name);
  return act ? { act } : null;
}
// A value written out with its keys in order, so two equal values read the same whoever built them
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : inner,
  );

// The difference between two memories, written. `guarded`: each entry only where storage still holds it as `before`
// has it (one it already holds as `after` has it is left alone); any other is another tab's write, not yet adopted,
// and is left and said (`conflict`). A guarded write is reconcile's, which never changes the Send the memory holds.
function writeDiff(session: string, before: SheetMemory, after: SheetMemory, now: number, storage: Storage, known: (question: string) => boolean, guarded: boolean): { wrote: boolean; conflict: boolean } {
  let wrote = false;
  let conflict = false;
  const stillAsBefore = (kind: Kind, name: string) => {
    if (!guarded) return true;
    const stored = parsed(storage.getItem(keyOf(kind, session, name)));
    const now = stored === null ? 'null' : canonical(Object.fromEntries(Object.entries(stored).filter(([field]) => field !== 'v' && field !== 'touchedAt')));
    if (now === canonical(shapeOf(kind, after, name))) return false; // already so
    if (now === canonical(shapeOf(kind, before, name))) return true;
    conflict = true;
    return false;
  };
  const put = (kind: Kind, name: string, value: Record<string, unknown>) => {
    if (!stillAsBefore(kind, name)) return;
    store(storage, keyOf(kind, session, name), JSON.stringify({ v: 1, touchedAt: now, ...value }));
    wrote = true;
  };
  const remove = (kind: Kind, name: string) => {
    if (kind !== 'act' && !known(name)) return; // a question newer than this tab's model: another tab's to keep
    if (!stillAsBefore(kind, name)) return;
    storage.removeItem(keyOf(kind, session, name));
    wrote = true;
  };

  for (const id of new Set([...before.drafts.keys(), ...after.drafts.keys()])) {
    const was = before.drafts.get(id);
    const is = after.drafts.get(id);
    if (was === is) continue;
    if (is === undefined) remove('draft', id);
    else put('draft', id, { draft: is });
  }
  for (const id of new Set([...before.seen.keys(), ...after.seen.keys(), ...before.marked, ...after.marked])) {
    const revision = after.seen.get(id);
    const marked = after.marked.has(id);
    if (before.seen.get(id) === revision && before.marked.has(id) === marked) continue;
    if (revision === undefined && !marked) remove('seen', id);
    else put('seen', id, { revision: revision ?? null, marked });
  }
  for (const id of new Set([...before.headers.keys(), ...after.headers.keys()])) {
    const header = after.headers.get(id);
    if (before.headers.get(id) === header) continue;
    if (header === undefined) remove('header', id);
    else put('header', id, { header });
  }
  const acts = new Map(after.acts.map((act) => [act.key, act]));
  const had = new Map(before.acts.map((act) => [act.key, act]));
  for (const key of new Set([...had.keys(), ...acts.keys()])) {
    const act = acts.get(key);
    if (had.get(key) === act) continue;
    if (act === undefined) remove('act', key);
    else put('act', key, { act });
  }

  if (before.sending === after.sending || guarded) return { wrote, conflict };
  const sends = sendsOf(storage, session);
  const entryOf = (attempt: string) => sends.find((send) => send.press === pressOf(attempt));
  const held = before.sending === null ? undefined : entryOf(before.sending.attempt);
  // a press again over the same lines is the same Send: its one entry keeps its key, its value replaced in one write, so
  // no tab sees the slot empty and a write that fails leaves the record as it was
  const again =
    held !== undefined &&
    after.sending !== null &&
    after.sending.attempt !== before.sending!.attempt &&
    after.sending.lines.length === held.lines.length &&
    after.sending.lines.every((line, i) => line.key === held.lines[i]!.key);
  if (!again && before.sending !== null && before.sending.attempt !== after.sending?.attempt) {
    // its end: the Send is over
    if (held) storage.removeItem(held.key);
    pressedHere.delete(pressOf(before.sending.attempt));
    wrote = true;
  }
  if (after.sending === null) return { wrote, conflict };
  const { attempt, lines, state, note } = after.sending;
  const entry = again ? held : entryOf(attempt);
  const at = again || entry === undefined ? now : entry.at; // since its press, or its press again
  store(storage, entry?.key ?? keyOf('send', session, randomName()), JSON.stringify({ v: 1, touchedAt: now, press: pressOf(attempt), at, lines, state, note }));
  if (again) pressedHere.delete(pressOf(before.sending!.attempt));
  if (!attempt.startsWith(ELSEWHERE)) pressedHere.add(attempt);
  return { wrote: true, conflict };
}

// A write that makes room when the store is full: the entries of the memory touched longest ago go first, never a
// Send's, and never the pairing or anything that is not the memory's
function store(storage: Storage, key: string, value: string): void {
  for (;;) {
    try {
      storage.setItem(key, value);
      return;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
      const oldest = memoryEntries(storage)
        .filter((entry) => entry.kind !== 'send' && entry.key !== key)
        .sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (oldest === undefined) throw error;
      storage.removeItem(oldest.key);
    }
  }
}

function memoryEntries(storage: Storage): { key: string; kind: Kind; touchedAt: number }[] {
  const found: { key: string; kind: Kind; touchedAt: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null || key === CREDENTIAL_KEY) continue;
    const kind = KINDS.find((name) => key.startsWith(`${STORAGE_PREFIX}${name}.`));
    if (kind === undefined) continue;
    found.push({ key, kind, touchedAt: (parsed(storage.getItem(key))?.touchedAt as number | undefined) ?? 0 });
  }
  return found;
}

/** At load: every entry of the memory not touched for 30 days. */
export function sweepMemory(now: number, storage: Storage = localStorage): void {
  for (const entry of memoryEntries(storage)) if (entry.touchedAt < now - SWEEP_MS) storage.removeItem(entry.key);
}

const CHANGED = 'maws-sheet-memory'; // this tab's own writes, which the storage event does not tell it

/**
 * One update of a session's memory: applied to the memory as it is in storage now, and its difference written. The
 * session is the one the update was made for, wherever the view that made it is by then.
 */
export interface MemoryUpdateOptions {
  storage?: Storage;
  now?: number;
  target?: EventTarget;
  known?: (question: string) => boolean; // the questions the tab's model holds: no other question's entry is removed
  base?: (stored: SheetMemory) => SheetMemory; // what the tab shows of the stored memory (its reconcile against its model)
}

/** Applies a change to the memory as stored now (as the tab shows it, `base`), and writes the difference it makes. */
export function updateMemory(session: string, update: (current: SheetMemory) => SheetMemory, { storage = localStorage, now = Date.now(), target = globalThis, known, base }: MemoryUpdateOptions = {}): void {
  const stored = readMemory(session, storage);
  let before = base ? base(stored) : stored;
  let after = update(before);
  if (after === before) {
    // an update for one of this window's Sends that is not the one shown (a press's late answer): tried against each
    for (const send of sendsOf(storage, session)) {
      if (!pressedHere.has(send.press) || before.sending?.attempt === send.press) continue;
      const shown = { ...before, sending: sendingOf(send) };
      const changed = update(shown);
      if (changed === shown) continue;
      before = shown;
      after = changed;
      break;
    }
  }
  if (after === before) return;
  if (writeMemory(session, before, after, now, storage, known)) target.dispatchEvent(Object.assign(new Event(CHANGED), { session }));
}

/**
 * Writes what C3's `reconcile` changed of the memory a tab's view was made from (`snapshot`, the stored memory it read;
 * `view`, its reconcile against the tab's model), when `settled`: that model was read after the last write of another
 * tab this tab adopted. Each entry only where storage still holds it as the snapshot had it; one another tab changed
 * since, and this tab has not yet adopted, is left, and `conflict` says so: the tab reads the model again.
 */
export function writeReconciled(session: string, snapshot: SheetMemory, view: SheetMemory, settled: boolean, { storage = localStorage, now = Date.now(), target = globalThis, known = () => true }: Omit<MemoryUpdateOptions, 'base'> = {}): { conflict: boolean } {
  if (!settled || snapshot === view) return { conflict: false };
  const { wrote, conflict } = writeDiff(session, snapshot, view, now, storage, known, true);
  if (wrote) target.dispatchEvent(Object.assign(new Event(CHANGED), { session }));
  return { conflict };
}

/** A session's memory changed: in this tab, or in another (the storage event: `adopted`). */
export function onMemory(session: string, listener: (adopted: boolean) => void, target: EventTarget = globalThis): () => void {
  const prefixes = KINDS.map((kind) => prefixOf(kind, session));
  const here = (event: Event) => (event as Event & { session?: string }).session === session && listener(false);
  const there = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || prefixes.some((prefix) => key.startsWith(prefix))) listener(true);
  };
  target.addEventListener(CHANGED, here);
  target.addEventListener('storage', there);
  return () => {
    target.removeEventListener(CHANGED, here);
    target.removeEventListener('storage', there);
  };
}
