// A file outside a session's folders on another machine, from this Mac's main (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, decisions 4 to 6, 12 to 15 and 18; §D).
// Every decision the device makes about the four outside acts is here; remote lane B (./remote.ts) hands this module a
// keyed read and each of the four names with the caller the router built, and the copy route (./remote-artifacts.ts)
// reads a session's file through `read` with the caller its handler was given.
//
// - Where an act begins, one question: `mayPromote(client, machine)`, asked on the caller and the machine of the very
//   read that would become the act: the caller is a live page of an app window (the guard's own predicate), and the
//   roster says the person owns the machine (`outsideOffer`). Every other caller is answered what the plain read
//   answered, and nothing more is sent.
// - A keyed read (decision 5): to a machine whose build does not list the capability, today's read with every key that
//   build's schema does not hold taken off, its refusal of a path outside the folders worded as the update sentence; to
//   one that lists it, the plain read with `named` first, which is all a file inside the folders costs; on the files
//   service's refusal, or an answer the session's deliveries admit read-only (`added`), the act, when the question
//   allows it. The call is bound to the channel whose peer's list was read for it (`oneChannel`, its pages too), so the
//   link never carries keys only that peer reads to the next channel's peer (M3's fix wave; Decision Log 27). When that
//   channel ends before the read is answered (the call, a page, or the act), the read waits for the link's next channel,
//   within the hold the link gives a carried call, and is read afresh there by decision 5's order: a new look at the
//   peer's list, a new call, the act if one is due; once (fix wave 2, the architect's condition 2). So the page sees
//   what today's carried read gave it: the answer, or at the hold's end today's sentence for a machine not reachable.
// - A copy's read ("Open externally"'s, a frame's): today's request to the byte, `named`, `agent` and `open` taken off,
//   held across a channel's end and sent again on the next as every copy's read always was, so any peer may read it; the
//   act only on the service's refusal of a path outside the folders, for a caller the question allows, judged on the
//   channel current when the act goes (Decision Log 27). The frame's `agent` and `open` ride that act alone.
// - The act's reads cross in pages of REMOTE_OUTSIDE_PAGE_BYTES, each an act on one channel, assembled and checked as
//   a call's pages are (./remote-files-read.ts); a page the services' ledger did not keep (its marker) is asked once more
//   under a new operation (decision 4).
// - With no channel current a keyed read, a listing and a choice answer at once (a copy's plain read waits, as above);
//   the save waits under the link's hold within its send window, as `files.write` does, and nothing withdraws it
//   (decision 6; R8).
import { NOT_KEPT_REFUSAL, OUTSIDE_ACTS, OUTSIDE_FILES_CAPABILITY, outsideOffer } from '@shared/files/outside';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { FilesReadOutput } from '@shared/ipc/schema/files';
import type { MachineRef } from '@shared/machine/ref';
import type { RemoteLink } from '../machines/remote/link';
import { readPages } from './remote-files-read';
import { refusalResult } from './remote-outcomes';

/** One page of an outside read: small enough that its answer, escaped at the worst, fits one message of the channel. */
export const REMOTE_OUTSIDE_PAGE_BYTES = 256 * 1024;

/**
 * The files service's refusal of a path outside the session's folders, as it crosses a call's answer: its message, under
 * the code `internal` (src/services/files/service.ts' FILES_REFUSAL, which main does not import; the page knows it the
 * same way, tools/code/copy.ts).
 */
export const OUTSIDE_REFUSAL = "path outside the session's directories";

export type OutsideAct = (typeof OUTSIDE_ACTS)[number];
type Fields = Record<string, unknown>;
type Result = CommandResult<CommandName>;

export interface RemoteOutsideDeps {
  /**
   * Today's paged call (`readInPages`), its log lines naming `label` in place of the path when one is given; `oneChannel`:
   * the call and its pages go only on the channel current when each is made, and fail at its end.
   */
  call(link: RemoteLink, name: 'files.read', fields: Fields, options: { label?: string; oneChannel?: true }): Promise<Result>;
  /** Remote lane B's `machine` act, the capability as its `requires`. */
  act(link: RemoteLink, name: OutsideAct, fields: Fields, options: { oneChannel: boolean; deadline: number }): Promise<Result>;
  /** U6e's `isAppPage(client, appUrl)` bound to the app's URL: the predicate the router's guard uses. */
  isAppPage(client: ClientRef): boolean;
  /** Whether the person owns the machine, as the roster says (what `MachineState.owner` is made from); null: not known. */
  owns(machine: MachineRef): boolean | null;
  now(): number;
  pendingMs: number;
  /** How long the link holds a carried call of `files.read` for its next channel: its budget, else the link's default. */
  holdMs(link: RemoteLink): number;
  log(line: string): void;
}

