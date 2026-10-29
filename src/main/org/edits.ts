// The Org page's changes (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "Changes" and
// "Pairing"; Interfaces §M): each `OrgChange`, and a pairing's approval, composed as the signer's `Edit` on a draft of
// the held head. The words are composed from the state the sheet was shown on; `apply` composes them again on the draft
// the signer signs, and signs only if they are the same, so what is signed is what was shown.
//
// What a composer refuses is what no state makes right (`RefusedEdit`, by `ChangeCode`): changing or removing yourself,
// removing this Mac's own device or its member, a change that changes nothing, an email outside the hub's grammar, a
// root of a device that can't sign org states. What the state decides (an email another member has, an owner of a
// machine removed, the last root gone, a non-admin's root, a later device unendorsed) is left to the checks, which run
// the package's `successorProblems` on the composed successor before Touch ID. A target gone from the draft, or words
// that changed, is `StaleEdit`: the head moved under the sheet.
//
// Lines name members by email and devices by their first 8 characters with their class, as `deployment admin show`
// does. Electron-free: vitest's node project runs it.
import { keyId, pairingFingerprint, type Device, type Member, type OrgState, type RevokedKey } from '../../../apps/org-protocol/src/index.ts';
import type { OrgChange } from '@shared/ipc/schema/org';
import type { ChangeCode } from './checks';
import { EMAIL } from './hub-client';
import { RefusedEdit, StaleEdit, type Edit } from './signer';

/**
 * A change the Org page asks for (§M; the shared schema's `OrgChangeSchema`, which `org.preview` and `org.change` take).
 * `member.add`'s `id` is set by `normalizeChange`, so the id signed is the id shown.
 */
export type { OrgChange };

/** This Mac in the org: the registration's member and this profile's device. */
export type EditSelf = { member: string; device: string };

/** An `Edit` composed from a change, with the change as it was composed (normalized). */
export type ChangeEdit = Edit & { change: OrgChange };

/**
 * A change as it is previewed and then signed: emails trimmed and lower-cased, and `member.add` given its member id, 16
 * random bytes in hex (`isMemberId`'s 32 characters), unless it already carries one.
 */
export function normalizeChange(change: OrgChange): OrgChange {
  switch (change.kind) {
    case 'member.add':
      return { kind: 'member.add', email: change.email.trim().toLowerCase(), role: change.role, id: change.id ?? randomMemberId() };
    case 'member.email':
      return { ...change, email: change.email.trim().toLowerCase() };
    default:
      return { ...change };
  }
}

/**
 * The change as an edit of a successor of `state` (the held head's, or a draft of it). Throws `RefusedEdit` for what no
 * state makes right and `StaleEdit` for a target `state` doesn't hold; `apply` throws the same on the draft it is
 * given, and `StaleEdit` when the words composed there differ from these.
 */
export async function composeChange(state: OrgState, change: OrgChange, self: EditSelf): Promise<ChangeEdit> {
  const shown = await planChange(state, change, self);
  return {
    change,
    summary: shown.summary,
    lines: shown.lines,
    async apply(draft) {
      const now = await planChange(draft, change, self);
      sameWords(shown, now);
      await now.edit();
    },
  };
}

/**
 * A pairing's approval (M4a's "Pairing"): `device`, the candidate the person compared, appended to `member`. Frozen here,
 * its endorsement left out: the device signed is the one shown, whatever the caller's copy does after. For this Mac's
 * own member it is named in `endorse`, so the device module endorses it with this Mac's step-up key inside the same
 * Touch ID; another member's first device goes unendorsed, as the protocol allows (P5 Decision Log 34), and a later
 * one meets the checks' `endorsement-missing`. `live`, the pairing's guard (this generation, neither cancelled nor
 * expired), is checked first at `apply` (`StaleEdit`) and passed on, so the signer reads it again after Touch ID.
 */
