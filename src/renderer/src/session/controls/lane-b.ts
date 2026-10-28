// Lane B behind the controls port (P5 O9 M4, Interfaces §C): a session MAWS's own engine runs. Each method is the
// command its call site invoked before the port, with that site's arguments, answering its result unchanged; the gates
// those sites kept (the status, the availability, the holder) answer `capability`, and the chips keep their own
// `disabled` (`liveBindings`). The submit table, the side question's and the compact widget's surface words stay at
// their sites, as lane B's own reading of the session.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { ipcError } from '@shared/ipc/errors';
import type { Availability } from '@shared/ipc/schema/session';
import { endedBindings, liveBindings, type LiveReads } from '../../composer/frame/bindings';
import { sendHumanPrompt } from '../../composer/submit/send-human-prompt';
import { ENDED, STARTING } from '../../composer/submit/submit-state';
import { availabilityIn, availabilityRefusal } from '../../sessions/availability';
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
const unavailable = (reason: string | null): Capability => (reason === null ? AVAILABLE : { available: false, reason });

// A command's result as a control's: its value done, its failure refused with the IPC error's own code and words (a
// timeout included, so a caller reads it as it read the error before).
const controlResultOf = <N extends CommandName>(result: CommandResult<N>): ControlResult =>
  result.ok ? (result.value === undefined ? { state: 'done' } : { state: 'done', result: result.value }) : { state: 'refused', code: result.error.code, message: result.error.message };

export function laneBControls(record: SessionRecord | null, { appSessionId, client, frame }: LaneBInputs): SessionControls {
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

  return {
    capability(key) {
      const elsewhere = ELSEWHERE[key];
      if (elsewhere !== undefined) return { available: false, reason: elsewhere };
      if (ALWAYS.has(key)) return AVAILABLE;
      return unavailable(NEEDS_PROCESS.has(key) ? processRefusal() : writeRefusal());
    },
    answerCapability: () => AVAILABLE, // lane B carries every RequestAnswer variant
    send: (content, options) => sendHumanPrompt(appSessionId, content, options, client),
    interrupt: (args) => client.invoke('session.interrupt', { appSessionId, ...args }),
    answer: (item, answer) => {
      const { requestId } = item.request;
      if (requestId === null) return Promise.resolve({ ok: false, error: ipcError('invalid_input', 'The request has no id to answer') });
      return client.invoke('session.answer', { appSessionId, requestId, answer });
    },
    bindings() {
      const { status, availability } = now();
      const reads = frame?.reads ?? {};
      return status !== null || record !== null ? liveBindings(status, record, reads, client, availability) : endedBindings();
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
