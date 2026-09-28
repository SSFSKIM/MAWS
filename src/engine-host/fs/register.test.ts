import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionId } from '@shared/graph/ids';
import { createHostRuntime, type HostPort } from '@shared/host/runtime';
import { StoreFixture } from '../../../test/support/store-fixture';
import { registerFs } from './register';
import type { FsService } from './service';

const S1 = '11111111-1111-4111-8111-111111111111' as SessionId;

function fakePort() {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const posted: { t: string; [k: string]: unknown }[] = [];
  const port: HostPort = {
    on: (_event, listener) => void listeners.push(listener),
    postMessage: (message) => void posted.push(message as { t: string }),
    start: vi.fn(),
  };
  return { port, posted, deliver: (data: unknown) => listeners.forEach((l) => l({ data })) };
}

describe('the engine host serves fs.* through the host protocol', () => {
  let fixture: StoreFixture;
  let service: FsService | null;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
    service = null;
  });
  afterEach(async () => {
    service?.stop();
    await fixture.dispose();
  });

  it('answers fs.state, fs.scan and fs.bind, and posts validated fs.* events, reading the config home from the environment', async () => {
    await fixture.addTranscript('/work/a', S1, [{ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/work/a', message: { role: 'user', content: 'hi' } }]);
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive' });
    const fake = fakePort();
    createHostRuntime((on, emit) => {
      service = registerFs(on, emit, { CLAUDE_CONFIG_DIR: fixture.configHome });
    }).serve(fake.port);

    const response = async (id: string) => {
      await expect.poll(() => fake.posted.some((m) => m.t === 'res' && m.id === id)).toBe(true);
      return fake.posted.find((m) => m.t === 'res' && m.id === id)!;
    };

    fake.deliver({ t: 'req', id: '1', name: 'fs.bind', input: { bindings: [{ sessionId: S1, appSessionId: 'app-1' }] } });
    expect(await response('1')).toEqual({ t: 'res', id: '1', ok: true, value: undefined });

    fake.deliver({ t: 'req', id: '2', name: 'fs.scan', input: {} });
    expect(await response('2')).toMatchObject({ ok: true, value: { projects: 1, sessions: 1, changed: 1 } });
    expect(fake.posted).toContainEqual({ t: 'evt', name: 'fs.sessionChanged', payload: expect.objectContaining({ appSessionId: 'app-1', summary: expect.objectContaining({ sessionId: S1, directory: '/work/a' }) }) });

    await expect.poll(() => fake.posted.some((m) => m.t === 'evt' && m.name === 'fs.holderChanged')).toBe(true);
    fake.deliver({ t: 'req', id: '3', name: 'fs.state', input: undefined });
    expect(await response('3')).toMatchObject({
      ok: true,
      value: { configHome: fixture.configHome, watching: true, sessions: 1, bound: 1, holders: [{ sessionId: S1, appSessionId: 'app-1', holder: { kind: 'terminal', pid: process.pid } }] },
    });

    fake.deliver({ t: 'req', id: '4', name: 'fs.holders', input: { sessionIds: [S1], directories: null } });
    expect(await response('4')).toMatchObject({
      ok: true,
      value: { refreshedAt: expect.any(String), holders: [{ sessionId: S1, appSessionId: 'app-1', holder: { kind: 'terminal', pid: process.pid }, cwd: null }] },
    });

    // Following: the temporary session.events handler answers through eventsSnapshot, and the events go out validated.
    fake.deliver({ t: 'req', id: '5', name: 'session.events', input: { appSessionId: 'app-1', afterSeq: null, limit: null } });
    expect(await response('5')).toMatchObject({ ok: true, value: { lastSeq: 0, complete: true, events: [expect.objectContaining({ kind: 'session.started' }), expect.objectContaining({ kind: 'turn.started' }), expect.objectContaining({ kind: 'user.message' })] } });
    expect(fake.posted).toContainEqual({ t: 'evt', name: 'session.eventBatch', payload: expect.objectContaining({ appSessionId: 'app-1' }) });
    expect(fake.posted).toContainEqual({ t: 'evt', name: 'fs.followState', payload: expect.objectContaining({ appSessionId: 'app-1', agentId: null, state: 'following', chainLength: 1 }) });

    const requests: [string, string, unknown][] = [
      ['6', 'fs.subagents', { appSessionId: 'app-1' }],
      ['7', 'fs.workflows', { appSessionId: 'app-1' }],
      ['8', 'fs.tasks', { listId: S1 }],
      ['9', 'fs.readSpill', { path: '/etc/hosts' }],
      ['10', 'fs.agentEvents', { appSessionId: 'app-1', agentId: 'nobody' }],
      ['11', 'fs.unfollow', { appSessionId: 'app-unknown', agentId: null }],
      ['12', 'fs.unfollow', { appSessionId: 'app-1', agentId: null }],
    ];
    for (const [id, name, input] of requests) fake.deliver({ t: 'req', id, name, input });
    expect(await response('6')).toEqual({ t: 'res', id: '6', ok: true, value: { agents: [] } });
    expect(await response('7')).toEqual({ t: 'res', id: '7', ok: true, value: { runs: [] } });
    expect(await response('8')).toEqual({ t: 'res', id: '8', ok: true, value: { tasks: [] } });
    expect(await response('9')).toMatchObject({ ok: false, error: { code: 'internal', message: 'path outside the engine store' } });
    expect(await response('10')).toMatchObject({ ok: false, error: { code: 'internal', message: 'unknown agent: nobody' } });
    expect(await response('11')).toMatchObject({ ok: false, error: { code: 'internal', message: 'unknown app session: app-unknown' } });
    expect(await response('12')).toEqual({ t: 'res', id: '12', ok: true, value: undefined });
  });
});
