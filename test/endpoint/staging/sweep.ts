// A staging phone run's undoing (P5 O13 M7, Interfaces §H's cleanup), by the names the run gives what it makes
// (run.ts), so it needs nothing the run kept: the machine `o13-phone-<n>` out of the state, its key retired (an honest
// departure, as `OrgAdmin.unlist` takes a machine out) and revoked at the hub (its service token deleted); the member
// `o13-b-<n>` removed, their device's keys revoked; the owner's `o13-c-<n>` device removed, its keys revoked; the push
// subscriptions bound to that device, or at its sink endpoint, deleted. A pairing entry `o13-c-<n>` posted and never
// listed (the run ended between the two) cannot be removed (no route does; listing a device drops its entry) and is
// reported `LEFT` with its expiry, ten minutes after it was posted. The run calls it however it ends, and the
// runner once more after it (a run killed outright): a run with nothing left is a no-op. The phone the owner paired is
// never touched; its `remove-device` is the owner's (the sitting's step 5).
import { keyId, type Device, type OrgState, type RetiredKey, type RevokedKey } from 'org-protocol';
import { PENDING_DEVICES_PATH, type PendingDevice } from 'desk-hub/protocol';
import type { Person } from '../../../apps/desk-hub/deploy/hub';
import type { OrgAdmin } from '../../../apps/desk-hub/deploy/org-admin';
import { revoke } from '../../../apps/desk-hub/deploy/proof';
import { cardsDeviceName, cardsRunOf, machineName, memberEmail } from './run';

/** What of run `n` a state still holds: its machine, its second member, the owner's devices it made. */
export type Residue = {
  machines: OrgState['machines'];
  members: OrgState['members'];
  /** The owner's (`owner`'s) devices whose passkey names `o13-c-<n>`. */
  devices: Device[];
};

export function residueOf(state: OrgState, n: string, owner: string): Residue {
  return {
    machines: state.machines.filter((m) => m.name === machineName(n)),
    members: state.members.filter((m) => m.email === memberEmail(n)),
    devices: (state.members.find((m) => m.id === owner)?.devices ?? []).filter((d) => d.passkey !== undefined && cardsRunOf(d.passkey.credentialId) === n),
  };
}

/** The residue, one line each, for the report's `LEFT …`. */
export function residueLines(r: Residue): string[] {
  return [
    ...r.machines.map((m) => `the state still lists the machine ${m.name} (ref ${m.ref})`),
    ...r.members.map((m) => `the state still lists the member ${m.email}`),
    ...r.devices.map((d) => `the state still lists the owner's device ${d.id} (${d.passkey ? `passkey ${cardsDeviceName(cardsRunOf(d.passkey.credentialId) ?? '?')}` : 'no passkey'})`),
  ];
}

/** The hub's pending pairing entries that are run `n`'s second device's (its passkey names `o13-c-<n>`), one line each. */
export function pendingLines(pending: PendingDevice[], n: string): string[] {
  return pending
    .filter((p) => p.passkey !== undefined && cardsRunOf(p.passkey.credentialId) === n)
    .map((p) => `the hub still holds ${cardsDeviceName(n)}'s pairing entry (device ${p.deviceId}), unlisted, until it expires at ${p.expires}`);
}

const isEmpty = (r: Residue) => r.machines.length + r.members.length + r.devices.length === 0;

/** A device's keys as `revoked` entries (RL DL 24: a test device leaves as a lost one does). */
async function revokedKeys(member: string, d: Device): Promise<RevokedKey[]> {
  const keys: Array<['channel' | 'step-up', string]> = [['channel', d.channelPub], ...(d.stepUpPub === undefined ? [] : [['step-up', d.stepUpPub] as ['step-up', string]])];
  return Promise.all(keys.map(async ([key, pub]) => ({ keyId: await keyId(pub), holder: { member, device: d.id, class: d.class, key } })));
}

/**
 * The edit that takes run `n`'s residue out of a successor of `state`, its keys computed beforehand (an edit is
 * synchronous): the machine retired as of `now`, the rest revoked. It changes only what `state` showed; what a newer
 * head added meanwhile is the next sweep's.
 */
