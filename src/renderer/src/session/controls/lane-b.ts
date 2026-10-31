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
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { ipcError } from '@shared/ipc/errors';
import type { Availability } from '@shared/ipc/schema/session';
import { REMOTE_INLINE_MAX_BYTES, REMOTE_TOO_LARGE_WORDS, type RemoteSession } from '@shared/ipc/schema/remote';
import { endedBindings, liveBindings, type FrameBindings, type LiveReads } from '../../composer/frame/bindings';
import { sendHumanPrompt, sendWithoutAcquiring } from '../../composer/submit/send-human-prompt';
import { ENDED, STARTING } from '../../composer/submit/submit-state';
import { availabilityIn, availabilityRefusal } from '../../sessions/availability';
import { beginRemoteSend } from '../../lane-b/remote-session'; // P5 O7 M2
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
// P5 O7 M2: `session.applyFlagSettings` and the rules read are not offered over a machine's link (O7's Interfaces §L)
const REMOTE_DIRECTORIES = 'Adding a directory isn’t offered for a session on another machine';
const refusedWith = (error: string) => async () => ({ ok: false as const, error });
const unavailable = (reason: string | null): Capability => (reason === null ? AVAILABLE : { available: false, reason });

// P5 O7 M2: content that would not fit one message on the channel, by the bound main's link checks (its UTF-8 JSON).
const encoder = new TextEncoder();
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
    const process = now().status?.process;
    return process === 'ready' ? null : process === 'starting' || process === 'initializing' ? STARTING : ENDED;
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
  const sendRemote = async (content: Parameters<SessionControls['send']>[0], options: Parameters<SessionControls['send']>[1]) => {
    const sendable = capability('send');
    if (!sendable.available) return { disposition: 'refused' as const, started: false, reason: sendable.reason };
    if (pastChannel(content)) return { disposition: 'refused' as const, started: false, reason: REMOTE_TOO_LARGE_WORDS };
    const sent = beginRemoteSend(appSessionId);
    try {
      return await sendWithoutAcquiring(appSessionId, content, options, client); // one invocation: main resumes and sends under one bound
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
    answerCapability: () => capability('answer'), // lane B carries every RequestAnswer variant; another machine's overlay may close them
    send: (content, options) => (remote ? sendRemote(content, options) : sendHumanPrompt(appSessionId, content, options, client)),
    interrupt: (args) => client.invoke('session.interrupt', { appSessionId, ...args }),
    answer: (item, answer) => {
      const { requestId } = item.request;
      if (requestId === null) return Promise.resolve({ ok: false, error: ipcError('invalid_input', 'The request has no id to answer') });
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
