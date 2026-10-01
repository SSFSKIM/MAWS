// The usage popover (W6, E1; charter §5.2 and D-17 as amended 2026-10-01): a copy of ClaudeUsage's panel
// (PanelView.swift, top to bottom) over C7's one read of its files: the header with the newest reading's age, the note,
// the one hint for the actions or their notice (`controls.ts`), every account in its grid (AccountCard, the Accounts
// tab's view model) with its saved sessions, what it served in the relay's last ten minutes, its limit bars and resets
// and its actions, the add row, the Codex accounts, and the footer: the routing toggle's state, the relay's line and
// its health over the last ten minutes, Refresh and the hand-off to ClaudeUsage's own panel. The geometry is
// ClaudeUsage's (PanelLayout.swift): 380 px and one column, 680 px and two at three or more accounts, at most 700 px
// tall, one column again when the window leaves less room. Tokens only.
import { useEffect, useId, type ReactNode } from 'react';
import { AccountCard } from '../accounts/AccountCard';
import { ACCOUNTS, CLAUDE_USAGE_README_URL, USAGE } from '../accounts/copy';
import { accountsViewModel, relayLine, type AccountRow } from '../accounts/model';
import { useGateway } from '../gateway/store';
import { ipc } from '../ipc/client';
import { ago } from '../statusline/format';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { useUsage } from '../stores/usage';
import { useUsageControls } from './controls';
import { useHandOff } from './hand-off';

const ACTION =
  'rounded-sm px-1.5 py-1 text-ui-sm whitespace-nowrap text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';
const BUTTON =
  'rounded-sm border border-border-strong bg-bg-hover px-2 py-1 text-ui-sm font-medium whitespace-nowrap outline-accent hover:bg-bg-active focus-visible:outline-2 disabled:border-border disabled:bg-transparent disabled:font-normal disabled:text-fg-faint';
const LINK = 'rounded-sm px-1 text-ui-sm whitespace-nowrap text-fg outline-accent hover:underline focus-visible:outline-2';
// ClaudeUsage's grid (AccountGridLayout.swift:6–49): two columns 16 px apart when the panel is at least 620 px inside,
// rows as tall as their tallest cell, a divider above every row after the first.
const GRID_1 = 'grid grid-cols-1 gap-x-4 [&>*:nth-child(n+2)]:border-t [&>*:nth-child(n+2)]:border-border';
const GRID_2 = `${GRID_1} @min-[620px]:grid-cols-2 @min-[620px]:[&>*:nth-child(2)]:border-t-0`;

function Grid({ columns, children }: { columns: 1 | 2; children: ReactNode }) {
  return (
    <div data-columns={columns} className={columns === 2 ? GRID_2 : GRID_1}>
      {children}
    </div>
  );
}

