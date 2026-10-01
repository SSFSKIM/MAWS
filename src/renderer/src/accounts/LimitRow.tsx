// One limit row as ClaudeUsage's LimitBarView lays it out (LimitBarView.swift:11–53; docs/panel-layout.md:10–17): a 52 px
// label, a 96 × 6 px bar, a 34 px percent and an at-least-52 px reset countdown, 8 px apart, so bars line up across
// accounts and are glanced rather than read; the tracks keep those widths and never stretch across a wide card (the
// reset sits beside its percent, as in the panel and mockup 06 vignette 01). W6: the bar takes its severity's colour as
// ClaudeUsage's does (`--success`, `--warning`, `--danger`; `model.ts` severityOf). Tokens only.
import type { CSSProperties } from 'react';
import { resetsIn } from '../statusline/format';
import type { LimitView, Severity } from './model';

// LimitBarView.swift's constants, as the row's custom properties.
const GEOMETRY = { '--limit-label': '52px', '--limit-bar': '96px', '--limit-pct': '34px', '--limit-reset': '52px' } as CSSProperties;

// W6: ClaudeUsage's SeverityColor.swift as tokens, for the bars, the account dots and the top bar's pill.
export const SEVERITY_BG: Record<Severity, string> = { normal: 'bg-success', warning: 'bg-warning', critical: 'bg-danger' };
export const SEVERITY_BORDER: Record<Severity, string> = { normal: 'border-success', warning: 'border-warning', critical: 'border-danger' };

export function LimitRow({ limit }: { limit: LimitView }) {
  const percent = Math.round(limit.percent);
  return (
    <div
      data-limit={limit.key}
      style={GEOMETRY}
      className="grid grid-cols-[var(--limit-label)_var(--limit-bar)_var(--limit-pct)_minmax(var(--limit-reset),auto)] items-center justify-start gap-2 text-ui-sm"
    >
      <span className="truncate text-fg-muted">{limit.name}</span>
      <span role="meter" aria-label={limit.meter} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="block h-1.5 overflow-hidden rounded-[3px] bg-bg-active">
        <span data-full={limit.full || undefined} data-severity={limit.severity} className={`block h-full rounded-[3px] ${SEVERITY_BG[limit.severity]}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </span>
      <span className={`text-right font-medium tabular-nums ${limit.full ? 'text-danger' : ''}`}>{percent}%</span>
      <span className="text-right whitespace-nowrap text-fg-muted tabular-nums">{limit.resetInMs === null ? '—' : resetsIn(limit.resetInMs)}</span>
    </div>
  );
}