export async function deviceApproveEdit(state: OrgState, input: { member: string; device: Omit<Device, 'endorsement'>; self: EditSelf; live(): boolean }): Promise<Edit> {
  const frozen = structuredClone(input.device) as Device;
  delete frozen.endorsement;
  const own = input.member === input.self.member;
  const plan = async (s: OrgState): Promise<Plan> => {
    const member = memberOf(s, input.member);
    if (s.members.some((m) => m.devices.some((d) => d.id === frozen.id))) gone(`device ${frozen.id} is listed already`);
    const fingerprint = await pairingFingerprint(s.org, member.id, frozen);
    const endorsement = own
      ? 'Endorsed by this Mac, in the same Touch ID'
      : member.devices.length === 0
        ? 'Their first device: an admin approves it, and no device of theirs needs to endorse it'
        : 'Not endorsed: a later device of theirs is endorsed by one of their own devices';
    return {
      summary: `pair device ${short(frozen)} to ${member.email}`,
      lines: [`Pair ${describe(frozen)} to ${member.email} (fingerprint ${fingerprint})`, endorsement],
      edit: () => void member.devices.push(structuredClone(frozen)),
    };
  };
  const shown = await plan(state);
  return {
    summary: shown.summary,
    lines: shown.lines,
    ...(own ? { endorse: [{ member: input.member, device: frozen.id }] } : {}),
    live: () => input.live(),
    async apply(draft) {
      if (!input.live()) throw new StaleEdit('the pairing ended (cancelled or expired): nothing was signed');
      const now = await plan(draft);
      sameWords(shown, now);
      await now.edit();
    },
  };
}

// --- Composing -------------------------------------------------------------------------------------------------------

/** A change's words on one state, and the edit that makes them true of that same state. */
type Plan = { summary: string; lines: string[]; edit(): void | Promise<void> };

const refused = (code: ChangeCode, detail: string): never => {
  throw new RefusedEdit([{ level: 'refuse', code, detail }]);
};

function sameWords(shown: Pick<Plan, 'summary' | 'lines'>, now: Pick<Plan, 'summary' | 'lines'>): void {
  if (shown.summary !== now.summary || shown.lines.length !== now.lines.length || shown.lines.some((line, i) => line !== now.lines[i])) {
    throw new StaleEdit('the org state changed since this change was shown: nothing was signed');
  }
}

function randomMemberId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const short = (d: Pick<Device, 'id'>) => d.id.slice(0, 8);
const describe = (d: Pick<Device, 'id' | 'class'>) => `${short(d)} (${d.class})`;
const article = (role: 'admin' | 'member') => (role === 'admin' ? 'an admin' : 'a member');

const gone = (what: string): never => {
  throw new StaleEdit(`${what}: nothing was signed`);
};
const memberOf = (state: OrgState, id: string): Member => state.members.find((m) => m.id === id) ?? gone(`member ${id} is no longer in the org state`);
const deviceOf = (member: Member, id: string): Device => member.devices.find((d) => d.id === id) ?? gone(`${member.email} no longer has device ${id.slice(0, 8)}`);

function validEmail(email: string): void {
  if (!EMAIL.test(email)) refused('bad-email', `${JSON.stringify(email)} is not an email address the hub can name`);
}

/** A device's keys as `revoked` lists them, under the holder the head holds them by (`keysAccounted`). */
async function revocations(member: Member, device: Device): Promise<RevokedKey[]> {
  const holder = (key: 'channel' | 'step-up') => ({ member: member.id, device: device.id, class: device.class, key });
  return [
    { keyId: await keyId(device.channelPub), holder: holder('channel') },
    ...(device.stepUpPub === undefined ? [] : [{ keyId: await keyId(device.stepUpPub), holder: holder('step-up') }]),
  ];
}

/** The root kids among `devices`' step-up keys, each with its device. */
async function rootsOf(state: OrgState, devices: readonly Device[]): Promise<Array<{ kid: string; device: Device }>> {
  const out: Array<{ kid: string; device: Device }> = [];
  for (const device of devices) {
    if (device.stepUpPub === undefined) continue;
    const kid = await keyId(device.stepUpPub);
    if (state.root.keys.includes(kid)) out.push({ kid, device });
  }
  return out;
}

const leavesRoots = (state: OrgState, kids: readonly string[]) => () => void (state.root.keys = state.root.keys.filter((k) => !kids.includes(k)));

