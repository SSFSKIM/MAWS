// DX7's machine records as the DX3 double serves them, and as the unit suites meet them through a stubbed fetch: one
// implementation of the hub's rules for both (desk-hub's `Registry`: `GET /api/machines`, any member's, by name; and
// `DELETE /api/machines/<name>`, an admin's, the name compared without case, `404 unknown-machine` for one it does not
// hold). Enrollment is not served: a suite puts the records it needs in place.
import { machineNameKey, type MachineRecord, type MachineState, type MemberRecord } from 'desk-hub/protocol';
import type { Answer } from './org-keys';

const MACHINE_PATH = /^\/api\/machines\/([^/]+)$/;

export function machineRecord(name: string, state: MachineState = 'active'): MachineRecord {
  return {
    name,
    client_id: `${name}.access`,
    token_name: `desk-org-${name}`,
    state,
    enrollment: `e-${name}`,
    created: '2026-10-15T00:00:00.000Z',
    confirmed: state === 'active' ? '2026-10-15T00:01:00.000Z' : null,
  };
}

export class MachinesDouble {
  machines: MachineRecord[] = [];
  /** The names each `DELETE` asked for, in order, whatever it was answered. */
  readonly removals: string[] = [];

  add(name: string, state: MachineState = 'active'): void {
    this.machines.push(machineRecord(name, state));
  }

  handle(member: MemberRecord, method: string, path: string): Answer | null {
    if (path === '/api/machines') return method === 'GET' ? { status: 200, body: { machines: [...this.machines].sort((a, b) => (a.name < b.name ? -1 : 1)) } } : null;
    const match = MACHINE_PATH.exec(path);
    if (!match || method !== 'DELETE') return null;
    const name = decodeURIComponent(match[1]);
    this.removals.push(name);
    if (member.role !== 'admin') return { status: 403, body: { error: 'not-admin' } };
    const found = this.machines.find((m) => machineNameKey(m.name) === machineNameKey(name));
    if (!found) return { status: 404, body: { error: 'unknown-machine' } };
    this.machines = this.machines.filter((m) => m !== found);
    return { status: 200, body: { revoked: found.name } };
  }

  /** A `fetch` serving the endpoints alone, as `member`, for the unit suites. */
  fetch(member: MemberRecord): typeof fetch {
    return async (input, init) => {
      const path = new URL(String(input), 'http://double').pathname;
      const answer = this.handle(member, init?.method ?? 'GET', path) ?? { status: 404, body: { error: 'not-found' } };
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
    };
  }
}
