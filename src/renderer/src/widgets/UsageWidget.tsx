// `/usage` (C11 execution document, the widget table; D-17, §5.5): the account's windows as the status line shows them
// (C7's usage store: the pinned account's, else the routing account's, from ClaudeUsage's files), then the engine's own
// accounting for this session from `get_usage` (cost, time, lines, tokens per model). Behind the relay the engine
// reports no windows (`rate_limits_available: false`), and the widget says so; a direct session's windows are the
// engine's `rate_limits` from the same read.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { UsageWindow } from '@shared/usage/types';
import type { GetUsageResponse } from '@shared/wire/control';
import * as z from 'zod';
import { windowsFromGetUsage } from '../statusline/direct-fallback';
import { resetsIn, windowShown } from '../statusline/format';
import { USAGE_UNAVAILABLE } from '../statusline/UsagePopover';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { useSessions } from '../stores/sessions';
import { useSessionWindows, useUsage, type Windows } from '../stores/usage';
import { USAGE, USAGE_DIRECT_FOOT, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Group, KeyValues, Mono, num } from './parts';
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

export interface UsageView {
  rows: { label: string; value: string }[];
  models: { model: string; line: string }[];
  engineWindows: { fact: string | null; sentence: string }; // what the engine said about windows, and what it means
}

// `route`: a direct session's missing windows are its login's (C11 M6, live), not the relay's.
export function present(answer: GetUsageResponse, route: 'gateway' | 'direct' = 'gateway'): UsageView {
  const s = answer.session;
  return {
    rows: [
      { label: USAGE.cost, value: dollars(s.total_cost_usd) },
      { label: USAGE.apiTime, value: seconds(s.total_api_duration_ms) },
      { label: USAGE.wallTime, value: seconds(s.total_duration_ms) },
      { label: USAGE.lines, value: `+${count(s.total_lines_added)} −${count(s.total_lines_removed)}` },
    ],
    models: Object.entries(s.model_usage).flatMap(([model, raw]) => {
      const u = ModelUsageSchema.safeParse(raw);
      if (!u.success) return [];
      return [{ model, line: USAGE.model(num(u.data.inputTokens), num(u.data.outputTokens), num(u.data.cacheReadInputTokens), num(u.data.cacheCreationInputTokens)) }];
    }),
    engineWindows:
      answer.rate_limits_available && answer.rate_limits !== null
        ? { fact: null, sentence: USAGE.engineDirect }
        : { fact: `rate_limits_available: ${String(answer.rate_limits_available)}`, sentence: route === 'direct' ? USAGE.engineNoneDirect : USAGE.engineNone },
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

// The account's windows for a routed session (C7's store) or the engine's for a direct one (this widget's own read).
function AccountWindows({ record, status, answer }: { record: SessionRecord; status: EngineSessionStatus | null; answer: GetUsageResponse }) {
  const shown = useSessionWindows(record, status);
  const snapshot = useUsage((s) => s.snapshot);
  const now = useNow(POPOVER_TICK_MS);
  if (shown.source === 'direct') {
    const windows = windowsFromGetUsage(answer, new Date(now).toISOString());
    return (
      <Group label={USAGE.direct}>
        {windows ? <KeyValues rows={windowRows(windows, now)} label={USAGE.windows} /> : <p className="m-0 text-ui-sm text-fg-muted">{USAGE.noPlanLimits}</p>}
      </Group>
    );
  }
  const who = shown.account ? [shown.account.email, shown.account.planLabel].filter(Boolean).join(' · ') : snapshot?.available === false ? USAGE_UNAVAILABLE : USAGE.readingClaudeUsage;
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
        <KeyValues rows={view.rows} label={USAGE.accounting} />
      </Group>
      {view.models.length > 0 && (
        <Group label={USAGE.models}>
          <KeyValues rows={view.models.map((m) => ({ label: m.model, value: m.line }))} label={USAGE.byModel} />
        </Group>
      )}
      <p className="m-0 mt-2 text-ui-sm text-fg-muted">
        {view.engineWindows.fact && (
          <>
            <Mono>{view.engineWindows.fact}</Mono>
            {' · '}
          </>
        )}
        {view.engineWindows.sentence}
      </p>
    </div>
  );
}

export function UsageWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getUsage', { appSessionId });
  const route = useSessions((s) => (s.engine.get(appSessionId)?.gateway.mode === 'direct' ? 'direct' : 'gateway'));
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.usage} command="usage" foot={route === 'direct' ? USAGE_DIRECT_FOOT : WIDGET_FOOT.usage} state={read.state} error={read.error} close={close}>
      {read.data && <UsageBody view={present(read.data, route)} answer={read.data} appSessionId={appSessionId} />}
    </WidgetFrame>
  );
}
