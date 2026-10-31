// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §B, §F; D28, D32): the app's side of the
// connectors, composed by main's root on both shapes over a scripted machine host: the window reporter's reports through
// main's own route, the one-time adoption at the right moment of each shape, and `connectors.reset` at each streaming of
// the machine host after the first (the daemon shape alone).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEALED_FORMAT_V1, SEALED_FORMAT_V2, type ConnectorOAuthSealer } from '@shared/connectors/sealer';
import { endableClientRef, type HandlerContext } from '@shared/ipc/client';
import type { CommandName, HostState } from '@shared/ipc/schema';
import { daemonStatus } from '../../../test/support/builders';
import { watchDaemon } from '../hosts/daemon';
import type { BeforeHook } from '../ipc/router';
import { adoptLegacyGrants } from './adoption';
import { startAppConnectors, type AppConnectors } from '.';

vi.mock('electron', () => ({ app: {}, safeStorage: {} })); // legacy-custody's production sealer, never used here

const ART = '11111111-1111-4111-8111-111111111111';

let hook: BeforeHook | null;
let invoked: { name: CommandName; input: unknown; client: string }[];
let emitted: [string, unknown][];
let adopt: ReturnType<typeof vi.fn<() => Promise<{ retry: boolean }>>>;
let logged: string[];
let streams: boolean;
let streamingListeners: Set<() => void>;
let connectors: AppConnectors;

function start(machine: boolean) {
  connectors = startAppConnectors({
    machine: machine
      ? {
          streaming: () => streams,
          onStreaming: (listener) => {
            streamingListeners.add(listener);
            return () => void streamingListeners.delete(listener);
          },
        }
      : null,
    windowShown: () => ({ shown: () => true, closed: () => false, onChange: () => () => {} }),
    invoke: (async (name: CommandName, input: unknown, context: HandlerContext) => {
      invoked.push({ name, input, client: context.client.id });
      return { ok: true, value: { ok: true } };
    }) as never,
    before: (_names, given) => {
      hook = given;
      return () => {
        hook = null;
      };
    },
    emit: (name, payload) => void emitted.push([name, payload]),
    adopt,
    log: (line) => void logged.push(line),
  });
}
const stream = () => {
  streams = true;
  for (const listener of [...streamingListeners]) listener();
};
const page = endableClientRef('page:3.1');
const lease = () => hook!('connectors.open', { artifactId: ART }, page);
const reports = () => invoked.filter((entry) => entry.name === 'connectors.windowShown');

beforeEach(() => {
  vi.useFakeTimers();
  hook = null;
  invoked = [];
  emitted = [];
  adopt = vi.fn(async () => ({ adopted: 0, left: 0, stopped: false, retry: false }));
  logged = [];
  streams = false;
  streamingListeners = new Set();
});
afterEach(() => {
  connectors.stop();
  vi.useRealTimers();
});

describe('the app’s connectors on the embedded shape', () => {
  it('adopts the legacy grants once, at once, and reports each page’s window through main’s own route under the page’s client', async () => {
    start(false);
    expect(adopt).toHaveBeenCalledOnce();
    await lease();
    expect(reports()).toEqual([{ name: 'connectors.windowShown', input: { shown: true }, client: page.id }]);
    expect(emitted).toEqual([]);
  });
});

