// "+ Session" on another machine (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The machine menu"
// (A5, P5 Decision Log 108) and "`session.spawn`"; the M4b report's contract for the renderer).
//
// - The menu. A New chat tab runs on this Mac unless its machine menu chose another: an RL2 machine that is up and whose
//   own projects (`session.projects.list`, a `list` call over its link) hold a checkout of the same org project as the
//   one chosen (`ProjectRecord.org.key`, O6's key). The choice is this window's, per tab and per org project: choosing
//   another project brings the tab back to this Mac.
// - The spawn. Send makes one `session.spawn` on that machine with the composer's mode (required: the machine's own
//   default may be looser), its model and effort when chosen, the Worktree box's name, and the text as the brief. Main
//   steps it up (the sheet, then Touch ID) and answers at its outcome. The tab stays this Mac's New chat until then, and
//   moves to the new session's address on success; the local intent is discarded. A refusal is said in words a person
//   can act on, and the tab stays as it was, its text kept.
// - With attachments, no brief: the composer's whole document becomes the new session's draft (this window's memory, as
//   any remote draft), the tab moves, and the new session's composer sends it once it is open, through the remote send
//   path (its files go up first, then one `session.send` names their paths there; a failed upload keeps the text with
//   Send again on the session that started).
// - A spawn answered `timeout` (the machine took it, no outcome yet) is asked again, by Retry or Send, with the same input,
//   whatever the text became: main's adapter answers it from the act it still queries, so it starts one session.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { IpcError } from '@shared/ipc/errors';
import type { MawsBridge } from '@shared/ipc/schema';
import { tabId } from '@shared/ipc/schema/layout';
import { addressOf, bareOf, machineOf } from '@shared/machine/address';
import type { SessionSpawnInput } from '@shared/ipc/schema/session';
import type { MachineRef } from '@shared/machine/ref';
import type { Location } from '@shared/sessions/intent';
import { attachmentsOf, type ComposerDoc } from '../composer/editor/doc';
import { rememberRemoteDraft } from '../composer/editor/drafts';
import type { Serialized } from '../composer/editor/serialize';
import { ipc } from '../ipc/client';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';

/** A machine a New chat tab can start its session on, with the checkout of its project there. */
export interface SpawnTarget {
  machine: MachineRef;
  name: string;
  checkout: string; // the directory of that machine's project of the same org project
  key: string; // the org project it was chosen for
}

export interface RemoteSpawnStore {
  chosen: ReadonlyMap<AppSessionId, SpawnTarget>; // by New chat tab; absent: this Mac
  spawning: ReadonlyMap<AppSessionId, string>; // the tabs whose spawn is on its way, with the words that say so
  choose(tab: AppSessionId, target: SpawnTarget | null): void;
}

const firstSends = new Set<AppSessionId>(); // the spawned sessions whose composer sends the handed document once
// A spawn the machine took but hasn't confirmed (`timeout`, or `unknown`), by New chat tab, in the window's session storage
// (it outlives a reload of the page, as main's attempt does): the tab's next ask is a check on it, under the same attempt
// key. Main answers it from that attempt (one act, its op queried; never a second session). The record restores the
// machine the tab was starting on after a reload, and keeps the input it sent, to say whether the text changed since.
// `attempt`: the key's number (0: the tab's own id; n: `<tab>~n`, after the person chose to start anew).
const UNCONFIRMED = 'maws.spawn.unconfirmed:';
type Unconfirmed = { target: SpawnTarget; input: SessionSpawnInput; attempt: number; unknown: boolean };
const unconfirmed = {
  get(tab: AppSessionId): Unconfirmed | null {
    const kept = sessionStorage.getItem(UNCONFIRMED + tab);
    return kept === null ? null : (JSON.parse(kept) as Unconfirmed);
  },
  set: (tab: AppSessionId, value: Unconfirmed) => sessionStorage.setItem(UNCONFIRMED + tab, JSON.stringify(value)),
  delete: (tab: AppSessionId) => sessionStorage.removeItem(UNCONFIRMED + tab),
  clear() {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(UNCONFIRMED)) sessionStorage.removeItem(key);
  },
};

