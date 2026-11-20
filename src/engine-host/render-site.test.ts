// `session.ui.renderSite` (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, Interfaces
// §E, "The command"): `session.ui.render`'s input and output for a site the closed set on the wire does not name, its
// `component` an open string the engine host checks against its own list where the ask runs (`TurnDuration` at this
// landing). The ask reaches the same attached desktop client as a render does.
import { describe, expect, it } from 'vitest';
import { validateCommandInput } from '@shared/ipc/validate';
import { registerEngineIpc, RENDER_SITE_COMPONENTS } from './ipc';
import { handshakeResponder, INIT_RESPONSE, scriptedSession } from './conformance/session-harness';

const props = { word: 'Worked', durationMs: 72_000, isExpanded: true };
const ask = (over: Record<string, unknown> = {}) => ({ appSessionId: 'app-s', component: 'TurnDuration', instanceId: '0b7e2a5c-3f41-4d8e-9a60-1c2d3e4f5a6b~turn', props, ...over });

async function attached() {
  const answer = { tree: { type: 'Box', children: [] }, props, rewritten: false, hooked: true };
  const { session, transport } = scriptedSession({ responder: handshakeResponder({
    initialize: () => ({ response: { ...INIT_RESPONSE, capabilities: ['ui_surface_v1'] } }),
    ui_attach: () => ({ response: { surfaces: ['desktop'] } }),
    ui_panes: () => ({ response: { panes: [] } }),
    ui_render: () => ({ response: answer }),
  }) });
  await session.start();
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  registerEngineIpc((name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>), () => true, {
    userData: '/tmp/maws-u2b-unused', replayEnabled: false,
    table: { get: () => session, list: () => [session], onBudget: () => {}, onDropped: () => {} } as never,
  });
  return { answer, transport, renderSite: handlers.get('session.ui.renderSite')! };
}

describe('session.ui.renderSite', () => {
  it('takes a component of 1 to 64 characters and an instance id of up to 256, as the wire bounds them', () => {
    expect(validateCommandInput('session.ui.renderSite', ask())).toEqual({ ok: true, value: ask() });
    expect(validateCommandInput('session.ui.renderSite', ask({ component: 'Anything' })).ok).toBe(true); // the host decides, not the wire
    expect(validateCommandInput('session.ui.renderSite', ask({ component: '' })).ok).toBe(false);
    expect(validateCommandInput('session.ui.renderSite', ask({ component: 'C'.repeat(65) })).ok).toBe(false);
    expect(validateCommandInput('session.ui.renderSite', ask({ instanceId: 'i'.repeat(257) })).ok).toBe(false);
    expect(validateCommandInput('session.ui.render', ask()).ok).toBe(false); // the closed set stays closed
  });

  it('lists TurnDuration alone at this landing', () => {
    expect(RENDER_SITE_COMPONENTS).toEqual(['TurnDuration']);
  });

  it('forwards TurnDuration to the attached surface with its id and props intact, and answers as a render does', async () => {
    const { answer, transport, renderSite } = await attached();
    expect(await renderSite(ask())).toEqual(answer);
    expect(transport.requestsOf('ui_render')[0]!.request).toEqual({
      subtype: 'ui_render', surface: 'desktop', client_id: 'maws-main', component: 'TurnDuration', instance_id: ask().instanceId, props,
    });
    transport.exit(0);
  });

  it('refuses a component not on the host’s list, before any ask reaches the engine', async () => {
    const { transport, renderSite } = await attached();
    for (const component of ['AbovePrompt', 'Thinking', 'turnDuration']) {
      await expect(renderSite(ask({ component })), component).rejects.toMatchObject({ ipcError: { code: 'invalid_input' } });
    }
    expect(transport.requestsOf('ui_render')).toEqual([]);
    transport.exit(0);
  });
});