export function UsagePanel() {
  const snapshot = useUsage((s) => s.snapshot);
  const relay = useGateway((s) => s.relay);
  const claudeUsage = useGateway((s) => s.claudeUsage);
  const now = useNow(POPOVER_TICK_MS); // ClaudeUsage's cadence for its reset labels (PanelView.swift:29)
  const controls = useUsageControls();
  const { waiting, handOff } = useHandOff();
  const hint = useId();

  useEffect(() => {
    const gateway = useGateway.getState();
    void gateway.refreshRelay(false).catch((error: unknown) => console.warn('[usage] relay check failed', error));
    void gateway.refreshClaudeUsage().catch((error: unknown) => console.warn('[usage] ClaudeUsage status failed', error));
  }, []);

  const model = snapshot ? accountsViewModel(snapshot, relay, now) : null;
  const available = snapshot?.available === true;
  const refresh = () => void useGateway.getState().refreshRelay(true).catch((error: unknown) => console.warn('[usage] relay check failed', error));
  const describedBy = controls.unavailable ? hint : undefined;

  const actionsOf = (row: AccountRow) => (
    <>
      {row.state === 'needs_reauth' && (
        <button type="button" className={`${BUTTON} ml-1.5`} disabled={!controls.reconnect.available({ uuid: row.uuid, email: row.email })} aria-describedby={describedBy} onClick={() => controls.reconnect.run({ uuid: row.uuid, email: row.email })}>
          {USAGE.reconnect}
        </button>
      )}
      {row.role !== 'routing' && row.state !== 'needs_reauth' && (
        <button type="button" className={ACTION} disabled={!controls.route.available({ uuid: row.uuid })} aria-describedby={describedBy} onClick={() => controls.route.run({ uuid: row.uuid })}>
          {USAGE.route}
        </button>
      )}
      <button type="button" className={ACTION} disabled={!controls.remove.available({ uuid: row.uuid, email: row.email })} aria-describedby={describedBy} onClick={() => controls.remove.run({ uuid: row.uuid, email: row.email })}>
        {USAGE.remove}
      </button>
    </>
  );

  let accounts: ReactNode;
  if (snapshot === null) accounts = <p className="m-0 py-3 text-ui-sm text-fg-muted">{ACCOUNTS.reading}</p>;
  else if (!available) {
    accounts = (
      <div className="flex flex-wrap items-center gap-3 py-3 text-ui-sm">
        <span className="text-fg-muted">{ACCOUNTS.unavailable}</span>
        {claudeUsage?.installed === false ? (
          <button type="button" className={ACTION} onClick={() => void ipc.invoke('layout.openExternal', { url: CLAUDE_USAGE_README_URL })}>
            {ACCOUNTS.install}
          </button>
        ) : (
          <button type="button" className={ACTION} onClick={() => handOff({ intent: 'panel' })}>
            {ACCOUNTS.openPlain}
          </button>
        )}
      </div>
    );
  } else if (model!.rows.length === 0) accounts = <p className="m-0 py-3 text-ui-sm text-fg-muted">{ACCOUNTS.empty}</p>;
  else {
    accounts = (
      <Grid columns={model!.columns}>
        {model!.rows.map((row) => (
          <AccountCard key={row.uuid} row={row} now={now} actions={actionsOf(row)} />
        ))}
      </Grid>
    );
  }

  return (
    <div
      data-usage-panel
      className={`@container p-4 text-ui text-fg ${model?.columns === 2 ? 'w-[min(680px,var(--radix-popover-content-available-width))]' : 'w-[min(380px,var(--radix-popover-content-available-width))]'}`}
    >
      <div className="flex items-baseline gap-2.5">
        <h2 className="m-0 text-ui font-semibold">{USAGE.title}</h2>
        {waiting && (
          <span role="status" className="text-ui-sm text-fg-muted">
            {ACCOUNTS.waiting}
          </span>
        )}
        {model && available && <span className="ml-auto text-ui-sm text-fg-muted">{USAGE.updated(ago(Math.max(0, now - Date.parse(model.updatedAt))))}</span>}
      </div>
      {available && model!.rows.length > 0 && <p className="m-0 mt-2 text-ui-sm text-fg-muted">{USAGE.note}</p>}
      {controls.unavailable && (
        <p id={hint} data-controls-hint className="m-0 mt-2 text-ui-sm text-fg-muted">
          {controls.unavailable}
        </p>
      )}

      <div className="mt-1">{accounts}</div>

      {available && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-ui-sm">
          <button type="button" className={BUTTON} disabled={!controls.add.available({ email: null })} aria-describedby={describedBy} onClick={() => controls.add.run({ email: null })}>
            {USAGE.add}
          </button>
          <span className="text-fg-muted">{USAGE.addHint}</span>
        </div>
      )}

      {model?.codex && (
        <section aria-label={USAGE.codexTitle} data-codex className="mt-3 border-t border-border pt-3">
          <h3 className="m-0 text-ui font-semibold">{USAGE.codexTitle}</h3>
          <p className="m-0 mt-0.5 text-ui-sm text-fg-muted">{USAGE.codexNote}</p>
          {model.codex.length === 0 ? (
            <p className="m-0 mt-2 text-ui-sm text-fg-muted">{USAGE.codexEmpty}</p>
          ) : (
            <Grid columns={model.columns}>
              {model.codex.map((row) => (
                <AccountCard key={row.uuid} row={row} now={now} />
              ))}
            </Grid>
          )}
        </section>
      )}

      <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-ui-sm">
        {model?.gateway && (
          <label className="flex items-center gap-2 text-fg-muted" title={USAGE.routingToggleHint}>
            <input type="checkbox" checked={model.gateway.routingEnabled} disabled readOnly className="accent-accent" />
            {USAGE.routingToggle}
          </label>
        )}
        <div className="flex items-center gap-2 text-fg-muted">
          <span aria-hidden className={relay?.ok === false ? 'text-warning' : 'text-success'}>
            ⇄
          </span>
          <span data-relay-line className="min-w-0 truncate">
            {relayLine(relay, now)}
          </span>
        </div>
        {model?.health && (
          <p data-health={model.health.degraded ? 'degraded' : 'ok'} className={`m-0 ${model.health.degraded ? 'text-warning' : 'text-fg-muted'}`}>
            {model.health.line}
          </p>
        )}
        <div className="mt-1 -ml-1.5 flex items-center gap-1">
          <button type="button" className={ACTION} onClick={refresh}>
            {ACCOUNTS.refresh}
          </button>
          <button type="button" className={`${LINK} ml-auto`} onClick={() => handOff({ intent: 'panel' })}>
            {ACCOUNTS.openClaudeUsage}
          </button>
        </div>
      </div>
    </div>
  );
}
