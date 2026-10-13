// P3-A M5: main's `artifacts.resync`, its one reconcile hook for a view that mirrors the store: announced each time the
// engine host's connection starts streaming, in either mode, and no more once the artifacts' side is stopped.
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ MessageChannelMain: class {} }));

import { startArtifacts, type ArtifactsDeps } from '.';

describe('startArtifacts', () => {
  it('announces artifacts.resync at every start of the engine host’s stream, until stopped', () => {
    const streaming: (() => void)[] = [];
    const emit = vi.fn(() => true);
    const hosts = {
      dispatch: vi.fn(),
      postDocPort: vi.fn(),
      closeDocPorts: vi.fn(),
      snapshot: () => ({ state: 'starting', pid: null, restarts: 0, revision: 0 }),
      onState: () => () => {},
      onStreaming: (owner: string, listener: () => void) => {
        expect(owner).toBe('engine-host');
        streaming.push(listener);
        return () => void streaming.splice(streaming.indexOf(listener), 1);
      },
    };
    const started = startArtifacts({
      hosts: hosts as unknown as ArtifactsDeps['hosts'],
      register: vi.fn() as never,
      emit: emit as never,
      settings: () => ({}) as never,
      onSettingsChanged: () => () => {},
      env: {},
      openWindow: vi.fn() as never,
    });
    streaming.forEach((listener) => listener());
    streaming.forEach((listener) => listener());
    expect(emit.mock.calls).toEqual([['artifacts.resync', {}], ['artifacts.resync', {}]]);
    started.stop();
    expect(streaming).toEqual([]);
  });
});
