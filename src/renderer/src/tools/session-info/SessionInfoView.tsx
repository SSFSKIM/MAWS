// Session info's body (C11 execution document, Interfaces "Session info tool"; M4 decisions and refresh task "Session
// info on C8a's host"): the stores' values at once, so the panel is never blank, and four reads plus the context
// summary on open and every 30 s while the tab is shown (none while hidden), counts only; the widgets hold the detail.
// W2 (§5.5 as amended 2026-10-01): with the status line gone, the Route row offers the Direct⇄gateway switch, and a
// Direct session's `get_usage` poll runs from here while the tab is shown.
// The word cut (T252, T266): each group is folded to its head, a press opening it with the shared disclosure motion;
// Permissions and Usage start open, and the controls a bridged session can't reach fold with their count beside the
// head. Where a value came from is its tooltip, on the value, which then takes the keyboard (T253). The context read went
// with the Context row (P176).
import { useId, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { routingFacts } from '../../gateway/routing-facts';
import { useGateway } from '../../gateway/store';
import type { PanelToolContext } from '../../panel/tool';
import { useSetup } from '../../sessions/store';
import { useDirectFallback } from '../../statusline/direct-fallback';
import { POPOVER_TICK_MS, useNow } from '../../statusline/use-now';
import { listedModelsOf, openComposerWidget, useComposerStore } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { routeOf, useModelCatalogue } from '../../composer/list-models'; // UX wave U4a M5
import { machineOf } from '@shared/machine/address';
import { workingFolder } from '@shared/sessions/working-folder';
import { useSettings } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import { useSessionWindows, useUsage } from '../../stores/usage';
import { heldModel, rowOf, useModelRequests } from '../../widgets/model';
import { KeyValues } from '../../widgets/parts';
import { DisclosureBody } from '../../ui/disclosure';
import { Tip } from '../../ui/tip';
import { useEngineRead } from '../../widgets/read';
import { useObservedFacts } from '../../sessions/observed'; // P2-A
import { DormantGesture } from '../../widgets/DormantGesture'; // P2-A M3
import { FRAME } from '../../widgets/copy'; // P2-A M3
import { INFO } from './copy';
import { autoModeLane, reviewsOf } from './lane';
import { drivenModeRow, drivenSection, sessionInfoSections, type InfoRow } from './model';
import { RouteSwitch } from './RouteSwitch';
import { useSessionControls } from '../../session/controls/controls-for'; // P5 O9 M5
import { useRemoteLaneA } from '../../lane-a/remote-session'; // P5 O9 M9
import { useBudget } from '../../budget/store'; // C12
import { loadedTabs, useBrowser } from '../browser/store'; // E4a

export type SessionInfoState = { openedAt: string }; // no per-tab state beyond bookkeeping; every value is read live

export const INFO_REFRESH_MS = 30_000;

export function SessionInfoView({ ctx }: { state: SessionInfoState; ctx: PanelToolContext }) {
  if (ctx.appSessionId === null) return <p className="p-3 text-ui text-fg-muted">{INFO.noSession}</p>;
  return <SessionInfo key={ctx.appSessionId} appSessionId={ctx.appSessionId} visible={ctx.visible} fallback={ctx.session} />;
}

const OPEN_AT_FIRST: ReadonlySet<string> = new Set([INFO.sections.permissions, INFO.sections.usage]);

// Which groups are open, by title: the two that start open, then the person's presses (kept while the tab is mounted).
function useFolds() {
  const [open, setOpen] = useState<ReadonlySet<string>>(OPEN_AT_FIRST);
  const toggle = (title: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(title)) next.add(title);
      return next;
    });
  return { isOpen: (title: string) => open.has(title), toggle };
}

const HEAD =
  'group flex h-6 w-full min-w-0 items-center gap-1 rounded-sm text-left text-ui-sm font-semibold tracking-wide text-fg-muted uppercase outline-accent hover:text-fg focus-visible:outline-2';
const CHEVRON = 'size-3 shrink-0 transition-transform duration-150 group-aria-expanded:rotate-90 motion-reduce:transition-none';