export async function undoRun(state: OrgState, n: string, owner: string, now: Date): Promise<{ residue: Residue; edit: (s: OrgState) => boolean } | null> {
  const residue = residueOf(state, n, owner);
  if (isEmpty(residue)) return null;
  const retired: RetiredKey[] = await Promise.all(residue.machines.map(async (m) => ({ keyId: await keyId(m.pub), pub: m.pub, notAfter: now.toISOString(), holder: { machine: m.ref } })));
  const revoked: RevokedKey[] = [
    ...(await Promise.all(residue.members.flatMap((m) => m.devices.map((d) => revokedKeys(m.id, d))))).flat(),
    ...(await Promise.all(residue.devices.map((d) => revokedKeys(owner, d)))).flat(),
  ];
  const refs = new Set(residue.machines.map((m) => m.ref));
  const members = new Set(residue.members.map((m) => m.id));
  const devices = new Set(residue.devices.map((d) => d.id));
  const edit = (s: OrgState) => {
    const before = JSON.stringify([s.machines, s.members]);
    s.machines = s.machines.filter((m) => !refs.has(m.ref));
    s.members = s.members.filter((m) => !members.has(m.id));
    const mine = s.members.find((m) => m.id === owner);
    if (mine) mine.devices = mine.devices.filter((d) => !devices.has(d.id));
    if (JSON.stringify([s.machines, s.members]) === before) return false;
    const known = new Set([...s.retired, ...s.revoked].map((k) => k.keyId));
    s.retired.push(...retired.filter((k) => !known.has(k.keyId)));
    s.revoked.push(...revoked.filter((k) => !known.has(k.keyId)));
    return true;
  };
  return { residue, edit };
}

/** Whether a push subscription is run `n`'s: bound to one of its devices, or at its sink endpoint (`…/o13-c-<n>`). */
export function isRunSubscription(subscription: { endpoint: string; device?: string }, n: string, devices: ReadonlySet<string>): boolean {
  if (subscription.device !== undefined && devices.has(subscription.device)) return true;
  try {
    return new URL(subscription.endpoint).pathname.endsWith(`/${cardsDeviceName(n)}`);
  } catch {
    return false;
  }
}

/**
 * Undoes run `n` on the hub `admin` signs for, as the owner `person`: the state's residue in one successor, the
 * machine's revocation at the hub, the run's push subscriptions deleted. Then reads everything back: what it says is
 * still there, one line each (empty when the run left nothing).
 */
export async function sweepRun(admin: OrgAdmin, person: Person, n: string, log: (line: string) => void): Promise<string[]> {
  const failures: string[] = [];
  const step = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  type Subscriptions = { subscriptions: Array<{ endpoint: string; device?: string }> };
  const subscriptions = async () => (await person.json<Subscriptions>('/api/push/subscriptions')).subscriptions;
  const devices = new Set<string>();
  await step('take the run out of the org state', async () => {
    const head = await admin.read();
    const undo = await undoRun(head.state, n, admin.member, new Date());
    if (undo === null) return;
    for (const d of undo.residue.devices) devices.add(d.id);
    const what = residueLines(undo.residue).map((line) => line.replace(/^the state still lists /, '')).join(', ');
    await admin.amend(`run ${n} undone: ${what} out`, undo.edit);
  });
  await step(`revoke ${machineName(n)} at the hub`, () => revoke(person, machineName(n)));
  await step('delete the run’s push subscriptions', async () => {
    for (const s of await subscriptions()) if (isRunSubscription(s, n, devices)) await person.json('/api/push/subscriptions', { method: 'DELETE', body: { endpoint: s.endpoint } });
  });
  // Read back: nothing of the run current.
  const left: string[] = [];
  await step('read the state back', async () => void left.push(...residueLines(residueOf((await admin.read()).state, n, admin.member))));
  await step('read the hub’s machines back', async () => {
    const { machines } = await person.json<{ machines: Array<{ name: string }> }>('/api/machines');
    left.push(...machines.filter((m) => m.name === machineName(n)).map((m) => `the hub still holds the machine ${m.name}`));
  });
  await step('read the push subscriptions back', async () => {
    left.push(...(await subscriptions()).filter((s) => isRunSubscription(s, n, devices)).map((s) => `the hub still holds a push subscription of the run (device ${s.device ?? 'none'})`));
  });
  await step('read the pending pairing entries back', async () => void left.push(...pendingLines((await person.json<{ pending: PendingDevice[] }>(PENDING_DEVICES_PATH)).pending, n)));
  left.push(...failures.map((f) => `cleanup step failed: ${f}`));
  log(left.length === 0 ? `cleanup: ${machineName(n)} revoked, ${memberEmail(n)} removed, ${cardsDeviceName(n)} removed, its push subscriptions deleted; nothing of the run is current` : `cleanup: ${left.length} thing(s) left`);
  return [...new Set(left)];
}
