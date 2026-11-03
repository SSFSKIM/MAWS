// The render seam's handle on mawsd's run path (P5 O5 M4; acceptance 8): nothing of the seam's chunk loads before the
// first request; a request the chunk could not load for is answered in the asker's shape with the reason, and the next
// request tries again; from stop() on a request is refused at once and nothing loads.
import { describe, expect, it } from 'vitest';
import { HostCommandError } from '@shared/host/runtime';
import type { MawsArtifactCapture } from '@shared/ipc/schema/maws';
import { createRenderHandle, type RenderChunk } from './render-handle';
import type { RenderSeam } from './render-seam';

const ARTIFACT = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const capture: MawsArtifactCapture = { appSessionId: 'app-1' as never, requestId: 'req-1' as never, artifactId: ARTIFACT, revision: 1, width: 640, height: 480 };

function fakeSeam(taken: string[]): RenderSeam {
  return {
    state: () => 'off',
    capture: (request) => void taken.push(`capture ${request.requestId}`),
    captureForE2e: async () => ({ ok: true, png: 'x', width: 1, height: 1, consoleErrors: [] }),
    export: (request) => void taken.push(`export ${request.requestId}`),
    exportForLibrary: async () => ({ path: '/p/x.pdf' }) as never,
    clientReady: () => void taken.push('ready'),
    clientGone: () => void taken.push('gone'),
    answer: () => true,
    capabilities: () => ({ artifact_screenshot: { available: true }, artifact_export: { available: true } }),
    status: () => ({ state: 'ready', detail: null, pid: 7, starts: 1, requests: 0 }),
    stop: async () => void taken.push('stop'),
    ensureBrowser: async (demand) => (taken.push(`ensure ${demand.appSessionId}`), { epoch: demand.epoch, socketPath: `/p/${demand.appSessionId}.sock` }),
    dropBrowser: async (appSessionId) => void taken.push(`drop ${appSessionId}`),
    browserAnswer: () => (taken.push('answer'), true),
    browserEngine: () => null,
    browserWorkChanged: () => void taken.push('work'),
    unavailable: () => 'it failed twice',
  };
}

type Facts = { machine: string; runtime: { available: true } | { available: false; reason: string }; engineHostRenders: boolean; appAttached: boolean };
function scene(loadResults: ('ok' | string)[], facts: Facts = { machine: 'mini', runtime: { available: true }, engineHostRenders: true, appAttached: false }) {
  const taken: string[] = [];
  const engine: { name: string; input: unknown }[] = [];
  const logs: string[] = [];
  let loads = 0;
  const handle = createRenderHandle({
    machine: 'mini',
    load: async () => {
      const result = loadResults[loads++] ?? 'ok';
      if (result !== 'ok') throw new Error(result);
      return { createRenderSeam: () => fakeSeam(taken) } as unknown as RenderChunk;
    },
    compose: () => ({}) as never,
    answerEngine: async (name, input) => (engine.push({ name, input }), 'delivered'),
    facts: () => facts,
    log: (line) => void logs.push(line),
  });
  return { handle, taken, engine, logs, loads: () => loads };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('the render seam’s handle (P5 O5 M4)', () => {
  it('loads nothing until the first request, and hands the engine host’s render events to the seam once loaded', async () => {
    const s = scene(['ok']);
    expect(s.handle.event('session.event', {}), 'not a render request').toBe(false);
    s.handle.front.clientReady();
    expect(s.loads()).toBe(0);
    expect(s.handle.status().state).toBe('off');
    expect(s.logs).toContain('[render] a render client said ready with no render seam loaded: not taken');
    expect(s.handle.event('maws.artifact.capture', capture)).toBe(true);
    await settle();
    expect(s.loads()).toBe(1);
    expect(s.taken).toEqual(['capture req-1']);
    s.handle.front.clientReady();
    expect(s.taken).toEqual(['capture req-1', 'ready']);
  });

  it('answers a request the chunk could not load for in the bridge’s own shape, and tries again at the next', async () => {
    const s = scene(['mawsd’s bundle was replaced', 'ok']);
    s.handle.event('maws.artifact.export', { ...capture, requestId: 'exp-1' });
    await settle();
    expect(s.engine).toEqual([{ name: 'maws.artifact.exported', input: { appSessionId: 'app-1', requestId: 'exp-1', answer: { ok: false, error: 'the render service could not start on mini: mawsd’s bundle was replaced' } } }]);
    s.handle.event('maws.artifact.capture', capture);
    await settle();
    expect(s.loads()).toBe(2);
    expect(s.taken).toEqual(['capture req-1']);
  });

  it('the library’s Export rejects with host_unavailable and the reason when the chunk could not load', async () => {
    const s = scene(['no chunk']);
    const failure = await s.handle.exportForLibrary({ artifactId: ARTIFACT, revision: 1, format: 'pdf' } as never).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HostCommandError);
    expect((failure as HostCommandError).ipcError).toMatchObject({ code: 'host_unavailable', message: 'the render service could not start on mini: no chunk' });
  });

  it('from stop on, refuses at once and loads nothing; a loaded seam is stopped', async () => {
    const s = scene(['ok']);
    s.handle.event('maws.artifact.capture', capture);
    await settle();
    await s.handle.stop();
    expect(s.taken).toEqual(['capture req-1', 'stop']);

    const cold = scene(['ok']);
    await cold.handle.stop();
    cold.handle.event('maws.artifact.capture', capture);
    await settle();
    expect(cold.loads()).toBe(0);
    expect(cold.engine).toEqual([{ name: 'maws.artifact.captured', input: { appSessionId: 'app-1', requestId: 'req-1', result: { ok: false, error: 'the render service is restarting on mini' } } }]);
  });
});

