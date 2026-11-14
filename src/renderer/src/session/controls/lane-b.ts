// Lane B behind the controls port (P5 O9 M4, Interfaces §C): a session MAWS's own engine runs. Each method is the
// command its call site invoked before the port, with that site's arguments, answering its result unchanged; the gates
// those sites kept (the status, the availability, the holder) answer `capability`, and the chips keep their own
// `disabled` (`liveBindings`). The submit table, the side question's and the compact widget's surface words stay at
// their sites, as lane B's own reading of the session.
// P5 O7 M2 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The capability list", "Images"): a lane B session on
// another machine takes this port too, its commands reaching that machine through main's remote lane B adapter, with
// `remote`: main's overlay (`remote.session`'s controls) closes what the session there can't take with main's reason, and
// every control while one reason closes them all; a send is refused before it goes when its content would not fit the
// channel (an image past the bound waits for M4's uploads), and is counted while on its way, for the composer's
// "Sending to <machine>…". Main resumes a released session there for the act itself, under the act's one bound (A4), so
// nothing here acquires first: a send is one invocation, and a chip changes with no acquisition.
// UX wave U1a §F: a plan answer that names a mode is carried only for a session on this Mac whose engine host has this
// build's wire (`hostAppliesPlanMode`, read from main's `host.status` when asked): another build's host would drop the key
// and implement in the earlier mode, and a session on another machine is never sent one (its endpoint refuses it, and a
// machine on an older build would refuse the whole answer). Closed in `answerCapability`, and refused again in `answer`; the services refuse it once more where
// they forward it to the engine host (src/services/sessions/index.ts), for a caller that does not come through this port.
// UX wave U4a (decision 30; Interfaces D): the stack's Send now on a next-step row (`session.steer.sendNow`) goes only to an
// engine host of this build's wire, by the same reading of `host.status`; under another build's host the port answers the
// sentence and invokes nothing (that host does not know the command). A session on another machine is never gated here:
// its host is that machine's, and the command is declared not offered there.
import type { RequestAnswer } from '@shared/engine/answers';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { ipcError } from '@shared/ipc/errors';
import type { Availability } from '@shared/ipc/schema/session';
import { REMOTE_INLINE_MAX_BYTES, REMOTE_TOO_LARGE_WORDS, type RemoteSession } from '@shared/ipc/schema/remote';
import { endedBindings, liveBindings, type FrameBindings, type LiveReads } from '../../composer/frame/bindings';
import { sendHumanPrompt, sendWithoutAcquiring } from '../../composer/submit/send-human-prompt';
import { ENDED, REATTACHING, reattaching, STARTING } from '../../composer/submit/submit-state';
import { availabilityIn, availabilityRefusal } from '../../sessions/availability';
import { beginRemoteSend } from '../../lane-b/remote-session'; // P5 O7 M2
import { READER } from '../../sessions/share/copy'; // board 525
import { learnReaderGrade, whomToAsk } from '../../sessions/share/reader'; // board 525
import { hostAppliesPlanMode, namesPlanMode, PLAN_MODE_OTHER_HOST } from '@shared/sessions/plan-next-mode';
import { useHosts } from '../../stores/hosts';
import { hostHasThisWire } from '@shared/sessions/host-wire';
import { HOST_UPDATING } from '../../composer/queue/host-wire';
import { useSessions } from '../../stores/sessions';
import type { Capability, ControlKey, ControlResult, SessionControls } from './types';

// What the composer reads of its session beside the record; a port made without one reads the stores when asked.
export interface LaneBFrame {
  status: EngineSessionStatus | null;
  reads?: LiveReads;
  availability: Availability | null;
}

export interface LaneBInputs {
  appSessionId: AppSessionId;
  client: MawsBridge;
  frame?: LaneBFrame;
  // P5 O7 M2: a session on another machine, with main's word on it (null before the first)
  remote?: { state: RemoteSession | null };
}

// The lane A verbs lane B reaches another way, and Take over, which a session MAWS holds has no use for.
const ELSEWHERE: Partial<Record<ControlKey, string>> = {
  command: 'A slash command is sent as a message in this session',
  'stop-agent': 'A subagent is stopped through its task in this session',
  tell: 'A subagent is messaged through its parent in this session',
  'take-over': 'MAWS already holds this session',
};
// What the request's own host decides, or what only reads: never gated on the session's process.
const ALWAYS = new Set<ControlKey>(['answer', 'decide', 'decide.scope', 'decide.interrupt', 'decide.addDirectory', 'elicitation.answer', 'subagent-rows']);
// What only a ready process takes: an interrupt or a stop never starts a session.
const NEEDS_PROCESS = new Set<ControlKey>(['interrupt', 'stop-task']);

