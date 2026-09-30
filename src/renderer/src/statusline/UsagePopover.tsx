// The 5h and 7d popover (§5.5; mockup 04 vignette 5): the account the session's windows belong to, one meter per
// window (5-hour, weekly, each model's weekly) with its reset countdown, the other accounts collapsed (the drain target
// marked `routing`), and a footer holding C11's registered component beside `Updated <ago>`. A direct session shows
// the engine's own windows and no accounts; without ClaudeUsage data the popover says so.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { UsageWindow } from '@shared/usage/types';
import { useUsage, useSessionWindows } from '../stores/usage';
import { ago, resetsIn, windowShown } from './format';
import { useUsagePopoverFooter } from './footer';
import { POPOVER_TICK_MS, useNow } from './use-now';

export const USAGE_UNAVAILABLE = 'ClaudeUsage is not installed or has no data';

function WindowMeter({ label, name, window, now }: { label: string; name: string; window: UsageWindow | null; now: number }) {
  const shown = window ? windowShown(window, now) : null;
  const percent = shown ? Math.round(shown.percent) : null;
  const note = shown === null ? 'no reading' : shown.reset ? 'no reading since the window reset' : `resets in ${resetsIn(shown.resetInMs!)}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span>
          {label} <strong className="font-semibold">{percent === null ? '—' : `${percent}%`}</strong>
        </span>
        <span className="text-ui-sm text-fg-muted">{note}</span>
      </div>
      <div
        role="meter"
        aria-label={`${name} usage`}
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-sm bg-bg-active"
      >
        <span className="block h-full rounded-sm bg-fg-muted" style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} />
      </div>
    </div>
  );
}

const NO_CLOSE = () => {};

// `close` closes the popover around the body (C11's footer calls it before opening another surface); a host that
// renders the body outside a popover passes none.
export function UsagePopoverBody({ record, status, close = NO_CLOSE }: { record: SessionRecord; status: EngineSessionStatus | null; close?: () => void }) {
  const now = useNow(POPOVER_TICK_MS);
  const snapshot = useUsage((s) => s.snapshot);
  const shown = useSessionWindows(record, status);
  const Footer = useUsagePopoverFooter();
  const direct = shown.source === 'direct';
  const unavailable = !direct && snapshot !== null && !snapshot.available;
  const others = direct || !snapshot?.available ? [] : snapshot.accounts.filter((a) => a.uuid !== shown.account?.uuid);

  let who: string;
  if (direct) who = 'Direct · the engine’s own login';
  else if (shown.account) who = [shown.account.email, shown.account.planLabel].filter(Boolean).join(' · ');
  else if (snapshot === null) who = 'Reading ClaudeUsage…';
  else who = unavailable ? USAGE_UNAVAILABLE : 'No routing account in ClaudeUsage';

  return (
    <>
      <div className="flex flex-col gap-4 p-3.5">
        <div>
          <h3 className="font-semibold">Usage</h3>
          <p className="mt-1 text-ui-sm text-fg-muted">
            {who}
            {shown.account && shown.account.uuid === snapshot?.drainTarget && <span className="text-accent"> · routing</span>}
          </p>
          {unavailable && snapshot.error && <p className="mt-1 text-ui-sm break-words text-fg-faint">{snapshot.error}</p>}
          {direct && shown.readAt !== null && shown.windows === null && <p className="mt-1 text-ui-sm text-fg-muted">The engine reports no plan limits for this login</p>}
        </div>
        {shown.windows && (
          <>
            <WindowMeter label="5h" name="Five-hour" window={shown.windows.fiveHour} now={now} />
            <WindowMeter label="Weekly" name="Weekly" window={shown.windows.sevenDay} now={now} />
            {shown.windows.scoped.map(({ model, window }) => (
              <WindowMeter key={model} label={model} name={`${model} weekly`} window={window} now={now} />
            ))}
          </>
        )}
        {others.length > 0 && (
          <details className="border-t border-border pt-3 text-ui-sm">
            <summary className="cursor-default text-fg-muted">Other accounts</summary>
            <ul aria-label="Other accounts" className="mt-2 flex flex-col gap-1">
              {others.map((account) => {
                const week = account.windows.sevenDay ? windowShown(account.windows.sevenDay, now) : null;
                return (
                  <li key={account.uuid} className="flex justify-between gap-2">
                    <span className="truncate">
                      {account.email} · 7d {week ? `${Math.round(week.percent)}%` : '—'}
                    </span>
                    {account.uuid === snapshot?.drainTarget && <span className="shrink-0 text-accent">routing</span>}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2.5 text-ui-sm">
        {/* eslint-disable-next-line react-hooks/static-components -- registered once by C11, not created in render */}
        {Footer ? <Footer appSessionId={record.appId} close={close} /> : <span />}
        {shown.readAt !== null && <span className="text-fg-muted">Updated {ago(Math.max(0, now - Date.parse(shown.readAt)))}</span>}
      </div>
    </>
  );
}