describe('the app’s connectors on the daemon shape', () => {
  it('adopts at the machine host’s first streaming alone, and tells the windows connectors.reset at each one after it', async () => {
    start(true);
    expect(adopt).not.toHaveBeenCalled();
    stream();
    expect(adopt).toHaveBeenCalledOnce();
    expect(emitted).toEqual([]);
    stream(); // mawsd restarted
    stream();
    expect(adopt).toHaveBeenCalledOnce();
    expect(emitted).toEqual([['connectors.reset', {}], ['connectors.reset', {}]]);
  });

  it('adopts at once when the machine host already streams, and resets at its next streaming', () => {
    streams = true;
    start(true);
    expect(adopt).toHaveBeenCalledOnce();
    stream();
    expect(emitted).toEqual([['connectors.reset', {}]]);
  });

  it('marks every page unreported at a reset, so a rebuilt lease’s first command reports its window first', async () => {
    start(true);
    stream();
    await lease();
    await lease();
    expect(reports()).toHaveLength(1);
    stream(); // mawsd restarted: it holds no report
    expect(emitted).toEqual([['connectors.reset', {}]]);
    await lease(); // the rebuilt lease's first command
    await lease();
    expect(reports()).toHaveLength(2);
  });

  it('says so when the adoption fails, and never throws', async () => {
    adopt.mockRejectedValueOnce(new Error('the legacy directory could not be read'));
    start(true);
    stream();
    await vi.waitFor(() => expect(logged).toEqual([expect.stringContaining('the legacy directory could not be read')]));
  });

  // P5 O4 (whole-branch review): the updated app's first streaming can be a pre-O4 `mawsd`'s, before the build check
  // restarts it; that daemon answers `connectors.adoptGrant` unknown_command, so the pass runs again when the O4 one streams.
  it('adopts again at the next streaming when the machine could not take a record yet, besides the reset', async () => {
    adopt.mockResolvedValueOnce({ retry: true });
    start(true);
    stream(); // the pre-O4 mawsd
    await vi.advanceTimersByTimeAsync(0);
    expect(adopt).toHaveBeenCalledOnce();
    stream(); // the O4 mawsd the build check restarted it into
    expect(emitted).toEqual([['connectors.reset', {}]]);
    expect(adopt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    stream(); // the pass settled: a later restart only resets
    expect(adopt).toHaveBeenCalledTimes(2);
    expect(emitted).toEqual([['connectors.reset', {}], ['connectors.reset', {}]]);
  });

  it('never adopts again after a pass the sealer stopped, or one that failed', async () => {
    adopt.mockResolvedValueOnce({ adopted: 0, left: 1, stopped: true, retry: false } as never);
    start(true);
    stream();
    await vi.advanceTimersByTimeAsync(0);
    stream();
    stream();
    expect(adopt).toHaveBeenCalledOnce();
    connectors.stop();
    adopt.mockReset();
    adopt.mockRejectedValueOnce(new Error('the legacy directory could not be read'));
    streamingListeners.clear();
    streams = false;
    start(true);
    stream();
    await vi.advanceTimersByTimeAsync(0);
    stream();
    expect(adopt).toHaveBeenCalledOnce();
  });

  it('runs a pass the machine could not complete again at once when the machine host streamed while it ran', async () => {
    let finish!: (value: { retry: boolean }) => void;
    adopt.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    start(true);
    stream();
    stream(); // restarted while the first pass waits (on the Keychain's prompt, say)
    expect(adopt).toHaveBeenCalledOnce(); // never two passes at once
    expect(emitted).toEqual([['connectors.reset', {}]]);
    finish({ retry: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(adopt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    stream();
    expect(adopt).toHaveBeenCalledTimes(2);
  });

  it('at stop, runs no pass again', async () => {
    let finish!: (value: { retry: boolean }) => void;
    adopt.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    start(true);
    stream();
    stream();
    connectors.stop();
    finish({ retry: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(adopt).toHaveBeenCalledOnce();
    connectors = { stop: () => {} };
  });

  it('at stop, hears no streaming and stands before no command', () => {
    start(true);
    connectors.stop();
    stream();
    expect(adopt).not.toHaveBeenCalled();
    expect(hook).toBeNull();
    connectors = { stop: () => {} };
  });
});

// P5 O4 (whole-branch review), the reviewer's reproduction: the updated app attaches to a still-running pre-O4 `mawsd`.
// The production build check (watchDaemon) and adoption pass (adoptLegacyGrants over a scratch grant directory and a fake
// Electron sealer) under a scripted machine host: the old daemon streams first and answers `connectors.adoptGrant`
// unknown_command; the build check restarts it; the O4 one streams and adopts the grant, in the same launch.
describe('the updated app over a pre-O4 mawsd', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const THIS = 'mawsd00000000001';
  let root: string;
  beforeEach(() => {
    vi.useRealTimers();
    root = mkdtempSync(join(tmpdir(), 'maws-o4-adoption-restart-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('adopts the format 1 grant when the restarted O4 mawsd streams, and asks the sealer’s availability once per pass', async () => {
    const dir = join(root, 'connectors', 'oauth');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${A}.sealed`);
    writeFileSync(file, `${SEALED_FORMAT_V1}\n${Buffer.from(JSON.stringify({ version: 1, connectionId: A })).toString('base64')}\n`, { mode: 0o600 });
    const sealer = {
      format: SEALED_FORMAT_V1,
      available: vi.fn(async () => true),
      seal: vi.fn(async (text: string) => Buffer.from(text, 'utf8')),
      open: vi.fn(async (sealed: Buffer) => ({ text: sealed.toString('utf8'), reseal: false })),
    } satisfies ConnectorOAuthSealer;

    let build = 'older00000000000'; // the running daemon's
    const stateListeners = new Set<(state: HostState) => void>();
    const tell = (state: HostState['state']) => {
      for (const listener of [...stateListeners]) listener({ state, pid: 1, restarts: 0, revision: 1 });
    };
    const answered: string[] = [];
    let oldAnswered!: () => void;
    const oldAnsweredOnce = new Promise<void>((resolve) => (oldAnswered = resolve));
    const route = (async (name: CommandName, input: { connectionId: string }) => {
      if (name !== 'connectors.adoptGrant') return { ok: true, value: { ok: true } };
      answered.push(build);
      if (build !== THIS) {
        oldAnswered();
        return { ok: false, error: { code: 'unknown_command', message: `unknown command: ${name}` } };
      }
      writeFileSync(file, `${SEALED_FORMAT_V2}\nresealed\n`); // the machine's conditional replacement
      return { ok: true, value: { adopted: true, connectionId: input.connectionId } };
    }) as never;
    let restarted!: () => void;
    const restartedOnce = new Promise<void>((resolve) => (restarted = resolve));
    const hosts = {
      onState: (owner: string, listener: (state: HostState) => void) => {
        if (owner === 'machine') stateListeners.add(listener);
        return () => void stateListeners.delete(listener);
      },
      dispatch: async (_owner: string, name: string) => {
        if (name === 'daemon.status') return { ok: true as const, value: daemonStatus({ build: { ...daemonStatus().build, buildId: build } }) };
        // the restart takes longer than the old daemon's first answer; then the O4 one is ready and streams
        void oldAnsweredOnce.then(() => {
          streams = false;
          tell('restarting');
          build = THIS;
          tell('ready');
          stream();
          restarted();
        });
        return { ok: true as const, value: undefined };
      },
      expectExit: () => true,
    };
    const watch = watchDaemon({ hosts: hosts as never, buildId: THIS, unitRunsThisApp: () => true, onChange: () => {}, log: (line) => void logged.push(line) });
    connectors = startAppConnectors({
      machine: { streaming: () => streams, onStreaming: (listener) => (streamingListeners.add(listener), () => void streamingListeners.delete(listener)) },
      windowShown: () => null,
      invoke: route,
      before: () => () => {},
      emit: (name, payload) => void emitted.push([name, payload]),
      adopt: () => adoptLegacyGrants({ directory: dir, sealer, invoke: route, log: (line) => void logged.push(line) }),
      log: (line) => void logged.push(line),
    });

    tell('ready'); // the pre-O4 daemon: the build check reads its status
    stream(); // and the adoption asks it
    await restartedOnce;
    await vi.waitFor(() => expect(readFileSync(file, 'utf8').startsWith(`${SEALED_FORMAT_V2}\n`)).toBe(true));
    expect(answered).toEqual(['older00000000000', THIS]);
    expect(emitted).toEqual([['connectors.reset', {}]]);
    expect(sealer.available).toHaveBeenCalledTimes(2); // one pass per streaming; the real sealer's key is in hand by then
    expect(logged).toContain('[connectors] adopted 0 of 1 legacy grants; left: unknown_command 1');
    expect(logged).toContain('[connectors] adopted 1 of 1 legacy grants');
    watch.stop();
  });
});
