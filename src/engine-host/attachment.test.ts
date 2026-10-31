// P5 O3-D M3 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §D; acceptance 4's unit half): the engine
// host's `host.attachment`, served through the real runtime, and the app-bound gates the entry keys on the presence it
// sets, composed as src/engine-host/index.ts composes them (the dataset refresh registry, the connection's holds, the
// connectors' gone hook, the bridges' gate).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostRuntime, type HostClientHooks, type HostPort, type HostRuntime } from '@shared/host/runtime';
import { ATTACHMENT_CAPABILITY, PTY_FRAMES_CAPABILITY } from '@shared/host/socket-protocol';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { registerAttachment, type RenderAttachment } from './attachment';
import { hostDatasetRefresh, type DatasetRefreshRequests } from './connectors/dataset-requests';
import { HostBridge } from './tool-server/bridge';

const DECLARING = { capabilities: [PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY] };
const MAIN = { capabilities: [PTY_FRAMES_CAPABILITY] };

function fakePort() {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const posted: Record<string, unknown>[] = [];
  const port: HostPort = { on: (_event, listener) => void listeners.push(listener), postMessage: (message) => void posted.push(message as Record<string, unknown>), start: () => {} };
  let next = 0;
  return {
    port,
    posted,
    // a request through the runtime's own path (envelope, input, handler, answer)
    async request(name: string, input: unknown): Promise<Record<string, unknown>> {
      const id = `r${++next}`;
      for (const listener of listeners) listener({ data: { t: 'req', id, name, input } });
      await vi.waitFor(() => {
        if (!posted.some((message) => message.t === 'res' && message.id === id)) throw new Error(`no answer to ${name}`);
      });
      return posted.find((message) => message.t === 'res' && message.id === id)!;
    },
  };
}

const ASK = { artifactId: '00000000-0000-4000-8000-000000000003', datasetId: 'live', baseRevision: 0, appSessionId: 'app-1' as AppSessionId, opId: null, server: 'fixture', tool: 'rows', args: {} };

let runtime: HostRuntime;
let requests: DatasetRefreshRequests;
let bridge: HostBridge<{ requestId: RequestId }, string>;
let announced: string[];
let holdsReleased: number;
let connectorsEnded: number;
let shellRecaptured: number;
let render: RenderAttachment; // P5 O5 M4
let renders: HostBridge<{ requestId: RequestId }, string>; // P5 O5 M4: the capture and export bridges' gate

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  announced = [];
  holdsReleased = 0;
  connectorsEnded = 0;
  shellRecaptured = 0;
  runtime = createHostRuntime((on, emit, client: HostClientHooks) => {
    on('engine.ping', async () => ({ pid: 1, uptimeMs: 1, hostVersion: 'test' }));
    render = registerAttachment(on, client, () => void shellRecaptured++);
    // as the entry wires them: the registry announced only to an attached app and ended at its going; the holds and
    // connectors' route E ended at its going; the bridges asking only an attached app
    requests = hostDatasetRefresh((name, payload) => {
      announced.push((payload as { requestId: string }).requestId);
      return emit(name, payload);
    }, client.presence);
    client.presence.onGone(() => void holdsReleased++);
    client.presence.onGone(() => void connectorsEnded++);
    bridge = new HostBridge({ send: () => {}, answerMs: 60_000, hasClient: client.presence.attached });
    renders = new HostBridge({ send: () => {}, answerMs: 60_000, hasClient: render.answersRenders }); // P5 O5 M4: as the entry gates captures and exports
  });
});

afterEach(() => vi.restoreAllMocks());

const never = () => new AbortController().signal;

