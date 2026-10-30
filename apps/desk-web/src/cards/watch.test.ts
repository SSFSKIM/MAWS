// The device's watch over the cut-over machines (P5 O13 M5): a Machine socket per machine the head resolves, the board
// drawn from their presence and the listings, a machine that leaves the head closed, an offline one keeping its rows.
import { base64urlEncode, generateSigningKey, NO_CERTIFICATES, signRecord, SIGNING_DOMAINS, type Certificates, type Listing, type RelayPresence, type Signed, type SignedOrgState } from 'org-protocol';
import { create } from 'zustand';
import { beforeEach, describe, expect, it } from 'vitest';
import { memberId, nextOf, rootedOrg, signedBy } from '../../test/org';
import type { useCardsBoard, CardsBoard } from './board';
import type { MachineSocket } from './carrier';
import { watchCards } from './watch';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Until `names` are the board's machines (a certificate's verification is WebCrypto's, a few turns), 2 s at most. */
async function boardIs(names: string[]): Promise<void> {
  for (let i = 0; i < 200 && JSON.stringify(board.getState().machines.map((m) => m.name)) !== JSON.stringify(names); i++) await new Promise((r) => setTimeout(r, 10));
  expect(board.getState().machines.map((m) => m.name)).toEqual(names);
}

class FakeSocket implements MachineSocket {
  closed = false;
  #presence: RelayPresence | null = null;
  readonly #listeners = new Set<(presence: RelayPresence | null) => void>();
  dial(): never {
    throw new Error('no channel here');
  }
  presence() {
    return this.#presence;
  }
  onPresence(listener: (presence: RelayPresence | null) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  close() {
    this.closed = true;
  }
  tell(presence: RelayPresence | null) {
    this.#presence = presence;
    for (const listener of this.#listeners) listener(presence);
  }
}

let org: Awaited<ReturnType<typeof rootedOrg>>;
let head: SignedOrgState;
let orgListeners: Set<() => void>;
let sockets: Map<string, FakeSocket>;
let board: typeof useCardsBoard;
const listings = new Map<string, Signed<Listing>>();

async function withMachines(...names: string[]): Promise<SignedOrgState> {
  const keys = await Promise.all(names.map(() => generateSigningKey()));
  return signedBy(
    await nextOf(org.genesis, (s) => {
      names.forEach((name, i) => {
        s.machines.push({ name, ref: `ref-${name}`, pub: keys[i].pub, owners: [org.member] });
        s.machineNames.push({ name, ref: `ref-${name}` });
      });
    }),
    org.admin,
  );
}

let certificates: Certificates;
let clock: { at: number; timers: Array<{ ms: number; run: () => void; cancelled: boolean }> };

function start() {
  return watchCards({
    member: org.member,
    org: { ready: true, head: () => head, certificates: () => certificates, onChange: (l) => (orgListeners.add(l), () => orgListeners.delete(l)) },
    clock: {
      now: () => new Date(clock.at),
      after: (ms, run) => {
        const timer = { ms, run, cancelled: false };
        clock.timers.push(timer);
        return () => void (timer.cancelled = true);
      },
    },
    listings: { listings: () => listings, onChange: () => () => {} },
    socketFor: (ref) => {
      const socket = new FakeSocket();
      sockets.set(ref, socket);
      return socket;
    },
    board,
  });
}

beforeEach(async () => {
  org = await rootedOrg('org-watch');
  head = await withMachines('mini', 'studio');
  orgListeners = new Set();
  sockets = new Map();
  board = create<CardsBoard>()(() => ({ watching: false, machines: [] }));
  certificates = NO_CERTIFICATES;
  clock = { at: Date.now(), timers: [] };
  listings.clear();
  listings.set('ref-mini/la-1', { body: { org: org.org, machine: 'ref-mini', session: 'la-1', revision: 1, issued: '', fields: { owners: [org.member], project: 'p', lane: 'A', state: 'waiting', title: 'main' } }, sig: { kid: '', value: '' } });
});

describe('the watch over the cut-over machines', () => {
  it("opens each machine's socket and draws the board from its presence; offline, the rows stay", async () => {
    const stop = start();
    await tick();
    expect([...sockets.keys()]).toEqual(['ref-mini', 'ref-studio']);
    expect(board.getState()).toMatchObject({ watching: true, machines: [{ name: 'mini', online: null, sessions: [] }, { name: 'studio', online: null, sessions: [] }] });
    sockets.get('ref-mini')!.tell({ t: 'presence', online: true, pending: { 'la-1': { project: 'p', kind: 'waiting', pending: 1 } } });
    expect(board.getState().machines[0]).toMatchObject({ online: true, sessions: [{ session: 'la-1', title: 'main', pending: 1 }] });
    sockets.get('ref-mini')!.tell(null); // the socket down
    expect(board.getState().machines[0]).toMatchObject({ online: false, sessions: [{ session: 'la-1', pending: 1 }] });
    stop();
    expect([...sockets.values()].every((s) => s.closed)).toBe(true);
    expect(board.getState()).toEqual({ watching: false, machines: [] });
  });

  it('closes the socket of a machine the head no longer lists', async () => {
    const stop = start();
    await tick();
    head = await withMachines('mini');
    for (const listener of orgListeners) listener();
    await tick();
    expect(sockets.get('ref-studio')!.closed).toBe(true);
    expect(sockets.get('ref-mini')!.closed).toBe(false);
    expect(board.getState().machines.map((m) => m.name)).toEqual(['mini']);
    stop();
  });

  it("drops a delegated machine when its delegation expires, a clock change no org change announces", async () => {
    const delegation = { id: memberId(), key: await generateSigningKey() };
    const expires = clock.at + 60_000;
    head = await signedBy(await nextOf(head, (s) => void s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: new Date(expires).toISOString(), maxUses: 10, offlineRevokeS: 0, owners: 'org' })), org.admin);
    const vm = `${delegation.id}_${base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))}`;
    const cert = await signRecord(SIGNING_DOMAINS.machineCert, { org: org.org, machine: vm, name: 'vm-one', pub: (await generateSigningKey()).pub, delegation: delegation.id, use: 1, issued: new Date(clock.at).toISOString() }, delegation.key.privateKey, delegation.key.pub);
    certificates = { certs: [cert], retirements: [] };
    const stop = start();
    await boardIs(['mini', 'studio', 'vm-one']);
    const due = clock.timers.filter((t) => !t.cancelled);
    expect(due.map((t) => t.ms)).toEqual([60_000]);
    clock.at = expires;
    due[0].run();
    await boardIs(['mini', 'studio']);
    expect(sockets.get(vm)!.closed).toBe(true);
    expect(clock.timers.filter((t) => !t.cancelled)).toHaveLength(0); // nothing left to expire
    stop();
  });
});
