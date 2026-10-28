// Direct revocation delivery (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M3's "Direct
// delivery"; Interfaces §K; RL §5.2). A revocation must reach the machines whether or not the hub carries it: each state
// the app signs that moves a key into `revoked` or `retired` is also sent to every machine of the roster at its signing
// (less one the state itself removes) as `endpoint.state` over O7's links, until each acknowledges it.
//
// - The obligation (`{hash, signed, owed, known, probed, tooLarge}` in signing.json) is written by the signer in the same
//   store update as the pending slot, with the signed bytes, before anything is sent. The slot clears at the hub's
//   acceptance; the obligation when its last machine acknowledges or leaves. A crash between them loses neither.
// - Only the app's own line is ever sent: the held chain, plus the pending state while the slot holds it as a candidate
//   (its parent the held head). A `pending-fork` slot's obligation is suspended; a discard removes it with the slot (the
//   signer's). An obligation whose state the held chain replaced (a recovery superseded it) can never be on the line
//   again and is dropped; the superseded offer is what carries its revocations onto the recovered line.
// - Runs page forward through that line, at most DELIVERY_MAX_BYTES each, with every accepted transition. Per machine and
//   obligation, a cursor `known {version, line}` says the machine's head is on the app's line at `version`; `line`
//   names the line the cursor was set on, so a rewind the app adopts resets every cursor.
//     1. Recovery first: while the line holds an accepted transition, a machine with no cursor on it gets one run from the
//        state at the newest transition's `fromVersion` (its base, which the whole held chain keeps), so an endpoint on a
//        superseded branch rewinds by it (`EndpointOrg`'s rewind needs the base and the state after it). A probe, tried
//        once per machine per line: any answer records `probed`.
//     2. Finding the head, without a cursor: runs start at the link's `caps().stateVersion` (else genesis) and include
//        that version's state. `done {version}` (the endpoint adopted states of the run, or holds the run's state at its
//        head) sets the cursor; `not-newer` or `rollback` moves the next start past the run's last state.
//     3. Forward catch-up from a cursor at v: runs from v + 1. A `done` must raise the version; `not-newer` or
//        `rollback` says the machine has moved past the run, so its head is found again from there.
//   A run that can't hold even its first state stops that machine's delivery as `too-large` (its cursor cleared, so the
//   next retry finds its head again, once its own hub sync has moved it past the large state).
// - A `done` whose version is at least the obligation's state's acknowledges the machine. Anything else stays owed,
//   sent again at the machine's next link up and every DELIVERY_RETRY_MS.
// - Exposure: a run that carries the pending state writes the machine into the slot's `exposed.machines` before its act,
//   so a send whose answer never came counts as exposed, and a later discard names the machine under `abandoned`.
//
// Network calls run outside the signing store's updates. Electron-free; the links, the roster and the held view are
// injected (main's `Machines.remote`, `onRemote` and the session's held view).
import { createHash } from 'node:crypto';
import { canonicalize, stateHash, type Certificates, type OrgState, type RootTransition, type Signed, type SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import type { MachineRef } from '@shared/machine/ref';
import type { ActOutcome, RemoteLink } from '../machines/remote/link';
import type { Obligation, SigningFile } from './files';
import type { HeldOrg } from './held';
import { judgePending } from './signer';
import { withExposure, type SigningStore } from './signing-store';
import { orgTiming, type OrgTiming } from './timing';

/** What the deliveries need of a machine's link (main's `Machines.remote(ref)`). */
export type DeliveryLink = Pick<RemoteLink, 'state' | 'caps' | 'act' | 'onState'>;

export type Owing = { version: number; machines: MachineRef[]; tooLarge: MachineRef[] };

export interface Deliveries {
  /** The obligation `signed` makes, owed to the roster less the machines it removes; null when it ends no key. */
  obligation(signed: SignedOrgState, parent: OrgState): Promise<Obligation | null>;
  /** Sends each owed machine whose link is up what its obligation's state on the app's line needs. One pass at a time. */
  send(): Promise<void>;
  /** The machines still owing an acknowledgement, per version (and those a run can't reach: `tooLarge`). */
  owing(): Owing[];
  /** `owing()` changed. */
  onChanged(listener: () => void): () => void;
  close(): void;
}

export type DeliveriesDeps = {
  store: SigningStore;
  /** O7's RL2 roster (`Machines.onRemote`'s refs). */
  roster(): readonly MachineRef[];
  onRoster(listener: () => void): () => void;
  /** `Machines.remote(ref)`. */
  link(ref: MachineRef): DeliveryLink | null;
  view: () => HeldOrg | null;
  timing?: Partial<OrgTiming>;
  log(line: string): void;
};

/** The bytes one `endpoint.state` run's arguments take on the wire, the bound's measure. */
export function runBytes(states: readonly SignedOrgState[], transitions: readonly Signed<RootTransition>[]): number {
  return Buffer.byteLength(JSON.stringify({ states, transitions }));
}

/**
 * The line the held view is on, as a number: a digest of its accepted transitions, which change at every rewind (a
 * recovery transition joins them, and the ones it rewound past leave). Not their count: a rewind past one forward
 * transition leaves the count as it was.
 */
export function lineOf(view: HeldOrg): number {
  const digest = createHash('sha256').update(canonicalize(view.since(0).transitions.map((t) => t.body))).digest('hex');
  return parseInt(digest.slice(0, 12), 16);
}

const ended = (keys: ReadonlyArray<{ keyId: string }>) => new Set(keys.map((k) => k.keyId));

/** `next` moves a key id into `revoked` or `retired` relative to `parent`. */
function endsKeys(parent: OrgState, next: OrgState): boolean {
  const revoked = ended(parent.revoked);
  const retired = ended(parent.retired);
  return next.revoked.some((r) => !revoked.has(r.keyId)) || next.retired.some((r) => !retired.has(r.keyId));
}

/** The machines `next` takes out of the org: an enrolled one it drops, one whose key it ends without keeping it enrolled, a certificate's whose delegation it drops. */
function removedMachines(parent: OrgState, next: OrgState, certificates: Certificates): Set<string> {
  const enrolled = new Set(next.machines.map((m) => m.ref));
  const out = new Set<string>(parent.machines.map((m) => m.ref).filter((ref) => !enrolled.has(ref)));
  const revoked = ended(parent.revoked);
  const retired = ended(parent.retired);
  for (const r of [...next.revoked.filter((k) => !revoked.has(k.keyId)), ...next.retired.filter((k) => !retired.has(k.keyId))]) {
    if ('machine' in r.holder && !enrolled.has(r.holder.machine)) out.add(r.holder.machine);
  }
  const delegations = new Set(next.delegations.map((d) => d.id));
  for (const cert of certificates.certs) {
    if (parent.delegations.some((d) => d.id === cert.body.delegation) && !delegations.has(cert.body.delegation)) out.add(cert.body.machine);
  }
  return out;
}

/** The refs the held org still names: enrolled, or certified under a delegation it lists. */
function namedBy(view: HeldOrg): Set<string> {
  const head = view.head().state;
  const delegations = new Set(head.delegations.map((d) => d.id));
  return new Set([...head.machines.map((m) => m.ref), ...view.certificates().certs.filter((c) => delegations.has(c.body.delegation)).map((c) => c.body.machine)]);
}

/** An act's outcome in the endpoint's words: `done {version}`, `failed {code}`, or no answer that judges the run. */
type Answer = { kind: 'done'; version: number } | { kind: 'failed'; code: string } | { kind: 'none'; why: string };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Endpoint codes that say nothing of the run: it could not be judged (no org yet, an internal error). */
const UNJUDGED = new Set(['unavailable', 'internal']);
function answerOf(outcome: ActOutcome): Answer {
  if (outcome.state === 'done') {
    const version = isObject(outcome.result) ? outcome.result.version : undefined;
    return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? { kind: 'done', version } : { kind: 'none', why: 'done without a version' };
  }
  if (outcome.state === 'failed') {
    const code = isObject(outcome.error) && typeof outcome.error.code === 'string' ? outcome.error.code : 'failed';
    return UNJUDGED.has(code) ? { kind: 'none', why: code } : { kind: 'failed', code };
  }
  return { kind: 'none', why: `${outcome.state}${'reason' in outcome ? ` ${outcome.reason}` : ''}` };
}

/** Where an obligation's state stands against the app's line. */
type Placement = { on: true; states: SignedOrgState[]; pending: SignedOrgState | null } | { on: false; why: 'suspended' | 'superseded' };

export function createDeliveries(deps: DeliveriesDeps): Deliveries {
  const { store } = deps;
  const timing = orgTiming(deps.timing);
  const log = (line: string) => deps.log(`deliveries: ${line}`);
  const listeners = new Set<() => void>();
  let closed = false;

  function owing(): Owing[] {
    const file = store.get();
    if (file === 'damaged') return [];
    return file.deliveries
      .map((o) => ({ version: o.signed.state.version, machines: [...o.owed] as MachineRef[], tooLarge: [...o.tooLarge] as MachineRef[] }))
      .sort((a, b) => a.version - b.version);
  }
  let shown = JSON.stringify(owing());
  function changed(): void {
    const next = JSON.stringify(owing());
    if (next === shown) return;
    shown = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log(`a listener failed: ${(error as Error).message}`);
      }
    }
  }

  /** One update of the obligation `hash` names (a no-op once it is gone); the obligation is dropped once nothing is owed. */
  async function change(hash: string, fn: (o: Obligation, file: SigningFile) => void): Promise<void> {
    await store.update((file) => {
      const o = file.deliveries.find((x) => x.hash === hash);
      if (o === undefined) return { next: file, value: undefined };
      fn(o, file);
      if (o.owed.length === 0) file.deliveries = file.deliveries.filter((x) => x !== o);
      return { next: file, value: undefined };
    });
    changed();
  }

  function forget(o: Obligation, ref: string): void {
    o.owed = o.owed.filter((r) => r !== ref);
    delete o.known[ref];
    delete o.probed[ref];
    o.tooLarge = o.tooLarge.filter((r) => r !== ref);
  }

  async function placement(o: Obligation, file: SigningFile, view: HeldOrg): Promise<Placement> {
    const held = view.since(0).states;
    const slot = file.pending;
    if (slot !== null && (await stateHash(slot.signed.state)) === o.hash) {
      const verdict = await judgePending(slot, view);
      if (verdict === 'fork') return { on: false, why: 'suspended' };
      if (verdict === 'candidate') return { on: true, states: [...held, slot.signed], pending: slot.signed };
    }
    const at = held[o.signed.state.version - 1];
    if (at !== undefined && (await stateHash(at.state)) === o.hash) return { on: true, states: held, pending: null };
    return { on: false, why: 'superseded' };
  }

  /** Consecutive states of `line` from version `from`, as many as the bound holds with `transitions`. */
  function take(line: SignedOrgState[], from: number, transitions: Signed<RootTransition>[]): SignedOrgState[] {
    const out: SignedOrgState[] = [];
    let bytes = runBytes([], transitions);
    for (const s of line.slice(from - 1)) {
      bytes += Buffer.byteLength(JSON.stringify(s)) + (out.length === 0 ? 0 : 1);
      if (bytes > timing.DELIVERY_MAX_BYTES) break;
      out.push(s);
    }
    return out;
  }

  /** Runs to one machine for one obligation until it acknowledges, stops progressing, or can't be sent to now. */
  async function deliverTo(hash: string, ref: MachineRef): Promise<void> {
    /** In this pass: where head-finding starts next, once a run has moved it past caps. */
    let hunt: number | null = null;
    for (;;) {
      if (closed) return;
      const link = deps.link(ref);
      const view = deps.view();
      const file = store.get();
      if (link === null || link.state() !== 'up' || view === null || file === 'damaged') return;
      const o = file.deliveries.find((x) => x.hash === hash);
      if (o === undefined || !o.owed.includes(ref)) return;
      const place = await placement(o, file, view);
      if (!place.on) return;
      const line = lineOf(view);
      const transitions = view.since(0).transitions;
      const target = o.signed.state.version;
      const end = place.states.length;
      const cursor = o.known[ref]?.line === line ? o.known[ref].version : null;
      const newest = transitions.reduce<Signed<RootTransition> | null>((a, t) => (a === null || t.body.issued > a.body.issued ? t : a), null);

      let kind: 'probe' | 'find' | 'forward';
      let from: number;
      if (cursor !== null) {
        kind = 'forward';
        from = cursor + 1;
      } else if (newest !== null && o.probed[ref] !== line) {
        kind = 'probe';
        from = newest.body.fromVersion;
      } else {
        kind = 'find';
        const caps = link.caps()?.stateVersion;
        from = hunt ?? (typeof caps === 'number' && caps >= 1 ? caps : 1);
      }
      // Past the app's line: the machine is ahead of what the app holds, and waits until the app adopts that far.
      if (from > end) return;
      const states = take(place.states, from, transitions);
      if (states.length === 0) {
        log(`version ${from} alone is over ${timing.DELIVERY_MAX_BYTES} bytes: ${ref} catches up through its own hub sync`);
        await change(hash, (x) => {
          if (!x.tooLarge.includes(ref)) x.tooLarge.push(ref);
          delete x.known[ref];
          x.probed[ref] = line;
        });
        return;
      }
      const last = states[states.length - 1].state.version;
      const pending = place.pending !== null && last === place.pending.state.version ? place.pending : null;

      // Still owed, the slot unchanged, and the machine written into the slot's exposure before a run carries it.
      const go = await store.update((f) => {
        const x = f.deliveries.find((y) => y.hash === hash);
        if (x === undefined || !x.owed.includes(ref)) return { next: f, value: false };
        if (pending === null) return { next: f, value: true };
        if (f.pending === null || canonicalize(f.pending.signed.state) !== canonicalize(pending.state)) return { next: f, value: false };
        return { next: withExposure(f, pending, { machine: ref }), value: true };
      });
      if (!go) return;

      const answer = answerOf(await link.act({ action: 'endpoint.state', args: { states, transitions }, stepUp: 'never' }).outcome);
      if (answer.kind === 'none') {
        log(`version ${target} to ${ref}: no answer that judges the run (${answer.why}); sent again later`);
        return;
      }
      if (answer.kind === 'done') {
        if (kind === 'forward' && answer.version <= (cursor as number)) {
          log(`version ${target} to ${ref}: a run from ${from} answered done at ${answer.version}, not past the cursor; sent again later`);
          return;
        }
        const acknowledged = answer.version >= target;
        await change(hash, (x) => {
          if (acknowledged) return forget(x, ref);
          x.known[ref] = { version: answer.version, line };
          if (kind === 'probe') x.probed[ref] = line;
          x.tooLarge = x.tooLarge.filter((r) => r !== ref);
        });
        if (acknowledged) {
          log(`version ${target} acknowledged by ${ref} at version ${answer.version}`);
          return;
        }
        continue;
      }
      // failed {code}
      if (kind === 'probe') {
        await change(hash, (x) => void (x.probed[ref] = line));
        continue;
      }
      if (answer.code === 'not-newer' || answer.code === 'rollback') {
        if (kind === 'forward') await change(hash, (x) => void delete x.known[ref]);
        hunt = last + 1;
        continue;
      }
      log(`version ${target} to ${ref}: a run from ${from} refused ${answer.code}; sent again later`);
      return;
    }
  }

  /** Machines that left the roster and that the held org no longer names are no longer owed. */
  async function prune(): Promise<void> {
    const view = deps.view();
    const file = store.get();
    if (view === null || file === 'damaged' || file.deliveries.length === 0) return;
    const roster = new Set<string>(deps.roster());
    const named = namedBy(view);
    const gone = (ref: string) => !roster.has(ref) && !named.has(ref);
    if (!file.deliveries.some((o) => o.owed.some(gone))) return;
    await store.update((f) => {
      for (const o of f.deliveries) for (const ref of o.owed.filter(gone)) forget(o, ref);
      f.deliveries = f.deliveries.filter((o) => o.owed.length > 0);
      return { next: f, value: undefined };
    });
    changed();
  }

  /** Obligations whose state the held chain replaced: never on the app's line again. */
  async function dropSuperseded(view: HeldOrg): Promise<void> {
    const file = store.get();
    if (file === 'damaged') return;
    const off: string[] = [];
    for (const o of file.deliveries) {
      const place = await placement(o, file, view);
      if (!place.on && place.why === 'superseded') off.push(o.hash);
    }
    if (off.length === 0) return;
    await store.update((f) => {
      f.deliveries = f.deliveries.filter((o) => !off.includes(o.hash));
      return { next: f, value: undefined };
    });
    log(`${off.length} obligation(s) dropped: their states are no longer on the held chain (a recovery superseded them)`);
    changed();
  }

  async function pass(): Promise<void> {
    await prune();
    const view = deps.view();
    if (view === null) return;
    await dropSuperseded(view);
    const file = store.get();
    if (file === 'damaged') return;
    const order = [...file.deliveries].sort((a, b) => a.signed.state.version - b.signed.state.version);
    for (const o of order) {
      for (const ref of o.owed) {
        if (closed) return;
        try {
          await deliverTo(o.hash, ref as MachineRef);
        } catch (error) {
          log(`delivering version ${o.signed.state.version} to ${ref} failed: ${(error as Error).message}`);
        }
      }
    }
  }

  let running: Promise<void> | null = null;
  let again = false;
  function send(): Promise<void> {
    if (closed) return Promise.resolve();
    if (running !== null) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await pass();
      } while (again && !closed);
    })().finally(() => {
      running = null;
    });
    return running;
  }
  const sendLogged = () => void send().catch((error: unknown) => log(`a pass failed: ${(error as Error).message}`));

  /** One `onState` per roster machine's link: an owed machine is sent to again when its link comes up. */
  const watched = new Map<MachineRef, { link: DeliveryLink; off: () => void }>();
  function watch(): void {
    const roster = new Set(deps.roster());
    for (const [ref, w] of watched) {
      if (roster.has(ref) && deps.link(ref) === w.link) continue;
      w.off();
      watched.delete(ref);
    }
    for (const ref of roster) {
      if (watched.has(ref)) continue;
      const link = deps.link(ref);
      if (link === null) continue;
      watched.set(ref, { link, off: link.onState((state) => state === 'up' && sendLogged()) });
    }
  }

  watch();
  const offRoster = deps.onRoster(() => {
    watch();
    void prune().catch((error: unknown) => log(`pruning the roster failed: ${(error as Error).message}`));
  });
  const timer = setInterval(sendLogged, timing.DELIVERY_RETRY_MS);
  timer.unref?.();

  return {
    async obligation(signed, parent) {
      if (!endsKeys(parent, signed.state)) return null;
      const removed = removedMachines(parent, signed.state, deps.view()?.certificates() ?? { certs: [], retirements: [] });
      const owed = [...new Set<string>(deps.roster())].filter((ref) => !removed.has(ref));
      if (owed.length === 0) return null;
      return { hash: await stateHash(signed.state), signed, owed, known: {}, probed: {}, tooLarge: [] };
    },
    send,
    owing,
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      closed = true;
      clearInterval(timer);
      offRoster();
      for (const w of watched.values()) w.off();
      watched.clear();
      listeners.clear();
    },
  };
}
