// Wires the read side into main (C5): decides the launch mode once, creates the read model, answers `session.digests`
// and `session.setVisible`, relays every digest as `session.digest`, and attaches the sources the mode allows. In mode
// `index` those are C4's `IndexSessionSource` (created in C4's block of src/main/index.ts, started here) and the engine
// host's event feed below; in mode `scenario` only the stub source, and the read model refuses C4's source unstarted,
// so the index never scans.
import type { WebContents, WebContentsDidStartNavigationEventParams } from 'electron';
import type { SessionEvent } from '@shared/graph/events'; // E3
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandOutput, EventName, EventPayload } from '@shared/ipc/schema';
import { isAppSynthesised } from '@shared/sessions/app-events';
import type { HostSupervisor } from '../hosts/supervisor';
import { emit, onEmitted } from '../ipc/events';
import { CommandFailure, interceptCommand, registerMainHandler } from '../ipc/router';
import { isSideThreadEvent } from '../side/side-threads'; // E3
import { SessionReadModel, type SessionSource } from './read-model';
import { launchMode, scenarioClock, scenarioPath } from './select-source';
import { stubSource } from './stub-source';
import { FoldFilter, resyncDigests } from './resync'; // E10

export interface SessionsOptions {
  env: Record<string, string | undefined>;
  packaged: boolean;
  appRoot: string;
  hosts: Pick<HostSupervisor, 'onEvent' | 'onState' | 'dispatch' | 'setResync'>; // C12: onState; E10: setResync
  indexSource?: SessionSource; // C4's IndexSessionSource: the records, projects and seed digests, and the unread rule
  // E3 (Design §5): app events kept elsewhere than the read model, answered with its own by `session.appEvents` (the
  // side-thread rows, re-synthesised from the index)
  appEventsExtra?: (appSessionId: AppSessionId) => SessionEvent[];
}

export interface Sessions {
  model: SessionReadModel;
  stop(): void;
}

// C3's event batches and statuses on the re-emit path: the digest fold and the process table the quit guard reads;
// C4's replay progress marks a replay run live for the fold.
// C12: at each engine-host generation change (the host leaving `ready`) the statuses it sent are forgotten, since a
// replacement host starts with none of their processes, as the budget store re-reads per generation (whole-branch
// review); the read model's `engine` event lets a quit wait re-read.
// E10: the engine host's resync (resync.ts) is registered here, run by the supervisor between each connect and its
// `ready` line: every row's status and launch folded before the host streams. The batches that follow pass the fold
// filter, so the burst's tail and live events fold once, in order, after what the resync folded.
export function hostEventSource(
  hosts: Pick<HostSupervisor, 'onEvent' | 'onState' | 'setResync'>, // C12: onState; E10: setResync
  log: (line: string) => void = (line) => console.log(`[sessions] ${line}`), // E10
): SessionSource {
  return {
    start(writer) {
      const held = new Set<AppSessionId>(); // C12: ids this host generation sent a status for
      // E10 start
      const filter = new FoldFilter();
      hosts.setResync('engine-host', (dispatch, signal) => resyncDigests({ dispatch, signal, writer, filter, held, log }));
      // E10 end
      const offs = [
        hosts.onEvent('session.eventBatch', ({ appSessionId, events }) => writer.fold(appSessionId, filter.pass(appSessionId, events))), // E10: the filter
        hosts.onEvent('session.status', ({ status }) => (held.add(status.appSessionId), writer.applyEngineStatus(status))), // C12: held
        // C12 start
        hosts.onState('engine-host', (state) => {
          if (state.state === 'ready') return;
          for (const appSessionId of held) writer.forgetEngineStatus(appSessionId);
          held.clear();
        }),
        // C12 end
        // C4's replay runs have no engine status; their progress says the host is playing the session's events live.
        hosts.onEvent('session.replay.progress', ({ appSessionId }) => writer.observeReplay(appSessionId as AppSessionId)),
      ];
      return () => {
        hosts.setResync('engine-host', null); // E10
        offs.forEach((off) => off());
      };
    },
  };
}

// Attention as main tells the renderer (`attention.changed`, from C3's attention service or the stub source), tapped
// after validation so the read model's view is exactly the renderer's, with no call from the emitter into the model.
export function emittedAttentionSource(tap: typeof onEmitted = onEmitted): SessionSource {
  return {
    start: (writer) => tap('attention.changed', ({ appSessionId, items }) => writer.observeAttention(appSessionId as AppSessionId, items)),
  };
}