// The machines the tabs were starting on when the page was loaded: a held attempt's (an ordinary choice is memory only).
const heldTargets = (): Map<AppSessionId, SpawnTarget> => {
  const chosen = new Map<AppSessionId, SpawnTarget>();
  for (const key of Object.keys(sessionStorage)) {
    if (!key.startsWith(UNCONFIRMED)) continue;
    const tab = key.slice(UNCONFIRMED.length) as AppSessionId;
    const held = unconfirmed.get(tab);
    if (held !== null) chosen.set(tab, held.target);
  }
  return chosen;
};

export const useRemoteSpawn = create<RemoteSpawnStore>()((set) => ({
  chosen: heldTargets(),
  spawning: new Map(),
  choose(tab, target) {
    set((s) => {
      const chosen = new Map(s.chosen);
      if (target === null) chosen.delete(tab);
      else chosen.set(tab, target);
      return { chosen };
    });
  },
}));

/** The machines of the attempts still held, chosen again (what loading the page does; tests: a reload). */
export function restoreHeldAttempts(): void {
  useRemoteSpawn.setState((s) => ({ chosen: new Map([...s.chosen, ...heldTargets()]) }));
}

export function resetRemoteSpawn(): void {
  firstSends.clear();
  unconfirmed.clear();
  useRemoteSpawn.setState({ chosen: new Map(), spawning: new Map() });
}

const targetFor = (chosen: ReadonlyMap<AppSessionId, SpawnTarget>, tab: AppSessionId, key: string | null): SpawnTarget | null => {
  const target = chosen.get(tab);
  return target !== undefined && target.key === key ? target : null;
};
/** The machine the tab starts on for the org project `key`; null: this Mac. */
export const spawnTargetOf = (tab: AppSessionId, key: string | null): SpawnTarget | null => targetFor(useRemoteSpawn.getState().chosen, tab, key);
export const useSpawnTarget = (tab: AppSessionId, key: string | null): SpawnTarget | null => useRemoteSpawn((s) => targetFor(s.chosen, tab, key));
export const useSpawning = (tab: AppSessionId): string | null => useRemoteSpawn((s) => s.spawning.get(tab) ?? null);
/** Whether the tab's last spawn was taken but not confirmed: its next try checks on that start. */
export const spawnUnconfirmed = (tab: AppSessionId): boolean => unconfirmed.get(tab) !== null;

/** The spawned session's composer sends the document it was handed (its remote draft) once it opens. */
export function queueFirstSend(appSessionId: AppSessionId): void {
  firstSends.add(appSessionId);
}

/** Whether the session's composer is to send its handed document now (once). */
export function takeFirstSend(appSessionId: AppSessionId): boolean {
  return firstSends.delete(appSessionId);
}

// ---- the menu's machines -----------------------------------------------------------------------------------------

/** The up RL2 machines whose projects hold a checkout of the org project `key`, in the roster's order. */
export async function readCandidates(key: string, client: MawsBridge = ipc): Promise<SpawnTarget[]> {
  const machines = [...useMachines.getState().machines.values()].filter((m) => !m.local && m.state === 'up' && (m.carrier === 'direct' || m.carrier === 'relay'));
  const found = await Promise.all(
    machines.map(async (machine): Promise<SpawnTarget | null> => {
      const read = await client.invoke('session.projects.list', undefined, { machine: machine.ref }).catch(() => null);
      if (read === null || !read.ok) return null;
      const checkout = read.value.projects.find((p) => p.org?.key === key && p.discovered !== true);
      return checkout === undefined ? null : { machine: machine.ref, name: machine.name, checkout: checkout.directory, key };
    }),
  );
  return found.filter((target): target is SpawnTarget => target !== null);
}

// ---- the spawn ---------------------------------------------------------------------------------------------------

