// The proofs of presence an action carries beyond its channel (O10 M5; RL §5.6, §5.10). A native device's step-up: an
// ECDSA signature over the canonical action by its `stepUpPub`, required for a spawn, an approval on a session the member
// doesn't own, a change of owners, access or shares (O8's `record.*`), a machine-admin action, and a `shell` request by
// a member who isn't a machine owner (P5's O10 item 8); a machine owner's own approvals and shell need none (RL §10.5).
// A web-cards device's every action carries a WebAuthn assertion over the action's digest, checked against the passkey
// its org-state entry lists, the origin its code is served from, and a signature counter kept per credential
// (`webauthn.json`) that must rise where the authenticator keeps one.
import { keyId, verifyStepUp, verifyWebAuthn, type Action, type Device, type OrgState, type Passkey } from 'org-protocol';
import type { Grade } from '@shared/ipc/grades';

/** Whether an action with this effective grade needs the device's step-up signature. */
export function stepUpRequired(input: { name: string; grade: Grade | null; ownsSession: boolean; ownsMachine: boolean }): boolean {
  const { name, grade, ownsSession, ownsMachine } = input;
  if (name.startsWith('record.')) return true;
  if (grade === 'spawn' || grade === 'machine-admin') return true;
  if (grade === 'approve') return !ownsSession;
  if (grade === 'shell') return !ownsMachine;
  return false;
}

/** The device's org-state entry in `head`, or undefined. */
export function deviceOf(head: OrgState, member: string, device: string): Device | undefined {
  return head.members.find((m) => m.id === member)?.devices.find((d) => d.id === device);
}

/** Whether `action.stepUp` verifies under the device's step-up key, a key the head doesn't revoke. */
export async function verifyDeviceStepUp(action: Action, device: Device, head: OrgState): Promise<boolean> {
  if (action.stepUp === undefined || device.stepUpPub === undefined) return false;
  const kid = await keyId(device.stepUpPub);
  if (head.revoked.some((r) => r.keyId === kid)) return false;
  return (await verifyStepUp(action, device.stepUpPub)).ok;
}

export type CounterStore = { counter(credentialId: string): number; setCounter(credentialId: string, counter: number): void };

/**
 * WebAuthn assertions, checked one at a time so two copies of one assertion can't both pass against the same stored
 * counter; a counter is kept only for an assertion that verified.
 */
export class Assertions {
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: CounterStore,
    private readonly origin: () => string | null,
  ) {}

  check(action: Action, passkey: Passkey): Promise<boolean> {
    const run = this.#queue.then(async () => {
      const origin = this.origin();
      if (action.webauthn === undefined || origin === null) return false;
      const verdict = await verifyWebAuthn(action, passkey, origin, this.store.counter(passkey.credentialId));
      if (!verdict.ok) return false;
      this.store.setCounter(passkey.credentialId, verdict.counter ?? 0);
      return true;
    });
    this.#queue = run.catch(() => {});
    return run;
  }
}
