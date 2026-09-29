import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IpcError } from '@shared/ipc/errors';
import { installWidgetBackend, type WidgetBackendInstall } from './fixture-backend';

const ROOT = join(__dirname, '../../..');
const SCENARIO = 'stub:test/fixtures/shell/nine-sessions.json';

class Refused extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
  }
}

function deps(env: Record<string, string>): WidgetBackendInstall & { handlers: Map<string, (input: unknown) => unknown>; emitted: string[] } {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: string[] = [];
  return {
    env,
    packaged: false,
    appRoot: ROOT,
    intercept: (name, handler) => {
      handlers.set(name, handler as (input: unknown) => unknown);
      return () => void handlers.delete(name);
    },
    emit: (name) => void emitted.push(name),
    fail: (error) => new Refused(error),
    handlers,
    emitted,
  };
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

describe('the fixture-backed widget backend in main', () => {
  it('installs only under MAWS_WIDGET_BACKEND=fixtures in launch mode scenario', () => {
    const plain = deps({ MAWS_SESSION_SOURCE: SCENARIO });
    expect(installWidgetBackend(plain)).toBeNull();
    const noScenario = deps({ MAWS_WIDGET_BACKEND: 'fixtures' });
    expect(installWidgetBackend(noScenario)).toBeNull();
    expect(noScenario.handlers.size).toBe(0);
  });

  it("intercepts the widgets' commands over the scenario's statuses, refusals as the command's error, and exposes itself to the test", async () => {
    const d = deps({ MAWS_WIDGET_BACKEND: 'fixtures', MAWS_SESSION_SOURCE: SCENARIO });
    stop = installWidgetBackend(d);
    expect(stop).not.toBeNull();
    expect([...d.handlers.keys()]).toEqual(expect.arrayContaining(['session.status', 'session.catalog', 'session.getContextUsage', 'session.mcpStatus']));
    expect(await d.handlers.get('session.getSandboxDialog')!({ appSessionId: 'app-7412a115' })).toMatchObject({ mode: 'disabled' });
    await expect(Promise.resolve().then(() => d.handlers.get('session.getStatus')!({ appSessionId: 'nobody' }))).rejects.toMatchObject({ error: { code: 'internal', message: 'unknown app session: nobody' } });
    expect(globalThis.__maws_widget_backend?.calls.map((c) => c.command)).toEqual(['session.getSandboxDialog', 'session.getStatus']);
    globalThis.__maws_widget_backend!.emitStatus('app-7412a115' as never, { engineState: 'running' });
    expect(d.emitted).toEqual(['session.status']);
    stop!();
    stop = null;
    expect(d.handlers.size).toBe(0);
    expect(globalThis.__maws_widget_backend).toBeUndefined();
  });
});
