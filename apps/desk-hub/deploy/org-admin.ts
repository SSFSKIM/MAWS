// The test device as an admin's app holds it (O11 M8): the org-state work the staging runs need — acceptance, the relay
// measurement, redeploy-check's RL1 leg — done the way the admin's app does it, through the protocol package's own
// signing. It signs successors with its device's step-up key (a root key of the head), enrolls v2 machines with a code
// it builds and checks the MAC each machine posts, lists them, and takes them out again.
//
// Where it may write is held, before anything is asked of the hub, to a staging hub or the suites' local one, never
// production, which is refused by name (config.ts, checkTestHub), and within it to two cases:
// - the deployment's own org, only when it serves a chain whose genesis is the one the configuration pins
//   (`orgGenesis`, the operator's anchor): a successor, never a genesis. A configuration without a pin (production's)
//   is refused, so a test device can never root an org nor sign into one it was not set up for;
// - a throwaway org (`--test-org`, proof.ts's rule): a genesis when it has no state yet, signed by this device.
import {
  base64urlEncode,
  generateSigningKey,
  importSigningKey,
  keyId,
  signOrgState,
  stateHash,
  verifyEnrollmentMac,
  type Device,
  type OrgState,
  type SignedOrgState,
  type SigningKey,
} from 'org-protocol';
import { readJsonFile } from '../fake-machine/json-file';
import { enrollV2, type V2Machine } from '../fake-machine/org';
import { encodeEnrollmentCodeV2, ORG_KEYS_PURGE_PATH, ORG_STATE_PATH, type EnrollmentIssued, type EnrollmentKey, type OrgKeysPurged, type OrgStateView } from '../src/protocol/identity';
import { checkTestHub } from './config';
import type { Person } from './hub';
import { revoke, type Cleanup } from './proof';

/** How long a command waits out Access's refusal of a service token it just minted (O11 M3: up to about a minute). */
export const ADMIT_MS = 90_000;

/** An admin's device: its channel and step-up keys, and the org's recovery key that a genesis names. */
export type AdminDevice = { id: string; channel: SigningKey; stepUp: SigningKey; recovery: SigningKey };

/**
 * The device in a keys file as the staging test device keeps it (`{keys: {"<id>.channel": jwk, "<id>.stepUp": jwk,
 * "recovery": jwk}}`, private JWKs, mode 0600): read here and nowhere printed, a malformed one included (readJsonFile).
 */
export async function loadAdminDevice(file: string, id = 'a1'): Promise<AdminDevice> {
  const { keys = {} } = readJsonFile<{ keys?: Record<string, JsonWebKey> } | null>(file, "an admin device's keys") ?? {};
  const jwk = (name: string) => {
    if (!keys[name]) throw new Error(`${file} holds no "${name}" key`);
    return keys[name];
  };
  return { id, channel: await importSigningKey(jwk(`${id}.channel`)), stepUp: await importSigningKey(jwk(`${id}.stepUp`)), recovery: await importSigningKey(jwk('recovery')) };
}

/** A device made for this run alone, for a throwaway org with no state yet. */
export async function newAdminDevice(id = 'admin'): Promise<AdminDevice> {
  return { id, channel: await generateSigningKey(), stepUp: await generateSigningKey(), recovery: await generateSigningKey() };
}

export const deviceEntry = (d: Pick<AdminDevice, 'id' | 'channel' | 'stepUp'>): Device => ({ id: d.id, class: 'native-mac', keyStorage: 'software', channelPub: d.channel.pub, stepUpPub: d.stepUp.pub });

/** Where the admin may write: the deployment's own org under its pinned genesis, or a throwaway org. */
export type OrgScope = { org: string; pinnedGenesis: string | undefined } | { org: string; throwaway: true };

/** The state after `head`, changed by `edit`: the next version, linked to it, issued now (never before the head). */
export async function successor(head: OrgState, edit: (state: OrgState) => void): Promise<OrgState> {
  const state = structuredClone(head);
  state.version += 1;
  state.prev = await stateHash(head);
  const now = new Date().toISOString();
  state.issued = now > head.issued ? now : head.issued;
  edit(state);
  return state;
}

