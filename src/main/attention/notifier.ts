// Main's notifier (C5 execution document, "Notifier rules"; residue *Notifications*; charter §3 and §5.7). It reads the
// attention table through the read model, so it works with no page open:
// - an item that first appears pending, with an actionable kind, while no MAWS window is focused and notifications are
//   on, posts one macOS notification (`<project> · <session>`, the item's summary), once per item id ever;
// - clicking it focuses (or re-creates) the window and hands `attention.navigate` to the navigation relay, which emits
//   it to a page that is listening or queues it for the page to pull (`attention.pendingNavigate`);
// - macOS delivers notifications only from a code-signed binary (an unsigned one emits `failed`), so the first failure,
//   or no notification support at all, switches to the fallback for the process lifetime: a dock bounce, and
//   `attention.notified { delivery: 'fallback' }`, which the page shows as a toast;
// - the dock badge is the count of tier-1 Needs-you sessions, at all times;
// - with C11's per-kind policy (`notifications.kinds`), only a group that is on notifies.
import { app, Notification } from 'electron';
import type { AttentionItem } from '@shared/graph/attention';
import type { AttentionKind } from '@shared/graph/enums';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { NotificationKinds, Settings } from '@shared/ipc/schema'; // C11: NotificationKinds
import type { AttentionNavigate } from '@shared/ipc/schema/attention';
import { isActionable, isOpen } from '@shared/attention/kinds';
import { previewLine } from '@shared/owner/preview';
import type { emit as emitEvent } from '../ipc/events';
import type { SessionReadModel } from '../sessions/read-model';

// C11: `NotificationKinds` is settings v3's per-group switch (C11's eighth ask of C5); every version 3 file carries it
// (the store migrates earlier files with every group on but held peer messages).
const GROUP: Record<AttentionKind, keyof NotificationKinds> = {
  permission: 'approvals', dialog: 'approvals', elicitation: 'approvals',
  question: 'questions',
  plan: 'planReviews',
  error: 'errors', interrupted: 'errors', auto_mode_unavailable: 'errors',
  held_peer_message: 'heldPeerMessages', // not actionable, so it never notifies today; the flag is honoured if that changes
  async_input: 'asyncInput', essential_unread: 'essential', // P2-C (2026-10-09): settings 12's two groups
};

function wanted(item: AttentionItem, settings: Settings): boolean {
  const { notifications } = settings;
  return notifications.enabled && notifications.kinds[GROUP[item.kind]]; // C11: the schema's kinds, always present in v3
}

export interface NotifierDeps {
  restoredIds?: ReadonlySet<AttentionId>; // live provenance set: hydration is silent, but still counts in the badge
  isFocused(): boolean; // whether a MAWS window has focus; false with no window
  focusWindow(): void; // brings the window forward, re-creating it if none is open
  navigate(navigation: AttentionNavigate): void; // the navigation relay: emits `attention.navigate` to a listening page, or queues it
  settings(): Settings;
  emit: typeof emitEvent;
}

export function startNotifier(model: SessionReadModel, deps: NotifierDeps): () => void {
  // Items already waiting when the notifier starts entered Needs you before it; only later arrivals are announced.
  const seen = new Set<AttentionId>([...model.allAttention().values()].flat().map((i) => i.id));
  // A posted notification must stay referenced, or it may be collected and its click never arrives.
  const live = new Set<Notification>();
  let fallback: string | null = Notification.isSupported() ? null : 'notifications are not supported';
  if (fallback !== null) console.warn(unavailable(fallback));

  const notified = (item: AttentionItem, delivery: 'os' | 'fallback') =>
    deps.emit('attention.notified', { appSessionId: item.appSessionId, attentionId: item.id, delivery, at: new Date().toISOString() });

  const fallBack = (item: AttentionItem) => {
    app.dock?.bounce('informational');
    notified(item, 'fallback');
  };

  const post = (item: AttentionItem) => {
    if (fallback !== null) {
      fallBack(item);
      return;
    }
    const record = model.record(item.appSessionId)!;
    const project = record.projectId === null ? null : model.project(record.projectId);
    const notification = new Notification({
      title: project ? `${project.name} · ${record.title.text}` : record.title.text,
      body: previewLine(item.summary, 200) ?? item.summary, // E11 F2b (plan 2.6)
      silent: !deps.settings().notifications.sound,
    });
    live.add(notification);
    notification.on('show', () => notified(item, 'os'));
    notification.on('failed', (_event, error) => {
      live.delete(notification);
      if (fallback === null) {
        fallback = error;
        console.warn(unavailable(error));
      }
      fallBack(item);
    });
    notification.on('click', () => {
      live.delete(notification);
      deps.focusWindow();
      deps.navigate({ appSessionId: item.appSessionId, attentionId: item.id, source: 'notification' });
    });
    notification.on('close', () => live.delete(notification));
    notification.show();
  };

  const inNeedsYou = (appSessionId: AppSessionId) => {
    const record = model.record(appSessionId);
    return record !== null && !record.archived;
  };

  const onAttention = (appSessionId: AppSessionId, items: AttentionItem[]) => {
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (deps.restoredIds?.has(item.id)) continue;
      if (item.state !== 'pending' || !isActionable(item) || !inNeedsYou(appSessionId)) continue;
      if (deps.isFocused() || !wanted(item, deps.settings())) continue;
      post(item);
    }
    updateBadge();
  };

  const updateBadge = () => {
    let count = 0;
    for (const [appSessionId, items] of model.allAttention()) {
      if (inNeedsYou(appSessionId) && items.some((i) => isOpen(i) && isActionable(i))) count += 1;
    }
    app.dock?.setBadge(count > 0 ? String(count) : '');
  };

  const offs = [model.on('attention', onAttention), model.on('record', updateBadge)];
  updateBadge();
  return () => {
    offs.forEach((off) => off());
    live.clear();
  };
}

const unavailable = (reason: string) => `notifier: OS notifications unavailable (${reason}); using dock bounce and toasts`;
