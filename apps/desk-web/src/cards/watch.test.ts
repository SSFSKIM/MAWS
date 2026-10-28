// The device's watch over the cut-over machines (P5 O13 M5): a Machine socket per machine the head resolves, the board
// drawn from their presence and the listings, a machine that leaves the head closed, an offline one keeping its rows.
import { generateSigningKey, NO_CERTIFICATES, type Listing, type RelayPresence, type Signed, type SignedOrgState } from 'org-protocol';
import { create } from 'zustand';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextOf, rootedOrg, signedBy } from '../../test/org';
import type { useCardsBoard, CardsBoard } from './board';
import type { MachineSocket } from './carrier';
import { watchCards } from './watch';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

function start() {
  return watchCards({
    member: org.member,
    org: { ready: true, head: () => head, certificates: () => NO_CERTIFICATES, onChange: (l) => (orgListeners.add(l), () => orgListeners.delete(l)) },
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
});