/**
 * The DX1 org key's retirement as a successor carries it (O14 M5a, Interfaces §E): `legacyRetired` at the successor's
 * own version and issue time. A successor keeps it as the head has it; `restoreLegacyKey` drops it (the retirement
 * undone, which the hub refuses once it has purged the wrapped copies). `deployment admin keys retire [--undo]` signs
 * these edits under its anchor; `OrgAdmin` here.
 */
export function retireLegacyKey(next: OrgState): void {
  next.legacyRetired = { version: next.version, at: next.issued };
}
export function restoreLegacyKey(next: OrgState): void {
  delete next.legacyRetired;
}

/** The hub's purge of the org key's wrapped copies, which it takes only once the head retires the key (irreversible). */
export function purgeOrgKeys(person: Person): Promise<OrgKeysPurged> {
  return person.json<OrgKeysPurged>(ORG_KEYS_PURGE_PATH, { method: 'POST' });
}

export class OrgAdmin {
  private constructor(
    readonly person: Person,
    readonly org: string,
    /** The member the device belongs to: the owner, as `/api/me` names them. */
    readonly member: string,
    readonly device: AdminDevice,
    private current: SignedOrgState,
    private readonly log: (line: string) => void,
  ) {}

  /** The head as this admin last read or wrote it. */
  get head(): SignedOrgState {
    return this.current;
  }

  /**
   * The admin of `scope`'s org, once the deployment is seen to serve that org and a chain this device may sign onto:
   * the pinned genesis and a head whose root keys hold the device's step-up key. In a throwaway org with no state, it
   * posts the genesis first.
   */
  static async open(person: Person, scope: OrgScope, device: AdminDevice, log: (line: string) => void = console.log): Promise<OrgAdmin> {
    checkTestHub(person.hub, 'write its org state');
    const me = await person.json<{ org: { id: string }; member: { id: string; email: string } }>('/api/me');
    if (me.org.id !== scope.org) throw new Error(`the deployment serves the org ${me.org.id}, not ${scope.org}: refusing to write its state`);
    const first = await person.json<OrgStateView>(`${ORG_STATE_PATH}?since=0`);
    const genesis = first.chain?.[0];
    if (!genesis) {
      if (!('throwaway' in scope)) throw new Error(`${scope.org} serves no org state: a genesis is posted only in a throwaway org (--test-org)`);
      const state: OrgState = {
        org: scope.org,
        version: 1,
        prev: null,
        issued: new Date().toISOString(),
        root: { keys: [await keyId(device.stepUp.pub)], recoveryPub: device.recovery.pub },
        members: [{ id: me.member.id, email: me.member.email, role: 'admin', devices: [deviceEntry(device)] }],
        machines: [],
        machineNames: [],
        retired: [],
        revoked: [],
        delegations: [],
        projects: [],
      };
      const signed = await signOrgState(state, [device.stepUp]);
      await person.json(ORG_STATE_PATH, { body: signed }, 201);
      log(`org state: genesis of the throwaway org ${scope.org}, signed by device ${device.id}`);
      return new OrgAdmin(person, scope.org, me.member.id, device, signed, log);
    }
    if (!('throwaway' in scope)) {
      if (!scope.pinnedGenesis) throw new Error(`the configuration pins no orgGenesis for ${scope.org}: refusing to sign into an org it does not anchor`);
      const served = await stateHash(genesis.state);
      if (served !== scope.pinnedGenesis) throw new Error(`${scope.org}'s genesis hashes to ${served}, not the pinned ${scope.pinnedGenesis}: refusing to write its state`);
    }
    const admin = new OrgAdmin(person, scope.org, me.member.id, device, genesis, log);
    const head = await admin.read();
    const kid = await keyId(device.stepUp.pub);
    const holder = head.state.members.find((m) => m.devices.some((d) => d.id === device.id && d.stepUpPub === device.stepUp.pub));
    if (!holder || holder.id !== me.member.id || !head.state.root.keys.includes(kid)) {
      throw new Error(`the head (version ${head.state.version}) does not hold device ${device.id}'s step-up key as a root key of ${me.member.id}: this device cannot sign its successors`);
    }
    return admin;
  }

  /** The head the hub serves now. */
  async read(): Promise<SignedOrgState> {
    const { head } = await this.person.json<OrgStateView>(ORG_STATE_PATH);
    if (!head) throw new Error(`${this.org} serves no org state`);
    this.current = head;
    return head;
  }

