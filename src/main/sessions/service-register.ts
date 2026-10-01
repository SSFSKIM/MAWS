// Main's handlers for the session service's X2 commands (C10 execution document, "X2 additions"), kept apart from the
// service so `SessionService` stays free of Electron for its tests. A refused intent command maps to X2's envelope: an
// invalid field is `invalid_input` with the field in `issues`; `starting`, `retained_worktree` and the rest are
// `internal` with their message. Anything else a handler throws is `internal` at the router (a fail-closed holder
// read's `holder registry unreadable: …` included).
import type { AppSessionId, MessageUuid, ProjectId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { SetupIntentPatch } from '@shared/sessions/intent';
import type { HostState } from '@shared/ipc/schema';
import type { HostSupervisor } from '../hosts/supervisor';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import { IntentRefused, type SessionService } from './service';

// The runtime hands a handler the schema's parsed value; the ids in it passed the branded id schemas, which is what the
// brands stand for (as C4's handlers read them).
export function registerSessionServiceHandlers(service: SessionService): void {
  const id = (appSessionId: string) => appSessionId as AppSessionId;
  registerMainHandler('session.trust.check', ({ directory }) => service.trustCheck(directory));
  registerMainHandler('session.create', ({ projectId, location }) => relay(() => service.create({ projectId: projectId as ProjectId | null, location })));
  registerMainHandler('session.intent.get', ({ appSessionId }) => service.getIntent(id(appSessionId)));
  registerMainHandler('session.intent.list', async () => ({ intents: await service.listIntents() }));
  registerMainHandler('session.intent.patch', ({ appSessionId, patch }) => relay(() => service.patch(id(appSessionId), patch as SetupIntentPatch)));
  registerMainHandler('session.intent.release', ({ appSessionId }) => relay(() => service.release(id(appSessionId))));
  registerMainHandler('session.intent.discard', ({ appSessionId }) => relay(() => service.discard(id(appSessionId))));
  registerMainHandler('session.intent.resolveWorktree', ({ appSessionId, resolution }) => relay(() => service.resolveRetainedWorktree(id(appSessionId), resolution)));
  registerMainHandler('session.start', ({ appSessionId, message, options }) => relay(() => service.startSession(id(appSessionId), { message, options })));
  registerMainHandler('session.fork', ({ appSessionId, target, message, rewindTo }) =>
    relay(() => service.fork(id(appSessionId), target, { message, rewindTo: rewindTo as MessageUuid | null })),
  );
  registerMainHandler('session.archive', ({ appSessionId, onlyIfIdle }) => service.archive(id(appSessionId), { onlyIfIdle }));
  registerMainHandler('session.takeOver', ({ appSessionId, holder }) => service.takeOver(id(appSessionId), holder)); // W7
  registerMainHandler('session.delete', ({ appSessionId, stopIfLive }) => service.remove(id(appSessionId), stopIfLive));
  registerMainHandler('session.rename', ({ appSessionId, title }) => service.rename(id(appSessionId), title));
  registerMainHandler('session.revealPath', ({ path }) => service.revealPath(path));
  registerMainHandler('session.deletions.list', async () => ({ manifests: await service.listDeletions() }));
  registerMainHandler('session.deletions.keep', ({ appSessionId }) => service.keepDeletion(id(appSessionId)));
  registerMainHandler('session.deletions.preview', ({ appSessionId }) => service.previewDeletion(id(appSessionId)));
}

// The engine host answers: its first launch is ready, or it has given up (a crashed host answers `host_unavailable`,
// which the service records per intent rather than waiting forever).
export function engineHostSettled(hosts: Pick<HostSupervisor, 'snapshot' | 'onState'>): Promise<void> {
  return new Promise((resolve) => {
    const settled = (state: HostState) => state.state === 'ready' || state.state === 'crashed';
    if (settled(hosts.snapshot('engine-host'))) return resolve();
    const off = hosts.onState('engine-host', (state) => {
      if (!settled(state)) return;
      off();
      resolve();
    });
  });
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof IntentRefused) {
      throw new CommandFailure(
        error.reason === 'invalid' ? ipcError('invalid_input', error.message, [{ path: ['patch', error.field ?? 'location'], message: error.message }]) : ipcError('internal', error.message),
      );
    }
    throw error;
  }
}
