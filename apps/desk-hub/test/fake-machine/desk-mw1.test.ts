// The fake machine as the machine-side wave's MW1 producer (`producer: 'mw1'`), on the local runtime through the
// stand-in: each bridged session's presence carries `capabilities.controls`, every control's key with whether its bridge
// can do it and why not; the reads of usage (the full count when asked), config, settings and MCP are answered on the
// sub that asked, as the MW1 live check recorded them on 2.1.310; an agent's sub is told a read is the session's; and an
// M1 producer serves none of them.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine, loadRecording, MW1_CAPABILITIES, MW1_READS, TWO_SUBAGENTS, type Producer } from '../../fake-machine';
import type { ProjectDown } from '../../src/protocol/browser';
import { newNonce } from '../../src/protocol/codes';
import { CONTROL_KEYS, type ConfigRead, type McpRead, type ReadAnswer, type SessionMessage, type SessionPresence, type SettingsRead, type UsageRead } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

let hub: LocalHub;
let member: string;
beforeAll(async () => {
  hub = await startLocalHub();
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const RAW_KEY = new Uint8Array(32).fill(12);
let count = 0;
const newProject = () => `9c3e0a8e-3b2d-4c5e-9f71-${(++count).toString(16).padStart(12, '0')}`;

async function setUp(producer: Producer = 'mw1') {
  const project = newProject();
  const recording = loadRecording(TWO_SUBAGENTS);
  const credentials = await enroll(hub, ADMIN, `mw1-${count}`);
  const fm = new FakeMachine({ hub: hub.url, machine: `mw1-${count}`, credentials, orgKey: RAW_KEY, project, recordings: [recording], member, producer });
  await fm.connect();
  const b = await BrowserClient.open(hub, ADMIN, project);
  await b.next((f) => f.t === 'deliveries', 'the end of the connect sequence');
  const subscribe = async (agentId: string | null = null) => {
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: fm.name, session: recording.session, agentId, sub });
    await b.next((f) => f.t === 'session' && f.message.sub === sub && f.message.kind === 'snapshot', 'the snapshot');
    return sub;
  };
  return { fm, b, recording, subscribe };
}

const sessionMessages = (b: BrowserClient, kind: SessionMessage['kind']) => b.frames.flatMap((f) => (f.t === 'session' && f.message.kind === kind ? [f.message] : []));
const presences = (b: BrowserClient) => sessionMessages(b, 'presence').map((m) => m.body as SessionPresence);
const reads = (b: BrowserClient) => sessionMessages(b, 'read').map((m) => m.body as ReadAnswer);

