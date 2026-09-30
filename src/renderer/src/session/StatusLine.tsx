// The status line under the composer (§5.5; residue *Status line container*): the six fields in order, cwd, context,
// the 5-hour and 7-day windows, cost and the effective permission mode, from the record, the digest and the usage
// store, with `—` where nothing is known. Each field is a button whose popover C7 supplies (Radix gives each its
// `aria-haspopup`). The near-limit banner is not here but in the banner host, once per window.
import type { AutoModeRefusalCode } from '@shared/graph/enums';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { useSessions } from '../stores/sessions';
import { useSessionWindows, useUsage, type UsageWindow, type Windows } from '../stores/usage'; // C7: the session's windows and their shapes
// C7 start
import { useDirectFallback } from '../statusline/direct-fallback';
import { resetsInCompact, tokens, windowShown } from '../statusline/format'; // tokens: the one formatter, shared with the context popover
import { MODE_REFUSAL_WORDS } from '../statusline/mode-menu';
import { ContextPopover, CostPopover, CwdPopover, ModePopover, UsagePopover } from '../statusline/popovers';
import { USAGE_UNAVAILABLE } from '../statusline/UsagePopover';
import { SetupActivity, useSetupPhase } from '../statusline/SetupActivity'; // the setup's phase while the session is unstarted
import { LINE_TICK_MS, useNow } from '../statusline/use-now';
// C7 end

// C7: the refusal in the words the mode chip and the mode menu use (C7 execution document, "Composer frame" Mode)
export const REFUSAL_WORDS: Record<AutoModeRefusalCode, string> = MODE_REFUSAL_WORDS;

// macOS homes live under /Users/<name>; the renderer is told no home directory, and needs none for this.
export const formatCwd = (directory: string): string => directory.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');

// C7 start: a window reads `5h 53% ↻3h46m` (mockup 04), `5h 0%` once its reset has passed with no new reading, and
// `5h —` with no reading at all.
function windowField(label: string, window: UsageWindow | null, now: number): string {
  if (!window) return `${label} —`;
  const shown = windowShown(window, now);
  return shown.reset ? `${label} 0%` : `${label} ${Math.round(shown.percent)}% ↻${resetsInCompact(shown.resetInMs!)}`;
}
// C7 end

export interface StatusFields {
  cwd: string;
  ctx: string;
  fiveHour: string;
  sevenDay: string;
  cost: string;
  mode: string;
  refusal: string | null; // the refusal in words when the requested mode was refused
}

export function statusFields(record: SessionRecord, digest: SessionDigest | null, windows: Windows | null, now: number = Date.now() /* C7 */): StatusFields {
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
    fiveHour: windowField('5h', windows?.fiveHour ?? null, now), // C7
    sevenDay: windowField('7d', windows?.sevenDay ?? null, now), // C7
    cost: digest?.cost ? `$${digest.cost.totalUsd.toFixed(2)}` : '$—',
    mode: effective,
    refusal: refusal ? REFUSAL_WORDS[refusal] : null,
  };
}

const FIELD = 'rounded-sm px-1 -mx-1 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';

export function StatusLine({ record }: { record: SessionRecord }) {
  const digest = useSessions((s) => s.digests.get(record.appId) ?? null);
  // C7 start: the session's own windows (its pinned account's, the drain target's, or a direct session's engine read)
  const status = useSessions((s) => s.engine.get(record.appId) ?? null);
  const shown = useSessionWindows(record, status);
  const unavailable = useUsage((s) => shown.source !== 'direct' && s.snapshot?.available === false);
  useDirectFallback(record.appId, status);
  const now = useNow(LINE_TICK_MS);
  const f = statusFields(record, digest, shown.windows, now);
  const setupPhase = useSetupPhase(record.appId);
  // C7 end
  const dot = <span aria-hidden>·</span>;
  return (
    <div role="group" aria-label="Session status" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pb-2 text-ui-sm text-fg-muted tabular-nums">
      <CwdPopover record={record /* C7 */}>
        <button type="button" title={record.directory} className={`basis-full truncate text-left font-mono ${FIELD}`}>
          {f.cwd}
        </button>
      </CwdPopover>
      {/* C7 start: the running setup's phase, while a started tab's first launch is still under C10's setup */}
      {setupPhase !== null && (
        <>
          <SetupActivity phase={setupPhase} />
          {dot}
        </>
      )}
      {/* C7 end */}
      <ContextPopover record={record /* C7 */}>
        <button type="button" className={FIELD}>
          {f.ctx}
        </button>
      </ContextPopover>
      {dot}
      <UsagePopover record={record} status={status /* C7 */}>
        <button type="button" title={unavailable ? USAGE_UNAVAILABLE : undefined /* C7 */} className={FIELD}>
          {f.fiveHour}
        </button>
      </UsagePopover>
      {dot}
      <UsagePopover record={record} status={status /* C7 */}>
        <button type="button" title={unavailable ? USAGE_UNAVAILABLE : undefined /* C7 */} className={FIELD}>
          {f.sevenDay}
        </button>
      </UsagePopover>
      {dot}
      <CostPopover record={record /* C7 */}>
        <button type="button" className={FIELD}>
          {f.cost}
        </button>
      </CostPopover>
      {dot}
      <ModePopover record={record /* C7 */}>
        <button type="button" title={f.refusal ?? undefined} className={`inline-flex items-center gap-1 ${FIELD}`}>
          {f.refusal && (
            <span role="img" aria-label="Warning" className="text-warning">
              ⚠
            </span>
          )}
          {f.mode}
        </button>
      </ModePopover>
    </div>
  );
}
