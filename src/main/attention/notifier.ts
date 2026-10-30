// Session-scoped delivery: OS banners outside MAWS, toasts while another session
// has focus. Restored requests/turns are silent; live requests retract on resolution. The banners, the dock's badge,
// its bounce and the window's focus go through the client port (OX4), with no client: no page asked for them. P5 O3-C
// (reader R1): the spine is read through its view alone, an attention change carrying the ids it must not announce.
// P5 O9 M6 (the owner's Q5): a request a terminal or background-job session's bridge raised (the lane A list's item) is
// asked in that terminal too, which the owner may be reading, so it is told in-app only: no OS notification and no
// bounce; it counts in the badge. The session's other notices (a turn, an owner-channel mark, a held message) are any
// session's.
import type { AttentionItem } from '@shared/graph/attention';
import { isNoClient, type ClientPort, type NotificationHandle, type NotifyEvent, type NotifyRequest } from '@shared/client/port';
import type { AttentionKind } from '@shared/graph/enums';
import { isLaneAItem } from '@shared/attention/lane-a-item'; // P5 O9 M6; P5 O3-C: neutral, lane A being the spine's
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { SpineView } from '@shared/spine/view';
import type { EventPayload, NotificationKinds, Settings, SessionDigest } from '@shared/ipc/schema';
import type { AttentionNavigate } from '@shared/ipc/schema/attention';
import { isActionable, isOpen } from '@shared/attention/kinds';
import { previewLine } from '@shared/owner/preview';
import type { emit as emitEvent } from '../ipc/events';
import type { NotificationActions } from './actions';

const GROUP: Record<AttentionKind, keyof NotificationKinds> = {
  permission: 'approvals', dialog: 'approvals', elicitation: 'approvals', question: 'questions',
  plan: 'planReviews', error: 'errors', interrupted: 'errors', auto_mode_unavailable: 'errors',
  held_peer_message: 'heldPeerMessages', async_input: 'asyncInput', essential_unread: 'essential',
};
export interface NotifierDeps {
  port: Pick<ClientPort, 'notify' | 'badge' | 'focus'>;
  isFocused(): boolean;
  isViewing(appSessionId: AppSessionId): boolean;
  navigate(navigation: AttentionNavigate): void;
  failure(notified: EventPayload<'attention.notified'>): void;
  settings(): Settings;
  emit: typeof emitEvent;
  actions?: NotificationActions;
}
type Notice = { appSessionId: AppSessionId; attentionId: AttentionId | null; body: string };

export type NotifierView = Pick<SpineView, 'allAttention' | 'digests' | 'attention' | 'record' | 'project' | 'on'>;

