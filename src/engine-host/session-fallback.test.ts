// W3 C5 (charter D-18 and §5.1 as amended 2026-10-01): a launch that asks for auto and is refused at initialize (the
// engine does it without a code, pass2/auto-haiku seq 4) falls back to the spec's mode before the session is ready.
import { describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import { toSessionRecordPatch } from '@shared/engine/status';
import { handshakeResponder, INIT_RESPONSE, replayedSession, scriptedSession } from './conformance/session-harness';

describe('a refused auto falls back before ready', () => {
  it('replays pass3/w3-auto-fallback: set_permission_mode acceptEdits, auto kept as requested with the model refusal', async () => {
    let atReady: EngineSessionStatus | null = null;
    const replayed = await replayedSession(
      'pass3',
      'w3-auto-fallback',
      (row, { session, transport, ready }) => {
        const frame = row.frame as { request?: { subtype?: string } };
        if (frame.request?.subtype === 'set_permission_mode') return; // the session's own fallback
        if (frame.request?.subtype === 'get_settings')
          void ready().then(() => {
            atReady = session.status();
            transport.kill('SIGTERM');
          });
        else transport.kill('SIGTERM');
      },
      { spec: { model: 'haiku', permissionMode: 'auto', permissionFallback: 'acceptEdits' } },
    );
    const outs = replayed.journal.rows.filter((r) => r.direction === 'out').map((r) => (r.frame as { request?: { subtype?: string; mode?: string } }).request);
    expect(outs).toContainEqual({ subtype: 'set_permission_mode', mode: 'acceptEdits' }); // seq 7, answered { mode: 'acceptEdits' } at seq 8
    expect(atReady!.permissionMode).toEqual({ requested: 'auto', effective: 'acceptEdits', refusal: 'auto_mode_model' });
    // the record keeps auto requested, so a resume asks for it again (launch-mapping re-passes `requested`)
    expect(toSessionRecordPatch(atReady!).permissionMode).toEqual({ requested: 'auto', effective: 'acceptEdits', refusal: 'auto_mode_model' });
  });

  it('a mode auto that initialize confirms, or a spec without a fallback, sends nothing', async () => {
    const held = scriptedSession({ spec: { permissionMode: 'auto', permissionFallback: 'acceptEdits' } }); // INIT_RESPONSE: current_permission_mode auto
    await held.session.start();
    expect(INIT_RESPONSE.current_permission_mode).toBe('auto');
    expect(held.transport.requestsOf('set_permission_mode')).toEqual([]);
    expect(held.session.status().permissionMode).toEqual({ requested: 'auto', effective: 'auto', refusal: null });
    const bare = scriptedSession({ spec: { permissionMode: 'auto' }, responder: handshakeResponder({ initialize: () => ({ response: { ...INIT_RESPONSE, current_permission_mode: 'default' } }) }) });
    await bare.session.start();
    expect(bare.transport.requestsOf('set_permission_mode')).toEqual([]);
  });

  it('auto unavailable for another reason reads auto_mode_unavailable; a refused fallback keeps the engine’s mode with a notice', async () => {
    const refusedAuto = { initialize: () => ({ response: { ...INIT_RESPONSE, current_permission_mode: 'default' } }) };
    const plain = scriptedSession({ spec: { model: 'sonnet', permissionMode: 'auto', permissionFallback: 'plan' }, responder: handshakeResponder(refusedAuto) });
    await plain.session.start();
    expect(plain.transport.requestsOf('set_permission_mode').map((f) => f.request)).toEqual([{ subtype: 'set_permission_mode', mode: 'plan' }]);
    expect(plain.session.status().permissionMode).toEqual({ requested: 'auto', effective: 'plan', refusal: 'auto_mode_unavailable' });

    const failing = scriptedSession({
      spec: { model: 'haiku', permissionMode: 'auto', permissionFallback: 'acceptEdits' },
      responder: handshakeResponder({ ...refusedAuto, set_permission_mode: () => ({ error: 'nope' }) }),
    });
    await failing.session.start();
    expect(failing.session.status().process).toBe('ready');
    expect(failing.session.status().permissionMode).toEqual({ requested: 'auto', effective: 'default', refusal: 'auto_mode_model' });
    expect(failing.journal.rows.some((r) => (r.frame as { key?: string }).key === 'permission:fallback_failed')).toBe(true);
  });
});
