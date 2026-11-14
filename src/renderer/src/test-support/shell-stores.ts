// Renderer component tests: fill the shell's stores from a scenario file as `ipc/events.ts` would after its snapshots,
// and reset them between tests. Imported only by happy-dom suites.
import { join } from 'node:path';
import * as z from 'zod';
import { EngineSessionStatusSchema } from '@shared/engine/status';
import { AttentionItemSchema } from '@shared/graph/attention';
import { SessionRecordSchema } from '@shared/graph/session';
import { ProjectRecordSchema, SessionDigestSchema, type SessionDigest } from '@shared/ipc/schema';
import { compileAddressing } from '@shared/machine/address';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { projectReveal } from '../sidebar/reveal';
import { useAttention } from '../stores/attention';
import { useShellView } from '../app/shell-view';
import { useLayout } from '../stores/layout';
import { EMPTY_REGISTRY } from '../stores/registry';
import { useSessions } from '../stores/sessions';
import { resetHidden } from '../stores/hidden'; // UX wave U7, O-16
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { loadScenario, type Scenario } from '../../../../test/support/scenario';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { resetPlaceNotes } from '../side/card/store'; // UX wave U5a

export function scenarioFile(name: 'nine-sessions' | 'empty' | 'many-sessions'): Scenario {
  return loadScenario(join(TEST_FIXTURE_DIR, `shell/${name}.json`));
}

// P5 O6 M2 (OX2): the scenario as the page holds it, every id an address on `TEST_MACHINE`, lifted through the records'
// own schemas as the client lifts main's answers. A scenario file is main's (bare ids); a test that looks an id up to
// find it in a store or the DOM looks it up here.
const liftAll = <S extends z.ZodType>(schema: S, values: unknown[]) => compileAddressing(z.array(schema)).lift(values, TEST_MACHINE);
export function pageScenario(scenario: Scenario): Scenario {
  return {
    ...scenario,
    projects: liftAll(ProjectRecordSchema, scenario.projects) as Scenario['projects'],
    sessions: liftAll(SessionRecordSchema, scenario.sessions) as Scenario['sessions'],
    digests: liftAll(SessionDigestSchema.partial(), scenario.digests) as Scenario['digests'],
    engine: liftAll(EngineSessionStatusSchema, scenario.engine) as Scenario['engine'],
    attention: scenario.attention.map((a) => ({ ...a, appSessionId: at(a.appSessionId), items: liftAll(AttentionItemSchema, a.items) as typeof a.items })),
  };
}

// Everything the scenario holds at load, with both snapshots loaded; `attention` overrides the scenario's lists. The
// scenario is given as its file holds it (bare); the stores get it as the page would (`pageScenario`).
export function fillStores(bare: Scenario, opts: { loaded?: boolean } = {}): void {
  const loaded = opts.loaded ?? true;
  const scenario = pageScenario(bare);
  const s = useSessions.getState();
  useSessions.setState({
    loaded,
    records: new Map(scenario.sessions.map((r) => [r.appId, r])),
    projects: new Map(scenario.projects.map((p) => [p.id, p])),
    digests: new Map(scenario.digests.map((d) => [d.appSessionId, { ...d, revision: 1 } as SessionDigest])),
    engine: new Map(),
    unstarted: new Map(),
    recordsVersion: s.recordsVersion + 1,
    projectsVersion: s.projectsVersion + 1,
    digestsVersion: s.digestsVersion + 1,
  });
  useAttention.setState({
    loaded,
    bySession: new Map(scenario.attention.map((a) => [a.appSessionId, a.items])),
    version: useAttention.getState().version + 1,
    pendingReplacements: null,
    requests: new Map(),
    unreadable: new Map(),
    drafts: new Map(),
    greyed: new Set(), // P5 O7 M6
  });
}

export function resetShellStores(): void {
  useShellView.setState({ sidebarOverlay: false, cardsOverlay: false });
  projectReveal.setState({ pending: null });
  fillStores({ projects: [], sessions: [], digests: [], engine: [], attention: [], timeline: [] }, { loaded: false });
  useSessions.setState({ indexing: null, reconnecting: false, listed: new Map(), listedMachines: new Set(), members: new Map(), member: null, turnsSeen: new Map(), acted: new Map() }); // P5 O8 M2, M5: no other machine's rows; P5 O7 M10: no turns seen; UX wave U7 (ticket 407): no refused read; the UX wave, U9: nothing this window did
  resetHidden(); // UX wave U7, O-16: nothing hidden, and the key not read yet
  useSessions.getState().applyRegistry(EMPTY_REGISTRY, TEST_MACHINE); // the project registry's M11: signed out, no registry record
  // P5 O6 M4: the store's per-machine reconciliation (revisions, tombstones) is no state `setState` reaches, and a
  // suite's earlier writes would refuse a later one's lower revisions.
  useSessions.getState().resetMachine(TEST_MACHINE);
  useLayout.setState({
    regions: LAYOUT_DEFAULTS.regions,
    main: LAYOUT_DEFAULTS.main,
    panelPinned: [],
    panelBySession: new Map(),
    panelActiveNoSession: null,
    panelParams: {}, // P4-B3
    panelSurfaces: { version: 2, stacks: {}, pinnedTools: [], contexts: {} },
    panelGroups: { version: 1, lower: {} }, // UX wave U8b
    panelWidths: { version: 1, wide: null, narrow: null },
    cardsOpen: ['environment'],
    knownSession: () => true,
    dragging: null, // P4-B3
    hydrated: true,
    overviewOpen: false,
    destination: null, // UX wave U7b: no page, no Settings dialog
    settings: null,
  });
  resetPlaceNotes(); // UX wave U5a: the comment card's passes and place lines are window state a suite must not inherit
}