export function startNotifier(view: NotifierView, deps: NotifierDeps): () => void {
  const seen = new Set<AttentionId>([...view.allAttention().values()].flat().map((i) => i.id));
  const previous = new Map(view.digests().map((d) => [d.appSessionId, d]));
  const live = new Map<NotificationHandle, Notice>();
  let fallback: string | null = null; // why OS notifications are unavailable, once the port has said so
  const unavailableFor = (reason: string) => { if (fallback === null) { fallback = reason; console.warn(unavailable(reason)); } };
  const notified = (notice: Notice, delivery: 'os' | 'fallback' | 'in-app') =>
    deps.emit('attention.notified', { appSessionId: notice.appSessionId, attentionId: notice.attentionId, delivery, at: new Date().toISOString() });
  // the dock's bounce, whose own noClient is ignored: the fallback is reported either way
  const fallBack = (notice: Notice) => { deps.port.focus(null, 'request'); notified(notice, 'fallback'); };
  const focusWindow = () => void deps.port.focus(null, 'bring'); // no client to bring forward: nothing to do
  const actionFailure = (notice: Notice, error: unknown, reply?: string) => {
    const message = error instanceof Error ? error.message : String(error);
    focusWindow();
    deps.navigate({ appSessionId: notice.appSessionId, attentionId: notice.attentionId, source: 'notification' });
    deps.failure({ appSessionId: notice.appSessionId, attentionId: notice.attentionId, delivery: 'in-app', at: new Date().toISOString(), error: message, ...(reply !== undefined ? { reply } : {}) });
  };
  const post = (notice: Notice, allowOnce = false, checked = false) => {
    if (deps.isViewing(notice.appSessionId)) return;
    if (deps.isFocused()) { notified(notice, 'in-app'); return; }
    if (notice.attentionId !== null && isLaneAItem(notice.attentionId)) return; // P5 O9 M6: in-app only
    if (fallback !== null) { fallBack(notice); return; }
    const item = notice.attentionId === null ? undefined : view.attention(notice.appSessionId).find((i) => i.id === notice.attentionId && i.state === 'pending');
    if (notice.attentionId !== null && !item) return;
    if (item?.kind === 'permission' && deps.actions && !checked) {
      void deps.actions.canAllow(item).then((allowed) => post(notice, allowed, true)).catch(() => post(notice, false, true));
      return;
    }
    const record = view.record(notice.appSessionId)!;
    const row = record.projectId === null ? null : view.project(record.projectId);
    const project = row?.hidden ? null : row; // a project removed from the sidebar names none, as having none
    const request: NotifyRequest = {
      title: project ? `${project.name} · ${record.title.text}` : record.title.text,
      body: previewLine(notice.body, 200) ?? notice.body,
      silent: !deps.settings().notifications.sound,
      ...(deps.actions && notice.attentionId === null ? { reply: { placeholder: 'Reply to session' } } : {}),
      ...(allowOnce ? { actions: ['Allow once'] } : {}),
    };
    let handle: NotificationHandle | null = null;
    let ended = false; // an end the port reported before its handle came back
    const end = () => { ended = true; if (handle) live.delete(handle); };
    const onEvent = (event: NotifyEvent) => {
      switch (event.kind) {
        case 'shown':
          return notified(notice, 'os');
        case 'failed':
          end();
          unavailableFor(event.error);
          return fallBack(notice);
        case 'clicked':
          end();
          focusWindow();
          return deps.navigate({ appSessionId: notice.appSessionId, attentionId: notice.attentionId, source: 'notification' });
        case 'replied':
          if (notice.attentionId !== null || !deps.actions) return;
          return void deps.actions.reply(notice.appSessionId, event.text).catch((error: unknown) => actionFailure(notice, error, event.text));
        case 'action':
          if (event.index !== 0 || !allowOnce || !item || !deps.actions) return;
          return void deps.actions.allow(item).catch((error: unknown) => actionFailure(notice, error));
        case 'closed':
          return end();
      }
    };
    const answer = deps.port.notify(null, request, onEvent);
    if (isNoClient(answer)) { fallBack(notice); return; } // no client to show it now, which says nothing of later ones
    if ('unsupported' in answer) { unavailableFor(answer.unsupported); fallBack(notice); return; }
    handle = answer;
    if (!ended) live.set(handle, notice);
  };
  const inNeedsYou = (id: AppSessionId) => { const r = view.record(id); return r !== null && !r.archived; };
  const onAttention = (appSessionId: AppSessionId, items: readonly AttentionItem[], silent: ReadonlySet<AttentionId>) => {
    for (const [handle, notice] of live) {
      if (notice.appSessionId === appSessionId && notice.attentionId !== null && !items.some((i) => i.id === notice.attentionId && isOpen(i))) {
        live.delete(handle);
        handle.close();
      }
    }
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (silent.has(item.id)) continue;
      if (item.state !== 'pending' || !isActionable(item) || !inNeedsYou(appSessionId)) continue;
      const settings = deps.settings().notifications;
      if (settings.enabled && settings.kinds[GROUP[item.kind]]) post({ appSessionId, attentionId: item.id, body: item.summary });
    }
    updateBadge();
  };
  const onDigest = (digest: SessionDigest) => {
    const before = previous.get(digest.appSessionId);
    previous.set(digest.appSessionId, digest);
    // Only a turn observed running by this process, not a disk seed or replay.
    if (!before || !['working', 'waiting'].includes(before.phase) || digest.phase !== 'idle'
      || digest.lastTurnEndedAt === null || digest.lastTurnEndedAt === before.lastTurnEndedAt) return;
    const record = view.record(digest.appSessionId);
    const policy = deps.settings().notifications;
    if (!record || record.archived || record.holder.kind !== 'self' || !policy.enabled || !policy.kinds.turnFinished) return;
    post({ appSessionId: digest.appSessionId, attentionId: null, body: digest.lastAssistantLine ?? 'Turn finished' });
  };
  const updateBadge = () => {
    let count = 0;
    for (const [id, items] of view.allAttention()) if (inNeedsYou(id) && items.some((i) => isOpen(i) && isActionable(i))) count++;
    deps.port.badge(null, count); // no client to badge: nothing to do
  };
  // P5 O3-D M5b fix round 5: a view that loads after the notifier starts (main's mirror of mawsd's spine) tells its first
  // snapshot's records and digests by none of the events above, and its members answer in any order, so the badge
  // counted at an attention change may have found no record yet; the readers start from its availability (spine-mirror.ts),
  // which in launch mode scenario settles on the scenario's reason rather than null, so every change of it counts again
  const onAvailability = () => {
    for (const d of view.digests()) if (!previous.has(d.appSessionId)) previous.set(d.appSessionId, d);
    updateBadge();
  };
  const offs = [view.on('attention', onAttention), view.on('digest', onDigest), view.on('record', () => updateBadge()), view.on('availability', onAvailability)];
  updateBadge();
  return () => { offs.forEach((off) => off()); for (const n of live.keys()) n.close(); live.clear(); };
}
const unavailable = (reason: string) => `notifier: OS notifications unavailable (${reason}); using dock bounce and toasts`;
