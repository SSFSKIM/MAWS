// The local door (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b "The local door" and
// Interfaces §Q): this machine's own app changes its own sessions' reach through its own endpoint, by the same act and
// rule as any member's device over a channel. The app has no channel to its own endpoint (the direct listener binds only
// tailnet addresses, and the roster leaves the local ref out), so `mawsd` serves the door on its machine socket
// (`endpoint.local.act`, `endpoint.local.call`), whose clients are this machine's user.
//
// The door adds no authority. What a channel's identity proves of a device, the door proves by the act's step-up
// signature alone, so it takes an act only through these checks, in order, the first refusal answering:
//   1. the act is one of the three record acts (`not-offered` for anything else, whatever it carries);
//   2. its step-up signature verifies, whatever the act's grade: the act carries one (`step-up`), the head lists its
//      device exactly once (`unknown-device`: an action names a device, never a member, so there is no one key to
//      verify it under otherwise), and the signature verifies under that entry's step-up key, a key the head doesn't
//      revoke (`step-up`). Channel authorization asks a step-up only of a grade that needs one, since the channel's
//      identity stands for the device; the door has none to stand in for it;
//   3. its member and class are that entry's;
//   4. it is then decided and run as a channel's act is, through the same route: freshness and replay, the endpoint's
//      authorization (which checks the step-up again, as every record act's), its executor. Its `done` (or its refusal)
//      is the door's answer; one that doesn't come within DOOR_DONE_MS answers `unknown`, the act left to sminos's ledger.
// `call` answers `record.policy` alone, as the machine's owners' member (P5 Decision Log 36's local reader), and nothing
// else (`not-offered`).
import { isAction, type Action, type ActMessage, type EndpointMessage, type OrgState } from 'org-protocol';
import { endableClientRef } from '@shared/ipc/client';
import type { RemoteChannel } from './channels';
import { isPolicyInput, RECORD_ACTS, RECORD_POLICY } from './offers';
import { verifyDeviceStepUp } from './step-up';

/** How long an act the door handed on waits for its `done` before it answers `unknown`. */
export const DOOR_DONE_MS = 30_000;

/** An act's answer as a device reads it: `done`'s outcome, or `{state: 'refused', reason}` for a refusal before it ran. */
export type DoorOutcome = { state: string } & Record<string, unknown>;
/** A call's answer, as RL3's `result` carries it. */
export type DoorCallAnswer = { ok: true; output: unknown } | { ok: false; code: string };

export type LocalDoorContext = {
  /** The head now; null while none is held. */
  head(): OrgState | null;
  /** The channel's `act` route (freshness, authorization, the executor), as a remote device's act takes it. */
  act(channel: RemoteChannel, m: ActMessage): void;
  /** `record.policy` for the machine's owners. */
  policy(input: unknown): Promise<DoorCallAnswer>;
  log(line: string): void;
  /** The suites' seam (DOOR_DONE_MS). */
  doneWithinMs?: number;
};

const refused = (reason: string): DoorOutcome => ({ state: 'refused', reason });

export class LocalDoor {
  #acts = 0;

  constructor(private readonly ctx: LocalDoorContext) {}

  /** An act through the door: the module's four checks, then the channel's route. */
  async act(action: unknown): Promise<DoorOutcome> {
    if (!isAction(action)) return refused('malformed');
    if (!(RECORD_ACTS as readonly string[]).includes(action.action)) return refused('not-offered');
    if (action.stepUp === undefined) return refused('step-up');
    const head = this.ctx.head();
    if (head === null) return refused('unavailable');
    const entries = head.members.flatMap((member) => member.devices.filter((device) => device.id === action.device).map((device) => ({ member: member.id, device })));
    if (entries.length !== 1) return refused('unknown-device');
    const [{ member, device }] = entries;
    if (!(await verifyDeviceStepUp(action, device, head))) return refused('step-up');
    return this.#run(action, { member, device: device.id, clientClass: device.class });
  }

  /** A call through the door: `record.policy` alone. */
  call(name: string, input: unknown): Promise<DoorCallAnswer> {
    if (name !== RECORD_POLICY) return Promise.resolve({ ok: false, code: 'not-offered' });
    if (!isPolicyInput(input)) return Promise.resolve({ ok: false, code: 'malformed' });
    return this.ctx.policy(input ?? null);
  }

  /** The act on a channel of the door's own, answered by the first `ack` refusal or `done` it carries. */
  #run(action: Action, who: Pick<RemoteChannel, 'member' | 'device' | 'clientClass'>): Promise<DoorOutcome> {
    const n = ++this.#acts;
    return new Promise<DoorOutcome>((resolve) => {
      const client = endableClientRef(`local-door:${n}`);
      const listeners = new Set<(reason: string) => void>();
      let closed = false;
      const close = (reason: string) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        client.end();
        for (const listener of [...listeners]) listener(reason);
      };
      const settle = (outcome: DoorOutcome) => {
        close('answered');
        resolve(outcome);
      };
      const send = (message: EndpointMessage): boolean => {
        if (closed) return false;
        const m = message as unknown as Record<string, unknown>;
        if (m.t === 'ack' && m.state === 'refused') settle(refused(String(m.reason)));
        else if (m.t === 'done') settle((typeof m.outcome === 'object' && m.outcome !== null ? m.outcome : { state: 'unknown', reason: 'internal' }) as DoorOutcome);
        return true;
      };
      const channel: RemoteChannel = {
        key: `local:${n}`,
        carrier: 'direct',
        id: `local-door-${n}`,
        ...who,
        client,
        capabilities: [],
        get closed() {
          return closed;
        },
        send,
        transmit: async (message) => send(message),
        close,
        terminate: close,
        onClose(listener) {
          if (closed) {
            listener('answered');
            return () => {};
          }
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      };
      // declared before the act is handed on, which is the only way `close` runs
      const timer = setTimeout(() => {
        this.ctx.log(`endpoint: a local \`${action.action}\` had no outcome within ${this.ctx.doneWithinMs ?? DOOR_DONE_MS} ms; its fate is sminos's ledger's`);
        settle({ state: 'unknown', reason: 'timeout' });
      }, this.ctx.doneWithinMs ?? DOOR_DONE_MS);
      timer.unref?.();
      this.ctx.act(channel, { t: 'act', action });
    });
  }
}
