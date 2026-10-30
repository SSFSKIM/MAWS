// C10's `session.start` as the route switch calls it (C11 execution document, Interfaces "Gateway", *The switch*; M4
// refresh task "the switch's failure and the queue"): the resume with the switch's options, every outcome other than
// `starting` a refusal in words, and a `session.setup` failure after `starting` heard for its session only.
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { StartOutcome } from '@shared/sessions/setup';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend } from '../../../../test/support/widget-backend';
import { at } from '../../../../test/support/machine';
import { createClient } from '../ipc/client';
import { sessionStartOver, startRefusal } from './session-start';

const ROOT = join(__dirname, '../../../..');
// P5 O6 M2: the backend is main (bare `READY`, `OTHER`); the switch runs on the page's client over it, with the page's ids.
const READY = 'app-7412a115' as AppSessionId;
const OTHER = 'app-bdb23713' as AppSessionId;
const PAGE_READY = at(READY);
const HEALTH = { url: 'http://127.0.0.1:8641', ok: false, status: null, latencyMs: null, checkedAt: '2026-09-29T12:00:00.000Z', error: 'ECONNREFUSED' };
const KEPT = { worktree: null, record: 'kept' as const, transcript: 'kept' as const };

function setup() {
  const { engine, sessions } = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
  const backend = createWidgetBackend({ root: ROOT, statuses: engine, records: sessions });
  return { backend, start: sessionStartOver(createClient(() => backend.bridge())) };
}

describe("the route switch's start over C10's session.start", () => {
  it('resumes with message null and the options given, and answers starting', async () => {
    const { backend, start } = setup();
    await backend.answer('session.stop', { appSessionId: READY, reason: 'stop' });
    expect(await start.start(PAGE_READY, { gateway: 'direct', model: 'sonnet' })).toEqual({ status: 'starting' });
    expect(backend.calls.filter((c) => c.command === 'session.start').map((c) => c.input)).toEqual([{ appSessionId: READY, message: null, options: { gateway: 'direct', model: 'sonnet' } }]);
  });

  it('words every outcome but starting as a refusal', async () => {
    const { start } = setup();
    expect(await start.start(PAGE_READY, { gateway: 'direct' })).toEqual({ status: 'refused', reason: 'This session is already running' });
    const cases: [StartOutcome, string][] = [
      [{ status: 'held', appSessionId: PAGE_READY, holder: { kind: 'terminal', pid: 4711 }, attach: null }, 'Held by terminal · 4711'],
      [{ status: 'relay_unreachable', appSessionId: PAGE_READY, health: HEALTH }, 'The relay was unreachable'],
      [{ status: 'needs_trust', appSessionId: PAGE_READY, trust: { trustKey: '/tmp/x', keyKind: 'directory', isHome: false, trusted: false, found: [] } as never }, 'The folder is not trusted yet · resume it from the sidebar to answer'],
      [{ status: 'archived', appSessionId: PAGE_READY }, 'This session is archived'],
      [{ status: 'missing_directory', appSessionId: PAGE_READY, directory: '/gone' }, 'Directory not found: /gone'],
      [{ status: 'invalid', appSessionId: PAGE_READY, field: 'model', message: 'unknown model' }, 'unknown model'],
      [{ status: 'refused', appSessionId: PAGE_READY, reason: 'busy', message: 'a turn is open' }, 'a turn is open'],
    ];
    for (const [outcome, words] of cases) expect(startRefusal(outcome), outcome.status).toBe(words);
    expect(startRefusal({ status: 'starting', appSessionId: PAGE_READY })).toBeNull();
  });

  it('answers an X2 error as a refusal in its message', async () => {
    const bridge = setup().backend.bridge();
    const failing = sessionStartOver(createClient(() => ({ ...bridge, invoke: (async () => ({ ok: false, error: { code: 'internal', message: 'main is gone' } })) as never })));
    expect(await failing.start(PAGE_READY, { gateway: 'gateway' })).toEqual({ status: 'refused', reason: 'main is gone' });
  });

  it("hears a setup failure for its session only, in words, until unsubscribed", () => {
    const { backend, start } = setup();
    const heard = vi.fn();
    const off = start.onSetupFailure(PAGE_READY, heard);
    backend.emitSetup({ appSessionId: OTHER, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'not mine', resources: KEPT } });
    backend.emitSetup({ appSessionId: READY, phase: 'launching', detail: 'Starting', outcome: null });
    backend.emitSetup({ appSessionId: READY, phase: 'failed', detail: null, outcome: { kind: 'relay_unreachable', health: HEALTH } });
    backend.emitSetup({ appSessionId: READY, phase: 'failed', detail: null, outcome: { kind: 'held', holder: { kind: 'background_job', pid: null, jobId: 'e6dcd828' }, attach: null } });
    backend.emitSetup({ appSessionId: READY, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'the engine exited', resources: KEPT } });
    expect(heard.mock.calls.map((c) => c[0])).toEqual(['The relay was unreachable', 'Held by bg · e6dcd828', 'the engine exited']);
    off();
    backend.emitSetup({ appSessionId: READY, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'later', resources: KEPT } });
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