// A group folded to its head: the heading is the disclosure's button, the chevron before the words; `count`, a bare
// count after them, its meaning its name and the head's tooltip (the head is its one focusable owner).
function FoldGroup({ label, count, open, onToggle, children }: { label: string; count?: { n: number; meaning: string }; open: boolean; onToggle(): void; children: ReactNode }) {
  const bodyId = useId();
  const head = (
    <button type="button" aria-expanded={open} aria-controls={open ? bodyId : undefined} aria-describedby={undefined} onClick={onToggle} className={HEAD}>
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={CHEVRON}>
        <path d="M6 3.5 10.5 8 6 12.5" />
      </svg>
      <span className="min-w-0 truncate">{label}</span>
      {count && (
        <span role="img" aria-label={count.meaning} className="font-normal tabular-nums">
          {count.n}
        </span>
      )}
    </button>
  );
  return (
    <section aria-label={label} data-info-group={label} className="mt-1.5 first:mt-0">
      <h4 className="m-0">{count ? <Tip content={count.meaning}>{head}</Tip> : head}</h4>
      <DisclosureBody open={open} id={bodyId}>
        <div className="pt-0.5 pb-1.5 pl-4">{children}</div>
      </DisclosureBody>
    </section>
  );
}

// The fold of one section: the controls a bridged session can't reach carry their count.
function SectionFold({ appSessionId, section, folds }: { appSessionId: AppSessionId; section: { title: string; rows: InfoRow[] }; folds: ReturnType<typeof useFolds> }) {
  const count = section.title === INFO.unavailableTitle ? { n: section.rows.length, meaning: INFO.unavailableCount(section.rows.length) } : undefined;
  return (
    <FoldGroup label={section.title} count={count} open={folds.isOpen(section.title)} onToggle={() => folds.toggle(section.title)}>
      <KeyValues label={section.title} rows={section.rows.map((row) => ({ label: row.label, value: <Value appSessionId={appSessionId} row={row} /> }))} />
    </FoldGroup>
  );
}

// The `Auto mode server` row of a `get_status` answer, when C3 has not read it for the status yet.
const serverRow = (sections: { title: string; rows: { label?: string | null; value: string }[] }[] | undefined): 'enabled' | 'disabled' | null => {
  const value = sections?.flatMap((s) => s.rows).find((r) => r.label === 'Auto mode server')?.value;
  return value === 'Enabled' ? 'enabled' : value === 'Disabled' ? 'disabled' : null;
};

function SessionInfo({ appSessionId, visible, fallback }: { appSessionId: AppSessionId; visible: boolean; fallback: PanelToolContext['session'] }) {
  const record = useSessions((s) => s.records.get(appSessionId)) ?? fallback;
  const remote = useRemoteLaneA(appSessionId); // P5 O9 M9
  if (!record && remote) return <RemoteSessionInfo appSessionId={appSessionId} />;
  if (!record) return <p className="p-3 text-ui text-fg-muted">{INFO.noSession}</p>;
  return <SessionInfoBody appSessionId={appSessionId} visible={visible} record={record} />;
}

// P5 O9 M9: another machine's terminal session has its listed row alone here, and no engine this machine reads: the mode
// it reported (sminos 1.27.14), and what this device can't do to it, each control with the reason its port gives (Q2: in
// place, never missing).
function RemoteSessionInfo({ appSessionId }: { appSessionId: AppSessionId }) {
  const controls = useSessionControls(appSessionId);
  const now = useNow(POPOVER_TICK_MS);
  const unavailable = controls === null ? null : drivenSection((key) => controls.capability(key));
  const mode = controls === null ? null : drivenModeRow(controls, now);
  const folds = useFolds();
  return (
    <div data-session-info={appSessionId} className="h-full overflow-auto p-3 text-ui text-fg">
      {mode && <SectionFold appSessionId={appSessionId} section={{ title: INFO.sections.permissions, rows: [mode] }} folds={folds} />}
      {unavailable && <SectionFold appSessionId={appSessionId} section={unavailable} folds={folds} />}
    </div>
  );
}

