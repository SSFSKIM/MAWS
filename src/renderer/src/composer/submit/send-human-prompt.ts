// P2-0 (parent docs/doperpowers/plans/2026-10-08-p2-daily-driver.md §4.3, X22): one human prompt path for the
// composer and callers outside its box. Read the same status/queue predicate as the submit control; a busy Send is
// always a next steer, never a preempting now steer. Bash and memory dispatch stay in editor/submit.ts.
// P2-A (2026-10-09; X22's final shape, the execution document §5.4): a session with a record and no ready process is
// acquired first (`session.acquire`, joining a start in flight) and then sent; `started` says this call launched the
// engine or joined its launch, beside the host's own answer. A trust or relay card holds a composer message (`held`,
// the text staying in the composer's draft until the host accepts it); no other origin's text is handed to a card.
import type { SendContent } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { CommandOutput, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { acquireSession, acquisitionWords, cardWords } from '../../sessions/acquire';
import { readSessionQueue } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { ENDED, STARTING, isBusy } from './submit-state';

export type HumanPromptOrigin = 'composer' | 'answer' | 'reply' | 'comment' | 'peer';
export interface HumanPromptOptions {
  origin: HumanPromptOrigin; // the caller's provenance; not a plugin-origin submission or a new engine/written field
  display?: string; // C12's first-message display: the composer preserves its pasted-segment markers
}
export interface HumanPromptResult {
  disposition: 'sent' | 'steered' | 'queued' | 'held' | 'refused';
  started: boolean; // P2-A: this call acquired the engine first (launched it, or joined a launch in flight)
  messageUuid?: MessageUuid; // sent, steered
  queueId?: string; // queued (the host's queue, paused or non-empty)
  reason?: string; // refused: the words; held: 'trust' | 'relay'
}

// The extracted wire dispatch, also used by the standalone editor's existing explicit send/steer API. Only the
// shared seam below chooses the action from session state; this primitive preserves that editor API and its tests.
export const dispatchHumanPrompt = (client: MawsBridge, appSessionId: AppSessionId, content: SendContent, how: 'send' | 'steer') =>
  how === 'steer'
    ? client.invoke('session.steer', { appSessionId, content, priority: 'next' })
    : client.invoke('session.send', { appSessionId, content });

const notReady = (process: string | undefined): HumanPromptResult => ({ disposition: 'refused', started: false, reason: process === 'starting' || process === 'initializing' ? STARTING : ENDED });

export async function sendHumanPrompt(appSessionId: AppSessionId, content: SendContent, options: HumanPromptOptions, client: MawsBridge = ipc): Promise<HumanPromptResult> {
  let status = useSessions.getState().engine.get(appSessionId) ?? null;
  // P2-A: a record with no ready process is acquired, then sent, whatever ended its last process
  const hasRecord = () => useSessions.getState().records.has(appSessionId);
  if (status?.process !== 'ready' && hasRecord()) return sendAcquiring(appSessionId, content, options, client);
  if (!useSessions.getState().engine.has(appSessionId)) {
    const result = await client.invoke('session.status', { appSessionId });
    // An event that arrived during the read wins, as in the composer's useSessionStatus.
    status = useSessions.getState().engine.get(appSessionId) ?? (result.ok ? result.value : null);
  }
  if (status === null || status.process !== 'ready') return notReady(status?.process);
  const queue = await readSessionQueue(appSessionId, client);
  // The unmounted caller's queue read may have spanned a process exit or launch. Never send using an older status.
  status = useSessions.getState().engine.get(appSessionId) ?? status;
  if (status.process !== 'ready') return hasRecord() ? sendAcquiring(appSessionId, content, options, client) : notReady(status.process);
  const how = isBusy(status, queue.entries) ? 'steer' : 'send';
  const result = await dispatchHumanPrompt(client, appSessionId, content, how);
  if (!result.ok) throw new Error(result.error.message); // the composer shows the host error with its existing Retry
  return hostAnswer(result.value, how, false);
}

// P2-A start: acquire, then `session.send` (never a steer: the renderer's status may trail the acquisition's answer,
// and the host's queue orders a send behind whatever the joined launch already submitted).
async function sendAcquiring(appSessionId: AppSessionId, content: SendContent, options: HumanPromptOptions, client: MawsBridge): Promise<HumanPromptResult> {
  const composer = options.origin === 'composer';
  const display = options.display ?? (typeof content === 'string' ? content : content.filter((block) => block.type === 'text').map((block) => block.text).join('\n'));
  const outcome = await acquireSession(appSessionId, 'send', composer ? { dockMessage: { content, display } } : {}, client);
  if (outcome.status === 'needs_trust' || outcome.status === 'relay_unreachable') {
    if (composer) return { disposition: 'held', started: false, reason: outcome.status === 'needs_trust' ? 'trust' : 'relay' };
    return { disposition: 'refused', started: false, reason: cardWords(outcome) };
  }
  if (outcome.status !== 'ready') return { disposition: 'refused', started: false, reason: acquisitionWords(outcome) ?? 'The session could not start' };
  const result = await dispatchHumanPrompt(client, appSessionId, content, 'send');
  if (!result.ok) throw new Error(result.error.message);
  return hostAnswer(result.value, 'send', outcome.launched || outcome.joined);
}
// P2-A end

// The host's own answer, passed through: `queued` (its queue paused or non-empty) carries the queue id and no uuid.
function hostAnswer(value: CommandOutput<'session.send'> | CommandOutput<'session.steer'>, how: 'send' | 'steer', started: boolean): HumanPromptResult {
  if ('disposition' in value && value.disposition === 'queued') return { disposition: 'queued', started, queueId: value.queueId };
  return { disposition: how === 'steer' ? 'steered' : 'sent', started, ...(value.messageUuid !== null && { messageUuid: value.messageUuid }) };
}
