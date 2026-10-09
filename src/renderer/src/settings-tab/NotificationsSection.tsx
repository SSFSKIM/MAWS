// The Notifications section (C11 execution document, Interfaces "Settings tab" Notifications; M5 refresh task, the
// section as landed): whether a session that needs you notifies while MAWS is not focused, and how macOS last took it
// (C5's `attention.notified`); which kinds do, each written alone under the two-level merge; the sound. C5's notifier groups `dialog` and `elicitation` under approvals
// and never notifies a held peer message (not actionable), so that row is shown and disabled. P2-C (2026-10-10): above
// them the to-human mod's app switch, and among the kinds the owner channel's question and must-read.
import type { Settings } from '@shared/ipc/schema';
import { useAttention } from '../stores/attention';
import { NOTIFICATIONS } from './copy';
import { Chip, Setting, Switch, writeSettings } from './parts';

type Kind = keyof Settings['notifications']['kinds'];
const KINDS: Kind[] = ['approvals', 'questions', 'planReviews', 'errors', 'asyncInput', 'essential' /* P2-C */, 'heldPeerMessages'];

export function NotificationsSection({ settings }: { settings: Settings }) {
  const { enabled, sound, kinds } = settings.notifications;
  const delivery = useAttention((s) => s.notificationDelivery);
  return (
    <>
      {/* P2-C start (2026-10-10; the P2-C document, §9): the to-human mod's app switch (a session's own override is /plugins') */}
      <Setting label={NOTIFICATIONS.toHuman.label} note={NOTIFICATIONS.toHuman.note}>
        <Switch checked={settings.mods.toHuman.enabled} label={NOTIFICATIONS.toHuman.name} onChange={(next) => void writeSettings({ mods: { toHuman: { enabled: next } } })} />
        <span>{NOTIFICATIONS.toHuman.name}</span>
      </Setting>
      {/* P2-C end */}
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
    </>
  );
}