function SessionInfoBody({ appSessionId, visible, record }: { appSessionId: AppSessionId; visible: boolean; record: SessionRecord }) {
  const { status, digest } = useSessions(useShallow((s) => ({ status: s.engine.get(appSessionId) ?? null, digest: s.digests.get(appSessionId) ?? null })));
  const read = { enabled: visible, refetchIntervalMs: INFO_REFRESH_MS };
  const input = { appSessionId };
  const statusRead = useEngineRead('session.getStatus', input, read);
  const rules = useEngineRead('session.listPermissionRules', input, read);
  const hooks = useEngineRead('session.getHooksListing', input, read);
  const mcp = useEngineRead('session.mcpStatus', input, read);
  const settings = useSettings((s) => s.state?.settings) ?? SETTINGS_DEFAULTS_V21;
  const snapshot = useUsage((s) => s.snapshot);
  const directLogin = useGateway((s) => s.directLogin.get(appSessionId) ?? null);
  // the model's catalogue entry, when C7 listed the session's models (the lane reads only its value, which the status
  // names anyway)
  const models = useComposerStore((s) => listedModelsOf(s, appSessionId));
  // UX wave U4a (decision 19): the catalogue the composer's chip names the model from before any menu has listed the
  // engine's models (C10's `engine.models` for the session's route and folder), so the Main row reads the chip's name
  const live = status?.process === 'ready';
  const modelNames = useModelCatalogue(machineOf(appSessionId), routeOf(status, record), live, status?.cwd ?? workingFolder(record).cwd);
  const held = useModelRequests((s) => heldModel(s, appSessionId, status)) ?? null; // the request the chip and the selector read
  // the transcript's state only while it holds rows for the session (the reviews count is omitted otherwise)
  const transcript = useTranscriptStore((s) => (s.entries[appSessionId]?.rows.length ? s.entries[appSessionId].state : undefined));
  const now = useNow(POPOVER_TICK_MS);
  const windows = useSessionWindows(record, status);
  const budget = useBudget((s) => s.state); // C12
  const browserTabs = useBrowser(useShallow(loadedTabs)); // E4a
  useDirectFallback(appSessionId, visible ? status : null); // W2: a Direct session's windows, read while the tab is shown
  // P2-A (X17): with no live process the sections show what the engine last reported, labelled with when; a read, never
  // a start (the 30 s reads above stay enabled only while the process is ready)
  const controls = useSessionControls(appSessionId); // P5 O9 M5
  const driven = controls !== null && controls.turn() !== null ? controls : null;
  const observed = useObservedFacts(appSessionId, { enabled: visible && !live });

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
    const account = facts.route === 'direct' ? INFO.engineLogin : (facts.account?.email ?? null);
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
    modelNames,
    held,
    windows,
    budget, // C12
    browserTabs, // E4a
    now,
    ...(live ? {} : { observed }), // P2-A
    driven, // P5 O9 M5
    reads: { status: statusRead.data ?? null, rules: rules.data ?? null, hooks: hooks.data ?? null, mcp: mcp.data ?? null },
  });
  const folds = useFolds();

  return (
    <div data-session-info={appSessionId} className="h-full overflow-auto p-3 text-ui text-fg">
      {/* P2-A M3: not live, the owner's Refresh starts the session; the 30 s reads follow at ready */}
      {!live && !firstLaunch && !driven && (
        <div className="mb-2">
          <DormantGesture appSessionId={appSessionId} label={FRAME.refresh} />
        </div>
      )}
      {sections.map((section) => (
        <SectionFold key={section.title} appSessionId={appSessionId} section={section} folds={folds} />
      ))}
    </div>
  );
}

function Value({ appSessionId, row }: { appSessionId: AppSessionId; row: InfoRow }) {
  return (
    <>
      {row.tip ? (
        <Tip content={row.tip} description={row.tip}>
          <span tabIndex={0} className="rounded-sm outline-accent focus-visible:outline-2">
            {row.value}
          </span>
        </Tip>
      ) : (
        <span>{row.value}</span>
      )}
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
