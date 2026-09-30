// The session service under test (C10 execution document, M3 pins: "vitest node with a fake host answering C3's
// commands from scripts, the real index on a temp file, a scratch repository, a temp CLAUDE_CONFIG_DIR with a
// synthetic `.claude.json`"): C4's real index and its session source folding the fake host's statuses (so a launch's
// pin binds the record as it would live), the real worktree service over a scratch-repository git runner, the real
// intent store under a temp userData, and a temp HOME. `restart()` is the app quitting and starting again over the same
// disk: a new service, a new host with an empty process table, the same index file, intents and store files.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppSessionId, SessionId } from '../../src/shared/graph/ids';
import type { EventName, EventPayload } from '../../src/shared/ipc/schema';
import type { SetupIntent } from '../../src/shared/sessions/intent';
import type { SetupEvent } from '../../src/shared/sessions/setup';
import { slugOf } from '../../src/engine-host/fs/paths';
import { createGitRunner } from '../../src/main/git/runner';
import { WorktreeService } from '../../src/main/git/worktrees';
import { Index } from '../../src/main/index/index';
import { IndexSessionSource } from '../../src/main/index/source';
import { BootstrapNotes, FileIntentStore } from '../../src/main/sessions/intents';
import { SessionService } from '../../src/main/sessions/service';
import type { SessionServiceDeps } from '../../src/main/sessions/context'; // C12
import type { C10Settings } from '../../src/main/sessions/launch-mapping';
import type { ReplaySeam } from '../../src/main/sessions/replay-seam';
import { FakeEngineHost } from './session-host';
import { TrustStoreFixture } from './trust-store';

const noopWriter = { observeRecord: () => {}, observeRemoved: () => {}, observeProject: () => {}, observeProjectRemoved: () => {}, setDigest: () => {} };

export interface HarnessOptions {
  settings?: () => C10Settings;
  replay?: ReplaySeam | null;
  watchdogMs?: number;
  stopWaitMs?: number;
  launchGate?: SessionServiceDeps['launchGate']; // C12: main's custody gate
}

export class SessionHarness {
  readonly root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-c10-service-')));
  readonly userData = join(this.root, 'userData');
  readonly home = join(this.root, 'home');
  readonly work = join(this.root, 'work'); // a plain directory, not a repository
  readonly trust = new TrustStoreFixture();
  readonly index: Index;
  readonly events: { name: string; payload: unknown }[] = [];
  readonly trashed: string[] = [];
  trashFails: ((path: string) => string | null) | null = null;
  // A crash point: a write the gate matches never completes (the app died before it landed). The gate belongs to one
  // boot's intent store: after `restart()` the old run stays hung at it for good (a dead app writes nothing more), and
  // the new boot starts with an open gate. `gateReached` says the old run got there, which is the crash point itself;
  // the intent file on disk is not, because a rename is visible before the writer's continuation runs.
  private gate = new CrashGate();
  get hangPut(): CrashGate['hangPut'] {
    return this.gate.hangPut;
  }
  set hangPut(match: CrashGate['hangPut']) {
    this.gate.hangPut = match;
  }
  get hangRemove(): boolean {
    return this.gate.hangRemove;
  }
  set hangRemove(hang: boolean) {
    this.gate.hangRemove = hang;
  }
  get gateReached(): boolean {
    return this.gate.reached;
  }
  host: FakeEngineHost;
  service!: SessionService;
  worktrees!: WorktreeService; // the instance the service holds (a test may wrap its methods)
  private stopSource: () => void = () => {};

  constructor(private readonly opts: HarnessOptions = {}) {
    mkdirSync(this.userData, { recursive: true });
    mkdirSync(this.home, { recursive: true });
    mkdirSync(this.work, { recursive: true });
    this.index = new Index(join(this.userData, 'index.sqlite'));
    this.host = new FakeEngineHost();
    this.boot();
  }

  get env(): NodeJS.ProcessEnv {
    return { PATH: process.env.PATH, HOME: this.home, CLAUDE_CONFIG_DIR: this.trust.configHome };
  }