export interface RemoteOutsideFiles {
  /** The four names. */
  handles(name: CommandName): boolean;
  /** One of the four, sent by a page the router's guard admitted. */
  dispatch(link: RemoteLink, name: CommandName, fields: Fields, client: ClientRef): Promise<Result>;
  /**
   * A keyed read (decision 5's order); `client` null: no page asked, never promoted. `label`: a frame's copy, whose log
   * lines name no path. `copy`: a copy's read ("Open externally"'s, a frame's): today's plain read, held as it always was,
   * then the act on the service's refusal; answered the plain read's refusal where the act is not offered (P2), the keyed
   * read the ownership sentence.
   */
  read(link: RemoteLink, fields: Fields, client: ClientRef | null, options?: { label?: string; copy?: true }): Promise<Result>;
}

const isOutsideAct = (name: string): name is OutsideAct => (OUTSIDE_ACTS as readonly string[]).includes(name);
const without = (fields: Fields, ...keys: string[]): Fields => Object.fromEntries(Object.entries(fields).filter(([key]) => !keys.includes(key)));
const refusalOf = (result: Result): unknown => (result.ok ? undefined : (result.error.issues as { refusal?: unknown } | undefined)?.refusal);
/** The files service refused the path as outside the session's folders. */
const refusedOutside = (result: Result) => !result.ok && result.error.code === 'internal' && result.error.message === OUTSIDE_REFUSAL;
const addedOf = (result: Result) => result.ok && (result.value as FilesReadOutput | undefined)?.outside?.why === 'added';
/** A keyed read whose channel ended before it answered. */
const CHANNEL_ENDED = Symbol('the channel ended');
const unreachable = (name: string, link: RemoteLink): Result => ({ ok: false, error: ipcError('host_unavailable', `${name}: machine ${link.name} is not reachable`) });

