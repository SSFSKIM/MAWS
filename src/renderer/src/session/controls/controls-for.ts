// Which controls a session has (P5 O9 M4, Interfaces §C): one port per session, chosen from its record and its lane A
// state, never by a component. A session MAWS holds, or nobody holds (`contestedBy` included: MAWS holds it), gets lane
// B. A session a terminal or a background job holds gets lane A while its bridge is live (M5); with no bridge, or one
// that answers but can't be driven, it gets none: it is read-only, with the holder notice and "Take over here", as
// before. P5 O9 M9: another machine's terminal session (a listed row of lane A, which has no record) gets lane A's port
// over main's remote adapter, its state the page's watch's (starting until the first), its gaps the remote ones.
// P5 O7 M2: another machine's lane B session (lane-b/remote-session.ts) gets lane B's port over main's remote lane B
// adapter, with the overlay main says for it (`remote.session`'s controls).
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
import { isRemoteLaneA, remoteMachineName, startingRemoteState, useRemoteLaneA } from '../../lane-a/remote-session';
import { laneAStateOf, useLaneACatalog, useLaneAState } from '../../stores/lane-a';
import { isRemoteLaneB, remoteLaneBStateOf, useIsRemoteLaneB, useRemoteLaneBState } from '../../lane-b/remote-session'; // P5 O7 M2
import { useSessions } from '../../stores/sessions';
import { laneAControls } from './lane-a';
import { laneBControls, type LaneBFrame, type LaneBInputs } from './lane-b';
import type { ControlResult, SessionControls } from './types';

const heldElsewhere = (record: SessionRecord | null): boolean => record?.holder.kind === 'terminal' || record?.holder.kind === 'background_job';

// `record` null: an id the renderer holds no record for (a status-only session); lane B reaches it by its status.
export function controlsFor(record: SessionRecord | null, laneA: LaneAState | null, inputs: LaneBInputs): SessionControls | null {
  const { appSessionId, client } = inputs;
  if (record === null && isRemoteLaneA(appSessionId)) return laneAControls(laneA ?? startingRemoteState(appSessionId), null, { appSessionId, client, remote: { machine: remoteMachineName(appSessionId) } });
  if (heldElsewhere(record)) return laneA?.bridge === 'live' ? laneAControls(laneA, record, { appSessionId, client }) : null;
  if (isRemoteLaneB(appSessionId)) return laneBControls(record, { ...inputs, remote: { state: remoteLaneBStateOf(appSessionId) } }); // P5 O7 M2
  return laneBControls(record, inputs);
}

// Whether the session is driven through its terminal's bridge now (lane A): its ops' outcomes arrive as the watch's
// `op` messages, not as the host's.
export const drivenByBridge = (appSessionId: AppSessionId): boolean =>
  (heldElsewhere(useSessions.getState().records.get(appSessionId) ?? null) && laneAStateOf(appSessionId)?.bridge === 'live') ||
  (!useSessions.getState().records.has(appSessionId) && isRemoteLaneA(appSessionId));

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
  useIsRemoteLaneB(appSessionId); // P5 O7 M2: another machine's lane B session takes main's overlay; subscribed so its state renders again
  useRemoteLaneBState(appSessionId);
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
