// Main's handlers for the session service's X2 commands (C10 execution document, "X2 additions"), kept apart from the
// service so `SessionService` stays free of Electron for its tests; registered on the services bus (P5 O3-C). A refused intent command maps to X2's envelope: an
// invalid field is `invalid_input` with the field in `issues`; `starting`, `retained_worktree` and the rest are
// `internal` with their message. Anything else a handler throws is `internal` at the router (a fail-closed holder
// read's `holder registry unreadable: …` included).
import type { AppSessionId, MessageUuid, ProjectId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { SetupIntentPatch } from '@shared/sessions/intent';
import type { HostState } from '@shared/ipc/schema';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import { HostCommandError } from '@shared/host/runtime';
import type { ServicesBus } from '@shared/spine/bus';
import { IntentRefused, type SessionService } from './service';
import { HostError } from './context'; // P2-A
import { InvalidSideInput } from '../side/invalid'; // E3
import type { LaunchMode } from '@shared/sessions/select-source'; // P5 O3-D M4
import { CONVERSATION_ACTS } from './rewind-note'; // P5 O3-D M4

// The runtime hands a handler the schema's parsed value; the ids in it passed the branded id schemas, which is what the
// brands stand for (as C4's handlers read them).
// P5 O3-D M4 (D18): in launch mode `index` the rewind's last-act note and the conversation acts that clear it are
// intercepted on their way to the engine host (rewind-note.ts), and from M5a (D47) lane B's claimed `host.op` that runs
// one of them; in mode `scenario` no engine runs, and the e2e fixture
// seams intercept some of those names themselves. Answers the intercepts' removal, for the root's stop.
export function registerSessionServiceHandlers(service: SessionService, { register, intercept }: Pick<ServicesBus, 'register' | 'intercept'>, mode: LaunchMode): () => void {
  const id = (appSessionId: string) => appSessionId as AppSessionId;
  register('session.trust.check', ({ directory }) => service.trustCheck(directory));
  register('session.create', ({ projectId, location }) => relay(() => service.create({ projectId: projectId as ProjectId | null, location })));
  register('session.intent.get', ({ appSessionId }) => service.getIntent(id(appSessionId)));
  register('session.intent.list', async () => ({ intents: await service.listIntents() }));
  register('session.intent.patch', ({ appSessionId, patch }) => relay(() => service.patch(id(appSessionId), patch as SetupIntentPatch)));
  register('session.intent.release', ({ appSessionId }) => relay(() => service.release(id(appSessionId))));
  register('session.intent.discard', ({ appSessionId }) => relay(() => service.discard(id(appSessionId))));
  register('session.intent.resolveWorktree', ({ appSessionId, resolution }) => relay(() => service.resolveRetainedWorktree(id(appSessionId), resolution)));
  register('session.start', ({ appSessionId, message, options }) => relay(() => service.startSession(id(appSessionId), { message, options })));
  // P2-A (X16): the one acquisition entry; a host that cannot answer is `host_unavailable`, so the supervisor's banner
  // returns for it as for the other launches (LAUNCHES in supervisor-notices.ts)
  register('session.acquire', ({ appSessionId, reason, options }) => relayHost(() => service.acquire(id(appSessionId), reason, options)));
  register('session.fork', ({ appSessionId, target, message, rewindTo }) =>
    relay(() => service.fork(id(appSessionId), target, { message, rewindTo: rewindTo as MessageUuid | null })),
  );
  register('session.archive', ({ appSessionId, onlyIfIdle }) => service.archive(id(appSessionId), { onlyIfIdle }));
  register('session.takeOverPane', ({ pid }) => service.takeOverPane(pid));
  register('session.takeOver', ({ appSessionId, holder, paneId }) => service.takeOver(id(appSessionId), holder, paneId)); // W7
  register('session.delete', ({ appSessionId, stopIfLive }) => service.remove(id(appSessionId), stopIfLive));
  register('session.rename', ({ appSessionId, title }) => service.rename(id(appSessionId), title));
  register('session.revealPath', ({ path }, { client }) => service.revealPath(path, client));
  register('session.deletions.list', async () => ({ manifests: await service.listDeletions() }));
  register('session.deletions.keep', ({ appSessionId }) => service.keepDeletion(id(appSessionId)));
  register('session.deletions.preview', ({ appSessionId }) => service.previewDeletion(id(appSessionId)));
  // E3 start: the side namespace's main commands (E3 execution document, Design §3, §8 and §9)
  register('side.thread.open', ({ appSessionId, from }) => relaySide(['from'], () => service.openSideThread(id(appSessionId), from)));
  register('side.sendToMain', (input) => relaySide([], () => service.sendToMain(input)));
  register('side.screenshot.preview', ({ appSessionId, screenshot }) => relaySide([], () => service.screenshotPreview(id(appSessionId), screenshot.path))); // E11 F2b (Q4)
  // E3 end
  // P5 O3-D M4 start
  if (mode !== 'index') return () => {};
  const removals = [
    intercept('session.rewind', (input) => service.rewind(input)),
    ...CONVERSATION_ACTS.map((name) => intercept(name, (input) => service.conversationAct(name, input))),
    intercept('host.op', (input) => service.claimedOp(input)), // P5 O3-D M5a (D47): a phone's act, claimed in the engine host's op ledger
  ];
  return () => {
    for (const remove of removals) remove();
  };
  // P5 O3-D M4 end
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
    throw new HostCommandError(ipcError('invalid_input', error.message, [{ path: [...at, ...error.path], message: error.message }]));
  }
}

// P2-A: the engine host's own `host_unavailable` keeps its code across main's handler; every other throw is `internal`.
async function relayHost<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof HostError && error.code === 'host_unavailable') throw new HostCommandError(ipcError('host_unavailable', error.message));
    throw error;
  }
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof IntentRefused) {
      throw new HostCommandError(
        error.reason === 'invalid' ? ipcError('invalid_input', error.message, [{ path: ['patch', error.field ?? 'location'], message: error.message }]) : ipcError('internal', error.message),
      );
    }
    throw error;
  }
}
