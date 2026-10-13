// P3-A M5: main's `artifacts.resync`, its one reconcile hook for a view that mirrors the store: announced each time the
// engine host's connection starts streaming, in either mode, and no more once the artifacts' side is stopped.
import { describe, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => {
  const make = () => ({ protocol: { handle: vi.fn() } });
  return { default: make(), capture: make(), partitions: [] as string[] };
});
vi.mock('electron', () => ({
  MessageChannelMain: class {},
  session: {
    defaultSession: sessions.default,
    fromPartition: (name: string) => {
      sessions.partitions.push(name);
      return sessions.capture;
    },
  },
}));

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
      onEvent: vi.fn(() => () => {}),
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
      root: '/tmp/artifacts',
    });
    streaming.forEach((listener) => listener());
    streaming.forEach((listener) => listener());
    expect(emit.mock.calls).toEqual([['artifacts.resync', {}], ['artifacts.resync', {}]]);
    started.stop();
    expect(streaming).toEqual([]);
  });

  it('serves maws-artifact: on the window’s session and the capture partition, registers artifacts.export and an html artifact’s PDF and PNG, and listens for the host’s exports (M7)', () => {
    const register = vi.fn();
    const onEvent = vi.fn(() => () => {});
    const hosts = { dispatch: vi.fn(), postDocPort: vi.fn(), closeDocPorts: vi.fn(), snapshot: () => ({ state: 'starting', pid: null, restarts: 0, revision: 0 }), onState: () => () => {}, onStreaming: () => () => {}, onEvent };
    const started = startArtifacts({ hosts: hosts as unknown as ArtifactsDeps['hosts'], register: register as never, emit: vi.fn() as never, settings: () => ({}) as never, onSettingsChanged: () => () => {}, env: {}, openWindow: vi.fn() as never, root: '/tmp/artifacts' });
    expect(sessions.default.protocol.handle).toHaveBeenCalledWith('maws-artifact', expect.any(Function));
    expect(sessions.capture.protocol.handle).toHaveBeenCalledWith('maws-artifact', expect.any(Function));
    expect(sessions.partitions).toContain('maws-capture');
    expect(register.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining(['artifacts.open', 'artifacts.export']));
    expect(onEvent).toHaveBeenCalledWith('maws.artifact.export', expect.any(Function));
    expect(started.exporters.get('html', 'pdf')).toMatchObject({ kind: 'html', format: 'pdf' });
    expect(started.exporters.get('html', 'png')).toMatchObject({ kind: 'html', format: 'png' });
    expect(started.exporters.get('document', 'pdf')).toBeUndefined();
    started.stop();
    expect(started.exporters.get('html', 'pdf')).toBeUndefined();
  });
});
