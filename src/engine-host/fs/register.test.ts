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
  });
});