const AVAILABLE: Capability = { available: true };
// U1a §F: why a plan answer that names a mode is not carried
export const PLAN_MODE_WORDS = {
  otherHost: PLAN_MODE_OTHER_HOST, // the services' forwarding boundary refuses in the same words
  elsewhere: 'A mode for after the plan isn’t chosen for a session on another machine',
} as const;
// P5 O7 M2: `session.applyFlagSettings` and the rules read are not offered over a machine's link (O7's Interfaces §L)
const REMOTE_DIRECTORIES = 'Adding a directory isn’t offered for a session on another machine';
const refusedWith = (error: string) => async () => ({ ok: false as const, error });
const unavailable = (reason: string | null): Capability => (reason === null ? AVAILABLE : { available: false, reason });

// Board 525: the machine's refusal a remote send's error carries (main's `issues.refusal`, the error's cause).
const refusalOf = (error: unknown): unknown => ((error as { cause?: { issues?: { refusal?: unknown } } } | null)?.cause?.issues?.refusal);

// P5 O7 M2: content that would not fit one message on the channel, by the bound main's link checks (its UTF-8 JSON).
const encoder = new TextEncoder();
// board 525: whether a text block of the content starts with `/` (after leading space), which the endpoint grades by
// the command, Manage unless it is a session-only or read-only one (src/endpoint/by-effect.ts `textGrade`; the renderer
// may not import it)
const hasSlashText = (content: string | readonly unknown[]): boolean =>
  typeof content === 'string'
    ? content.trimStart().startsWith('/')
    : content.some((block) => {
        const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown };
        return type === 'text' && typeof text === 'string' && text.trimStart().startsWith('/');
      });
const pastChannel = (content: string | readonly unknown[]): boolean => encoder.encode(JSON.stringify(content)).length > REMOTE_INLINE_MAX_BYTES;

// A command's result as a control's: its value done, its failure refused with the IPC error's own code and words (a
// timeout included, so a caller reads it as it read the error before).
const controlResultOf = <N extends CommandName>(result: CommandResult<N>): ControlResult =>
  result.ok ? (result.value === undefined ? { state: 'done' } : { state: 'done', result: result.value }) : { state: 'refused', code: result.error.code, message: result.error.message };