export const SPAWN_WORDS = {
  starting: (machine: string) => `Starting on ${machine}…`,
  checking: (machine: string, edited = false) => `Checking on the start on ${machine}…${edited ? ' Your edit is sent only once this start is settled' : ''}`,
  unconfirmed: (machine: string, edited = false) => `Still starting on ${machine}: it took the request but hasn’t confirmed it yet${edited ? '. Your edit is sent only once this start is settled' : ''}`,
  checkAgain: 'Check again',
  editKept: (machine: string) => `Started on ${machine} with your first message; your edit is in the message box, not sent`,
  untrusted: (machine: string) => `This project isn’t trusted on ${machine} yet; open it there and trust it first`,
  unknownCheckout: (machine: string) => `${machine} no longer has this project’s checkout; choose the machine again`,
  worktreeExists: (machine: string) => `${machine} already has a worktree of that name; turn Worktree off and on for a new name`,
  refused: (machine: string, reason: string) => `Not started on ${machine}: ${reason}`,
  cancelled: 'Not started: the confirmation was cancelled',
  grade: (machine: string) => `You can’t start sessions on ${machine}; ask its owner for the right to`,
  ceiling: (machine: string) => `${machine} doesn’t start sessions in this permission mode; choose a stricter mode`,
  notOffered: (machine: string) => `${machine} doesn’t take new sessions from this Mac yet; update MAWS on ${machine}`,
  malformed: (machine: string) => `${machine} couldn’t read the request; update MAWS on ${machine}`,
  unknown: (machine: string) => `Couldn’t confirm whether it started on ${machine} yet`,
  stillUnknown: (machine: string) => `Still couldn’t confirm whether it started on ${machine}, and it may have. Check again, or start a new session there: the first one may then start too`,
  startNew: (machine: string) => `Start a new session on ${machine}`,
} as const;

/** A spawn's error in words: the machine's and the link's refusals named, main's own words as they are. */
export function spawnErrorWords(error: Pick<IpcError, 'code' | 'message' | 'issues'>, machine: string): string {
  const refusal = (error.issues as { refusal?: unknown } | undefined)?.refusal;
  switch (refusal) {
    case 'step-up-cancelled':
      return SPAWN_WORDS.cancelled;
    case 'grade':
      return SPAWN_WORDS.grade(machine);
    case 'ceiling':
      return SPAWN_WORDS.ceiling(machine);
    case 'unknown-checkout':
      return SPAWN_WORDS.unknownCheckout(machine);
    case 'not-offered':
      return SPAWN_WORDS.notOffered(machine);
    case 'malformed':
      return SPAWN_WORDS.malformed(machine);
    case 'unknown':
      return SPAWN_WORDS.unknown(machine);
    default:
      return error.message;
  }
}

function refusedWords(reason: string, machine: string): string {
  if (reason === 'untrusted') return SPAWN_WORDS.untrusted(machine);
  if (reason === 'unknown-checkout') return SPAWN_WORDS.unknownCheckout(machine);
  if (reason === 'worktree-exists') return SPAWN_WORDS.worktreeExists(machine);
  return SPAWN_WORDS.refused(machine, reason);
}

export interface SpawnRequest {
  from: AppSessionId; // the New chat tab's session
  target: SpawnTarget;
  s: Serialized; // the first message as the composer serialized it
  doc: ComposerDoc; // the composer's document, its attachments with it
  intent: { model: string | null; effort: string | null; location: Location | null };
  mode: string; // the composer's permission mode
  fresh?: boolean; // the person chose "Start a new session": a new attempt key, the held one let go
}

const setSpawning = (tab: AppSessionId, words: string | null) =>
  useRemoteSpawn.setState((s) => {
    const spawning = new Map(s.spawning);
    if (words === null) spawning.delete(tab);
    else spawning.set(tab, words);
    return { spawning };
  });