export function createRemoteOutsideFiles(deps: RemoteOutsideDeps): RemoteOutsideFiles {
  /** The one question before an act another request turns into: an app page, of a person the roster says owns the machine. */
  const mayPromote = (client: ClientRef | null, machine: MachineRef) => client !== null && deps.isAppPage(client) && outsideOffer(deps.owns(machine));
  const deadline = () => deps.now() + deps.pendingMs;

  /** A read or a listing, on one channel; a copy of its operation the ledger answered with the marker is asked once more. */
  async function askedAgainOnce(link: RemoteLink, name: 'files.readOutside' | 'files.listOutside', fields: Fields, said: string): Promise<Result> {
    const first = await deps.act(link, name, fields, { oneChannel: true, deadline: deadline() });
    if (refusalOf(first) !== NOT_KEPT_REFUSAL) return first;
    deps.log(`lane B: ${name} of ${link.name} ${said}: the machine kept no answer for it; asked again`);
    return deps.act(link, name, fields, { oneChannel: true, deadline: deadline() });
  }

  /** `files.readOutside` in pages, `fields` as its schema holds them. */
  function readOutside(link: RemoteLink, fields: Fields, label?: string): Promise<Result> {
    const said = label ?? String(fields.path);
    return readPages(link, 'files.readOutside', fields, deps.log, {
      page: (page) => askedAgainOnce(link, 'files.readOutside', page, said),
      pageBytes: REMOTE_OUTSIDE_PAGE_BYTES,
      ...(label !== undefined && { label }),
    });
  }

  /**
   * The page's keyed read; once more on the link's next channel, by the hold's end, when the channel it was checked on
   * ended before it answered. A second end, or no channel by then, answers what today's read held that long answers.
   */
  async function keyedRead(link: RemoteLink, fields: Fields, client: ClientRef | null, label: string | undefined): Promise<Result> {
    const until = deps.now() + deps.holdMs(link);
    const first = await onItsChannel(link, () => decided(link, fields, client, label));
    if (first !== CHANNEL_ENDED) return first;
    if (!(await nextChannel(link, until))) return unreachable('files.read', link);
    deps.log(`lane B: files.read of ${link.name} ${label ?? String(fields.path)}: its channel ended before it answered; read again on the next`);
    const again = await onItsChannel(link, () => decided(link, fields, client, label));
    return again === CHANNEL_ENDED ? unreachable('files.read', link) : again;
  }

  /** `read`'s answer, or CHANNEL_ENDED: a channel ended while it was under way and it failed as no machine reachable. */
  async function onItsChannel(link: RemoteLink, read: () => Promise<Result>): Promise<Result | typeof CHANNEL_ENDED> {
    let ended = false;
    const off = link.onChannel((event) => void (event === 'lost' && (ended = true)));
    try {
      const result = await read();
      return ended && !result.ok && result.error.code === 'host_unavailable' ? CHANNEL_ENDED : result;
    } finally {
      off();
    }
  }

  /** Whether a channel is current by `until`, waiting for the link's next one. */
  function nextChannel(link: RemoteLink, until: number): Promise<boolean> {
    if (link.peerCapabilities() !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (current: boolean) => {
        clearTimeout(timer);
        off();
        resolve(current);
      };
      const timer = setTimeout(() => done(false), Math.max(0, until - deps.now()));
      const off = link.onChannel((event) => void (event === 'current' && done(true)));
    });
  }

  /** Decision 5's order, each call on the channel whose peer's list decided its keys. */
  async function decided(link: RemoteLink, fields: Fields, client: ClientRef | null, label: string | undefined): Promise<Result> {
    const peers = link.peerCapabilities();
    if (peers === null) return unreachable('files.read', link);
    const bound = { ...(label !== undefined && { label }), oneChannel: true as const };
    // (i) a build before this landing: today's read to the byte; its refusal of a path outside the folders says to update
    if (!peers.includes(OUTSIDE_FILES_CAPABILITY)) {
      const plain = await deps.call(link, 'files.read', without(fields, 'named', 'agent', 'raw', 'open'), bound);
      return refusedOutside(plain) ? refusalResult('files.readOutside', link.name, 'not-offered') : plain;
    }
    // (ii) the plain read, with `named`: a file inside the folders costs this one call; a call asks nothing of a private folder
    const plain = await deps.call(link, 'files.read', without(fields, 'open'), bound);
    const added = addedOf(plain);
    if (!added && !refusedOutside(plain)) return plain;
    // (iv) no act for any other caller, nor for a person this build does not offer it to
    if (!mayPromote(client, link.machine)) return client !== null && deps.isAppPage(client) && !added ? refusalResult('files.readOutside', link.name, 'owners-only') : plain;
    // (iii) the act, by the outside rule: no `named` (the act always asks by it) and no raw read across a link
    const outside = await readOutside(link, without(fields, 'named', 'raw'), label);
    return added && !outside.ok ? plain : outside;
  }

  /** A copy's read: today's plain read, held as it always was; the act on the service's refusal alone. */
  async function copyRead(link: RemoteLink, fields: Fields, client: ClientRef | null, label: string | undefined): Promise<Result> {
    const plain = await deps.call(link, 'files.read', without(fields, 'named', 'agent', 'open'), label !== undefined ? { label } : {});
    if (!refusedOutside(plain)) return plain;
    // the peer the act would go to: the channel current now, which may not be the one that refused
    const peers = link.peerCapabilities();
    if (peers !== null && !peers.includes(OUTSIDE_FILES_CAPABILITY)) return refusalResult('files.readOutside', link.name, 'not-offered');
    if (!mayPromote(client, link.machine)) return plain;
    if (peers === null) return unreachable('files.readOutside', link);
    return readOutside(link, without(fields, 'named', 'raw'), label);
  }

  return {
    handles: (name) => isOutsideAct(name),

    read: (link, fields, client, { label, copy } = {}) => (copy === true ? copyRead(link, fields, client, label) : keyedRead(link, fields, client, label)),

    async dispatch(link, name, fields) {
      if (!isOutsideAct(name)) return { ok: false, error: ipcError('internal', `${name}: not an act on a file outside a session's folders`) };
      const peers = link.peerCapabilities();
      if (peers !== null && !peers.includes(OUTSIDE_FILES_CAPABILITY)) return refusalResult(name, link.name, 'not-offered');
      if (!outsideOffer(deps.owns(link.machine))) return refusalResult(name, link.name, 'owners-only');
      // the save as `files.write` goes: held under the link's hold within its send window, its `requires` judged at the
      // channel it meets, answered at its outcome or at the pending bound; nothing withdraws it
      if (name === 'files.writeOutside') return deps.act(link, name, fields, { oneChannel: false, deadline: deadline() });
      if (peers === null) return unreachable(name, link);
      if (name === 'files.readOutside') return readOutside(link, fields);
      if (name === 'files.listOutside') return askedAgainOnce(link, name, fields, String(fields.path ?? '~'));
      return deps.act(link, name, fields, { oneChannel: true, deadline: deadline() });
    },
  };
}