describe('the render entries of a session’s capabilities (P5 O5 M5)', () => {
  it('are read from the facts without loading the seam, and from the seam once it is loaded', async () => {
    const facts: Facts = { machine: 'mini', runtime: { available: false, reason: 'the render runtime is not installed on mini' }, engineHostRenders: true, appAttached: false };
    const s = scene(['ok'], facts);
    expect(s.handle.capabilities().artifact_export).toEqual({ available: false, reason: 'the render service is unavailable on mini: the render runtime is not installed on mini' });
    facts.runtime = { available: true };
    expect(s.handle.capabilities()).toEqual({ artifact_screenshot: { available: true }, artifact_export: { available: true } });
    expect(s.loads()).toBe(0);
    s.handle.event('maws.artifact.capture', capture);
    await settle();
    facts.runtime = { available: false, reason: 'unread' };
    expect(s.handle.capabilities().artifact_screenshot).toEqual({ available: true }); // the loaded seam's own reading
  });
});

describe('the headless browser through the handle (P5 O17 M5, Interfaces §D)', () => {
  const demand = { appSessionId: 'S' as never, epoch: 'e1', deadline: 4_000, signal: new AbortController().signal };

  it('loads the seam at a browser demand alone: a drop, an answer, a work change or a reading with none loaded loads nothing', async () => {
    const s = scene(['ok']);
    await s.handle.dropBrowser('S' as never);
    expect(s.handle.browserAnswer({}, { id: 'x', result: { ok: true, value: null } })).toBe(false);
    s.handle.browserWorkChanged();
    expect(s.handle.browserEngine('S' as never)).toBeNull();
    expect(s.handle.unavailable()).toBeNull();
    expect(s.loads()).toBe(0);
    expect(await s.handle.ensureBrowser(demand)).toEqual({ epoch: 'e1', socketPath: '/p/S.sock' });
    expect(s.loads()).toBe(1);
    await s.handle.dropBrowser('S' as never);
    expect(s.handle.browserAnswer({}, { id: 'x', result: { ok: true, value: null } })).toBe(true);
    expect(s.handle.unavailable()).toBe('it failed twice');
    expect(s.taken).toEqual(['ensure S', 'drop S', 'answer']);
  });

  it('a drop while the seam loads reaches it once loaded; a demand the chunk could not load for fails with the reason', async () => {
    const s = scene(['ok']);
    const ensured = s.handle.ensureBrowser(demand);
    const dropped = s.handle.dropBrowser('S' as never);
    await Promise.all([ensured, dropped]);
    expect(s.taken).toEqual(['ensure S', 'drop S']);
    const failing = scene(['no chunk']);
    await expect(failing.handle.ensureBrowser(demand)).rejects.toThrow('the render service could not start on mini: no chunk');
  });
});
