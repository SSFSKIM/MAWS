// Renderer component tests: fill the shell's stores from a scenario file as `ipc/events.ts` would after its snapshots,
// and reset them between tests. Imported only by happy-dom suites.
import { join } from 'node:path';
import type { SessionDigest } from '@shared/ipc/schema';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { useAttention } from '../stores/attention';
import { NO_PROJECT_OF, useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { loadScenario, type Scenario } from '../../../../test/support/scenario';

export function scenarioFile(name: 'nine-sessions' | 'empty' | 'many-sessions'): Scenario {
  return loadScenario(join(TEST_FIXTURE_DIR, `shell/${name}.json`));
}

// Everything the scenario holds at load, with both snapshots loaded; `attention` overrides the scenario's lists.
export function fillStores(scenario: Scenario, opts: { loaded?: boolean } = {}): void {
  const loaded = opts.loaded ?? true;
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
  });
}

export function resetShellStores(): void {
  fillStores({ projects: [], sessions: [], digests: [], engine: [], attention: [], timeline: [] }, { loaded: false });
  useSessions.setState({ indexing: null });
  useLayout.setState({
    regions: LAYOUT_DEFAULTS.regions,
    main: LAYOUT_DEFAULTS.main,
    panelPinned: [],
    panelBySession: new Map(),
    panelActiveNoSession: null,
    hydrated: true,
    focusRequest: null,
    overviewOpen: false,
    projectOf: NO_PROJECT_OF,
  });
}

// W12: the layout files each session's tabs under its record's project, as the shell's hydration has it do (until this,
// a component test keeps every tab in the no-project set).
export function fileTabsByProject(): void {
  useLayout.setState({ projectOf: (id) => useSessions.getState().records.get(id)?.projectId ?? null });
}