  /**
   * A successor of the head the hub serves now, changed by `edit`, signed by this device and posted; `edit` returning
   * false posts nothing. A head that moved meanwhile (`409 not-head`) is read again and the edit made anew, twice at most.
   */
  async amend(what: string, edit: (state: OrgState) => boolean | void): Promise<SignedOrgState | null> {
    for (let attempt = 0; ; attempt++) {
      const head = await this.read();
      let changed = true;
      const next = await successor(head.state, (s) => void (changed = edit(s) !== false));
      if (!changed) return null;
      const signed = await signOrgState(next, [this.device.stepUp]);
      const response = await this.person.fetch(ORG_STATE_PATH, { body: signed });
      const text = await response.text();
      if (response.status === 201) {
        this.current = signed;
        this.log(`org state: version ${next.version}, ${what}`);
        return signed;
      }
      if (response.status === 409 && text.includes('"not-head"') && attempt < 2) continue;
      throw new Error(`org state (${what}): ${response.status} ${text.slice(0, 300)}`);
    }
  }

  /**
   * A machine enrolled the v2 way under `name` and listed in the state, owned by this admin's member, as the admin's app
   * pairs one: a code it builds (the head's root key ids and recovery key, a fresh pairing secret `k`), the machine's
   * redemption and key, the MAC over its name, key, ref and enrollment checked under `k`, then a signed successor
   * listing it. Its undoing is registered on `cleanup` before anything is made: the successor that takes it out of the
   * state, its key retired (an honest departure, so the events it signed keep verifying), and its revocation at the hub,
   * which deletes its service token.
   */
  async listedMachine(name: string, cleanup: Cleanup, admitMs = ADMIT_MS): Promise<V2Machine> {
    cleanup.add(`revoke ${name}`, () => revoke(this.person, name));
    const issued = await this.person.json<EnrollmentIssued>('/api/enrollments', { body: {} }, 201);
    const k = crypto.getRandomValues(new Uint8Array(32));
    const { root } = this.head.state;
    const code = encodeEnrollmentCodeV2({ hub: this.person.hub, token: issued.token, roots: root.keys, recoveryPub: root.recoveryPub, k: base64urlEncode(k) });
    const machine = await enrollV2(code, name, {}, admitMs);
    const posted = await this.person.json<EnrollmentKey>(`/api/enrollments/${machine.enrollment}/key`);
    const fields = { name: posted.machine, machinePub: posted.pub, ref: posted.ref, tokenId: machine.enrollment };
    if (posted.machine !== name || posted.pub !== machine.key.pub || posted.ref !== machine.ref || !(await verifyEnrollmentMac(k, fields, posted.mac))) {
      throw new Error(`the key the hub holds for ${name}'s enrollment is not the one the machine posted under the pairing secret`);
    }
    cleanup.add(`take ${name} out of the org state`, async () => void (await this.unlist(machine)));
    await this.amend(`${name} (ref ${machine.ref}) listed`, (s) => {
      s.machines.push({ name, ref: machine.ref, pub: machine.key.pub, owners: [this.member] });
      s.machineNames.push({ name, ref: machine.ref });
    });
    return machine;
  }

  /** The head's successor retiring the DX1 org key; nothing when the head retires it already. */
  retireLegacy(): Promise<SignedOrgState | null> {
    return this.amend('the legacy org key retired', (s) => (s.legacyRetired === undefined ? retireLegacyKey(s) : false));
  }

  /** The head's successor undoing that retirement; nothing when the head retires nothing. */
  restoreLegacy(): Promise<SignedOrgState | null> {
    return this.amend('the legacy org key back in use', (s) => (s.legacyRetired === undefined ? false : restoreLegacyKey(s)));
  }

  /** Takes `machine` out of the state, its key retired as of now; nothing when the head does not list it. */
  async unlist(machine: Pick<V2Machine, 'name' | 'ref' | 'key'>): Promise<SignedOrgState | null> {
    const kid = await keyId(machine.key.pub);
    return this.amend(`${machine.name} taken out, its key retired`, (s) => {
      if (!s.machines.some((m) => m.ref === machine.ref)) return false;
      s.machines = s.machines.filter((m) => m.ref !== machine.ref);
      s.retired.push({ keyId: kid, pub: machine.key.pub, notAfter: new Date().toISOString(), holder: { machine: machine.ref } });
    });
  }
}
