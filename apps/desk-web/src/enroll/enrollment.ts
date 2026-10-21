// Enrolling a machine from the browser (§6, DX7), and removing one. The browser asks the hub for a one-time token (`POST
// /api/enrollments`, an admin's) and builds the enrollment code around it with the org key, which the hub never sees;
// the owner carries the code by hand to the machine, runs `sminos hub enroll` there and pastes it at its prompt, and
// the CLI redeems the token at `/machine/enroll`. The code is the only way the key leaves the browser: it is built after the owner confirms the
// machine's name, shown once, and never stored.
//
// A provisioning key (the provisioning-keys spec, §5) is the same act for machines nobody attends: the hub makes a
// reusable, revocable key that enrolls machines named under its prefix, the browser builds its code around the key's
// secret with the org key, and the owner keeps the code in the secret store the machines read at boot. The code is shown
// once and never stored here either.
import {
  base64urlEncode,
  encodeEnrollmentCode,
  encodeProvisioningCode,
  isMachineName,
  machineNameKey,
  PROVISIONING_KEYS_PATH,
  type EnrollmentIssued,
  type EnrollmentRequest,
  type MachineRecord,
  type ProvisioningKeyIssued,
  type ProvisioningKeyRecord,
  type ProvisioningKeyRequest,
  type ProvisioningKeyRevoked,
  type ProvisioningKeys,
} from 'desk-hub/protocol';
import { hubJson, withJson } from '../hub/http';

/** A one-time token for one machine, live `ttl_s` seconds (the hub's default, 900, when not given). */
export function createEnrollment(ttl_s?: number): Promise<EnrollmentIssued> {
  const request: EnrollmentRequest = ttl_s === undefined ? {} : { ttl_s };
  return hubJson('/api/enrollments', withJson('POST', request));
}

export async function listMachines(): Promise<MachineRecord[]> {
  return (await hubJson<{ machines: MachineRecord[] }>('/api/machines')).machines;
}

/** Revokes a machine (an admin's): the hub ends its stream, deletes its service token and its record, and releases its
 * name, so using it again means enrolling it again. Answers the name revoked; `not-admin` and `unknown-machine` are
 * raised as `HubRequestError`s. */
export function removeMachine(name: string): Promise<{ revoked: string }> {
  return hubJson(`/api/machines/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/** Why `name` cannot be the next machine's, or null: DX7's grammar, and unique in the org without regard to case. */
export function machineNameProblem(name: string, machines: ReadonlyArray<Pick<MachineRecord, 'name'>>): string | null {
  if (name === '') return 'Name the machine.';
  if (!isMachineName(name)) return 'A machine name is letters, digits, dots, dashes, and underscores, starts with a letter or digit, and is not "hub" or "legacy".';
  if (machines.some((m) => machineNameKey(m.name) === machineNameKey(name))) return `A machine named ${name} is already enrolled.`;
  return null;
}

/** DX7's enrollment code, with the org key's bytes, which are wiped once it is built (or refused). */
export function enrollmentCode(parts: { hub: string; org: string; token: string; machine: string; key: Uint8Array }): string {
  try {
    return encodeEnrollmentCode({ hub: parts.hub, org: parts.org, token: parts.token, machine: parts.machine, key: base64urlEncode(parts.key) });
  } finally {
    parts.key.fill(0);
  }
}

/** What the owner runs on the machine; it asks for the code at a hidden prompt (or reads it piped). The code is never
 * part of a command line, where the process listing and the shell's history would keep the org key. */
export const ENROLL_COMMAND = 'sminos hub enroll';

/** A provisioning key (an admin's): its record, and its secret, which no other answer carries. */
export function createProvisioningKey(request: ProvisioningKeyRequest): Promise<ProvisioningKeyIssued> {
  return hubJson(PROVISIONING_KEYS_PATH, withJson('POST', request));
}

/** Every key the org made, revoked ones included, by creation, each with the machines enrolled through it now. */
export async function listProvisioningKeys(): Promise<ProvisioningKeyRecord[]> {
  return (await hubJson<ProvisioningKeys>(PROVISIONING_KEYS_PATH)).keys;
}

/** Revokes a key (an admin's): no machine enrolls through it from then; the machines it enrolled stay. `not-admin` and
 * `unknown-key` are raised as `HubRequestError`s. */
export function revokeProvisioningKey(id: string): Promise<ProvisioningKeyRevoked> {
  return hubJson(`${PROVISIONING_KEYS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Why `prefix` cannot be a key's, or null. It is checked as a machine name, as the hub checks it: then every name that
 * starts with it begins as an admitted name does. */
export function prefixProblem(prefix: string): string | null {
  if (prefix === '') return 'Name the prefix.';
  if (!isMachineName(prefix)) return 'A prefix starts every machine name: letters, digits, dots, dashes, and underscores, starting with a letter or digit, at most 63 characters, and not "hub" or "legacy".';
  return null;
}

/** A provisioning key's code, with the org key's bytes, which are wiped once it is built (or refused). */
export function provisioningCode(parts: { hub: string; org: string; token: string; prefix: string; key: Uint8Array }): string {
  try {
    return encodeProvisioningCode({ hub: parts.hub, org: parts.org, token: parts.token, prefix: parts.prefix, key: base64urlEncode(parts.key) });
  } finally {
    parts.key.fill(0);
  }
}

/** What each machine runs at boot: the code, read from the secret store into `$CODE`, piped in — never an argument. */
export const BOOT_COMMAND = (prefix: string) => `printf %s "$CODE" | sminos hub enroll --name ${prefix}<machine>`;