/** A spawn's outcome: started (the tab moved, with a note to say), or not, in words, with whether a try checks on it. */
// `again`: what the toast offers: a check on the start still out, a retry, or nothing (an outcome that can't be known: the
// person checks the machine first, and only a deliberate Send starts again)
// `startNew`: the person may choose to start a new session anew (an unknown asked again, still unknown)
export type SpawnOutcome = { started: true; note?: string } | { started: false; words: string; again: 'check' | 'retry' | null; startNew?: true };

/** Starts the session on the target's machine and moves the tab there. */
export async function spawnOnMachine(request: SpawnRequest, client: MawsBridge = ipc): Promise<SpawnOutcome> {
  const { from, target, s, doc, intent, mode } = request;
  const held = unconfirmed.get(from);
  const asked = held?.target.machine === target.machine ? held : null;
  // a check on the start the machine took, under its attempt key; "Start a new session": the next key, a new start
  const attempt = request.fresh === true ? (held?.attempt ?? 0) + 1 : (asked?.attempt ?? 0);
  const again = request.fresh === true ? null : (asked?.input ?? null);
  const key = attempt === 0 ? from : addressOf(machineOf(from), `${bareOf(from)}~${attempt}` as AppSessionId); // an attempt key only
  const attached = attachmentsOf(doc).length > 0;
  const text = s.text.trim() !== '' ? s.text : null;
  // The first message goes from the new session's composer when the spawn carries no brief (attachments go up first);
  // a check on a start that carried one leaves an edit since in the message box, unsent.
  const handed = again === null ? attached : again.brief === undefined;
  const editKept = again?.brief !== undefined && (attached || text !== again.brief);
  const brief = !handed ? text : null;
  const input: SessionSpawnInput = again ?? {
    checkout: target.checkout,
    permission_mode: mode,
    ...(intent.model !== null && { model: intent.model }),
    ...(intent.effort !== null && { effort: intent.effort }),
    ...(intent.location?.kind === 'newWorktree' && { worktree: intent.location.name }),
    ...(brief !== null && { brief }),
  };
  setSpawning(from, again === null ? SPAWN_WORDS.starting(target.name) : SPAWN_WORDS.checking(target.name, editKept));
  let spawned: AppSessionId;
  try {
    const result = await client.invoke('session.spawn', input, { machine: target.machine, from: key }); // main keeps the attempt by its key
    const unknown = !result.ok && (result.error.issues as { refusal?: unknown } | undefined)?.refusal === 'unknown';
    if (!result.ok && (result.error.code === 'timeout' || unknown)) unconfirmed.set(from, { target, input, attempt, unknown });
    else unconfirmed.delete(from);
    if (!result.ok && result.error.code === 'timeout') return { started: false, words: SPAWN_WORDS.unconfirmed(target.name, editKept), again: 'check' };
    // An unknown is asked again at the next ask (main queries the same op), never started anew silently: asked again and
    // still unknown, the person may choose to start a new session.
    if (unknown && asked?.unknown === true) return { started: false, words: SPAWN_WORDS.stillUnknown(target.name), again: 'check', startNew: true };
    if (unknown) return { started: false, words: SPAWN_WORDS.unknown(target.name), again: 'check' };
    if (!result.ok) return { started: false, words: spawnErrorWords(result.error, target.name), again: 'retry' };
    if (result.value.status !== 'ok') return { started: false, words: refusedWords(result.value.reason, target.name), again: 'retry' };
    spawned = result.value.appSessionId;
  } finally {
    setSpawning(from, null);
  }
  if (handed || editKept) rememberRemoteDraft(spawned, doc);
  if (handed) queueFirstSend(spawned);
  useLayout.getState().retargetTab(tabId({ kind: 'session', appSessionId: from }), { kind: 'session', appSessionId: spawned });
  useRemoteSpawn.getState().choose(from, null);
  void client.invoke('session.intent.discard', { appSessionId: from }).then((result) => {
    if (!result.ok) console.warn('[sessions] the New chat tab’s intent was not discarded after its spawn', result.error);
  });
  return editKept ? { started: true, note: SPAWN_WORDS.editKept(target.name) } : { started: true };
}
