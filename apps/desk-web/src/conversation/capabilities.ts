// What each kind of session can do from the web (§5's second table, binding): the web reads it to draw what a session
// cannot do, and why, instead of failing when a button is pressed. The kind comes from presence (whether a process is
// live and whether its bridge is attached), the seat its `joined` names (a `--bg` seat, against a terminal session),
// and the machine's lease. A machine its owner set read-only (§6, its policy in DX4's `machine` presence) executes no
// RPC and delivers nothing sent from outside it, whatever the kind. An ended session is resumed only once its machine
// is known to serve its transcript (`shell/transcript-served.ts`): resuming one it holds none of starts an empty
// session. `note` says how an action that can be taken will land.
import type { SessionPresence } from 'desk-hub/protocol';
import { sessionName, type SessionGroup } from '../log/projection';
import type { TranscriptServed } from '../shell/transcript-served';

export type CapabilityInput = {
  alias: string;
  /** Its title, which the reasons name it by when it has one (`sessionName`). */
  title?: string | null;
  machine: string;
  member: boolean;
  group: SessionGroup;
  /** The seat its `joined` names, `''` for a session sminos did not spawn (a terminal session). */
  seat: string;
  machineOnline: boolean | null;
  /** The machine's policy says read-only (DX4 `machine` presence); absent or false until it says so. */
  machineReadOnly?: boolean;
  presence: SessionPresence | null;
  /** The log's latest `retired`, while it stands (DX8's `DeskSession.ended`). */
  ended?: { by: string; reason: string } | null;
  /** Whether its machine serves its transcript, as its subscription said (`useTranscriptServed`); absent or null until it does. */
  transcript?: TranscriptServed | null;
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

// `stop` is a background job's Stop (DC10): whether the session can stop a job at all; whether a job runs is the jobs
// view's to say.
export const VERBS = ['send', 'steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire', 'resume', 'stop'] as const;
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
  return { send: can.send.can ? yes('sent once the desk reconnects') : can.send, steer: off, interrupt: off, answer: off, decide: off, model: off, compact: off, retire: off, resume: off, stop: off };
}

function capabilitiesByKind(s: CapabilityInput): Record<Verb, Capability> {
  const kind = kindOf(s);
  if (s.machineReadOnly === true && kind !== 'offline') {
    const ro = no(`${s.machine} is read-only: it runs nothing sent from outside it`);
    return { send: yes(`recorded, not delivered: ${s.machine} is read-only`), steer: ro, interrupt: ro, answer: ro, decide: ro, model: ro, compact: ro, retire: ro, resume: ro, stop: ro };
  }
  const running = turnRunning(s);
  const name = sessionName(s);
  const retire = s.member ? yes(s.seat ? undefined : 'records it retired; the process stays yours to close') : no(`${name} is retired`);
  switch (kind) {
    case 'offline': {
      const off = no(`${s.machine} is offline`);
      const shown = no(`${s.machine} is offline: shown, not answerable`);
      return { send: yes(`kept in the log; delivered when ${s.machine} reconnects`), steer: off, interrupt: off, answer: shown, decide: shown, model: off, compact: off, retire: off, resume: off, stop: off };
    }
    case 'not-running': {
      const stopped = no(`${name} is not running`);
      if (retiredBy(s) !== null) {
        return { send: yes(), steer: stopped, interrupt: stopped, answer: stopped, decide: stopped, model: stopped, compact: stopped, retire, resume: no('retired: a retired session is not resumed'), stop: stopped };
      }
      // Resume only once the machine is known to serve the transcript, and a send says so where it cannot bring it back.
      if (s.transcript === 'none') {
        const send = yes(`recorded, not delivered: ${s.machine} serves no transcript of it to resume`);
        return { send, steer: stopped, interrupt: stopped, answer: stopped, decide: stopped, model: stopped, compact: stopped, retire, resume: no(`${s.machine} serves no transcript of ${name} to resume`), stop: stopped };
      }
      const send = yes(s.seat ? 'resumes the seat to read it' : 'recorded, not delivered: a closed terminal session is reopened only by Resume');
      const resume = s.transcript === 'served' ? yes() : no(`waiting for ${s.machine} to serve ${name}'s transcript`);
      return { send, steer: stopped, interrupt: stopped, answer: stopped, decide: stopped, model: stopped, compact: stopped, retire, resume, stop: stopped };
    }
    case 'unknown': {
      const waiting = no(`waiting for ${name}'s presence`);
      return { send: yes(), steer: waiting, interrupt: waiting, answer: waiting, decide: waiting, model: waiting, compact: waiting, retire, resume: waiting, stop: waiting };
    }
    case 'bridged':
      return {
        send: yes(running ? `queued until ${name} is idle` : 'starts a turn'),
        steer: running ? yes('read at its next model request') : no(`${name} is idle: Send starts a turn`),
        interrupt: running ? yes() : no(`nothing to interrupt: ${name} is idle`),
        answer: yes(),
        decide: yes(),
        model: yes(),
        compact: yes(running ? 'at the end of this turn' : undefined),
        retire,
        resume: no(`${name} is running`),
        stop: yes(),
      };
    case 'seat': {
      const terminal = no(`terminal only: ${name} runs without the bridge`);
      const bridge = no(`${name} runs without the bridge`);
      return {
        send: yes(running ? 'read at its next step' : 'starts a turn'),
        steer: running ? yes('read at its next step') : no(`${name} is idle: Send starts a turn`),
        interrupt: no(`${name} runs without the bridge: interrupt it in its terminal`),
        answer: terminal,
        decide: terminal,
        model: bridge,
        compact: bridge,
        retire,
        resume: no(`${name} is running`),
        stop: no(`${name} runs without the bridge: stop its jobs in its terminal`),
      };
    }
    case 'terminal': {
      const terminal = no(`terminal only: ${name} runs without the bridge`);
      const bridge = no(`${name} runs without the bridge`);
      return {
        send: yes('read at its next tool round'),
        // §5: a terminal session without the bridge takes a steer as a send, which it reads at its next tool round.
        steer: running ? { can: true, reason: null, note: 'sent as a message: it arrives at its next tool round', path: 'send' } : no(`${name} is idle: Send starts a turn`),
        interrupt: no(`${name} runs without the bridge: interrupt it in its terminal`),
        answer: terminal,
        decide: terminal,
        model: bridge,
        compact: bridge,
        retire,
        resume: no(`${name} is running`),
        stop: no(`${name} runs without the bridge: stop its jobs in its terminal`),
      };
    }
  }
}