async function planChange(state: OrgState, change: OrgChange, self: EditSelf): Promise<Plan> {
  switch (change.kind) {
    case 'member.add': {
      const { email, role, id } = change;
      if (id === undefined) throw new Error('member.add is composed only once normalized, with its member id');
      validEmail(email);
      return {
        summary: `add ${email} to the org`,
        lines: [
          `Add ${email} as ${article(role)}, with no devices yet: their first device is paired next`,
          "They sign in through the hub's Access. On production their email must be admitted there too: an Access change, the owner's.",
        ],
        edit: () => void state.members.push({ id, email, role, devices: [] }),
      };
    }

    case 'member.remove': {
      const member = memberOf(state, change.member);
      if (member.id === self.member) refused('self', 'you are not removed from here: another admin removes you');
      if (member.devices.some((d) => d.id === self.device)) refused('this-mac', `${member.email} holds this Mac's device, which leaves only through New keys`);
      const keys = await Promise.all(member.devices.map((d) => revocations(member, d)));
      const roots = await rootsOf(state, member.devices);
      return {
        summary: `remove ${member.email} from the org`,
        lines: [
          `Remove ${member.email} (${member.role}) from the org`,
          ...member.devices.map((d) => `Revoke the keys of their device ${describe(d)}`),
          ...roots.map((r) => `Their device ${describe(r.device)} leaves the root set`),
        ],
        edit() {
          state.members = state.members.filter((m) => m.id !== member.id);
          state.revoked.push(...keys.flat());
          leavesRoots(state, roots.map((r) => r.kid))();
        },
      };
    }

    case 'member.role': {
      const member = memberOf(state, change.member);
      if (member.id === self.member) refused('self', 'your role is not changed from here: another admin changes your role');
      if (member.role === change.role) refused('no-change', `${member.email} is ${article(change.role)} already`);
      const roots = change.role === 'member' ? await rootsOf(state, member.devices) : [];
      return {
        summary: `make ${member.email} ${article(change.role)}`,
        lines: [
          `${member.email} becomes ${article(change.role)}`,
          ...roots.map((r) => `Their device ${describe(r.device)} leaves the root set: only an admin's device signs org states`),
        ],
        edit() {
          member.role = change.role;
          leavesRoots(state, roots.map((r) => r.kid))();
        },
      };
    }

    case 'member.email': {
      const member = memberOf(state, change.member);
      validEmail(change.email);
      if (member.email.toLowerCase() === change.email) refused('no-change', `${member.email} is their email already`);
      return {
        summary: `change ${member.email}'s email to ${change.email}`,
        lines: [
          `${member.email} becomes ${change.email}`,
          `The hub admits them by ${change.email} from this state on. On production Access must admit it too: an Access change, the owner's.`,
        ],
        edit: () => void (member.email = change.email),
      };
    }

    case 'device.remove': {
      const member = memberOf(state, change.member);
      const device = deviceOf(member, change.device);
      if (device.id === self.device) refused('this-mac', "this Mac's own device leaves the org through New keys, never from here");
      const keys = await revocations(member, device);
      const roots = await rootsOf(state, [device]);
      return {
        summary: `remove ${member.email}'s device ${short(device)}`,
        lines: [`Remove ${member.email}'s device ${describe(device)} and revoke its keys`, ...roots.map(() => `Its step-up key leaves the root set`)],
        edit() {
          member.devices = member.devices.filter((d) => d.id !== device.id);
          state.revoked.push(...keys);
          leavesRoots(state, roots.map((r) => r.kid))();
        },
      };
    }

    case 'root.add': {
      const member = memberOf(state, change.member);
      const device = deviceOf(member, change.device);
      if (device.class !== 'native-mac' || device.stepUpPub === undefined) {
        refused('not-signing-device', `${short(device)} is a ${device.class} device${device.stepUpPub === undefined ? ' with no step-up key' : ''}: only a native-mac device with a step-up key signs org states`);
      }
      const kid = await keyId(device.stepUpPub!);
      if (state.root.keys.includes(kid)) refused('no-change', `${member.email}'s device ${short(device)} is a root already`);
      const fingerprint = await pairingFingerprint(state.org, member.id, device);
      return {
        summary: `make ${member.email}'s device ${short(device)} a root`,
        lines: [`Make ${member.email}'s device ${describe(device)} a root of the org: its step-up key ${kid} signs org states (fingerprint ${fingerprint})`],
        edit: () => void state.root.keys.push(kid),
      };
    }
  }
}
