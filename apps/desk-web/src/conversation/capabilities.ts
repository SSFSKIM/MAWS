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
};

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

export function capabilities(s: CapabilityInput): Record<Verb, Capability> {
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