async function until(test: () => boolean, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('the MW1 recording', () => {
  it('is the file the README names, byte for byte', () => {
    const at = (name: string) => fileURLToPath(new URL(`../../fake-machine/dx4/${name}`, import.meta.url));
    const sha = createHash('sha256').update(readFileSync(at('mw1-reads.json'))).digest('hex');
    expect(readFileSync(at('README.md'), 'utf8')).toContain(sha);
  });
});

describe('the fake machine as the MW1 producer', () => {
  it("advertises every control's capability, the controls the desk had before the wave and MW1's reads available", async () => {
    const { fm, b } = await setUp();
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk?.sminos).toBe('1.11.0');
    const capabilities = presences(b).at(-1)?.capabilities;
    expect(capabilities).toEqual(MW1_CAPABILITIES);
    expect(capabilities?.reads).toEqual(['status', 'catalog', 'usage', 'config', 'settings', 'mcp']);
    const controls = capabilities?.controls ?? {};
    expect(Object.keys(controls)).toEqual([...CONTROL_KEYS]);
    expect(CONTROL_KEYS.filter((k) => controls[k]?.available)).toEqual([
      'read.usage', 'read.config', 'read.settings', 'read.mcp', 'compact', 'model', 'mcp.enable', 'mcp.disable', 'mcp.reconnect', 'decide',
    ]);
    for (const key of CONTROL_KEYS.filter((k) => !controls[k]?.available)) {
      expect(controls[key]?.reason, key).toMatch(/\S/);
    }
    expect(controls.btw?.reason).toContain('1.11.0');
    b.close();
    await fm.close();
  });

  it('answers the four reads on the sub that asked, as recorded; usage counts in full only when asked', async () => {
    const { fm, b, subscribe } = await setUp();
    const sub = await subscribe();
    b.send({ t: 'read', sub, id: 'u', what: 'usage' });
    b.send({ t: 'read', sub, id: 'uf', what: 'usage', args: { breakdown: 'full' } });
    b.send({ t: 'read', sub, id: 'ux', what: 'usage', args: { breakdown: 'exact' } });
    b.send({ t: 'read', sub, id: 'c', what: 'config' });
    b.send({ t: 'read', sub, id: 's', what: 'settings' });
    b.send({ t: 'read', sub, id: 'm', what: 'mcp' });
    await until(() => reads(b).length === 6, 'six answers');
    const got = Object.fromEntries(reads(b).map((r) => [r.id, r]));

    const usage = got.u!.result as unknown as UsageRead;
    expect(usage).toEqual(MW1_READS.usage);
    expect(usage.breakdownDetail).toBe('summary');
    expect(usage.context.window).toBeGreaterThan(0);
    expect(usage.context.breakdown).toHaveProperty('categories');
    expect((got.uf!.result as unknown as UsageRead).breakdownDetail).toBe('full');
    expect(got.ux).toMatchObject({ error: { code: 'failed', message: "usage's breakdown is summary or full" } });

    const config = got.c!.result as unknown as ConfigRead;
    expect(config.readOnly).toBe(true);
    const pluginText = config.rows.filter((r) => r.provider.plugin !== 'engine' && r.kind === 'text');
    expect(pluginText.length).toBeGreaterThan(0);
    expect(pluginText.every((r) => !('value' in r))).toBe(true);
    expect(config.rows.find((r) => r.key === 'model')).toMatchObject({ kind: 'choice', provider: { plugin: 'engine', tier: 'core' } });

    const settings = got.s!.result as unknown as SettingsRead;
    expect(settings.permissionsExact).toBe(false);
    expect(Object.keys(settings.permissions.bySource).sort()).toEqual(['cliArg', 'local', 'policy', 'project', 'user']);
    expect(settings.hooks.PreToolUse).toEqual([{ matcher: 'Bash', commands: 1 }]);
    expect(JSON.stringify(settings)).not.toMatch(/LIVE-HOOK-SECRET|live-env-secret/);

    const mcp = got.m!.result as unknown as McpRead;
    expect(mcp.exact).toBe(false);
    expect(mcp.servers).toContainEqual({ name: 'probe_server', status: 'connected', tools: 2 });
    expect(mcp.servers).toContainEqual({ name: 'parked server', status: 'disabled' });
    b.close();
    await fm.close();
  });

  it("tells an agent's sub that a read is the session's", async () => {
    const { fm, b, recording, subscribe } = await setUp();
    await fm.play({ speed: 0 });
    const agent = Object.keys(recording.meta)[0]!;
    const sub = await subscribe(agent);
    b.send({ t: 'read', sub, id: 'a', what: 'config' });
    await until(() => reads(b).length === 1, 'the answer');
    expect(reads(b)[0]).toMatchObject({ id: 'a', what: 'config', error: { code: 'unsupported' } });
    b.close();
    await fm.close();
  });

  it('as an M1 producer, carries no controls and serves none of the four reads', async () => {
    const { fm, b, subscribe } = await setUp('m1');
    expect(presences(b).at(-1)?.capabilities).not.toHaveProperty('controls');
    const sub = await subscribe();
    b.send({ t: 'read', sub, id: 'c', what: 'config' });
    await until(() => reads(b).length === 1, 'the answer');
    expect(reads(b)[0]).toMatchObject({ id: 'c', what: 'config', error: { code: 'unsupported', message: 'no read config' } });
    b.close();
    await fm.close();
  });
});
