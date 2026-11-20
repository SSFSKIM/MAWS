// One account in ClaudeUsage's geometry (mockup 06 vignette 01; PanelView.swift `AccountRowView`): the dot and email (the
// routing account's email semibold and its dot filled), plan and tier at the right (ClaudeUsage stores both and does not
// draw them; §3 asks for them), its saved sessions and what it served in the relay's last ten minutes, the limit rows,
// its state line, and the actions its parent gives it. W6 (E1): the dot takes the worst severity of the account's limits,
// as ClaudeUsage's does; a Codex account (ClaudeUsage's Codex section) has no limits in the files and says where they
// are. Tokens only.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M1; W177, W178, G115, W181): the plan alone at the
// right of the email; the rate-limit tier, the saved sessions and what the account served are the email's tooltip, which
// the keyboard reaches; an account that must sign in again says so in orange, what follows from it its tooltip.
import type { ReactNode } from 'react';
import { ago } from '../statusline/format';
import { Tip } from '../ui/tip';
import { ROUTING, savedSessions, serving, STATE, USAGE } from './copy';
import { LimitRow, SEVERITY_BG, SEVERITY_BORDER } from './LimitRow';
import type { AccountRow } from './model';

const OWNER = 'rounded-sm outline-accent focus-visible:outline-2';

function dotClass(row: AccountRow): string {
  const filled = row.role === 'routing';
  if (row.severity === null) return filled ? 'border-fg-muted bg-fg-muted' : 'border-fg-muted';
  return filled ? `${SEVERITY_BORDER[row.severity]} ${SEVERITY_BG[row.severity]}` : SEVERITY_BORDER[row.severity];
}

export function AccountCard({ row, now, actions }: { row: AccountRow; now: number; actions?: ReactNode }) {
  const routing = row.role === 'routing';
  const reauth = row.state === 'needs_reauth';
  const facts = [
    row.rateLimitTier,
    row.pinnedSessionCount > 0 ? savedSessions(row.pinnedSessionCount) : null,
    row.activity ? serving(row.activity.requests, row.activity.cacheHitRatio, ago(Math.max(0, now - Date.parse(row.activity.lastServed)))) : null,
  ].filter((fact): fact is string => fact !== null && fact !== '');
  const tip = facts.length === 0 ? null : facts.join(' · ');
  return (
    <section aria-label={row.email} data-account={row.uuid} data-state={row.state} data-routing={routing || undefined} className="py-3.5">
      <div className="flex items-center gap-[7px] text-ui">
        <span aria-hidden data-dot={row.severity ?? 'none'} className={`size-[7px] shrink-0 rounded-full border ${dotClass(row)}`} />
        <Tip content={tip} description={tip}>
          <span tabIndex={tip === null ? undefined : 0} className={`truncate ${routing ? 'font-semibold' : ''} ${OWNER}`}>
            {row.email}
          </span>
        </Tip>
        {row.planLabel && <span className="ml-auto text-ui-sm whitespace-nowrap text-fg-muted">{row.planLabel}</span>}
      </div>
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
      {reauth && (
        <p className="m-0 mt-2 text-ui-sm leading-normal text-warning">
          <Tip content={STATE.needsReauthWhy} description={STATE.needsReauthWhy}>
            <span tabIndex={0} className={OWNER}>
              {STATE.needsReauth}
            </span>
          </Tip>
        </p>
      )}
      {row.state === 'no_readings' && <p className="m-0 mt-2 text-ui-sm text-fg-muted">{row.provider === 'codex' ? USAGE.codexLimits : STATE.noReadings}</p>}
      {actions && <div className="mt-2 -ml-1.5 flex flex-wrap items-center gap-1">{actions}</div>}
    </section>
  );
}

