// One account in ClaudeUsage's geometry (mockup 06 vignette 01; PanelView.swift `AccountRowView`): the dot and email (the
// routing account's email semibold and its dot filled), plan and tier at the right (ClaudeUsage stores both and does not
// draw them; §3 asks for them), its saved sessions and what it served in the relay's last ten minutes, the limit rows,
// its state line, and the actions its parent gives it. W6 (E1): the dot takes the worst severity of the account's limits,
// as ClaudeUsage's does; a Codex account (ClaudeUsage's Codex section) has no limits in the files and says where they
// are. Tokens only.
import type { ReactNode } from 'react';
import { ago } from '../statusline/format';
import { ROUTING, savedSessions, serving, STATE, USAGE } from './copy';
import { LimitRow, SEVERITY_BG, SEVERITY_BORDER } from './LimitRow';
import type { AccountRow } from './model';

const CHIP = 'inline-flex items-center gap-1 rounded-lg px-[7px] py-0.5 text-ui-sm whitespace-nowrap';

function dotClass(row: AccountRow): string {
  const filled = row.role === 'routing';
  if (row.severity === null) return filled ? 'border-fg-muted bg-fg-muted' : 'border-fg-muted';
  return filled ? `${SEVERITY_BORDER[row.severity]} ${SEVERITY_BG[row.severity]}` : SEVERITY_BORDER[row.severity];
}

export function AccountCard({ row, now, actions }: { row: AccountRow; now: number; actions?: ReactNode }) {
  const routing = row.role === 'routing';
  const reauth = row.state === 'needs_reauth';
  const plan = [row.planLabel, row.rateLimitTier].filter(Boolean).join(' · ');
  return (
    <section aria-label={row.email} data-account={row.uuid} data-state={row.state} data-routing={routing || undefined} className="py-3.5">
      <div className="flex items-center gap-[7px] text-ui">
        <span aria-hidden data-dot={row.severity ?? 'none'} className={`size-[7px] shrink-0 rounded-full border ${dotClass(row)}`} />
        <span className={`truncate ${routing ? 'font-semibold' : ''}`}>{row.email}</span>
        {plan && <span className="ml-auto text-ui-sm whitespace-nowrap text-fg-muted">{plan}</span>}
      </div>
      {(row.pinnedSessionCount > 0 || row.activity) && (
        <div className="mt-[7px] flex flex-wrap gap-1">
          {row.pinnedSessionCount > 0 && <span className={`${CHIP} bg-bg-active text-fg-muted`}>{savedSessions(row.pinnedSessionCount)}</span>}
          {row.activity && (
            <span data-serving={row.latest ? 'latest' : 'recent'} className={`${CHIP} ${row.latest ? 'bg-bg-active font-semibold text-fg' : 'bg-bg-hover text-fg-muted'}`}>
              <BoltIcon filled={row.latest} />
              {serving(row.activity.requests, row.activity.cacheHitRatio, ago(Math.max(0, now - Date.parse(row.activity.lastServed))))}
            </span>
          )}
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
      {row.state === 'no_readings' && <p className="m-0 mt-2 text-ui-sm text-fg-muted">{row.provider === 'codex' ? USAGE.codexLimits : STATE.noReadings}</p>}
      {actions && <div className="mt-2 -ml-1.5 flex flex-wrap items-center gap-1">{actions}</div>}
    </section>
  );
}

// ClaudeUsage's `bolt` and `bolt.fill`: filled on the account that served the newest request.
const BoltIcon = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`size-[11px] shrink-0 stroke-current [stroke-linejoin:round] [stroke-width:1.3] ${filled ? 'fill-current' : 'fill-none'}`}>
    <path d="M9.5 1.5 3.5 9h4l-1 5.5 6-7.5h-4z" />
  </svg>
);
