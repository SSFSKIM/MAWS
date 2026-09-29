// The status line under the composer (§5.5; residue *Status line container*): the six fields in order, cwd, context,
// the 5-hour and 7-day windows, cost and the effective permission mode, from the record, the digest and the usage
// store, with `—` where nothing is known. Each field is a button whose popover C7 supplies; until then they are inert
// (no `aria-haspopup`). The near-limit banner is not here but in the banner host, once per window.
import type { AutoModeRefusalCode } from '@shared/graph/enums';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { useSessions } from '../stores/sessions';
import { useUsage, type UsageState } from '../stores/usage';

export const REFUSAL_WORDS: Record<AutoModeRefusalCode, string> = {
  auto_mode_settings: 'Auto mode refused: settings do not allow it',
  auto_mode_circuit_breaker: 'Auto mode refused: paused after repeated classifier failures',
  auto_mode_fast_mode: 'Auto mode refused: not available in fast mode',
  auto_mode_model: 'Auto mode refused: this model does not support it',
  auto_mode_unavailable: 'Auto mode refused: auto mode is unavailable',
};

// macOS homes live under /Users/<name>; the renderer is told no home directory, and needs none for this.
export const formatCwd = (directory: string): string => directory.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');

const tokens = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

export interface StatusFields {
  cwd: string;
  ctx: string;
  fiveHour: string;
  sevenDay: string;
  cost: string;
  mode: string;
  refusal: string | null; // the refusal in words when the requested mode was refused
}

export function statusFields(record: SessionRecord, digest: SessionDigest | null, windows: UsageState['windows']): StatusFields {
  const context = digest?.context ?? null;
  let ctx = 'ctx —';
  if (context) {
    const threshold = context.autoCompactThreshold;
    const near = threshold !== null && context.maxTokens > 0 && context.percent >= (threshold / context.maxTokens) * 100;
    ctx = `ctx ${Math.round(context.percent)}% of ${tokens(context.maxTokens)}${near ? ' ⚠' : ''}`;
  }
  const { effective, refusal } = record.permissionMode;
  return {
    cwd: formatCwd(record.directory),
    ctx,
    fiveHour: windows ? `5h ${Math.round(windows.fiveHour.percent)}%` : '5h —',
    sevenDay: windows ? `7d ${Math.round(windows.sevenDay.percent)}%` : '7d —',
    cost: digest?.cost ? `$${digest.cost.totalUsd.toFixed(2)}` : '$—',
    mode: effective,
    refusal: refusal ? REFUSAL_WORDS[refusal] : null,
  };
}

const FIELD = 'rounded-sm px-1 -mx-1 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';

export function StatusLine({ record }: { record: SessionRecord }) {
  const digest = useSessions((s) => s.digests.get(record.appId) ?? null);
  const windows = useUsage((s) => s.windows);
  const f = statusFields(record, digest, windows);
  const dot = <span aria-hidden>·</span>;
  return (
    <div role="group" aria-label="Session status" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pb-2 text-ui-sm text-fg-muted tabular-nums">
      <button type="button" title={record.directory} className={`basis-full truncate text-left font-mono ${FIELD}`}>
        {f.cwd}
      </button>
      <button type="button" className={FIELD}>
        {f.ctx}
      </button>
      {dot}
      <button type="button" className={FIELD}>
        {f.fiveHour}
      </button>
      {dot}
      <button type="button" className={FIELD}>
        {f.sevenDay}
      </button>
      {dot}
      <button type="button" className={FIELD}>
        {f.cost}
      </button>
      {dot}
      <button type="button" title={f.refusal ?? undefined} className={`inline-flex items-center gap-1 ${FIELD}`}>
        {f.refusal && (
          <span role="img" aria-label="Warning" className="text-warning">
            ⚠
          </span>
        )}
        {f.mode}
      </button>
    </div>
  );
}
