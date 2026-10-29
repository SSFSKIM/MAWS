// The spine's view, backed in process (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces
// §B; D9): what the renderer is told, read from the spine's own parts. Records, digests, attention, engine statuses and
// the visible set are the read model's; an attention change is the read model's with `silent` the ids among its items
// the attention service restored (marked before their change is emitted, so the mark is in place when the read model
// hears it); intents are the intent store's, changed by each `session.intent.changed` emitted; the listed projects are
// what `session.projects.list` answers and `session.projects.changed` carries, and the project rows every row the index
// holds (connectors' route D falls back to a project with no present session, D8); `acquire` is the session service's;
// files' admission read is the library's.
//
// In launch mode `scenario` (D10) the view answers the scenario the renderer shows (the read model's records and
// projects) and reports itself unavailable, so nothing reconciles the browser's rows against a scenario. In a run refused
// the spine the index is unavailable and the view says why; its project sets and linked paths are empty, and `acquire`
// rejects as the composer's binding does. In process, availability never changes after start.
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { ServicesBus } from '@shared/spine/bus';
import type { SpineView, SpineViewEvents } from '@shared/spine/view';
import type { LibraryStore } from '../library/store';
import type { ProjectStore } from '../index/projects';
import type { IntentStore } from './intents';
import type { SessionReadModel } from './read-model';
import type { LaunchMode } from '@shared/sessions/select-source';

export const SCENARIO_UNAVAILABLE = 'launch mode scenario: the sessions shown are a scenario’s';

export interface SpineViewDeps {
  mode: LaunchMode;
  model: Pick<SessionReadModel, 'record' | 'allRecords' | 'allProjects' | 'digest' | 'digests' | 'attention' | 'allAttention' | 'engineStatuses' | 'midTurnCount' | 'visibleSessions' | 'on'>;
  index: {
    readonly unavailable: string | null;
    projects: Pick<ProjectStore, 'list' | 'listWithRemoved' | 'onChange'>;
    library: Pick<LibraryStore, 'fileLinkedPaths'>;
  };
  intents: Pick<IntentStore, 'get' | 'list'>;
  tap: ServicesBus['onEmitted'];
  restoredIds: ReadonlySet<AttentionId>; // the attention service's; empty in a refused run, which starts none
  acquire: SpineView['acquire']; // the session service's
}

export interface InProcessSpineView {
  readonly view: SpineView;
  stop(): void; // every subscription to its backings ends
}

export function createSpineView(deps: SpineViewDeps): InProcessSpineView {
  const { model, index, intents } = deps;
  const scenario = deps.mode === 'scenario';
  const indexReadable = () => index.unavailable === null;
  const listeners: { [E in keyof SpineViewEvents]: Set<SpineViewEvents[E]> } = {
    availability: new Set(), record: new Set(), projects: new Set(), digest: new Set(), attention: new Set(), engine: new Set(), intent: new Set(), visible: new Set(),
  };
  const fire = <E extends keyof SpineViewEvents>(event: E, ...args: Parameters<SpineViewEvents[E]>) => {
    for (const listener of [...listeners[event]]) (listener as (...a: Parameters<SpineViewEvents[E]>) => void)(...args);
  };

  // Both project sets, read again at each change of their backing (in process the index answers at once)
  let listed: readonly ProjectRecord[] = scenario || !indexReadable() ? [] : index.projects.listWithRemoved();
  let rows: readonly ProjectRecord[] = scenario || !indexReadable() ? [] : index.projects.list({ includeHidden: true });
  const subscriptions = [
    model.on('record', (id, record) => fire('record', id, record)),
    model.on('digest', (digest) => fire('digest', digest)),
    model.on('attention', (id, items) => fire('attention', id, items, new Set(items.flatMap((item) => (deps.restoredIds.has(item.id) ? [item.id] : []))))),
    model.on('engine', (id, status) => fire('engine', id, status)),
    model.on('visible', (id, visible) => fire('visible', id, visible)),
    deps.tap('session.intent.changed', ({ appSessionId, intent }) => fire('intent', appSessionId as AppSessionId, intent)),
    ...(scenario || !indexReadable()
      ? []
      : [
          deps.tap('session.projects.changed', ({ projects }) => {
            listed = projects;
            fire('projects');
          }),
          index.projects.onChange(() => {
            rows = index.projects.list({ includeHidden: true });
            fire('projects');
          }),
        ]),
  ];
  const projectRows = () => (scenario ? model.allProjects() : rows);

  const view: SpineView = {
    unavailable: () => index.unavailable ?? (scenario ? SCENARIO_UNAVAILABLE : null),
    record: (id) => model.record(id),
    records: () => model.allRecords(),
    projects: () => (scenario ? model.allProjects() : listed),
    projectRows,
    project: (id) => projectRows().find((project) => project.id === id) ?? null,
    digest: (id) => model.digest(id),
    digests: () => model.digests(),
    attention: (id) => model.attention(id),
    allAttention: () => model.allAttention(),
    engineStatuses: () => model.engineStatuses(),
    midTurnCount: () => model.midTurnCount(),
    intent: (id) => intents.get(id),
    intents: () => intents.list(),
    known: (id) => model.record(id) !== null || intents.get(id) !== null,
    visibleSessions: () => model.visibleSessions(),
    on(event, listener) {
      listeners[event].add(listener);
      return () => void listeners[event].delete(listener);
    },
    acquire: (id, reason) => deps.acquire(id, reason),
    fileLinkedPaths: async (id) => (indexReadable() ? index.library.fileLinkedPaths(id) : []),
  };
  return {
    view,
    stop: () => subscriptions.forEach((off) => off()),
  };
}
