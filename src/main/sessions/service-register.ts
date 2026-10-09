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
import { HostError } from './context'; // P2-A
import { InvalidSideInput } from '../side/invalid'; // E3

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
  // P2-A (X16): the one acquisition entry; a host that cannot answer is `host_unavailable`, so the supervisor's banner
  // returns for it as for the other launches (LAUNCHES in supervisor-notices.ts)
  registerMainHandler('session.acquire', ({ appSessionId, reason, options }) => relayHost(() => service.acquire(id(appSessionId), reason, options)));
  registerMainHandler('session.fork', ({ appSessionId, target, message, rewindTo }) =>
    relay(() => service.fork(id(appSessionId), target, { message, rewindTo: rewindTo as MessageUuid | null })),
  );
  registerMainHandler('session.archive', ({ appSessionId, onlyIfIdle }) => service.archive(id(appSessionId), { onlyIfIdle }));
  registerMainHandler('session.takeOverPane', ({ pid }) => service.takeOverPane(pid));
  registerMainHandler('session.takeOver', ({ appSessionId, holder, paneId }) => service.takeOver(id(appSessionId), holder, paneId)); // W7
  registerMainHandler('session.delete', ({ appSessionId, stopIfLive }) => service.remove(id(appSessionId), stopIfLive));
  registerMainHandler('session.rename', ({ appSessionId, title }) => service.rename(id(appSessionId), title));
  registerMainHandler('session.revealPath', ({ path }) => service.revealPath(path));
  registerMainHandler('session.deletions.list', async () => ({ manifests: await service.listDeletions() }));
  registerMainHandler('session.deletions.keep', ({ appSessionId }) => service.keepDeletion(id(appSessionId)));
  registerMainHandler('session.deletions.preview', ({ appSessionId }) => service.previewDeletion(id(appSessionId)));
  // E3 start: the side namespace's main commands (E3 execution document, Design §3, §8 and §9)
  registerMainHandler('side.thread.open', ({ appSessionId, from }) => relaySide(['from'], () => service.openSideThread(id(appSessionId), from)));
  registerMainHandler('side.sendToMain', (input) => relaySide([], () => service.sendToMain(input)));
  registerMainHandler('side.screenshot.preview', ({ appSessionId, screenshot }) => relaySide([], () => service.screenshotPreview(id(appSessionId), screenshot.path))); // E11 F2b (Q4)
  // E3 end
}

// The engine host answers: its first launch is ready, or it has given up (a crashed host answers `host_unavailable`,
// which the service records per intent rather than waiting forever).
// E10: ready means streaming (after main's resync and the `ready` line): the boot's commands whose effect reaches main
// only as an event (`session.forget`'s `session.forgotten`, which retires the id's attention) are sent once the host's
// events reach main.
export function engineHostSettled(hosts: Pick<HostSupervisor, 'snapshot' | 'onState' | 'onStreaming' | 'streaming'>): Promise<void> {
  return new Promise((resolve) => {
    const crashed = (state: HostState) => state.state === 'crashed';
    if (hosts.streaming('engine-host') || crashed(hosts.snapshot('engine-host'))) return resolve();
    const settle = () => {
      offs.forEach((off) => off());
      resolve();
    };
    const offs = [hosts.onState('engine-host', (state) => crashed(state) && settle()), hosts.onStreaming('engine-host', settle)];
  });
}

// E3: a side input main refuses (a screenshot, an oversized first message) is `invalid_input` at its path under `at`,
// where the command's input holds the comment; every other refusal, the host's included, stays `internal`, verbatim.
async function relaySide<T>(at: string[], call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof InvalidSideInput)) throw error;
    throw new CommandFailure(ipcError('invalid_input', error.message, [{ path: [...at, ...error.path], message: error.message }]));
  }
}

// P2-A: the engine host's own `host_unavailable` keeps its code across main's handler; every other throw is `internal`.
async function relayHost<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof HostError && error.code === 'host_unavailable') throw new CommandFailure(ipcError('host_unavailable', error.message));
    throw error;
  }
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
