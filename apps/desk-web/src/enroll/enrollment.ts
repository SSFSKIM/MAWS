// Enrolling a machine from the browser (§6, DX7). The browser asks the hub for a one-time token (`POST
// /api/enrollments`, an admin's) and builds the enrollment code around it with the org key, which the hub never sees;
// the owner carries the code by hand to the machine, runs `sminos hub enroll` there and pastes it at its prompt, and
// the CLI redeems the token at `/machine/enroll`. The code is the only way the key leaves the browser: it is built after the owner confirms the
// machine's name, shown once, and never stored.
import {
  base64urlEncode,
  encodeEnrollmentCode,
  isMachineName,
  machineNameKey,
  type EnrollmentIssued,
  type EnrollmentRequest,
  type HubError,
  type MachineRecord,
} from 'desk-hub/protocol';

/** A hub endpoint's refusal, by DX7's error code. */
export class HubRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function hubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'manual', ...init });
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => null)) as HubError | null;
  throw new HubRequestError(response.status, body?.error ?? `http-${response.status}`, body?.message);
}

/** A one-time token for one machine, live `ttl_s` seconds (the hub's default, 900, when not given). */
export function createEnrollment(ttl_s?: number): Promise<EnrollmentIssued> {
  const request: EnrollmentRequest = ttl_s === undefined ? {} : { ttl_s };
  return hubJson('/api/enrollments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
}

export async function listMachines(): Promise<MachineRecord[]> {
  return (await hubJson<{ machines: MachineRecord[] }>('/api/machines')).machines;
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