export function laneBControls(record: SessionRecord | null, { appSessionId, client, frame, remote }: LaneBInputs): SessionControls {
  const now = () => {
    if (frame) return frame;
    const state = useSessions.getState();
    return { status: state.engine.get(appSessionId) ?? null, availability: availabilityIn(state, appSessionId) };
  };
  // Why a write can't go now; null when it may (a ready process, or one the write starts), as `liveBindings` gates the chips.
  const writeRefusal = (): string | null => {
    const { status, availability } = now();
    return status?.process === 'ready' ? null : availabilityRefusal(availability, record?.holder ?? null);
  };
  const processRefusal = (): string | null => {
    const status = now().status;
    const process = status?.process;
    return process === 'ready' ? null : reattaching(status ?? null) ? REATTACHING /* P5 O16 M3b */ : process === 'starting' || process === 'initializing' ? STARTING : ENDED;
  };
  const refusedHere = (key: ControlKey): Promise<ControlResult> => Promise.resolve({ state: 'refused', code: 'unsupported', message: ELSEWHERE[key]! });
  const ownCapability = (key: ControlKey): Capability => {
    const elsewhere = ELSEWHERE[key];
    if (elsewhere !== undefined) return { available: false, reason: elsewhere };
    if (ALWAYS.has(key)) return AVAILABLE;
    return unavailable(NEEDS_PROCESS.has(key) ? processRefusal() : writeRefusal());
  };
  // P5 O7 M2: a session on another machine. Main's overlay is the verdict from its record: a released session resumes
  // there for the act, and a link down holds the act (A4) rather than closing it, so a status this page doesn't hold (it
  // forgets a departed machine's) gates nothing; one it holds still says a process is starting or gone, for an act that
  // never starts a session. Lane B's own words for what it reaches another way, and before main's first word.
  const remoteCapability = (key: ControlKey, state: RemoteSession): Capability => {
    const elsewhere = ELSEWHERE[key];
    if (elsewhere !== undefined) return { available: false, reason: elsewhere };
    const overlaid = state.controls[key];
    if (!overlaid.available) return overlaid;
    return NEEDS_PROCESS.has(key) && now().status !== null ? unavailable(processRefusal()) : AVAILABLE;
  };
  const capability = (key: ControlKey): Capability => (remote?.state ? remoteCapability(key, remote.state) : ownCapability(key));
  // U1a §F: why this answer's named mode can't go, or null (none named, or this Mac's host of this build applies it)
  const modeRefusal = (answer: RequestAnswer): string | null => {
    if (!namesPlanMode(answer)) return null;
    if (remote) return PLAN_MODE_WORDS.elsewhere;
    return hostAppliesPlanMode(useHosts.getState().supervisor) ? null : PLAN_MODE_WORDS.otherHost;
  };
  const sendRemote = async (content: Parameters<SessionControls['send']>[0], options: Parameters<SessionControls['send']>[1]) => {
    const sendable = capability('send');
    if (!sendable.available) return { disposition: 'refused' as const, started: false, reason: sendable.reason };
    if (pastChannel(content)) return { disposition: 'refused' as const, started: false, reason: REMOTE_TOO_LARGE_WORDS };
    const sent = beginRemoteSend(appSessionId);
    try {
      return await sendWithoutAcquiring(appSessionId, content, options, client); // one invocation: main resumes and sends under one bound
    } catch (error) {
      // board 525: another member's session refused the words at the member's grade: said with whom to ask, and learnt,
      // but only for plain words (Converse): a slash command is graded Manage, so its refusal says nothing of Converse
      if (refusalOf(error) === 'grade' && !hasSlashText(content) && learnReaderGrade(appSessionId, 'view')) return { disposition: 'refused' as const, started: false, reason: READER.notSent(whomToAsk(appSessionId)) };
      throw error;
    } finally {
      sent();
    }
  };
  // P5 O7 M2: the chips of a session on another machine: changed with no acquisition (main resumes it for the change),
  // each closed with the overlay's reason for its key; the directories are not offered over the link
  const remoteBindings = (live: FrameBindings): FrameBindings => {
    const model = capability('model');
    const mode = capability('mode');
    return {
      ...live,
      model: model.available ? live.model : { ...live.model, disabled: model.reason, set: refusedWith(model.reason) },
      mode: mode.available ? live.mode : { ...live.mode, disabled: mode.reason, set: refusedWith(mode.reason) },
      directories: { ...live.directories, disabled: REMOTE_DIRECTORIES, set: refusedWith(REMOTE_DIRECTORIES) },
    };
  };

  return {
    capability,
    // lane B carries every RequestAnswer variant; another machine's overlay may close them, and a plan's named mode is
    // carried only where it is applied (U1a §F)
    answerCapability: (_item, answer) => {
      const refusal = modeRefusal(answer);
      return refusal === null ? capability('answer') : { available: false, reason: refusal };
    },
    send: (content, options) => (remote ? sendRemote(content, options) : sendHumanPrompt(appSessionId, content, options, client)),
    interrupt: (args) => client.invoke('session.interrupt', { appSessionId, ...args }),
    answer: (item, answer) => {
      const { requestId } = item.request;
      if (requestId === null) return Promise.resolve({ ok: false, error: ipcError('invalid_input', 'The request has no id to answer') });
      const refusal = modeRefusal(answer);
      if (refusal !== null) return Promise.resolve({ ok: false, error: ipcError('invalid_input', refusal) });
      return client.invoke('session.answer', { appSessionId, requestId, answer });
    },
    bindings() {
      const { status, availability } = now();
      const reads = frame?.reads ?? {};
      if (status === null && record === null) return endedBindings();
      return remote ? remoteBindings(liveBindings(status, record, reads, client, availability, false)) : liveBindings(status, record, reads, client, availability);
    },
    queue: () => ({
      promote: (args) => client.invoke('session.queue.promote', { appSessionId, ...args }),
      hold: (args) => client.invoke('session.queue.hold', { appSessionId, ...args }),
      remove: (args) => client.invoke('session.queue.remove', { appSessionId, ...args }),
      edit: (args) => client.invoke('session.queue.edit', { appSessionId, ...args }),
      setPaused: (args) => client.invoke('session.queue.setPaused', { appSessionId, ...args }),
      cancelSteer: (args) => client.invoke('session.steer.cancel', { appSessionId, ...args }),
      sendNow: (args) =>
        !remote && !hostHasThisWire(useHosts.getState().supervisor)
          ? Promise.resolve({ ok: false as const, error: ipcError('invalid_input', HOST_UPDATING) })
          : client.invoke('session.steer.sendNow', { appSessionId, ...args }),
    }),
    btw: (question, options) => client.invoke('session.sideQuestion', { appSessionId, question, ...(options?.retryOf !== undefined && { retryOf: options.retryOf }) }),
    command: () => refusedHere('command'),
    compact: async (instructions) => controlResultOf(await client.invoke('session.send', { appSessionId, content: instructions ? `/compact ${instructions}` : '/compact' })),
    stopAgent: () => refusedHere('stop-agent'),
    tell: () => refusedHere('tell'),
    stopTask: async (taskId) => controlResultOf(await client.invoke('session.stopTask', { appSessionId, taskId: taskId as TaskId })),
    turn: () => null, // C3's status is the session's own
    slash: (catalog, widgets) => ({ catalog, widgets }), // the engine's catalogue, every registered widget
  };
}
