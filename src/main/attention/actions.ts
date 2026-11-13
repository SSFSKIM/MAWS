import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { RequestAnswer } from '@shared/engine/answers';
import type { SpineView } from '@shared/spine/view';
import { outsideAnswers, shownCommand, type OutsideAnswers } from '@shared/attention/outside-answers';
import { waits } from '@shared/attention/kinds';
import type { HostDispatch } from '../ipc/router';

/** What a permission's notification offers (UX wave U1a §H), and its body when that is the command it allows. */
export interface NotificationOffer extends OutsideAnswers { body: string | null }

const NOTHING: NotificationOffer = { allowOnce: false, deny: false, body: null };
const ANSWERS: Record<keyof OutsideAnswers, RequestAnswer> = {
  allowOnce: { kind: 'permission', decision: 'allow', scope: 'once' },
  deny: { kind: 'permission', decision: 'deny' },
};

// P5 O3-C (reader R2): a reply acquires the session, and the request's answers read it still waiting, through the spine's
// view. UX wave U1a §H: a permission's notification offers what the one rule admits for the request as the engine host
// holds it, and each action reads it again at the press and applies the rule to what it reads, so a request answered or
// replaced between the banner and the press is never answered from it.
export function notificationActions(deps: {
  dispatch: HostDispatch;
  view: Pick<SpineView, 'acquire' | 'attention'>;
}) {
  // The request the item names, while the item is still the session's waiting permission for that request; else null.
  const requestOf = async (item: AttentionItem): Promise<{ requestId: RequestId; event: SessionEvent | null } | null> => {
    const current = deps.view.attention(item.appSessionId).find((listed) => listed.id === item.id);
    const requestId = current?.request.requestId ?? null;
    if (current?.kind !== 'permission' || !waits(current) || requestId === null || requestId !== item.request.requestId) return null;
    const result = await deps.dispatch('engine-host', 'session.pendingRequest', { appSessionId: item.appSessionId, requestId });
    return result.ok ? { requestId, event: (result.value as { event: SessionEvent | null }).event } : null;
  };
  const answer = async (item: AttentionItem, act: keyof OutsideAnswers, done: string) => {
    const read = await requestOf(item);
    if (read === null || !outsideAnswers(read.event, 'notification')[act]) throw new Error(`This request can no longer be ${done} from its notification. Open the session to review it.`);
    const result = await deps.dispatch('engine-host', 'session.answer', { appSessionId: item.appSessionId, requestId: read.requestId, answer: ANSWERS[act] });
    if (!result.ok) throw new Error(result.error.message);
    if ((result.value as { outcome: string }).outcome !== 'delivered') throw new Error('The answer was not delivered. Open the session to review it.');
  };
  return {
    /** What the item's notification offers: nothing unless it is a waiting permission whose request reads. */
    async offer(item: AttentionItem): Promise<NotificationOffer> {
      const read = await requestOf(item);
      if (read === null) return NOTHING;
      const answers = outsideAnswers(read.event, 'notification');
      return { ...answers, body: answers.allowOnce ? shownCommand(read.event, 'notification') : null };
    },
    allow: (item: AttentionItem): Promise<void> => answer(item, 'allowOnce', 'allowed'),
    deny: (item: AttentionItem): Promise<void> => answer(item, 'deny', 'denied'),
    async reply(id: AppSessionId, text: string): Promise<void> {
      if (!text.trim()) return;
      const ready = await deps.view.acquire(id, 'send');
      if (ready.status !== 'ready') throw new Error('Open the session before sending this reply.');
      // Same command as the hover card: the engine host owns the queue. Never steer.
      const sent = await deps.dispatch('engine-host', 'session.send', { appSessionId: id, content: text });
      if (!sent.ok) throw new Error(sent.error.message);
    },
  };
}
export type NotificationActions = ReturnType<typeof notificationActions>;
