// The Notifications section (C11 execution document, Interfaces "Settings tab" Notifications; M5 refresh task, the
// section as landed): whether a session that needs you notifies while MAWS is not focused, and how macOS last took it
// (C5's `attention.notified`); which kinds do, each written alone under the two-level merge; the sound. C5's notifier groups `dialog` and `elicitation` under approvals
// and never notifies a held peer message (not actionable), so that row is shown and disabled. P2-C (2026-10-10): above
// them the to-human mod's app switch, and among the kinds the owner channel's question and must-read. The word cut
// (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M1): a switch's row is its label and the switch, the switch named
// by the words that stood beside it (G26, G28); a refused delivery reads "Blocked in macOS", why its tooltip (G30);
// approvals' caption is its tooltip (G33); held peer messages, which never notify, are not drawn (G34); Sound has no
// on/off word (G35).
import { Fragment, useId } from 'react';
import type { Settings } from '@shared/ipc/schema';
import { Tip } from '../ui/tip';
import { useAttention } from '../stores/attention';
import { NOTIFICATIONS } from './copy';
import { Chip, Setting, Switch, TipWord, WORD_OWNER, writeSettings } from './parts';

type Kind = keyof Settings['notifications']['kinds'];
const KINDS: Kind[] = ['turnFinished', 'approvals', 'questions', 'planReviews', 'errors', 'asyncInput', 'essential' /* P2-C */];

export function NotificationsSection({ settings }: { settings: Settings }) {
  const { enabled, sound, kinds } = settings.notifications;
  const delivery = useAttention((s) => s.notificationDelivery);
  const caption = useId();
  return (
    <>
      {/* P2-C start (2026-10-10; the P2-C document, §9): the to-human mod's app switch (a session's own override is /plugins') */}
      <Setting row="notifications.toHuman">
        <Switch checked={settings.mods.toHuman.enabled} label={NOTIFICATIONS.toHuman.name} onChange={(next) => void writeSettings({ mods: { toHuman: { enabled: next } } })} />
      </Setting>
      {/* P2-C end */}
      <Setting row="notifications.when">
        <Switch checked={enabled} label={NOTIFICATIONS.enabledLabel} onChange={(next) => void writeSettings({ notifications: { enabled: next } })} />
        {delivery === 'os' && <Chip>{NOTIFICATIONS.delivery.os}</Chip>}
        {delivery === 'fallback' && (
          <TipWord tip={NOTIFICATIONS.fallbackWhy}>
            <span tabIndex={0} className={WORD_OWNER}>
              <Chip>{NOTIFICATIONS.delivery.fallback}</Chip>
            </span>
          </TipWord>
        )}
      </Setting>
      <Setting row="notifications.kinds">
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {KINDS.map((kind) => {
            const approvals = kind === 'approvals';
            const box = (
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={kinds[kind]}
                  aria-describedby={approvals ? caption : undefined}
                  onChange={(e) => void writeSettings({ notifications: { kinds: { [kind]: e.target.checked } } })}
                  className="m-0 accent-accent"
                />
                {NOTIFICATIONS.kind[kind]}
              </label>
            );
            // approvals' caption: the tooltip of its word and its box, shown when the box takes focus, and its description
            if (!approvals) return <Fragment key={kind}>{box}</Fragment>;
            return (
              <Fragment key={kind}>
                <Tip content={NOTIFICATIONS.approvalsCaption}>{box}</Tip>
                <span id={caption} hidden>
                  {NOTIFICATIONS.approvalsCaption}
                </span>
              </Fragment>
            );
          })}
        </span>
      </Setting>
      <Setting row="notifications.sound">
        <Switch checked={sound} label={NOTIFICATIONS.sound} onChange={(next) => void writeSettings({ notifications: { sound: next } })} />
      </Setting>
    </>
  );
}
