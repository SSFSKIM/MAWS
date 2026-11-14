// Which controls a session has (P5 O9 M4, Interfaces §C): one port per session, chosen from its record and its lane A
// state, never by a component. A session MAWS holds, or nobody holds (`contestedBy` included: MAWS holds it), gets lane
// B. A session a terminal or a background job holds gets lane A while its bridge is live (M5); with no bridge, or one
// that answers but can't be driven, it gets none: it is read-only, with the holder notice and "Take over here", as
// before. P5 O9 M9: another machine's terminal session (a listed row of lane A, which has no record) gets lane A's port
// over main's remote adapter, its state the page's watch's (starting until the first), its gaps the remote ones.
// P5 O7 M2: another machine's lane B session (lane-b/remote-session.ts) gets lane B's port over main's remote lane B
// adapter, with the overlay main says for it (`remote.session`'s controls). Board 525: on another member's session whose
// machine refused the member's read or words at their grade (sessions/share/reader.ts), every control but a subagent's
// rows is closed with why and whom to ask, and a send is refused in those words without going.
import type { RequestAnswer } from '@shared/engine/answers';
import type { SendContent } from '@shared/engine/session-state-store';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { ipcError } from '@shared/ipc/errors';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import type { HumanPromptOptions, HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { ipc } from '../../ipc/client';
import { holderWords } from '../../sessions/holder-words';
import { isRemoteLaneA, remoteMachineCapabilities, remoteMachineName, startingRemoteState, useRemoteLaneA, useRemoteMachineCapabilities } from '../../lane-a/remote-session';
import { laneAStateOf, useLaneACatalog, useLaneAState } from '../../stores/lane-a';
import { isRemoteLaneB, remoteLaneBStateOf, useIsRemoteLaneB, useRemoteLaneBState } from '../../lane-b/remote-session'; // P5 O7 M2
import { useSessions } from '../../stores/sessions';
import { closedWords, noteOwnPrompt, noteOwnQueued, readerGradeOf, useReaderGrade, useWhomToAsk, whomToAsk } from '../../sessions/share/reader';
import { FILES_MAX, LANE_A_WORDS, laneAControls } from './lane-a';
import { laneBControls, type LaneBFrame, type LaneBInputs } from './lane-b';
import type { Capability, ControlResult, SessionControls } from './types';

const heldElsewhere = (record: SessionRecord | null): boolean => record?.holder.kind === 'terminal' || record?.holder.kind === 'background_job';

// `record` null: an id the renderer holds no record for (a status-only session); lane B reaches it by its status.
export function controlsFor(record: SessionRecord | null, laneA: LaneAState | null, inputs: LaneBInputs): SessionControls | null {
  return noting(gated(portFor(record, laneA, inputs), inputs.appSessionId), inputs.appSessionId);
}

// Board 525: every send goes through a port, so here a prompt the host took for another member's session is kept as the
// member's own: by its message uuid, or, queued, by its queue id (the uuid comes when the entry is submitted).
function noting(controls: SessionControls | null, appSessionId: AppSessionId): SessionControls | null {
  if (controls === null) return null;
  return {
    ...controls,
    send: async (content, options) => {
      const result = await controls.send(content, options);
      if (result.disposition !== 'refused' && result.disposition !== 'held') {
        noteOwnPrompt(appSessionId, result.messageUuid);
        if (result.disposition === 'queued') noteOwnQueued(appSessionId, result.queueId);
      }
      return result;
    },
  };
}

// Board 525: the port of another member's session closed at the grade its machine's refusal taught.
function gated(controls: SessionControls | null, appSessionId: AppSessionId): SessionControls | null {
  const grade = controls === null ? null : readerGradeOf(appSessionId);
  if (controls === null || grade === null) return controls;
  const reason = closedWords(grade, whomToAsk(appSessionId));
  const closed: Capability = { available: false, reason };
  return {
    ...controls,
    capability: (key) => (key === 'subagent-rows' ? controls.capability(key) : closed),
    answerCapability: () => closed,
    send: async () => ({ disposition: 'refused', started: false, reason }),
  };
}

function portFor(record: SessionRecord | null, laneA: LaneAState | null, inputs: LaneBInputs): SessionControls | null {
  const { appSessionId, client } = inputs;
  if (record === null && isRemoteLaneA(appSessionId)) {
    return laneAControls(laneA ?? startingRemoteState(appSessionId), null, { appSessionId, client, remote: { machine: remoteMachineName(appSessionId), capabilities: remoteMachineCapabilities(appSessionId) } });
  }
  if (heldElsewhere(record)) return laneA?.bridge === 'live' ? laneAControls(laneA, record, { appSessionId, client }) : null;
  if (isRemoteLaneB(appSessionId)) return laneBControls(record, { ...inputs, remote: { state: remoteLaneBStateOf(appSessionId) } }); // P5 O7 M2
  return laneBControls(record, inputs);
}

// Whether the session is driven through its terminal's bridge now (lane A): its ops' outcomes arrive as the watch's
// `op` messages, not as the host's.
export const drivenByBridge = (appSessionId: AppSessionId): boolean =>
  (heldElsewhere(useSessions.getState().records.get(appSessionId) ?? null) && laneAStateOf(appSessionId)?.bridge === 'live') ||
  (!useSessions.getState().records.has(appSessionId) && isRemoteLaneA(appSessionId));

// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, decision 9): how many screenshots one
// message to the session can carry, with the sentence its composer says for the rest; null when the route sets no count
// (a session MAWS runs: a size it refuses comes back as the send's refusal). A session driven through its bridge takes the
// bridge's four files while its `media` control is open, and none when it is closed (another machine's, whose words
// name why).
export function screenshotRoom(appSessionId: AppSessionId, controls: SessionControls | null = sessionControls(appSessionId)): { max: number; reason: string } | null {
  if (!drivenByBridge(appSessionId)) return null;
  const media = controls?.capability('media') ?? { available: false as const, reason: LANE_A_WORDS.noBridge };
  return media.available ? { max: FILES_MAX, reason: LANE_A_WORDS.tooManyFiles } : { max: 0, reason: media.reason };
}

// The session's port as the stores have it now, for a caller outside a component (a store, a card's continuation).
export function sessionControls(appSessionId: AppSessionId, client: MawsBridge = ipc): SessionControls | null {
  return controlsFor(useSessions.getState().records.get(appSessionId) ?? null, laneAStateOf(appSessionId), { appSessionId, client });
}

// The session's port for a component, following its record, its lane A state and its catalog's body (which the lane A
// port reads when asked: the model chip, the palette, MCP's capabilities); `frame` is what the composer reads beside it.
export function useSessionControls(appSessionId: AppSessionId, options: { client?: MawsBridge; frame?: LaneBFrame } = {}): SessionControls | null {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const laneA = useLaneAState(appSessionId);
  useLaneACatalog(appSessionId); // read through the port; subscribed here so its arrival renders again
  useRemoteLaneA(appSessionId); // M9: a listed row of another machine's lane A takes the port; subscribed so its listing renders again
  useRemoteMachineCapabilities(appSessionId); // 2026-11-06: its endpoint's capabilities lift a gap (`subagent-rows`)
  useIsRemoteLaneB(appSessionId); // P5 O7 M2: another machine's lane B session takes main's overlay; subscribed so its state renders again
  useRemoteLaneBState(appSessionId);
  useReaderGrade(appSessionId); // board 525: a refusal at the member's grade closes the port; subscribed so it renders again
  useWhomToAsk(appSessionId);
  return controlsFor(record, laneA, { appSessionId, client: options.client ?? ipc, ...(options.frame && { frame: options.frame }) });
}

// What a caller says when no port drives the session: who holds it, in the words an acquisition's refusal used.
export const heldWords = (appSessionId: AppSessionId): string => `Held by ${holderWords(useSessions.getState().records.get(appSessionId)?.holder ?? { kind: 'none' })}`;

// A person's words to a session from outside its composer (a quick reply, an answer, a comment, a card's continuation):
// its port's send, or a refusal naming who holds it.
export async function sendToSession(appSessionId: AppSessionId, content: SendContent, options: HumanPromptOptions, client: MawsBridge = ipc): Promise<HumanPromptResult> {
  const controls = sessionControls(appSessionId, client);
  return controls ? controls.send(content, options) : { disposition: 'refused', started: false, reason: heldWords(appSessionId) };
}

// An answer to a request from a card or a preview: its session's port, or, when none drives the session, a failure
// naming who holds it (the card's Retry stays).
export async function answerSession(item: AttentionItem, answer: RequestAnswer, client: MawsBridge = ipc): Promise<CommandResult<'session.answer'>> {
  const controls = sessionControls(item.appSessionId, client);
  return controls ? controls.answer(item, answer) : { ok: false, error: ipcError('internal', heldWords(item.appSessionId)) };
}

// A control answering a `ControlResult`, refused in the holder's words when no port drives the session.
const heldControl = (appSessionId: AppSessionId): ControlResult => ({ state: 'refused', code: 'held', message: heldWords(appSessionId) });

// Compact now, from the compact widget or the context popover.
export async function compactSession(appSessionId: AppSessionId, instructions?: string, client: MawsBridge = ipc): Promise<ControlResult> {
  const controls = sessionControls(appSessionId, client);
  return controls ? controls.compact(instructions) : heldControl(appSessionId);
}

// A background task's or a subagent's task's Stop, from the agents tools.
export async function stopSessionTask(appSessionId: AppSessionId, taskId: string, client: MawsBridge = ipc): Promise<ControlResult> {
  const controls = sessionControls(appSessionId, client);
  return controls ? controls.stopTask(taskId) : heldControl(appSessionId);
}

// A side question from the side pane: its session's port, or a failure naming who holds the session.
export async function askSession(appSessionId: AppSessionId, question: string, retryOf: string | undefined, client: MawsBridge = ipc): Promise<CommandResult<'session.sideQuestion'>> {
  const controls = sessionControls(appSessionId, client);
  return controls ? controls.btw(question, retryOf === undefined ? {} : { retryOf }) : { ok: false, error: ipcError('internal', heldWords(appSessionId)) };
}
