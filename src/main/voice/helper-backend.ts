// The helper backend (E9 execution document, Design §2): spawns the bundled Swift helper lazily on the first `probe` or
// `start`, waits for its `ready` line, and keeps it warm for later captures (a warm helper answers a hold in tens of
// milliseconds); after 10 idle minutes it sends `quit` and the next use respawns. A helper exit during a capture is that
// capture's `helper_crashed`. Every stdout line is validated against the protocol's schema; a line that fails is logged
// and dropped, never thrown into the service.
//
// Cancellation crosses the ready wait: `start` registers its capture before awaiting the helper, `cancel` flags it, and a
// flagged capture never writes its `start` line, so a hold released during a cold spawn never opens the microphone.
import { spawn as spawnChild } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { VoiceHelperState, VoiceStartResult, VoiceStatus } from '@shared/ipc/schema/voice';
import type { HelperEvent, VoiceBackend } from './backend';
import { encodeCommand, HelperEventSchema, isCaptureEvent, LineSplitter, type HelperCommand, type HelperProbe } from './protocol';

export const HELPER_READY_MS = 5_000; // from spawn to the `ready` line
export const HELPER_IDLE_MS = 10 * 60_000; // with nothing to do, the helper is asked to quit
export const HELPER_TERM_MS = 1_000; // after `quit`, SIGTERM
export const HELPER_KILL_MS = 3_000; // after `quit`, SIGKILL
export const HELPER_PROBE_CACHE_MS = 10_000; // the Settings tab and the toolbar do not re-probe on every render
export const HELPER_LINE_MAX = 64 * 1024; // a longer stdout line is dropped unread

// Where the helper lives: `MAWS_VOICE_HELPER` (a developer's own build, a test's), the packaged app's resources, or the
// development build `pnpm build:helper` writes under the app root.
export function helperPath({ env, packaged, resourcesPath, appRoot }: { env: NodeJS.ProcessEnv; packaged: boolean; resourcesPath: string; appRoot: string }): string {
  const named = env.MAWS_VOICE_HELPER;
  if (named) return isAbsolute(named) ? named : resolve(appRoot, named);
  if (packaged) return join(resourcesPath, 'voice-helper', 'maws-voice-helper');
  return join(appRoot, 'build', 'voice-helper', 'maws-voice-helper');
}

export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// What the backend needs of a child process; `child_process.spawn` with piped stdio is one.
export interface HelperChild {
  readonly stdin: { write(chunk: string): boolean; on(event: 'error', listener: (error: Error) => void): unknown };
  readonly stdout: { setEncoding(encoding: 'utf8'): unknown; on(event: 'data', listener: (chunk: string) => void): unknown };
  readonly stderr: { setEncoding(encoding: 'utf8'): unknown; on(event: 'data', listener: (chunk: string) => void): unknown };
  kill(signal: NodeJS.Signals): boolean;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface HelperBackendDeps {
  path: string;
  probeOnly: boolean; // under MAWS_E2E=1 without a script: `start` is refused, `probe` (never prompting) runs
  spawn?: (path: string) => HelperChild;
  executable?: (path: string) => boolean;
}

const spawnHelper = (path: string): HelperChild => spawnChild(path, [], { stdio: ['pipe', 'pipe', 'pipe'] });

interface Helper {
  child: HelperChild;
  ready: Promise<string | null>; // null once `ready` arrived, else why it never will
  isReady: boolean;
  settleReady(failure: string | null): void;
  probes: ((answer: HelperProbe | string) => void)[]; // FIFO: the helper answers probes in order
  exited: boolean;
}

interface Capture {
  id: string;
  sink: (event: HelperEvent) => void;
  cancelled: boolean;
  helper: Helper | null; // the helper its `start` line was written to; null while it awaits `ready`
  stopRequested: boolean;
}

const TERMINAL = new Set<HelperEvent['type']>(['final', 'cancelled', 'error']);

export class HelperBackend implements VoiceBackend {
  readonly kind = 'helper';
  private helper: Helper | null = null;
  private readonly captures = new Map<string, Capture>();
  private readonly probeCache = new Map<string, { at: number; status: VoiceStatus }>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly spawn: (path: string) => HelperChild;
  private readonly executable: (path: string) => boolean;

