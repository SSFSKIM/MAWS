// The spine's view, backed in process (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces
// §B; D9): what the renderer is told, read from the spine's own parts. Records, digests, attention, engine statuses and
// the visible set are the read model's; intents are the intent store's, changed by each `session.intent.changed`
// emitted; the listed projects are what `session.projects.list` answers, and the project rows every row the index holds
// (connectors' route D falls back to a project with no present session, D8); `acquire` is the session service's; files'
// admission read is the library's. P5 O3-D M1 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D13): what changes
// both is read from the events the spine emits, as main's mirror reads them from the services front: an attention change
// fires with `attention.changed`'s items and its `silent` ids (the attention service's restored marks, filled on the
// event; the read model holds the items by then, its tap being the earlier), and both project sets follow
// `session.projects.changed` (`projects`, and `rows` when it carries them), the index read once at the start.
//
// In launch mode `scenario` (D10) the view answers the scenario the renderer shows (the read model's records and
// projects) and reports itself unavailable, so nothing reconciles the browser's rows against a scenario. In a run refused
// the spine the index is unavailable and the view says why; its project sets and linked paths are empty, and `acquire`
// rejects as the composer's binding does. In process, availability never changes after start.
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { ServicesBus } from '@shared/spine/bus';
import { SCENARIO_UNAVAILABLE, type SpineView, type SpineViewEvents } from '@shared/spine/view';
import type { LibraryStore } from '../library/store';
import type { ProjectStore } from '../index/projects';
import type { IntentStore } from './intents';
import type { SessionReadModel } from './read-model';
import type { LaunchMode } from '@shared/sessions/select-source';

export { SCENARIO_UNAVAILABLE }; // @shared/spine/view's, which main's mirror says too (P5 O3-D M5b)

export interface SpineViewDeps {
  mode: LaunchMode;
  model: Pick<SessionReadModel, 'record' | 'allRecords' | 'allProjects' | 'digest' | 'digests' | 'attention' | 'allAttention' | 'engineStatuses' | 'midTurnCount' | 'visibleSessions' | 'on'>;
  index: {
    readonly unavailable: string | null;
    projects: Pick<ProjectStore, 'list' | 'listWithRemoved'>;
    library: Pick<LibraryStore, 'fileLinkedPaths'>;
  };
  intents: Pick<IntentStore, 'get' | 'list'>;
  tap: ServicesBus['onEmitted']; // after the read model's own taps, so a change the view fires is the model's already
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

  // Both project sets, read at the start and then from each change the index source emits
  let listed: readonly ProjectRecord[] = scenario || !indexReadable() ? [] : index.projects.listWithRemoved();
  let rows: readonly ProjectRecord[] = scenario || !indexReadable() ? [] : index.projects.list({ includeHidden: true });
  const subscriptions = [
    model.on('record', (id, record) => fire('record', id, record)),
    model.on('digest', (digest) => fire('digest', digest)),
    model.on('engine', (id, status) => fire('engine', id, status)),
    model.on('visible', (id, visible) => fire('visible', id, visible)),
    deps.tap('attention.changed', ({ appSessionId, items, silent }) => fire('attention', appSessionId as AppSessionId, items, new Set((silent ?? []) as AttentionId[]))),
    deps.tap('session.intent.changed', ({ appSessionId, intent }) => fire('intent', appSessionId as AppSessionId, intent)),
    ...(scenario || !indexReadable()
      ? []
      : [
          deps.tap('session.projects.changed', (change) => {
            listed = change.projects;
            if (change.rows) rows = change.rows;
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
