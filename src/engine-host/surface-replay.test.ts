// R2: an app replay (the launcher's replay transport, surface reads on) of the R2 fixtures through a real EngineSession:
// the session attaches, becomes ready, answers renders by site, takes the person's focus reports without holding, and a
// held press advances the replay.
import { appReplayHandshake } from './replay-handshake';
import { describe, expect, it } from 'vitest';
import { loadJournal } from '../../test/support/fixtures';
import { ENGINE_BIN, ENGINE_VERSION } from '../../test/support/engine-pin';
import { uiFocus, uiPaneFocus, uiPress, uiRender } from './controls';
import { handshakePrelude } from './conformance/harness';
import { MemoryJournal } from './conformance/scripted-transport';
import { launchSpec } from './conformance/session-harness';
import { buildLaunch, RELAY_URL } from './launch';
import { replayEngine } from './replay-transport';
import { EngineSession } from './session';

async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function appReplay(name: string) {
  const fixture = loadJournal('pass3', name);
  const spec = launchSpec({ appSessionId: `replay-${name}` as never, sessionId: null, model: null, replay: `pass3/${name}` });
  const plan = buildLaunch(spec, { PATH: '/usr/bin', HOME: '/Users/x' }, { relayUrl: RELAY_URL, bin: ENGINE_BIN, engineVersion: ENGINE_VERSION });
  const journal = new MemoryJournal();
  const logs: string[] = [];
  const session = new EngineSession({ spec, plan, journal, log: (m) => logs.push(m), spawn: () => replayEngine(appReplayHandshake(fixture, spec.trust), { prelude: handshakePrelude(), surfaceReads: true }) });
  return { session, journal, logs };
}

describe('an app replay of the R2 fixtures (surface reads on)', () => {
  it('render-sites: attaches, becomes ready and answers each site by its recorded tree', async () => {
    const { session, journal, logs } = appReplay('mods-surface-render-sites');
    void session.start();
    await until(() => session.lifecycle === 'ready', 'ready');
    expect(session.status().uiSurface).toEqual({ clientId: 'maws-main' });
    const client = session.control!;
    const ask = (component: string, instance_id: string) => uiRender(client, { ...session.surface.address, component, instance_id, props: {} });
    expect(JSON.stringify((await ask('SessionMode', 'session-mode')).tree)).toContain('MODS_PROBE_MODE');
    expect(JSON.stringify((await ask('AbovePrompt', 'above-prompt')).tree)).toContain('MODS_PROBE_BAND presses=0');
    expect(JSON.stringify((await ask('PromptHint', 'prompt-hint')).tree)).toContain('MODS_PROBE_HINT');
    // the person's focus and scroll reports, sent as the DOM moves, never hold the replay
    await uiFocus(client, { ...session.surface.address, component: 'AbovePrompt', instance_id: 'above-prompt', is_held: true, element: { plugin: 'mods-probe', key: 'press' }, by: 'person' }).catch(() => null);
    await uiPaneFocus(client, { ...session.surface.address, id: 'mods-probe-pane' });
    expect(journal.rows.filter((r) => (r.frame as { event?: string }).event === 'replay_mismatch')).toEqual([]);
    expect(logs.filter((line) => /attach|mismatch|exited/.test(line))).toEqual([]); // the empty answers to reads it never recorded are logged as schema misses, nothing else
    void session.stop('stop');
    await session.exited;
  });

  it('invalidate: a press the replay holds at goes through, and the band redraws', async () => {
    const { session } = appReplay('mods-surface-invalidate');
    void session.start();
    await until(() => session.lifecycle === 'ready', 'ready');
    const client = session.control!;
    const band = () => uiRender(client, { ...session.surface.address, component: 'AbovePrompt', instance_id: 'above-prompt', props: {} });
    expect(JSON.stringify((await band()).tree)).toContain('presses=0');
    // a click moves the keyboard into the band first: its report must not stand in the press's place
    await uiFocus(client, { ...session.surface.address, component: 'AbovePrompt', instance_id: 'above-prompt', is_held: true, element: { plugin: 'mods-probe', key: 'press' }, by: 'person' }).catch(() => null);
    const pressed = await uiPress(client, { plugin: 'mods-probe', handle: 1, key: 'press', ...session.surface.address });
    expect(pressed.handled).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.stringify((await band()).tree)).toContain('presses=1');
    void session.stop('stop');
    await session.exited;
  });
});