  constructor(private readonly deps: HelperBackendDeps) {
    this.spawn = deps.spawn ?? spawnHelper;
    this.executable = deps.executable ?? isExecutableFile;
  }

  async probe(locale: string | null): Promise<VoiceStatus> {
    const { path } = this.deps;
    const unprobed = (helper: VoiceHelperState): VoiceStatus => ({ helper, backend: 'helper', permission: null, systemLocale: null, locale, supportsOnDevice: null, locales: [] });
    if (!this.executable(path)) return unprobed({ state: 'missing', path });
    const key = locale ?? '';
    const cached = this.probeCache.get(key);
    if (cached && Date.now() - cached.at < HELPER_PROBE_CACHE_MS) return cached.status;
    const helper = this.ensure();
    const failure = await helper.ready;
    if (failure !== null) return unprobed({ state: 'failed', path, message: failure });
    this.clearIdle();
    const answer = await new Promise<HelperProbe | string>((resolve) => {
      helper.probes.push(resolve);
      this.write(helper, { cmd: 'probe', locale });
    });
    this.touch();
    if (typeof answer === 'string') return unprobed({ state: 'failed', path, message: answer });
    const status: VoiceStatus = {
      helper: { state: 'ready', path },
      backend: 'helper',
      permission: answer.permission,
      systemLocale: answer.systemLocale,
      locale: answer.locale,
      supportsOnDevice: answer.supportsOnDevice,
      locales: answer.locales,
    };
    this.probeCache.set(key, { at: Date.now(), status });
    return status;
  }

  async start(captureId: string, locale: string | null, sink: (event: HelperEvent) => void): Promise<VoiceStartResult> {
    const { path } = this.deps;
    if (this.deps.probeOnly) return { accepted: false, reason: 'e2e_refused', path: null };
    if (!this.executable(path)) return { accepted: false, reason: 'helper_missing', path };
    const capture: Capture = { id: captureId, sink, cancelled: false, helper: null, stopRequested: false };
    this.captures.set(captureId, capture); // before the first await, so a cancel during the ready wait finds it
    this.clearIdle();
    const helper = this.ensure();
    const failure = await helper.ready;
    if (capture.cancelled) return { accepted: false, reason: 'cancelled', path: null };
    if (failure !== null || helper.exited) {
      this.captures.delete(captureId);
      this.touch();
      return { accepted: false, reason: 'helper_failed', path };
    }
    capture.helper = helper;
    this.write(helper, { cmd: 'start', id: captureId, locale });
    if (capture.stopRequested) this.write(helper, { cmd: 'stop', id: captureId });
    return { accepted: true };
  }

  stop(captureId: string): void {
    const capture = this.captures.get(captureId);
    if (!capture) return;
    if (capture.helper) this.write(capture.helper, { cmd: 'stop', id: captureId });
    else capture.stopRequested = true; // written right after the start line
  }

  cancel(captureId: string): void {
    const capture = this.captures.get(captureId);
    if (!capture) return;
    capture.cancelled = true;
    this.captures.delete(captureId);
    if (capture.helper) this.write(capture.helper, { cmd: 'cancel', id: captureId });
    this.touch();
  }

  dispose(): void {
    this.clearIdle();
    for (const capture of this.captures.values()) capture.cancelled = true; // a start still awaiting ready writes nothing
    this.captures.clear();
    if (this.helper) this.retire(this.helper);
  }

