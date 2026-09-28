// Wires the read side into main (C5): decides the launch mode once, creates the read model, answers `session.digests`
// and `session.setVisible`, relays every digest as `session.digest`, and attaches the sources the mode allows. In mode
// `index` that is the engine host's event feed below (C4's `IndexSessionSource` registers itself from C4's block); in
// mode `scenario` only the stub source, which the read model is the only way to attach.
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { HostSupervisor } from '../hosts/supervisor';
import { emit, onEmitted } from '../ipc/events';
import { interceptCommand, registerMainHandler } from '../ipc/router';
import { SessionReadModel, type SessionSource } from './read-model';
import { launchMode, scenarioClock, scenarioPath } from './select-source';
import { stubSource } from './stub-source';

export interface SessionsOptions {
  env: Record<string, string | undefined>;
  packaged: boolean;
  appRoot: string;
  hosts: Pick<HostSupervisor, 'onEvent'>;
}

export interface Sessions {
  model: SessionReadModel;
  stop(): void;
}

// C3's event batches and statuses on the re-emit path: the digest fold and the process table the quit guard reads.
export function hostEventSource(hosts: Pick<HostSupervisor, 'onEvent'>): SessionSource {
  return {
    start(writer) {
      const offs = [
        hosts.onEvent('session.eventBatch', ({ appSessionId, events }) => writer.fold(appSessionId, events)),
        hosts.onEvent('session.status', ({ status }) => writer.applyEngineStatus(status)),
      ];
      return () => offs.forEach((off) => off());
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

export function startSessions({ env, packaged, appRoot, hosts }: SessionsOptions): Sessions {
  const mode = launchMode(env, packaged);
  const model = new SessionReadModel(mode);
  registerMainHandler('session.digests', () => ({ digests: model.digests() }));
  registerMainHandler('session.launchMode', () => ({ mode }));
  registerMainHandler('session.setVisible', ({ appSessionId, visible }) => model.setVisible(appSessionId as AppSessionId, visible));
  model.on('digest', (digest) => emit('session.digest', digest));

  const stops: (() => void)[] = [];
  if (mode === 'index') {
    stops.push(model.register(emittedAttentionSource()));
    stops.push(model.register(hostEventSource(hosts)));
  } else {
    // Attached before the stub, whose load emits the scenario's attention through the same tap.
    stops.push(model.registerScenario(emittedAttentionSource()));
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
  return { model, stop: () => stops.forEach((stop) => stop()) };
}
