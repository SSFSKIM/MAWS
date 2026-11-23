// `/usage` (C11 execution document, the widget table; D-17, §5.5): the account's windows as the status line shows them
// (C7's usage store: the pinned account's, else the routing account's, from ClaudeUsage's files), then the engine's own
// accounting for this session from `get_usage` (cost, time, lines, tokens per model); a direct session's windows are the
// engine's `rate_limits` from the same read. The word cut (P596 to P599): the session's cost stays in view and its times,
// lines and tokens per model fold under Details; the line on what the engine reports about windows is gone; the account
// line is a quiet spinner while ClaudeUsage has not answered.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { UsageWindow } from '@shared/usage/types';
import type { GetUsageResponse } from '@shared/wire/control';
import * as z from 'zod';
import { windowsFromGetUsage } from '../statusline/direct-fallback';
import { resetsIn, windowShown } from '../statusline/format';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { throughClaudeUsage } from '../gateway/observed-route'; // P5 O7 M9
import { useSessions } from '../stores/sessions';
import { useSessionWindows, useUsage, type Windows } from '../stores/usage';
import { USAGE, WIDGET_TITLE } from './copy';
import { Group, KeyValues, num } from './parts';
import { QuietSpinner } from '../ui/spinner';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const ModelUsageSchema = z.looseObject({
  inputTokens: z.number().catch(0),
  outputTokens: z.number().catch(0),
  cacheReadInputTokens: z.number().catch(0),
  cacheCreationInputTokens: z.number().catch(0),
});

const seconds = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const dollars = (usd: number) => `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;
const count = (value: unknown) => (typeof value === 'number' ? num(value) : '0');

type Reading = { label: string; value: string };
export interface UsageView {
  cost: Reading; // in view
  readings: Reading[]; // behind Details, with the models
  models: { model: string; line: string }[];
}

export function present(answer: GetUsageResponse): UsageView {
  const s = answer.session;
  return {
    cost: { label: USAGE.cost, value: dollars(s.total_cost_usd) },
    readings: [
      { label: USAGE.apiTime, value: seconds(s.total_api_duration_ms) },
      { label: USAGE.wallTime, value: seconds(s.total_duration_ms) },
      { label: USAGE.lines, value: `+${count(s.total_lines_added)} −${count(s.total_lines_removed)}` },
    ],
    models: Object.entries(s.model_usage).flatMap(([model, raw]) => {
      const u = ModelUsageSchema.safeParse(raw);
      if (!u.success) return [];
      return [{ model, line: USAGE.model(num(u.data.inputTokens), num(u.data.outputTokens), num(u.data.cacheReadInputTokens), num(u.data.cacheCreationInputTokens)) }];
    }),
  };
}

function windowRows(windows: Windows, now: number): { label: string; value: string }[] {
  const row = (label: string, window: UsageWindow | null) => {
    if (!window) return { label, value: USAGE.noReading };
    const shown = windowShown(window, now);
    return { label, value: shown.reset ? USAGE.sinceReset : USAGE.resetsIn(Math.round(shown.percent), resetsIn(shown.resetInMs!)) };
  };
  return [row(USAGE.fiveHour, windows.fiveHour), row(USAGE.weekly, windows.sevenDay), ...windows.scoped.map((s) => row(s.model, s.window))];
}

// A direct session's windows: this widget's own read, or (no answer of its own) the reading Session info's poll holds.
function DirectWindows({ windows, now }: { windows: Windows | null; now: number }) {
  return (
    <Group label={USAGE.direct}>
      {windows ? <KeyValues rows={windowRows(windows, now)} label={USAGE.windows} /> : <p className="m-0 text-ui-sm text-fg-muted">{USAGE.noPlanLimits}</p>}
    </Group>
  );
}

function HeldDirectWindows({ windows }: { windows: Windows | null }) {
  return <DirectWindows windows={windows} now={useNow(POPOVER_TICK_MS)} />;
}

// The account's windows for a routed session (C7's store) or the engine's for a direct one (this widget's own read).
function AccountWindows({ record, status, answer }: { record: SessionRecord; status: EngineSessionStatus | null; answer: GetUsageResponse }) {
  const shown = useSessionWindows(record, status);
  const snapshot = useUsage((s) => s.snapshot);
  const now = useNow(POPOVER_TICK_MS);
  if (shown.source === 'direct') return <DirectWindows windows={windowsFromGetUsage(answer, new Date(now).toISOString())} now={now} />;
  // until ClaudeUsage answers, a wait its next answer ends; once it has, what it said
  const who = shown.account
    ? [shown.account.email, shown.account.planLabel].filter(Boolean).join(' · ')
    : snapshot === null
      ? <QuietSpinner label={USAGE.readingClaudeUsage} />
      : snapshot.available
        ? USAGE.noAccount
        : USAGE.unavailable;
  return (
    <Group label={shown.source === 'pinned' ? USAGE.pinned : USAGE.routing}>
      <p className="m-0 mb-1 text-ui-sm">{who}</p>
      {shown.windows && <KeyValues rows={windowRows(shown.windows, now)} label={USAGE.windows} />}
    </Group>
  );
}

export function UsageBody({ view, answer, appSessionId }: { view: UsageView; answer: GetUsageResponse; appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  return (
    <div className="flex flex-col">
      {record ? <AccountWindows record={record} status={status} answer={answer} /> : <p className="m-0 text-ui-sm text-fg-muted">{USAGE.noRecord}</p>}
      <Group label={USAGE.session}>
        <KeyValues rows={[view.cost]} label={USAGE.accounting} />
      </Group>
      <details className="mt-2">
        <summary className="cursor-default text-ui-sm text-fg-muted">{USAGE.details}</summary>
        <div className="mt-1">
          <KeyValues rows={view.readings} />
          {view.models.length > 0 && (
            <Group label={USAGE.models}>
              <KeyValues rows={view.models.map((m) => ({ label: m.model, value: m.line }))} label={USAGE.byModel} />
            </Group>
          )}
        </div>
      </details>
    </div>
  );
}

export function UsageWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getUsage', { appSessionId });
  // A direct session whose process exited before this widget read: the windows Session info's poll last read, dated as
  // a cached answer is (the word cut took them out of Session info, and the title bar's ring reads relay accounts)
  const direct = useSessions((s) => throughClaudeUsage(s.engine.get(appSessionId) ?? null, s.records.get(appSessionId) ?? null) === false);
  const reading = useUsage((s) => s.direct.get(appSessionId) ?? null);
  const held = read.data === undefined && direct ? reading : null;
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.usage} command="usage" state={read.state} error={read.error} readAt={held ? Date.parse(held.readAt) : read.readAt} close={close}>
      {read.data && <UsageBody view={present(read.data)} answer={read.data} appSessionId={appSessionId} />}
      {held && <HeldDirectWindows windows={held.windows} />}
    </WidgetFrame>
  );
}
