// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §B, §F; D28, D32): the app's side of the
// connectors, composed by main's root on both shapes over a scripted machine host: the window reporter's reports through
// main's own route, the one-time adoption at the right moment of each shape, and `connectors.reset` at each streaming of
// the machine host after the first (the daemon shape alone).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef, type HandlerContext } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import type { BeforeHook } from '../ipc/router';
import { startAppConnectors, type AppConnectors } from '.';

const ART = '11111111-1111-4111-8111-111111111111';

let hook: BeforeHook | null;
let invoked: { name: CommandName; input: unknown; client: string }[];
let emitted: [string, unknown][];
let adopt: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
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
  adopt = vi.fn(async () => ({ adopted: 0, left: 0, stopped: false }));
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

  it('at stop, hears no streaming and stands before no command', () => {
    start(true);
    connectors.stop();
    stream();
    expect(adopt).not.toHaveBeenCalled();
    expect(hook).toBeNull();
    connectors = { stop: () => {} };
  });
});
