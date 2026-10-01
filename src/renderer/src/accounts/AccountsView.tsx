// The Accounts tab (C11 execution document, Interfaces "Accounts tab"; mockup 06 vignette 01; D-20: ClaudeUsage's own
// panel geometry): ClaudeUsage's accounts as C7's one reader carries them (D-17), with the routing account marked and
// why, the add row, and the relay's line. Sign-in, reconnect and removal are ClaudeUsage's (D-19): each is a hand-off,
// and the tab updates by itself when ClaudeUsage rewrites its files (C7's watcher); nothing here polls ClaudeUsage.
import { useEffect } from 'react';
import { useGateway } from '../gateway/store';
import { ipc } from '../ipc/client';
import { ago } from '../statusline/format';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { useUsage } from '../stores/usage';
import { useHandOff } from '../usage/hand-off';
import { AccountCard } from './AccountCard';
import { ACCOUNTS, CLAUDE_USAGE_README_URL } from './copy';
import { accountsViewModel, relayLine } from './model';

const TEXT_ACTION = 'rounded-sm px-1.5 py-1 text-ui-sm whitespace-nowrap text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';
const LINK = 'rounded-sm px-1 text-ui-sm whitespace-nowrap text-fg outline-accent hover:underline focus-visible:outline-2';
const BUTTON = 'rounded-sm border border-border-strong bg-bg-hover px-2 py-1 text-ui-sm font-medium whitespace-nowrap outline-accent hover:bg-bg-active focus-visible:outline-2';

export function AccountsView() {
  const snapshot = useUsage((s) => s.snapshot);
  const relay = useGateway((s) => s.relay);
  const claudeUsage = useGateway((s) => s.claudeUsage);
  const now = useNow(POPOVER_TICK_MS); // ClaudeUsage's cadence for its reset labels (PanelView.swift:5–10)
  const { waiting, handOff } = useHandOff();

  useEffect(() => {
    const gateway = useGateway.getState();
    void gateway.refreshRelay(false).catch((error: unknown) => console.warn('[accounts] relay check failed', error));
    void gateway.refreshClaudeUsage().catch((error: unknown) => console.warn('[accounts] ClaudeUsage status failed', error));
  }, []);

  const model = snapshot ? accountsViewModel(snapshot, relay, now) : null;
  const refresh = () => void useGateway.getState().refreshRelay(true).catch((error: unknown) => console.warn('[accounts] relay check failed', error));

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-bg text-ui text-fg">
      <div className="mx-auto max-w-[760px] @container">
        <div className="flex items-baseline gap-2.5 px-5 pt-4">
          <h3 className="m-0 text-ui font-semibold">{ACCOUNTS.title}</h3>
          {model && snapshot?.available && <span className="text-ui-sm text-fg-muted">{ACCOUNTS.readFrom(ago(Math.max(0, now - Date.parse(model.updatedAt))))}</span>}
          {waiting && (
            <span role="status" className="text-ui-sm text-fg-muted">
              {ACCOUNTS.waiting}
            </span>
          )}
          <button type="button" className={`${LINK} ml-auto`} onClick={() => handOff({ intent: 'panel' })}>
            {ACCOUNTS.openClaudeUsage}
          </button>
        </div>
        <p className="m-0 border-b border-border px-5 pt-1.5 pb-3.5 text-ui-sm text-fg-muted">{ACCOUNTS.note}</p>

        {snapshot === null ? (
          <p className="px-5 py-4 text-ui-sm text-fg-muted">{ACCOUNTS.reading}</p>
        ) : !snapshot.available ? (
          <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-ui-sm">
            <span className="text-fg-muted">{ACCOUNTS.unavailable}</span>
            {claudeUsage?.installed === false ? (
              <button type="button" className={TEXT_ACTION} onClick={() => void ipc.invoke('layout.openExternal', { url: CLAUDE_USAGE_README_URL })}>
                {ACCOUNTS.install}
              </button>
            ) : (
              <button type="button" className={TEXT_ACTION} onClick={() => handOff({ intent: 'panel' })}>
                {ACCOUNTS.openPlain}
              </button>
            )}
          </div>
        ) : model!.rows.length === 0 ? (
          <p className="px-5 py-4 text-ui-sm text-fg-muted">{ACCOUNTS.empty}</p>
        ) : (
          // ClaudeUsage's grid (AccountGridLayout.swift:6–49): one column below three accounts, two at three or more,
          // 16 px apart, rows as tall as their tallest cell, a divider above every row after the first; one column again
          // when the tab is narrower than 620 px.
          <div
            data-columns={model!.columns}
            className={`grid grid-cols-1 gap-x-4 px-5 pt-1.5 [&>*:nth-child(n+2)]:border-t [&>*:nth-child(n+2)]:border-border ${model!.columns === 2 ? '@min-[620px]:grid-cols-2 @min-[620px]:[&>*:nth-child(2)]:border-t-0' : ''}`}
          >
            {model!.rows.map((row) => (
              <AccountCard
                key={row.uuid}
                row={row}
                now={now}
                actions={
                  <>
                    {row.state === 'needs_reauth' && (
                      <button type="button" className={`${BUTTON} ml-1.5`} onClick={() => handOff({ intent: 'reconnect', accountEmail: row.email })}>
                        {ACCOUNTS.reconnect}
                      </button>
                    )}
                    <button type="button" className={TEXT_ACTION} onClick={() => handOff({ intent: 'remove', accountEmail: row.email })}>
                      {ACCOUNTS.remove}
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5 border-t border-border px-5 py-3 text-ui-sm">
          <button type="button" className={LINK} onClick={() => handOff({ intent: 'addAccount' })}>
            {ACCOUNTS.addAccount}
          </button>
          <span className="text-fg-muted">{ACCOUNTS.addHint}</span>
        </div>
        <div className="flex items-center gap-2 border-t border-border bg-bg-raised px-5 py-2.5 text-ui-sm text-fg-muted">
          <span aria-hidden className={relay?.ok === false ? 'text-warning' : 'text-success'}>
            ⇄
          </span>
          <span data-relay-line className="min-w-0 truncate">
            {relayLine(relay, now)}
          </span>
          <button type="button" className={`${TEXT_ACTION} ml-auto`} onClick={() => handOff({ intent: 'panel' })}>
            {ACCOUNTS.openPlain}
          </button>
          <button type="button" className={TEXT_ACTION} onClick={refresh}>
            {ACCOUNTS.refresh}
          </button>
        </div>
      </div>
    </div>
  );
}
