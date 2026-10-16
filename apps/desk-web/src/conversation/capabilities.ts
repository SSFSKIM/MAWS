// What each kind of session can do from the web (§5's second table, binding): the web reads it to draw what a session
// cannot do, and why, instead of failing when a button is pressed. The kind comes from presence (whether a process is
// live and whether its bridge is attached), the seat its `joined` names (a `--bg` seat, against a terminal session),
// and the machine's lease. `note` says how an action that can be taken will land.
import type { SessionPresence } from 'desk-hub/protocol';
import type { SessionGroup } from '../log/projection';

export type CapabilityInput = {
  alias: string;
  machine: string;
  member: boolean;
  group: SessionGroup;
  /** The seat its `joined` names, `''` for a session sminos did not spawn (a terminal session). */
  seat: string;
  machineOnline: boolean | null;
  presence: SessionPresence | null;
  /** The log's latest `retired`, while it stands (DX8's `DeskSession.ended`). */
  ended?: { by: string; reason: string } | null;
};

/**
 * Who retired the session, from the log's `retired`, when it was retired — the owner's deliberate act of taking it out
 * of the project, which its machine refuses to Resume (DC7's M4) — and not merely ended (a `retired` whose reason is
 * `ended`, sminos's record of a session that ended); null otherwise.
 */
export function retiredBy(s: Pick<CapabilityInput, 'member' | 'ended'>): string | null {
  return !s.member && s.ended && s.ended.reason !== 'ended' ? s.ended.by : null;
}

export type SessionKind = 'bridged' | 'seat' | 'terminal' | 'not-running' | 'unknown' | 'offline';

export const VERBS = ['send', 'steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire', 'resume'] as const;
export type Verb = (typeof VERBS)[number];

/** `path: 'send'`: the verb is carried by a log `human` (the send path), not by its RPC. */
export type Capability = { can: boolean; reason: string | null; note?: string; path?: 'send' };

export function kindOf(s: CapabilityInput): SessionKind {
  if (s.machineOnline === false) return 'offline';
  if (s.presence === null) return s.member ? 'unknown' : 'not-running';
  if (s.presence.record === null) return 'not-running';
  if (s.presence.bridge) return 'bridged';
  return s.seat ? 'seat' : 'terminal';
}

/** A turn is running: the engine's status is anything but idle (busy, a shell, waiting on the human). */
export const turnRunning = (s: CapabilityInput): boolean => {
  const status = s.presence?.record?.status;
  return typeof status === 'string' && status !== 'idle';
};

const yes = (note?: string): Capability => (note === undefined ? { can: true, reason: null } : { can: true, reason: null, note });
const no = (reason: string): Capability => ({ can: false, reason });

/**
 * `connected`: the project socket is welcomed. While it is not, no RPC is offered, whatever presence last said: the
 * browser sends none then (the hub queues nothing for an absent party), and presence from before the drop may no longer
 * hold. A send is a log `human`, held and sent once the socket is back.
 */
export function capabilities(s: CapabilityInput, connected = true): Record<Verb, Capability> {
  const byKind = capabilitiesByKind(s);
  // A send to a retired session is only recorded, whatever its process or its machine is doing: sminos delivers nothing
  // to a session that is not a member.
  const can = retiredBy(s) === null ? byKind : { ...byKind, send: yes('recorded, not delivered: it is retired') };
  if (connected) return can;
  const off = no('not connected to the hub');
  return { send: can.send.can ? yes('sent once the desk reconnects') : can.send, steer: off, interrupt: off, answer: off, decide: off, model: off, compact: off, retire: off, resume: off };
}

function capabilitiesByKind(s: CapabilityInput): Record<Verb, Capability> {
  const kind = kindOf(s);
  const running = turnRunning(s);
  const retire = s.member ? yes(s.seat ? undefined : 'records it retired; the process stays yours to close') : no(`${s.alias} is retired`);
  switch (kind) {
    case 'offline': {
      const off = no(`${s.machine} is offline`);
      const shown = no(`${s.machine} is offline: shown, not answerable`);
      return { send: yes(`kept in the log; delivered when ${s.machine} reconnects`), steer: off, interrupt: off, answer: shown, decide: shown, model: off, compact: off, retire: off, resume: off };
    }
    case 'not-running': {
      const stopped = no(`${s.alias} is not running`);
      if (retiredBy(s) !== null) {
        return { send: yes(), steer: stopped, interrupt: stopped, answer: stopped, decide: stopped, model: stopped, compact: stopped, retire, resume: no('retired: a retired session is not resumed') };
      }
      const send = yes(s.seat ? 'resumes the seat to read it' : 'recorded, not delivered: a closed terminal session is reopened only by Resume');
      return { send, steer: stopped, interrupt: stopped, answer: stopped, decide: stopped, model: stopped, compact: stopped, retire, resume: yes() };
    }
    case 'unknown': {
      const waiting = no(`waiting for ${s.alias}'s presence`);
      return { send: yes(), steer: waiting, interrupt: waiting, answer: waiting, decide: waiting, model: waiting, compact: waiting, retire, resume: waiting };
    }
    case 'bridged':
      return {
        send: yes(running ? `queued until ${s.alias} is idle` : 'starts a turn'),
        steer: running ? yes('read at its next model request') : no(`${s.alias} is idle: Send starts a turn`),
        interrupt: running ? yes() : no(`nothing to interrupt: ${s.alias} is idle`),
        answer: yes(),
        decide: yes(),
        model: yes(),
        compact: yes(running ? 'at the end of this turn' : undefined),
        retire,
        resume: no(`${s.alias} is running`),
      };
    case 'seat': {
      const terminal = no(`terminal only: ${s.alias} runs without the bridge`);
      const bridge = no(`${s.alias} runs without the bridge`);
      return {
        send: yes(running ? 'read at its next step' : 'starts a turn'),
        steer: running ? yes('read at its next step') : no(`${s.alias} is idle: Send starts a turn`),
        interrupt: no(`${s.alias} runs without the bridge: interrupt it in its terminal`),
        answer: terminal,
        decide: terminal,
        model: bridge,
        compact: bridge,
        retire,
        resume: no(`${s.alias} is running`),
      };
    }
    case 'terminal': {
      const terminal = no(`terminal only: ${s.alias} runs without the bridge`);
      const bridge = no(`${s.alias} runs without the bridge`);
      return {
        send: yes('read at its next tool round'),
        // §5: a terminal session without the bridge takes a steer as a send, which it reads at its next tool round.
        steer: running ? { can: true, reason: null, note: 'sent as a message: it arrives at its next tool round', path: 'send' } : no(`${s.alias} is idle: Send starts a turn`),
        interrupt: no(`${s.alias} runs without the bridge: interrupt it in its terminal`),
        answer: terminal,
        decide: terminal,
        model: bridge,
        compact: bridge,
        retire,
        resume: no(`${s.alias} is running`),
      };
    }
  }
}