  private boot(): void {
    const source = new IndexSessionSource(this.index, this.host, { emit: (name, payload) => this.record(name, payload), tickMs: 1 });
    this.stopSource = source.start(noopWriter);
    const git = createGitRunner({ env: { PATH: process.env.PATH, HOME: this.home } });
    const worktrees = (this.worktrees = new WorktreeService({ git, holders: { dispatch: this.host.dispatch, sessions: this.index.sessions } }));
    this.service = new SessionService({
      index: this.index,
      host: { dispatch: this.host.dispatch, onEvent: this.host.onEvent },
      git,
      worktrees,
      intents: gatedIntents(new FileIntentStore(join(this.userData, 'sessions', 'intents')), this.gate),
      bootstraps: new BootstrapNotes(join(this.userData, 'sessions', 'bootstraps')),
      userData: this.userData,
      env: this.env,
      emit: (name, payload) => this.record(name, payload),
      trash: async (path) => {
        const failure = this.trashFails?.(path) ?? null;
        if (failure !== null) throw new Error(failure);
        rmSync(path, { recursive: true, force: true });
        this.trashed.push(path);
      },
      reveal: () => {},
      replay: this.opts.replay ?? null,
      settings: this.opts.settings,
      launchGate: this.opts.launchGate, // C12
      timing: { watchdogMs: this.opts.watchdogMs ?? 2_000, stopWaitMs: this.opts.stopWaitMs ?? 200 },
      log: () => {},
    });
  }

  private record<N extends EventName>(name: N, payload: EventPayload<N>): boolean {
    this.events.push({ name, payload });
    return true;
  }

  async start(): Promise<this> {
    await this.service.start();
    return this;
  }

  // The app quits and starts again: nothing it ran survives but the disk.
  async restart(): Promise<void> {
    this.gate = new CrashGate(); // the old store keeps its own, still closed
    this.service.dispose();
    this.stopSource();
    this.host = this.host.afterRestart();
    this.boot();
    await this.service.start();
  }

  setupEvents(appSessionId: string): SetupEvent[] {
    return this.events.filter((e) => e.name === 'session.setup' && (e.payload as SetupEvent).appSessionId === appSessionId).map((e) => e.payload as SetupEvent);
  }

  // Resolves when the setup of `appSessionId` has told `ready` or `failed` (after the n-th such end, counting from 1).
  async settled(appSessionId: string, nth = 1, timeoutMs = 5_000): Promise<SetupEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const ends = this.setupEvents(appSessionId).filter((e) => e.phase === 'ready' || e.phase === 'failed');
      if (ends.length >= nth) return ends[nth - 1]!;
      if (Date.now() > deadline) throw new Error(`no end of setup ${nth} for ${appSessionId}; phases: ${this.setupEvents(appSessionId).map((e) => `${e.phase}:${e.detail}`).join(', ')}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  removed(appSessionId: string): boolean {
    return this.events.some((e) => e.name === 'session.removed' && (e.payload as { appSessionId: string }).appSessionId === appSessionId);
  }

  // The transcript a launch in `cwd` pinned to `sessionId` would write under the temp config home.
  writeTranscript(cwd: string, sessionId: SessionId | string, lines = '{"type":"user"}\n'): string {
    const path = join(this.trust.configHome, 'projects', slugOf(realpathSync(cwd)), `${sessionId}.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, lines);
    return path;
  }

  trustDirectory(...directories: string[]): void {
    this.trust.write(Object.fromEntries(directories.map((d) => [d, { hasTrustDialogAccepted: true }])));
  }

  dir(name: string): string {
    const path = join(this.root, name);
    mkdirSync(path, { recursive: true });
    return path;
  }

  dispose(): void {
    this.service.dispose();
    this.stopSource();
    this.index.close();
    this.trust.dispose();
    rmSync(this.root, { recursive: true, force: true });
  }
}

export const idOf = (s: string) => s as AppSessionId;

// One boot's crash point: a matching `put`, or any `remove`, never completes; `reached` once one was held there.
class CrashGate {
  hangPut: ((intent: SetupIntent) => boolean) | null = null;
  hangRemove = false;
  reached = false;
}

function gatedIntents(store: FileIntentStore, gate: CrashGate): FileIntentStore {
  const put = store.put.bind(store);
  const remove = store.remove.bind(store);
  const hold = () => {
    gate.reached = true;
    return new Promise<never>(() => {});
  };
  store.put = (intent) => (gate.hangPut?.(intent) ? hold() : put(intent));
  store.remove = (id) => (gate.hangRemove ? hold() : remove(id));
  return store;
}