  // The running helper, or a fresh one.
  private ensure(): Helper {
    if (this.helper && !this.helper.exited) return this.helper;
    let settleReady!: (failure: string | null) => void;
    const ready = new Promise<string | null>((resolve) => (settleReady = resolve));
    const child = this.spawn(this.deps.path); // a launch failure (ENOENT, EACCES) arrives as `error` below
    const helper: Helper = { child, ready, isReady: false, settleReady, probes: [], exited: false };
    this.helper = helper;
    const readyTimer = setTimeout(() => {
      if (helper.isReady || helper.exited) return;
      this.gone(helper, `the helper did not answer ready within ${HELPER_READY_MS / 1000} s`);
      child.kill('SIGKILL');
    }, HELPER_READY_MS);
    helper.ready.then(() => clearTimeout(readyTimer));

    child.stdout.setEncoding('utf8');
    const lines = new LineSplitter(HELPER_LINE_MAX, (line) => this.onLine(helper, line), (length) => console.warn(`[voice] dropped a helper line of ${length} characters (over ${HELPER_LINE_MAX})`));
    child.stdout.on('data', (chunk) => lines.push(chunk));
    child.stderr.setEncoding('utf8');
    const logs = new LineSplitter(HELPER_LINE_MAX, (line) => console.info(line), () => {});
    child.stderr.on('data', (chunk) => logs.push(chunk));
    child.stdin.on('error', (error) => console.warn('[voice] could not write to the helper', error.message));
    child.on('error', (error) => this.gone(helper, `the helper could not start: ${error.message}`));
    // `close`, not `exit`: every line the helper wrote before it exited is read first
    child.on('close', (code, signal) => this.gone(helper, `the helper exited (${signal ?? `code ${code}`})`));
    return helper;
  }

  private onLine(helper: Helper, line: string): void {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      console.warn('[voice] dropped a helper line that is not JSON', line.slice(0, 200));
      return;
    }
    const parsed = HelperEventSchema.safeParse(json);
    if (!parsed.success) {
      console.warn('[voice] dropped a helper line outside the protocol', line.slice(0, 200));
      return;
    }
    const event = parsed.data;
    if (event.type === 'ready') {
      helper.isReady = true;
      helper.settleReady(null);
      return;
    }
    if (event.type === 'probe') {
      helper.probes.shift()?.(event);
      return;
    }
    if (!isCaptureEvent(event)) return;
    const { id } = event;
    if (id === null) {
      console.warn('[voice] the helper refused a command it could not attribute to a capture', event); // only `error` has a null id
      return;
    }
    if (event.type === 'permission') this.probeCache.clear(); // the states a probe answered may have just changed
    const capture = this.captures.get(id);
    if (!capture || capture.helper !== helper) return; // a cancelled capture's, or one this helper never started
    if (TERMINAL.has(event.type)) this.captures.delete(id);
    capture.sink(event);
    if (TERMINAL.has(event.type)) this.touch();
  }

  // The helper is gone (it exited, never started, or never answered ready): whatever waited on it learns why.
  private gone(helper: Helper, message: string): void {
    if (helper.exited) return;
    helper.exited = true;
    if (this.helper === helper) this.helper = null;
    helper.settleReady(message);
    for (const answer of helper.probes.splice(0)) answer(message);
    for (const capture of [...this.captures.values()]) {
      if (capture.helper !== helper) continue;
      this.captures.delete(capture.id);
      capture.sink({ type: 'error', id: capture.id, code: 'helper_crashed', message });
    }
    this.touch();
  }

  private write(helper: Helper, command: HelperCommand): void {
    if (helper.exited) return;
    helper.child.stdin.write(encodeCommand(command));
  }

  // Asks the helper to quit; signals follow while it still runs.
  private retire(helper: Helper): void {
    if (this.helper === helper) this.helper = null;
    this.write(helper, { cmd: 'quit' });
    setTimeout(() => helper.exited || helper.child.kill('SIGTERM'), HELPER_TERM_MS);
    setTimeout(() => helper.exited || helper.child.kill('SIGKILL'), HELPER_KILL_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  // Re-arms the idle quit whenever the running helper has nothing to do.
  private touch(): void {
    this.clearIdle();
    const helper = this.helper;
    if (!helper || helper.exited || this.captures.size > 0 || helper.probes.length > 0) return;
    this.idleTimer = setTimeout(() => this.retire(helper), HELPER_IDLE_MS);
  }
}
