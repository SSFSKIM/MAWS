// P2-0 (parent docs/doperpowers/plans/2026-10-08-p2-daily-driver.md §4.3, X22): one human prompt path for the
// composer and callers outside its box. Read the same status/queue predicate as the submit control; a busy Send is
// always a next steer, never a preempting now steer. Bash and memory dispatch stay in editor/submit.ts.
import type { SendContent } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { readSessionQueue } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { releasedResume } from '../resume-seam';
import { ENDED, STARTING, isBusy } from './submit-state';

export type HumanPromptOrigin = 'composer' | 'answer' | 'reply' | 'comment' | 'peer';
export interface HumanPromptOptions {
  origin: HumanPromptOrigin; // the caller's provenance; not a plugin-origin submission or a new engine/written field
  display?: string; // C12's first-message display: the composer preserves its pasted-segment markers
}
export interface HumanPromptResult {
  disposition: 'sent' | 'steered' | 'queued' | 'started' | 'refused';
  messageUuid?: MessageUuid;
  queueId?: string;
  reason?: string;
}

// The extracted wire dispatch, also used by the standalone editor's existing explicit send/steer API. Only the
// shared seam below chooses the action from session state; this primitive preserves that editor API and its tests.
export const dispatchHumanPrompt = (client: MawsBridge, appSessionId: AppSessionId, content: SendContent, how: 'send' | 'steer') =>
  how === 'steer'
    ? client.invoke('session.steer', { appSessionId, content, priority: 'next' })
    : client.invoke('session.send', { appSessionId, content });

export async function sendHumanPrompt(appSessionId: AppSessionId, content: SendContent, options: HumanPromptOptions, client: MawsBridge = ipc): Promise<HumanPromptResult> {
  let status = useSessions.getState().engine.get(appSessionId) ?? null;
  const released = useSessions.getState().digests.get(appSessionId)?.released !== undefined;
  if (released && (status === null || status.process === 'exited')) {
    const resume = releasedResume();
    if (resume === null) return { disposition: 'refused', reason: 'Session resume is unavailable' };
    const display = options.display ?? (typeof content === 'string' ? content : content.filter((block) => block.type === 'text').map((block) => block.text).join('\n'));
    const accepted = await resume(appSessionId, { content, display });
    return accepted ? { disposition: 'started' } : { disposition: 'refused', reason: 'Session resume was refused' };
  }
  if (!useSessions.getState().engine.has(appSessionId)) {
    const result = await client.invoke('session.status', { appSessionId });
    // An event that arrived during the read wins, as in the composer's useSessionStatus.
    status = useSessions.getState().engine.get(appSessionId) ?? (result.ok ? result.value : null);
  }
  if (status === null || status.process !== 'ready') {
    const starting = status?.process === 'starting' || status?.process === 'initializing';
    return { disposition: 'refused', reason: starting ? STARTING : ENDED };
  }
  const queue = await readSessionQueue(appSessionId, client);
  // The unmounted caller's queue read may have spanned a process exit or launch. Never send using an older status.
  status = useSessions.getState().engine.get(appSessionId) ?? status;
  if (status.process !== 'ready') return { disposition: 'refused', reason: status.process === 'starting' || status.process === 'initializing' ? STARTING : ENDED };
  const how = isBusy(status, queue.entries) ? 'steer' : 'send';
  const result = await dispatchHumanPrompt(client, appSessionId, content, how);
  if (!result.ok) throw new Error(result.error.message); // the composer shows the host error with its existing Retry
  if ('disposition' in result.value && result.value.disposition === 'queued') return { disposition: 'queued', queueId: result.value.queueId };
  return { disposition: how === 'steer' ? 'steered' : 'sent', ...(result.value.messageUuid !== null && { messageUuid: result.value.messageUuid }) };
}
