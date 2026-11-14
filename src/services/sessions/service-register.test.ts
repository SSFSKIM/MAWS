import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import { endableClientRef, type HandlerContext } from '@shared/ipc/client';
import { fakeBus } from '../../../test/support/fake-bus';
import { SessionHarness } from '../../../test/support/session-harness';
import { sessionIdFor, summary } from '../../../test/support/index-fixture'; // P2-A
import { registerSessionServiceHandlers } from './service-register';

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string; issues?: unknown } };

// The session service through the services bus (P5 O3-C), routed as main's router routes the renderer's invoke.
describe('the session service’s commands, answered on the services bus', () => {
  let h: SessionHarness;
  const bus = fakeBus();
  const invoke = (name: CommandName, input: unknown) => bus.invoke(name, input) as Promise<Result>;

  beforeAll(async () => {
    h = await new SessionHarness().start();
    registerSessionServiceHandlers(h.service, bus, 'index');
  });
  afterAll(() => h.dispose());

  it('creates, lists, patches and starts; an invalid patch is invalid_input naming the field', async () => {
    const created = await invoke('session.create', { projectId: null, location: { kind: 'directory', path: h.work } });
    expect(created.ok).toBe(true);
    const id = (created.value as { appSessionId: string }).appSessionId;
    expect(await invoke('session.intent.list', undefined)).toMatchObject({ ok: true, value: { intents: [{ appSessionId: id }] } });
    const bad = await invoke('session.intent.patch', { appSessionId: id, patch: { location: { kind: 'directory', path: join(h.root, 'missing') } } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('location: directory not found'), issues: [{ path: ['patch', 'location'] }] } });
    expect(await invoke('session.start', { appSessionId: id, message: null, options: {} })).toMatchObject({ ok: true, value: { status: 'needs_trust' } });
    expect(await invoke('session.trust.check', { directory: h.work })).toMatchObject({ ok: true, value: { trustKey: h.work, trusted: false } });
  });

  // The UX wave (U9, R9): a rename made under a reader (another machine's member, through the endpoint) answers the record
  // as `session.get` answers that reader, read after the rename: a member is never answered the owners' reading.
  it('answers a rename under a reader with the record as that reader reads it', async () => {
    const B = 'b'.repeat(32);
    const record = h.index.sessions.upsertFromSummary(summary({ directory: h.work })).record;
    h.index.sessions.setPinned(record.appId, true);
    const as = (reader: string): HandlerContext => ({ client: endableClientRef('endpoint:1'), remote: true, reader });
    for (const [reader, title] of [[B, 'Loft notes'], ['owner', 'Studio notes']] as const) {
      const renamed = (await bus.invoke('session.rename', { appSessionId: record.appId, title }, as(reader))) as Result;
      expect(renamed, reader).toEqual({ ok: true, value: { record: h.index.sessions.get(record.appId, reader), via: 'override' } });
    }
    const asMember = (await bus.invoke('session.rename', { appSessionId: record.appId, title: 'Loft notes' }, as(B))) as Result;
    expect((asMember.value as { record: { pinned: boolean } }).record.pinned).toBe(false);
    expect(h.index.sessions.get(record.appId)!.pinned).toBe(true);
  });

  // The UX wave (U9, M2): a fork under an operation's claim is another machine's (`machine.op` hands the claim), composed
  // here and held to the machine's ceiling; a fork above it is refused with the refusal and the mode in `issues`, which
  // the asking device words. A fork with no claim is this machine's own window's, unheld by the ceiling.
  it('holds a fork another machine asked for to the ceiling, the refusal and the mode in `issues`, and leaves a local fork as it was', async () => {
    h.trustDirectory(h.work);
    h.host.script = () => ({});
    const engine = sessionIdFor(0x2f01);
    const record = h.index.sessions.upsertFromSummary(summary({ sessionId: engine, directory: h.work })).record;
    h.writeTranscript(h.work, engine);
    const fork = { appSessionId: record.appId, target: { kind: 'inPlace' }, message: null, rewindTo: null };
    const claimed: HandlerContext = { client: endableClientRef('endpoint:1'), remote: true, reader: 'owner', op: { opId: 'op-fork-1', opCreated: new Date().toISOString(), member: 'a'.repeat(32), device: 'dev-1', fingerprint: 'fp-1' } };
    // this harness's service was given no ceiling to read: every fork from another machine is above it
    expect(await bus.invoke('session.fork', fork, claimed)).toEqual({
      ok: false,
      error: { code: 'internal', message: expect.stringContaining(record.permissionMode.requested), issues: { refusal: 'ceiling', mode: record.permissionMode.requested } },
    });
    expect(await invoke('session.fork', fork)).toMatchObject({ ok: true, value: { status: 'starting' } });
  });

  it('refuses a patch while a start is in flight as internal `starting`', async () => {
    h.trustDirectory(h.work);
    h.host.script = () => ({ ready: false });
    const id = ((await invoke('session.create', { projectId: null, location: { kind: 'directory', path: h.work } })).value as { appSessionId: string }).appSessionId;
    expect(await invoke('session.start', { appSessionId: id, message: null, options: {} })).toMatchObject({ ok: true, value: { status: 'starting' } });
    expect(await invoke('session.intent.patch', { appSessionId: id, patch: { model: 'opus' } })).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringMatching(/^starting/) } });
  });

  // E3: the side namespace's two main commands; a screenshot's refusal and an oversized first message are invalid_input
  it('opens a side thread and sends to main through the router, refusing a bad screenshot as invalid_input naming it', async () => {
    h.trustDirectory(h.work);
    h.host.script = () => ({});
    const parent = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x3e3), directory: h.work })).record.appId;
    h.writeTranscript(h.work, sessionIdFor(0x3e3)); // its conversation, which the thread forks (P3-F L242)
    const anchor = { kind: 'file-line', locator: '/r/x.ts#L1', label: 'x.ts:1', path: '/r/x.ts', line: 1 };
    expect(await invoke('side.thread.open', { appSessionId: parent, from: { kind: 'comment', anchor, text: 'why?', screenshot: null } })).toMatchObject({ ok: true, value: { status: 'starting' } });
    const shot = { path: join(h.root, 'nowhere.png'), width: 1, height: 1 };
    expect(await invoke('side.thread.open', { appSessionId: parent, from: { kind: 'comment', anchor, text: 'why?', screenshot: shot } })).toMatchObject({
      ok: false, error: { code: 'invalid_input', message: 'screenshot: not found', issues: [{ path: ['from', 'screenshot'] }] },
    });
    expect(await invoke('side.sendToMain', { appSessionId: parent, anchor, text: 'look', screenshot: shot })).toMatchObject({
      ok: false, error: { code: 'invalid_input', message: 'screenshot: not found', issues: [{ path: ['screenshot'] }] },
    });
    const exchanges = Array.from({ length: 11 }, (_, i) => ({ question: `q${i}`, response: 'r'.repeat(100_000) }));
    expect(await invoke('side.thread.open', { appSessionId: parent, from: { kind: 'btw', exchanges, text: null } })).toMatchObject({
      ok: false, error: { code: 'invalid_input', issues: [{ path: ['from'] }] },
    });
    // the parent has no process in this host: its refusal goes back verbatim
    expect(await invoke('side.sendToMain', { appSessionId: parent, anchor, text: 'look', screenshot: null })).toMatchObject({ ok: false, error: { code: 'internal', message: `unknown session ${parent}` } });
  });

  // P2-A (X16): the acquisition through the router; the engine host's own host_unavailable keeps its code, so the
  // supervisor's banner returns for it as for the other launches
  it('acquires a record through the router, and relays the host’s host_unavailable with its code', async () => {
    h.trustDirectory(h.work);
    h.host.script = () => ({});
    const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x2a01), directory: h.work })).record;
    expect(await invoke('session.acquire', { appSessionId: record.appId, reason: 'send' })).toEqual({ ok: true, value: { status: 'ready', appSessionId: record.appId, launched: true, joined: false } });
    expect(await invoke('session.acquire', { appSessionId: record.appId, reason: 'mount' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const other = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x2a02), directory: h.work })).record;
    h.host.unavailable = true;
    try {
      expect(await invoke('session.acquire', { appSessionId: other.appId, reason: 'send' })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    } finally {
      h.host.unavailable = false;
    }
  });

  it('answers an unknown session’s delete as internal', async () => {
    expect(await invoke('session.delete', { appSessionId: '00000000-0000-4000-8000-000000000000', stopIfLive: false })).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('unknown app session') } });
  });
});
