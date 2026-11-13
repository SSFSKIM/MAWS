// The usage ring's popover (UX wave U7b, O-47; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// M7 decision 3): a glance, not the panel. The heading "Usage" with the newest reading's age; each Claude account as its
// name and its limit rows (LimitRow), the routed one first and marked "Routing here"; the Codex accounts after, each
// marked "Codex" and saying where their limits are; the relay's line only while the relay is not answering or its last
// ten minutes were degraded; one link, "Usage settings", to Settings › Usage, which holds the whole panel with its
// saved sessions and account actions. A name truncates and keeps its whole text as its title; its mark never truncates.
// Tokens only.
import { useEffect } from 'react';
import { ACCOUNTS, ROUTING, USAGE } from '../accounts/copy';
import { LimitRow } from '../accounts/LimitRow';
import { accountsViewModel, relayLine, type AccountRow } from '../accounts/model';
import { useGateway } from '../gateway/store';
import { ago } from '../statusline/format';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { useLayout } from '../stores/layout';
import { useUsage } from '../stores/usage';

const LINK = 'rounded-sm px-1 text-ui-sm whitespace-nowrap text-fg outline-accent hover:underline focus-visible:outline-2';

export function UsagePopover({ close }: { close(): void }) {
  const snapshot = useUsage((s) => s.snapshot);
  const relay = useGateway((s) => s.relay);
  const now = useNow(POPOVER_TICK_MS); // a reset that passes changes the reading
  useEffect(() => {
    void useGateway.getState().refreshRelay(false).catch((error: unknown) => console.warn('[usage] relay check failed', error));
  }, []);

  const model = snapshot?.available ? accountsViewModel(snapshot, relay, now) : null;
  const claude = model?.rows ?? [];
  const codex = model?.codex ?? [];
  // the relay's own line while it does not answer; else its last ten minutes, while they were degraded
  const trouble = relay?.ok === false ? relayLine(relay, now) : model?.health?.degraded ? model.health.line : null;
  const toSettings = () => {
    close();
    useLayout.getState().openSettings('usage');
  };

  return (
    <div data-usage-popover className="text-ui text-fg">
      <div className="flex items-baseline gap-2.5 px-4 pt-3 pb-1">
        <h2 className="m-0 text-ui font-semibold">{USAGE.popoverTitle}</h2>
        {model && <span className="ml-auto text-ui-sm text-fg-muted">{USAGE.updated(ago(Math.max(0, now - Date.parse(model.updatedAt))))}</span>}
      </div>
      <div className="px-4">
        {claude.length === 0 && codex.length === 0 ? (
          <p data-usage-none className="m-0 py-2 text-ui-sm text-fg-muted">
            {ACCOUNTS.unavailable}
          </p>
        ) : (
          <>
            {claude.map((row) => (
              <Account key={row.uuid} row={row} />
            ))}
            {codex.length > 0 && (
              <div data-codex className={claude.length > 0 ? 'border-t border-border' : ''}>
                {codex.map((row) => (
                  <Account key={row.uuid} row={row} />
                ))}
              </div>
            )}
          </>
        )}
        {trouble && (
          <div className="flex items-center gap-2 border-t border-border py-2 text-ui-sm text-warning">
            <span aria-hidden>⇄</span>
            <span data-relay-line className="min-w-0">
              {trouble}
            </span>
          </div>
        )}
      </div>
      <div className="border-t border-border px-3 py-2">
        <button type="button" className={LINK} onClick={toSettings}>
          {USAGE.settingsLink}
        </button>
      </div>
    </div>
  );
}

function Account({ row }: { row: AccountRow }) {
  const codex = row.provider === 'codex';
  const routed = !codex && row.role === 'routing';
  const mark = routed ? ROUTING.here : codex ? USAGE.codexMark : null;
  return (
    <section aria-label={row.email} data-account={row.uuid} className="border-t border-border py-2 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <span data-account-name title={row.email} className={`min-w-0 truncate ${routed ? 'font-semibold' : ''}`}>
          {row.email}
        </span>
        {mark && (
          <span data-account-mark className={`ml-auto shrink-0 text-ui-sm whitespace-nowrap ${codex ? 'text-fg-muted' : 'text-fg'}`}>
            {mark}
          </span>
        )}
      </div>
      {row.limits.length > 0 && (
        <div className={`mt-1.5 grid gap-1.5 ${row.state === 'needs_reauth' ? 'opacity-55' : ''}`}>
          {row.limits.map((limit) => (
            <LimitRow key={limit.key} limit={limit} />
          ))}
        </div>
      )}
      {codex && <p className="m-0 mt-1 text-ui-sm text-fg-muted">{USAGE.codexLimits}</p>}
    </section>
  );
}