describe('host.attachment (P5 O3-D M3)', () => {
  it('from a client whose hello did not list the capability: answers internal and changes nothing', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, MAIN);
    runtime.setReady();
    expect(await fake.request('host.attachment', { attached: false })).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('host.attachment') } });
    expect(runtime.presence.attached()).toBe(true); // keyed on its connection, as before
    expect(holdsReleased).toBe(0);
    expect(shellRecaptured).toBe(0);
  });

  it('a declaring client that sent none: a dataset refresh and a bridge request settle noClient at once, nothing announced', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, DECLARING);
    runtime.setReady();
    expect(await requests.ask(ASK, never())).toEqual({ kind: 'noClient' });
    expect(await bridge.request({ requestId: 'req-1' as RequestId }, never())).toEqual({ kind: 'noClient' });
    expect(announced).toEqual([]);
  });

  it('{attached: true} announces them and recaptures the shell once; {attached: false} ends what is in flight, with the connection kept', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, DECLARING);
    runtime.setReady();
    expect(await fake.request('host.attachment', { attached: true })).toMatchObject({ ok: true });
    expect(shellRecaptured).toBe(1);
    expect(await fake.request('host.attachment', { attached: true })).toMatchObject({ ok: true });
    expect(shellRecaptured).toBe(1); // a repeated signal is no new attachment
    const asked = requests.ask(ASK, never());
    const bridged = bridge.request({ requestId: 'req-2' as RequestId }, never());
    expect(announced).toHaveLength(1);
    expect(fake.posted.some((message) => message.t === 'evt' && message.name === 'maws.artifact.datasetRefresh')).toBe(true);
    expect(await fake.request('host.attachment', { attached: false })).toMatchObject({ ok: true });
    expect(await asked).toEqual({ kind: 'noClient' });
    expect(holdsReleased).toBe(1);
    expect(connectorsEnded).toBe(1);
    expect(runtime.hasClient()).toBe(true); // the connection holds
    expect(bridge.pending).toBe(1); // a bridge request in flight waits for its own deadline, as with a client gone
    bridge.processExited();
    expect(await bridged).toEqual({ kind: 'ended' });
  });

  it('a declaring client’s connection end counts as {attached: false}', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, DECLARING);
    runtime.setReady();
    await fake.request('host.attachment', { attached: true });
    const asked = requests.ask(ASK, never());
    runtime.detach();
    expect(await asked).toEqual({ kind: 'noClient' });
    expect(holdsReleased).toBe(1);
    expect(connectorsEnded).toBe(1);
  });

  // P5 O3-D M6 fix round 1: what an older host does for `mawsd`'s recycled link (O2's path, acceptance 9's incapable
  // half): each outstanding item settles at the connection's going, as before O3-D
  it('a client keyed on its connection: its going ends them, as E10 did', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, MAIN);
    runtime.setReady();
    const asked = requests.ask(ASK, never());
    const bridged = bridge.request({ requestId: 'req-3' as RequestId }, never());
    expect(announced).toHaveLength(1);
    runtime.detach();
    expect(await asked).toEqual({ kind: 'noClient' });
    expect(holdsReleased).toBe(1);
    expect(connectorsEnded).toBe(1);
    expect(bridge.pending).toBe(1); // a bridge request in flight waits for its own deadline, as with a client gone
    expect(await bridge.request({ requestId: 'req-4' as RequestId }, never())).toEqual({ kind: 'noClient' }); // a later one settles at once
    bridge.processExited();
    expect(await bridged).toEqual({ kind: 'ended' });
  });
});

// P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §F): `render` on host.attachment says the
// client answers render requests, so the capture and export bridges send with no app attached; the pane bridge and the
// asks keep the app's presence.
describe('host.attachment.render (P5 O5 M4)', () => {
  it('{attached: false, render: true}: a capture request leaves the host with no app, the app-bound gates stay closed', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, DECLARING);
    runtime.setReady();
    expect(await fake.request('host.attachment', { attached: false, render: true })).toMatchObject({ ok: true });
    expect(runtime.presence.attached()).toBe(false);
    expect(render.answersRenders()).toBe(true);
    const sent = renders.request({ requestId: 'req-r1' as RequestId }, never());
    expect(renders.pending).toBe(1); // sent, waiting for the answer
    expect(await bridge.request({ requestId: 'req-p1' as RequestId }, never())).toEqual({ kind: 'noClient' }); // show_pane's gate
    expect(await requests.ask(ASK, never())).toEqual({ kind: 'noClient' });
    expect(shellRecaptured).toBe(0); // no app came
    renders.processExited();
    expect(await sent).toEqual({ kind: 'ended' });
  });

  it('{attached: false, render: false}, or render absent: a capture request settles noClient at once', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, DECLARING);
    runtime.setReady();
    expect(await renders.request({ requestId: 'req-r2' as RequestId }, never())).toEqual({ kind: 'noClient' }); // none sent yet
    await fake.request('host.attachment', { attached: false, render: true });
    await fake.request('host.attachment', { attached: false, render: false });
    expect(await renders.request({ requestId: 'req-r3' as RequestId }, never())).toEqual({ kind: 'noClient' });
    await fake.request('host.attachment', { attached: false, render: true });
    await fake.request('host.attachment', { attached: false }); // an older mawsd's signal: render absent reads false
    expect(await renders.request({ requestId: 'req-r4' as RequestId }, never())).toEqual({ kind: 'noClient' });
  });

  it('an attached app still opens the gate without render, as before', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, DECLARING);
    runtime.setReady();
    await fake.request('host.attachment', { attached: true });
    expect(render.answersRenders()).toBe(true);
    void renders.request({ requestId: 'req-r5' as RequestId }, never());
    expect(renders.pending).toBe(1);
  });

  it('the declaring connection’s end closes it; a client that did not declare cannot open it', async () => {
    const fake = fakePort();
    runtime.serve(fake.port, DECLARING);
    runtime.setReady();
    await fake.request('host.attachment', { attached: false, render: true });
    runtime.detach();
    expect(render.answersRenders()).toBe(false);
    const other = fakePort();
    runtime.serve(other.port, DECLARING);
    runtime.setReady();
    expect(render.answersRenders()).toBe(false); // a new connection starts with no signal
    const main = fakePort();
    runtime.serve(main.port, MAIN);
    runtime.setReady();
    expect(await main.request('host.attachment', { attached: false, render: true })).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(render.answersRenders()).toBe(true); // keyed on its connection, as the presence is (main renders in-process)
  });
});
