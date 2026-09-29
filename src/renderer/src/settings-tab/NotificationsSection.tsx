// The Notifications section (C11 execution document, Interfaces "Settings tab" Notifications; M5 refresh task, the
// section as landed): whether a session that needs you notifies while MAWS is not focused, and how macOS last took it
// (C5's `attention.notified`); which kinds do, each written alone under the two-level merge; the sound; and the
// near-limit banner's threshold (C7's banner reads it). C5's notifier groups `dialog` and `elicitation` under approvals
// and never notifies a held peer message (not actionable), so that row is shown and disabled.
import type { Settings } from '@shared/ipc/schema';
import { useAttention } from '../stores/attention';
import { NOTIFICATIONS } from './copy';
import { Chip, INPUT, Setting, Switch, writeSettings } from './parts';

type Kind = keyof Settings['notifications']['kinds'];
const KINDS: Kind[] = ['approvals', 'questions', 'planReviews', 'errors', 'heldPeerMessages'];
const THRESHOLDS = [80, 85, 90, 95];

export function NotificationsSection({ settings }: { settings: Settings }) {
  const { enabled, sound, kinds } = settings.notifications;
  const delivery = useAttention((s) => s.notificationDelivery);
  const threshold = settings.usage.nearLimitPercent;
  const thresholds = THRESHOLDS.includes(threshold) ? THRESHOLDS : [...THRESHOLDS, threshold].sort((a, b) => a - b);
  return (
    <>
      <Setting label={NOTIFICATIONS.when}>
        <Switch checked={enabled} label={NOTIFICATIONS.enabledLabel} onChange={(next) => void writeSettings({ notifications: { enabled: next } })} />
        <span>{NOTIFICATIONS.enabledLabel}</span>
        {delivery && <Chip>{NOTIFICATIONS.delivery[delivery]}</Chip>}
      </Setting>
      <Setting label={NOTIFICATIONS.kinds}>
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {KINDS.map((kind) => {
            const held = kind === 'heldPeerMessages';
            const caption = kind === 'approvals' ? NOTIFICATIONS.approvalsCaption : held ? NOTIFICATIONS.heldNever : null;
            return (
              <label key={kind} className={`inline-flex items-center gap-1.5 ${held ? 'text-fg-muted' : ''}`} title={caption ?? undefined}>
                <input
                  type="checkbox"
                  checked={held ? false : kinds[kind]}
                  disabled={held}
                  onChange={(e) => void writeSettings({ notifications: { kinds: { [kind]: e.target.checked } } })}
                  className="m-0 accent-accent"
                />
                {NOTIFICATIONS.kind[kind]}
                {caption && <span className="text-fg-muted">· {caption}</span>}
              </label>
            );
          })}
        </span>
      </Setting>
      <Setting label={NOTIFICATIONS.sound}>
        <Switch checked={sound} label={NOTIFICATIONS.sound} onChange={(next) => void writeSettings({ notifications: { sound: next } })} />
        <span className="text-ui-sm text-fg-muted">{sound ? NOTIFICATIONS.on : NOTIFICATIONS.off}</span>
      </Setting>
      <Setting label={NOTIFICATIONS.nearLimit}>
        <select aria-label={NOTIFICATIONS.nearLimit} value={threshold} onChange={(e) => void writeSettings({ usage: { nearLimitPercent: Number(e.target.value) } })} className={`${INPUT} max-w-[100px]`}>
          {thresholds.map((n) => (
            <option key={n} value={n}>
              {NOTIFICATIONS.nearLimitAt(n)}
            </option>
          ))}
        </select>
        <span className="text-ui-sm text-fg-muted">{NOTIFICATIONS.nearLimitHint}</span>
      </Setting>
    </>
  );
}
