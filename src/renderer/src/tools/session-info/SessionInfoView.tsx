// Session info's body (C11 execution document, Interfaces "Session info tool"; M4 decisions and refresh task "Session
// info on C8a's host"): the stores' values at once, so the panel is never blank, and four reads plus the context
// summary on open and every 30 s while the tab is shown (none while hidden), counts only; the widgets hold the detail.
// W2 (§5.5 as amended 2026-10-01): with the status line gone, the Route row offers the Direct⇄gateway switch, and a
// Direct session's `get_usage` poll runs from here while the tab is shown.
import { useShallow } from 'zustand/react/shallow';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { SETTINGS_DEFAULTS_V9 } from '@shared/settings/defaults';
import { routingFacts } from '../../gateway/routing-facts';
import { useGateway } from '../../gateway/store';
import type { PanelToolContext } from '../../panel/tool';
import { useSetup } from '../../sessions/store';
import { useDirectFallback } from '../../statusline/direct-fallback';
import { POPOVER_TICK_MS, useNow } from '../../statusline/use-now';
import { listedModelsOf, openComposerWidget, useComposerStore } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { useSettings } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import { useSessionWindows, useUsage } from '../../stores/usage';
import { rowOf } from '../../widgets/model';
import { Group, KeyValues } from '../../widgets/parts';
import { useEngineRead } from '../../widgets/read';
import { INFO } from './copy';
import { autoModeLane, reviewsOf } from './lane';
import { sessionInfoSections, type InfoRow } from './model';
import { RouteSwitch } from './RouteSwitch';
import { useBudget } from '../../budget/store'; // C12

export type SessionInfoState = { openedAt: string }; // no per-tab state beyond bookkeeping; every value is read live

export const INFO_REFRESH_MS = 30_000;

export function SessionInfoView({ ctx }: { state: SessionInfoState; ctx: PanelToolContext }) {
  if (ctx.appSessionId === null) return <p className="p-3 text-ui text-fg-muted">{INFO.noSession}</p>;
  return <SessionInfo key={ctx.appSessionId} appSessionId={ctx.appSessionId} visible={ctx.visible} fallback={ctx.session} />;
}

// The `Auto mode server` row of a `get_status` answer, when C3 has not read it for the status yet.
const serverRow = (sections: { title: string; rows: { label?: string | null; value: string }[] }[] | undefined): 'enabled' | 'disabled' | null => {
  const value = sections?.flatMap((s) => s.rows).find((r) => r.label === 'Auto mode server')?.value;
  return value === 'Enabled' ? 'enabled' : value === 'Disabled' ? 'disabled' : null;
};

function SessionInfo({ appSessionId, visible, fallback }: { appSessionId: AppSessionId; visible: boolean; fallback: PanelToolContext['session'] }) {
  const record = useSessions((s) => s.records.get(appSessionId)) ?? fallback;
  if (!record) return <p className="p-3 text-ui text-fg-muted">{INFO.noSession}</p>;
  return <SessionInfoBody appSessionId={appSessionId} visible={visible} record={record} />;
}

function SessionInfoBody({ appSessionId, visible, record }: { appSessionId: AppSessionId; visible: boolean; record: SessionRecord }) {
  const { status, digest } = useSessions(useShallow((s) => ({ status: s.engine.get(appSessionId) ?? null, digest: s.digests.get(appSessionId) ?? null })));
  const read = { enabled: visible, refetchIntervalMs: INFO_REFRESH_MS };
  const input = { appSessionId };
  const statusRead = useEngineRead('session.getStatus', input, read);
  const rules = useEngineRead('session.listPermissionRules', input, read);
  const hooks = useEngineRead('session.getHooksListing', input, read);
  const mcp = useEngineRead('session.mcpStatus', input, read);
  // C3 samples the context at ready and after every turn into the digest (debt wave 3); the engine's summary is read
  // only while no sample has arrived (a session C3 has not sampled yet, or one whose digest predates the sampling).
  const context = useEngineRead('session.getContextUsage', { appSessionId, detail: 'summary' }, { ...read, enabled: visible && !digest?.context });
  const settings = useSettings((s) => s.state?.settings) ?? SETTINGS_DEFAULTS_V9;
  const snapshot = useUsage((s) => s.snapshot);
  const directLogin = useGateway((s) => s.directLogin.get(appSessionId) ?? null);
  // the model's catalogue entry, when C7 listed the session's models (the lane reads only its value, which the status
  // names anyway)
  const models = useComposerStore((s) => listedModelsOf(s, appSessionId));
  // the transcript's state only while it holds rows for the session (the reviews count is omitted otherwise)
  const transcript = useTranscriptStore((s) => (s.entries[appSessionId]?.rows.length ? s.entries[appSessionId].state : undefined));
  const now = useNow(POPOVER_TICK_MS);
  const windows = useSessionWindows(record, status);
  const budget = useBudget((s) => s.state); // C12
  useDirectFallback(appSessionId, visible ? status : null); // W2: a Direct session's windows, read while the tab is shown

  // W2: a session whose first launch C10 still runs (its intent, no status) chooses its route on the intent (the model
  // widget's Route segment), never by a restart from here, as the usage popover's footer branched before routingFacts
  const firstLaunch = useSetup((s) => s.intents.has(appSessionId)) && status === null;
  const routed = routingFacts(record, status, snapshot, settings, directLogin);
  const facts = firstLaunch ? { ...routed, targets: [], canSwitch: false, switchLabel: '' } : routed;
  let lane = null;
  if (status) {
    const server = status.gateway.autoModeServer === 'unknown' ? serverRow(statusRead.data?.sections) : null;
    const laneStatus = server ? { ...status, gateway: { ...status.gateway, autoModeServer: server } } : status;
    const entry = rowOf(models ?? [], status.model.requested ?? status.model.resolved) ?? null;
    const account = facts.route === 'direct' ? INFO.direct : (facts.account?.email ?? null);
    lane = autoModeLane(laneStatus, entry, reviewsOf(transcript), account);
  }
  const sections = sessionInfoSections({
    record,
    status,
    digest,
    facts,
    directLogin,
    lane,
    models: models ?? null,
    windows,
    budget, // C12
    now,
    reads: { status: statusRead.data ?? null, rules: rules.data ?? null, hooks: hooks.data ?? null, mcp: mcp.data ?? null, context: context.data ?? null },
  });

  return (
    <div data-session-info={appSessionId} className="h-full overflow-auto p-3 text-ui text-fg">
      {!status && <p className="m-0 mb-2 text-ui-sm text-fg-muted">{INFO.notLive}</p>}
      {sections.map((section) => (
        <Group key={section.title} label={section.title}>
          <KeyValues label={section.title} rows={section.rows.map((row) => ({ label: row.label, value: <Value appSessionId={appSessionId} row={row} /> }))} />
        </Group>
      ))}
    </div>
  );
}

function Value({ appSessionId, row }: { appSessionId: AppSessionId; row: InfoRow }) {
  return (
    <>
      <span>{row.value}</span>
      {row.note && <span className="text-fg-muted"> · {row.note}</span>}
      {row.action === 'permissions' && (
        <button
          type="button"
          onClick={() => openComposerWidget(appSessionId, 'permissions', '')}
          className="ml-2 rounded-sm px-1 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2"
        >
          {INFO.openPermissions}
        </button>
      )}
      {row.action === 'route' && row.targets && <RouteSwitch appSessionId={appSessionId} targets={row.targets} />}
    </>
  );
}
