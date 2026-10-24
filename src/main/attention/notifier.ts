// Session-scoped delivery: OS banners outside MAWS, toasts while another session
// has focus. Restored requests/turns are silent; live requests retract on resolution.
import { app, Notification } from 'electron';
import type { AttentionItem } from '@shared/graph/attention';
import type { AttentionKind } from '@shared/graph/enums';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { EventPayload, NotificationKinds, Settings, SessionDigest } from '@shared/ipc/schema';
import type { AttentionNavigate } from '@shared/ipc/schema/attention';
import { isActionable, isOpen } from '@shared/attention/kinds';
import { previewLine } from '@shared/owner/preview';
import type { emit as emitEvent } from '../ipc/events';
import type { NotificationActions } from './actions';
import type { SessionReadModel } from '../sessions/read-model';

const GROUP: Record<AttentionKind, keyof NotificationKinds> = {
  permission: 'approvals', dialog: 'approvals', elicitation: 'approvals', question: 'questions',
  plan: 'planReviews', error: 'errors', interrupted: 'errors', auto_mode_unavailable: 'errors',
  held_peer_message: 'heldPeerMessages', async_input: 'asyncInput', essential_unread: 'essential',
};
export interface NotifierDeps {
  restoredIds?: ReadonlySet<AttentionId>;
  isFocused(): boolean;
  isViewing(appSessionId: AppSessionId): boolean;
  focusWindow(): void;
  navigate(navigation: AttentionNavigate): void;
  failure(notified: EventPayload<'attention.notified'>): void;
  settings(): Settings;
  emit: typeof emitEvent;
  actions?: NotificationActions;
}
type Notice = { appSessionId: AppSessionId; attentionId: AttentionId | null; body: string };

export function startNotifier(model: SessionReadModel, deps: NotifierDeps): () => void {
  const seen = new Set<AttentionId>([...model.allAttention().values()].flat().map((i) => i.id));
  const previous = new Map(model.digests().map((d) => [d.appSessionId, d]));
  const live = new Map<Notification, Notice>();
  let fallback: string | null = Notification.isSupported() ? null : 'notifications are not supported';
  if (fallback !== null) console.warn(unavailable(fallback));
  const notified = (notice: Notice, delivery: 'os' | 'fallback' | 'in-app') =>
    deps.emit('attention.notified', { appSessionId: notice.appSessionId, attentionId: notice.attentionId, delivery, at: new Date().toISOString() });
  const fallBack = (notice: Notice) => { app.dock?.bounce('informational'); notified(notice, 'fallback'); };
  const actionFailure = (notice: Notice, error: unknown, reply?: string) => {
    const message = error instanceof Error ? error.message : String(error);
    deps.focusWindow();
    deps.navigate({ appSessionId: notice.appSessionId, attentionId: notice.attentionId, source: 'notification' });
    deps.failure({ appSessionId: notice.appSessionId, attentionId: notice.attentionId, delivery: 'in-app', at: new Date().toISOString(), error: message, ...(reply !== undefined ? { reply } : {}) });
  };
  const post = (notice: Notice, allowOnce = false, checked = false) => {
    if (deps.isViewing(notice.appSessionId)) return;
    if (deps.isFocused()) { notified(notice, 'in-app'); return; }
    if (fallback !== null) { fallBack(notice); return; }
    const item = notice.attentionId === null ? undefined : model.attention(notice.appSessionId).find((i) => i.id === notice.attentionId && i.state === 'pending');
    if (notice.attentionId !== null && !item) return;
    if (item?.kind === 'permission' && deps.actions && !checked) {
      void deps.actions.canAllow(item).then((allowed) => post(notice, allowed, true)).catch(() => post(notice, false, true));
      return;
    }
    const record = model.record(notice.appSessionId)!;
    const project = record.projectId === null ? null : model.project(record.projectId);
    const notification = new Notification({
      title: project ? `${project.name} · ${record.title.text}` : record.title.text,
      body: previewLine(notice.body, 200) ?? notice.body,
      silent: !deps.settings().notifications.sound,
      ...(deps.actions && notice.attentionId === null ? { hasReply: true, replyPlaceholder: 'Reply to session' } : {}),
      ...(allowOnce ? { actions: [{ type: 'button' as const, text: 'Allow once' }] } : {}),
    });
    live.set(notification, notice);
    notification.on('show', () => notified(notice, 'os'));
    notification.on('failed', (_event, error) => {
      live.delete(notification);
      if (fallback === null) { fallback = error; console.warn(unavailable(error)); }
      fallBack(notice);
    });
    notification.on('click', () => {
      live.delete(notification);
      deps.focusWindow();
      deps.navigate({ appSessionId: notice.appSessionId, attentionId: notice.attentionId, source: 'notification' });
    });
    notification.on('reply', (_event, reply: string) => {
      if (notice.attentionId !== null || !deps.actions) return;
      void deps.actions.reply(notice.appSessionId, reply).catch((error: unknown) => actionFailure(notice, error, reply));
    });
    notification.on('action', (_event, index: number) => {
      if (index !== 0 || !allowOnce || !item || !deps.actions) return;
      void deps.actions.allow(item).catch((error: unknown) => actionFailure(notice, error));
    });
    notification.on('close', () => live.delete(notification));
    notification.show();
  };
  const inNeedsYou = (id: AppSessionId) => { const r = model.record(id); return r !== null && !r.archived; };
  const onAttention = (appSessionId: AppSessionId, items: AttentionItem[]) => {
    for (const [notification, notice] of live) {
      if (notice.appSessionId === appSessionId && notice.attentionId !== null && !items.some((i) => i.id === notice.attentionId && isOpen(i))) {
        live.delete(notification);
        notification.close();
      }
    }
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (deps.restoredIds?.has(item.id)) continue;
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
    const record = model.record(digest.appSessionId);
    const policy = deps.settings().notifications;
    if (!record || record.archived || record.holder.kind !== 'self' || !policy.enabled || !policy.kinds.turnFinished) return;
    post({ appSessionId: digest.appSessionId, attentionId: null, body: digest.lastAssistantLine ?? 'Turn finished' });
  };
  const updateBadge = () => {
    let count = 0;
    for (const [id, items] of model.allAttention()) if (inNeedsYou(id) && items.some((i) => isOpen(i) && isActionable(i))) count++;
    app.dock?.setBadge(count > 0 ? String(count) : '');
  };
  const offs = [model.on('attention', onAttention), model.on('digest', onDigest), model.on('record', updateBadge)];
  updateBadge();
  return () => { offs.forEach((off) => off()); for (const n of live.keys()) n.close(); live.clear(); };
}
const unavailable = (reason: string) => `notifier: OS notifications unavailable (${reason}); using dock bounce and toasts`;
