import { describe, expect, it } from 'vitest';
import { FakeMachine, Commands, loadRecording, loadRoutes, SessionDepth, SESSION_VIEW } from '../../fake-machine';
import type { Catalog, SessionMessage } from '../../src/protocol/session';
import fixture from '../../fake-machine/dx4/routes-2.1.307.json';
const where = { project: 'p', machine: 'mini' };
describe('M1 catalog producer', () => {
  it('advertises only the declared machine desk capability fields', () => {
    const machine = new FakeMachine({ ...where, hub: 'http://unused', credentials: { clientId: 'fake', clientSecret: 'fake' }, orgKey: new Uint8Array(32), producer: 'm1' });
    expect(Object.keys(machine.presence().desk!).sort()).toEqual(['reads', 'rpcs', 'sminos']);
    expect(machine.presence().desk?.sminos).toBe('1.8.0');
    expect(machine.presence().desk?.rpcs).toContain('command');
  });

  it('pushes its recorded catalog only on main snapshots, updates on changes and answers read catalog', async () => {
    const frames: SessionMessage[] = [];
    const recording = loadRecording(SESSION_VIEW);
    const depth = new SessionDepth(recording.session, recording, (m) => frames.push(m), where, true, 'main', 'm1');
    await depth.subscribe('main-sub', null);
    expect(frames.find((m) => m.kind === 'snapshot')?.body).toMatchObject({ catalog: fixture.catalog });
    expect(depth.capabilities?.reads).toContain('catalog');
    depth.read('main-sub', 'r1', 'catalog');
    expect(frames.find((m) => m.kind === 'read')?.body).toEqual({ id: 'r1', what: 'catalog', result: fixture.catalog });
    const changed: Catalog = { ...fixture.catalog as Catalog, fingerprint: 'changed', commands: [] };
    depth.updateCatalog(changed);
    depth.updateCatalog(changed);
    expect(frames.filter((m) => m.kind === 'catalog')).toHaveLength(1);
    expect(frames.at(-1)?.body).toEqual(changed);
    const agent = Object.keys(recording.meta)[0];
    depth.rows.set(agent, []);
    await depth.subscribe('agent-sub', agent);
    expect(frames.find((m) => m.sub === 'agent-sub' && m.kind === 'snapshot')?.body).not.toHaveProperty('catalog');
  });
  it('keeps older and stale sessions without a catalog, while M1 runs listed prompt and goal forms', async () => {
    const recording = loadRecording(SESSION_VIEW);
    for (const producer of ['m0', 'm1'] as const) {
      const frames: SessionMessage[] = [];
      const depth = new SessionDepth(recording.session, recording, (m) => frames.push(m), where, true, 'main', producer);
      depth.stale = producer === 'm1';
      await depth.subscribe('s', null);
      expect(frames[0].body).not.toHaveProperty('catalog');
    }
    const commands = new Commands({}, loadRoutes(), true);
    expect(commands.plan('probe:probe-prompt (MCP)', 'hello', 's', 'mini')).toMatchObject({ ok: true, route: 'run-prompt' });
    expect(commands.plan('goal', 'clear', 's', 'mini')).toMatchObject({ ok: true, route: 'run' });
    expect(commands.plan('goal', 'finish', 's', 'mini')).toMatchObject({ ok: true, route: 'run-prompt' });
    expect(commands.plan('not:listed', '', 's', 'mini')).toMatchObject({ ok: false });
    expect(commands.plan('exit', '', 's', 'mini')).toMatchObject({ ok: false, code: 'disabled' });
  });
});
