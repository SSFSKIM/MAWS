// What each kind of session can do from the web (§5's second table, binding): the web reads it to draw what a session
// cannot do, and why, instead of failing when a button is pressed. The kind comes from presence (whether a process is
// live and whether its bridge is attached), the seat its `joined` names (a `--bg` seat, against a terminal session),
// and the machine's lease. A machine its owner set read-only (§6, its policy in DX4's `machine` presence) executes no
// RPC and delivers nothing sent from outside it, whatever the kind. An ended session is resumed only once its machine
// is known to serve its transcript (`shell/transcript-served.ts`): resuming one it holds none of starts an empty
// session. `note` says how an action that can be taken will land.
//
// The desk control surface's verbs (its spec, 2026-10-22, §4) exist on some machines and not others while doperpowers
// rolls out, and a session keeps the mod it loaded until a reload: each is offered only when what it needs (`NEEDS`) is
// advertised — a bridge op or read in the session's `presence.capabilities`, a daemon RPC in the machine's `desk` — and
// otherwise names the stale session or the older machine, so the owner is sent to the right place.
import type { DeskCapabilities, SessionPresence } from 'desk-hub/protocol';
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
  /** What the machine's daemon can do itself (DX4 `machine` presence's `desk`); absent from an older daemon or hub. */
  machineDesk?: DeskCapabilities | null;
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
// view's to say. `command` runs a slash command in the session; `status` is a read's capability, which the Info tab
// draws (not a button).
const KIND_VERBS = ['send', 'steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire', 'resume', 'stop'] as const;
const DESK_VERBS = ['command', 'status', 'catalog'] as const;
export const VERBS = [...KIND_VERBS, ...DESK_VERBS] as const;
export type Verb = (typeof VERBS)[number];
type KindVerb = (typeof KIND_VERBS)[number];
type DeskVerb = (typeof DESK_VERBS)[number];

/** The sminos version of the desk control surface's M0, whose bridge and daemon first advertise what they can do. */
export const M0_SMINOS = '1.7.0';
export const M1_SMINOS = '1.8.0';

/**
 * What each desk-control verb needs: a bridge op (in `presence.capabilities.ops`), a read (in its `reads`), a daemon
 * RPC (in `machine.desk.rpcs`), and the sminos version that added it, which a fallback names.
 */
export const NEEDS: Record<DeskVerb, { op?: string; rpc?: string; read?: string; sminos: string }> = {
  command: { op: 'command', rpc: 'command', sminos: M0_SMINOS },
  status: { read: 'status', sminos: M0_SMINOS },
  catalog: { read: 'catalog', sminos: M1_SMINOS },
};

/** Whether dotted version `have` is at or above `need` (`1.10.0` above `1.9.2`); a part that is not a number counts 0. */
export function versionAtLeast(have: string, need: string): boolean {
  const a = have.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const b = need.split('.').map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

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
  const can = { ...(retiredBy(s) === null ? byKind : { ...byKind, send: yes('recorded, not delivered: it is retired') }), command: deskCapability(s, 'command'), status: deskCapability(s, 'status'), catalog: deskCapability(s, 'catalog') };
  if (connected) return can;
  const off = no('not connected to the hub');
  return { send: can.send.can ? yes('sent once the desk reconnects') : can.send, steer: off, interrupt: off, answer: off, decide: off, model: off, compact: off, retire: off, resume: off, stop: off, command: off, status: off, catalog: off };
}

/**
 * A desk-control verb: the kind's reason where the session cannot take one at all (no bridge, not running, offline),
 * read-only for one that executes (an RPC), else what both presences advertise (§4): the bridge its op or read, the
 * daemon its RPC. Where they do not, the machine's `desk.sminos` tells a stale session (the machine is updated, the
 * session's mod loaded before) from an older machine, and names its version when the daemon says it.
 */
function deskCapability(s: CapabilityInput, verb: DeskVerb): Capability {
  const name = sessionName(s);
  switch (kindOf(s)) {
    case 'offline':
      return no(`${s.machine} is offline`);
    case 'not-running':
      return no(`${name} is not running`);
    case 'unknown':
      return no(`waiting for ${name}'s presence`);
    case 'seat':
    case 'terminal':
      return no(`${name} runs without the bridge`);
    case 'bridged':
      break;
  }
  const need = NEEDS[verb];
  if (need.rpc && s.machineReadOnly === true) return no(`${s.machine} is read-only: it runs nothing sent from outside it`);
  const caps = s.presence?.capabilities;
  const desk = s.machineDesk ?? null;
  const bridgeHas = caps !== undefined && versionAtLeast(caps.sminos, need.sminos) && (!need.op || caps.ops.includes(need.op)) && (!need.read || caps.reads.includes(need.read));
  const daemonHas = !need.rpc || (desk?.rpcs.includes(need.rpc) ?? false);
  if (bridgeHas && daemonHas) return verb === 'command' && turnRunning(s) ? yes(`queued until ${name} is idle`) : yes();
  if (!bridgeHas && desk !== null && versionAtLeast(desk.sminos, need.sminos)) return no("this session's plugin loaded before the update: run /reload-plugins in it, or restart it");
  const older = `${s.machine}'s plugin${desk ? ` (${desk.sminos})` : ''} is older than the desk's controls: update sminos on ${s.machine}`;
  return no(verb === 'catalog' ? `commands need sminos ≥ ${need.sminos} on ${s.machine} · ${older}` : older);
}

function capabilitiesByKind(s: CapabilityInput): Record<KindVerb, Capability> {
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
      // Not known is a condition, not a promise: the machine may never answer (an early end, a session gone while open).
      if (s.transcript === 'none') {
        const send = yes(`recorded, not delivered: ${s.machine} serves no transcript of it to resume`);
        return { send, steer: stopped, interrupt: stopped, answer: stopped, decide: stopped, model: stopped, compact: stopped, retire, resume: no(`${s.machine} serves no transcript of ${name} to resume`), stop: stopped };
      }
      const send = yes(s.seat ? 'resumes the seat to read it' : 'recorded, not delivered: a closed terminal session is reopened only by Resume');
      const resume = s.transcript === 'served' ? yes() : no(`offered once ${s.machine} serves ${name}'s transcript`);
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
