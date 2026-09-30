// One account in ClaudeUsage's geometry (mockup 06 vignette 01): the dot and email (the routing account's email
// semibold and its dot filled), plan and tier at the right (ClaudeUsage stores both and does not draw them; §3 asks for
// them), its saved sessions, the limit rows, its state line, and the hand-offs to ClaudeUsage for what MAWS never does
// itself (reconnect, remove; D-19). Tokens only.
import type { ClaudeUsageOpenIntent } from '@shared/ipc/schema';
import { ACCOUNTS, ROUTING, savedSessions, STATE } from './copy';
import { LimitRow } from './LimitRow';
import type { AccountRow } from './model';

const TEXT_ACTION = 'rounded-sm px-1.5 py-1 text-ui-sm whitespace-nowrap text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';
const BUTTON = 'rounded-sm border border-border-strong bg-bg-hover px-2 py-1 text-ui-sm font-medium whitespace-nowrap outline-accent hover:bg-bg-active focus-visible:outline-2';

export function AccountCard({ row, handOff }: { row: AccountRow; handOff(intent: ClaudeUsageOpenIntent): void }) {
  const routing = row.role === 'routing';
  const reauth = row.state === 'needs_reauth';
  const plan = [row.planLabel, row.rateLimitTier].filter(Boolean).join(' · ');
  return (
    <section aria-label={row.email} data-account={row.uuid} data-state={row.state} data-routing={routing || undefined} className="py-3.5">
      <div className="flex items-center gap-[7px] text-ui">
        <span aria-hidden className={`size-[7px] shrink-0 rounded-full border ${routing ? 'border-accent bg-accent' : reauth ? 'border-warning' : 'border-fg-muted'}`} />
        <span className={`truncate ${routing ? 'font-semibold' : ''}`}>{row.email}</span>
        {plan && <span className="ml-auto text-ui-sm whitespace-nowrap text-fg-muted">{plan}</span>}
      </div>
      {row.pinnedSessionCount > 0 && (
        <div className="mt-[7px] flex flex-wrap gap-1">
          <span className="inline-flex items-center rounded-lg bg-bg-active px-[7px] py-0.5 text-ui-sm whitespace-nowrap text-fg-muted">{savedSessions(row.pinnedSessionCount)}</span>
        </div>
      )}
      {row.limits.length > 0 && (
        <div className={`mt-2.5 grid gap-1.5 ${reauth ? 'opacity-55' : ''}`}>
          {row.limits.map((limit) => (
            <LimitRow key={limit.key} limit={limit} />
          ))}
        </div>
      )}
      {row.limits
        .filter((l) => l.reset)
        .map((l) => (
          <p key={l.key} className="m-0 mt-1.5 text-ui-sm text-fg-muted">
            {STATE.resetPassed(l.name)}
          </p>
        ))}
      {routing && (
        <p className="m-0 mt-2 text-ui-sm leading-normal">
          <span aria-hidden className="text-success">
            ✓{' '}
          </span>
          {ROUTING.here}
          {row.routingWhy && <span className="text-fg-muted"> · {ROUTING.why[row.routingWhy]}</span>}
        </p>
      )}
      {reauth && <p className="m-0 mt-2 text-ui-sm leading-normal text-warning">{STATE.needsReauth}</p>}
      {row.state === 'no_readings' && <p className="m-0 mt-2 text-ui-sm text-fg-muted">{STATE.noReadings}</p>}
      <div className="mt-2 -ml-1.5 flex flex-wrap items-center gap-1">
        {reauth && (
          <button type="button" className={`${BUTTON} ml-1.5`} onClick={() => handOff({ intent: 'reconnect', accountEmail: row.email })}>
            {ACCOUNTS.reconnect}
          </button>
        )}
        <button type="button" className={TEXT_ACTION} onClick={() => handOff({ intent: 'remove', accountEmail: row.email })}>
          {ACCOUNTS.remove}
        </button>
      </div>
    </section>
  );
}