// Debt wave 5 (C10 · C6): the events main itself synthesises for a session (C10's route notice), tapped from main's
// `session.eventBatch` as the renderer receives them, so the read model keeps what nothing else stores. E3: the
// side-thread rows are stored by the index and come back from it (`appEventsExtra`); kept here too, a parent with many
// threads would push its notices out of the capped store.
export function emittedAppEventsSource(tap: typeof onEmitted = onEmitted): SessionSource {
  return {
    start: (writer) =>
      tap('session.eventBatch', ({ appSessionId, events }) => {
        const id = appSessionId as AppSessionId;
        const ours = events.filter((event) => isAppSynthesised(id, event) && !isSideThreadEvent(event)); // E3
        if (ours.length > 0) writer.observeAppEvents(id, ours);
      }),
  };
}

// E3: the read model's kept events, then the extra provider's, once per id.
function appEventsOf(model: SessionReadModel, appSessionId: AppSessionId, extra: SessionsOptions['appEventsExtra']): SessionEvent[] {
  const events = [...model.appEvents(appSessionId), ...(extra?.(appSessionId) ?? [])];
  const seen = new Set<string>();
  return events.filter((event) => !seen.has(event.id) && (seen.add(event.id), true));
}

export function startSessions({ env, packaged, appRoot, hosts, indexSource, appEventsExtra }: SessionsOptions): Sessions {
  const mode = launchMode(env, packaged);
  const model = new SessionReadModel(mode);
  registerMainHandler('session.digests', () => ({ digests: model.digests() }));
  registerMainHandler('session.launchMode', () => ({ mode }));
  registerMainHandler('session.appEvents', ({ appSessionId }) => ({ events: appEventsOf(model, appSessionId as AppSessionId, appEventsExtra) })); // debt wave 5; E3: the extra
  // Visibility is the union of the pages displaying a session, not a sticky app-wide flag.
  const pages = new Map<WebContents, { ids: Set<AppSessionId>; release(): void }>();
  const refreshVisibility = (id: AppSessionId) => model.setVisible(id, [...pages.values()].some((page) => page.ids.has(id)));
  registerMainHandler('session.setVisible', ({ appSessionId, visible }, { sender }) => {
    if (sender.isDestroyed()) return;
    let page = pages.get(sender);
    if (!page) {
      if (!visible) return;
      const ids = new Set<AppSessionId>();
      const release = () => {
        pages.delete(sender);
        sender.removeListener('destroyed', release);
        sender.removeListener('render-process-gone', release);
        sender.removeListener('did-start-navigation', navigating);
        for (const id of ids) refreshVisibility(id);
      };
      const navigating = (details: WebContentsDidStartNavigationEventParams) => {
        if (details.isMainFrame && !details.isSameDocument) release();
      };
      page = { ids, release };
      pages.set(sender, page);
      sender.on('destroyed', release);
      sender.on('render-process-gone', release);
      sender.on('did-start-navigation', navigating);
    }
    const id = appSessionId as AppSessionId;
    if (visible) page.ids.add(id);
    else page.ids.delete(id);
    refreshVisibility(id);
  });
  model.on('digest', (digest) => emit('session.digest', digest));

  const stops: (() => void)[] = [];
  if (mode === 'index') {
    // The renderer may still have an approval card after host loss. Never forward its stale answer.
    stops.push(interceptCommand('session.answer', async (input) => {
      const pending = model.allAttention().get(input.appSessionId as AppSessionId)?.some((item) => item.state === 'pending' && item.request.requestId === input.requestId);
      if (!pending) return { outcome: 'not_pending' };
      const result = await hosts.dispatch('engine-host', 'session.answer', input);
      if (!result.ok) throw new CommandFailure(result.error);
      return result.value as CommandOutput<'session.answer'>;
    }));
    // The index first: its records are observed before any batch or status for them is folded.
    if (indexSource) stops.push(model.register(indexSource));
    stops.push(model.register(emittedAttentionSource()));
    stops.push(model.register(emittedAppEventsSource())); // debt wave 5
    stops.push(model.register(hostEventSource(hosts)));
  } else {
    if (indexSource) model.register(indexSource); // refused unstarted (logged): the scenario is the only source
    // Attached before the stub, whose load emits the scenario's attention through the same tap.
    stops.push(model.registerScenario(emittedAttentionSource()));
    stops.push(model.registerScenario(emittedAppEventsSource())); // debt wave 5
    try {
      const path = scenarioPath(env, { packaged, appRoot });
      const clock = scenarioClock(env);
      const relay = <N extends EventName>(name: N, payload: EventPayload<N>) => emit(name, payload);
      stops.push(model.registerScenario(stubSource(path, clock, { emit: relay, intercept: interceptCommand })));
      console.log(`[sessions] launch mode scenario: ${path} on the ${clock.kind} clock`);
    } catch (error) {
      console.error('[sessions] the scenario could not be played; no sessions will show', error);
    }
  }
  return { model, stop: () => {
    for (const page of pages.values()) page.release();
    stops.forEach((stop) => stop());
  } };
}
