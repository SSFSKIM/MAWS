// P3-HD M2: the synchronous source-validity seam (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, M2 and
// Decision Log 10). A lookup's own fence ends when its promise settles; route D's last check at the actual transport
// write is synchronous, so `readEntryForWrite`'s answer carries `stillValid()`, which answers for every cache change after
// that settlement. A launch that only repeats the same facts (an eligible engine appearing for the same source) keeps
// it valid: the next call selects route E, this one is not cancelled. Scratch config files throughout.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpStatusResponse } from '@shared/wire/control';
import { CONNECTOR_STATUS_BOUNDS, ConnectorStatusCache, connectorLaunchContext, type ConnectorWriteEntryAnswer, type ConnectorLaunchContext } from './provenance';

type Server = { name: string; status: string; scope?: string; source?: string; config?: Record<string, unknown>; tools?: { name: string; annotations?: Record<string, unknown> }[] };
const report = (...servers: Server[]): McpStatusResponse => ({ mcpServers: servers });
const toy = (overrides: Partial<Server> = {}, args = ['toy-server.mjs', 'stdio']): Server => ({ name: 'usertoy', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args }, tools: [{ name: 'rows', annotations: { readOnly: true } }], ...overrides });
const other = (): Server => ({ name: 'othertoy', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args: ['other'] } });

let dir: string;
let config: string;
let project: string;
let bin: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-hd-validity-'));
  config = join(dir, 'config');
  project = join(dir, 'project');
  bin = join(dir, 'bin');
  for (const path of [join(dir, 'home'), config, join(dir, 'config-2'), project, bin, join(dir, 'bin-2')]) mkdirSync(path);
  for (const path of [join(bin, 'toy'), join(dir, 'bin-2', 'toy')]) {
    writeFileSync(path, '#!/bin/sh\nexit 0\n');
    chmodSync(path, 0o755);
  }
  const file = { mcpServers: { usertoy: { type: 'stdio', command: 'toy', args: ['toy-server.mjs', 'stdio'] }, othertoy: { type: 'stdio', command: 'toy', args: ['other'] } } };
  writeFileSync(join(config, '.claude.json'), JSON.stringify(file));
  writeFileSync(join(dir, 'config-2', '.claude.json'), JSON.stringify(file));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const launch = (appSessionId: string, launchId: string, extra: Record<string, string> = {}): ConnectorLaunchContext =>
  connectorLaunchContext({ appSessionId, launchId, cwd: project, environment: { HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: config, PATH: bin, USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TERM: 'dumb', ...extra }, localKey: { kind: 'directory', key: project } });
const observed = (cache: ConnectorStatusCache, context: ConnectorLaunchContext, answer: McpStatusResponse) => cache.observe(cache.begin(context), answer);

async function entry(cache: ConnectorStatusCache): Promise<Extract<ConnectorWriteEntryAnswer, { ok: true }>> {
  const resolved = await cache.resolveSource(project, 'usertoy');
  if (!resolved.ok) throw new Error(resolved.why);
  const read = await cache.readEntryForWrite(resolved.source);
  if (!read.ok) throw new Error(read.why);
  return read;
}

describe('readEntryForWrite’s stillValid: the cache behind an entry, answered synchronously after the lookup settled', () => {
  it('holds while nothing changes, and across reports and launches that repeat the same facts', async () => {
    const cache = new ConnectorStatusCache();
    observed(cache, launch('app-1', 'L1'), report(toy(), other()));
    const read = await entry(cache);
    expect(read.stillValid()).toBe(true);
    observed(cache, launch('app-1', 'L1'), report(toy(), other())); // the same launch's newer, identical report
    observed(cache, launch('app-2', 'L2'), report(toy(), other())); // an eligible engine appears for the same source
    observed(cache, launch('app-3', 'L3'), report(toy({ status: 'pending', tools: undefined }), other())); // one reporting it pending attests nothing
    observed(cache, launch('app-4', 'L4'), report(toy())); // another server's absence elsewhere is that server's contradiction alone
    expect(read.stillValid()).toBe(true);
    expect((await cache.readEntryForWrite(read.source)).ok).toBe(true); // a fresh lookup agrees
  });

  const breaks: [string, (cache: ConnectorStatusCache) => void][] = [
    ['another launch reports it absent', (cache) => observed(cache, launch('app-2', 'L2'), report(other()))],
    ['another launch reports it disabled', (cache) => observed(cache, launch('app-2', 'L2'), report(toy({ status: 'disabled', tools: undefined }), other()))],
    ['another launch reports another identity', (cache) => observed(cache, launch('app-2', 'L2'), report(toy({}, ['changed']), other()))],
    ['its own launch’s newer report changes its meaning', (cache) => observed(cache, launch('app-1', 'L1'), report(toy({}, ['changed']), other()))],
    ['its own launch’s newer report removes it', (cache) => observed(cache, launch('app-1', 'L1'), report(other()))],
    ['a report names it twice', (cache) => observed(cache, launch('app-2', 'L2'), report(toy(), toy(), other()))],
    ['its context’s newer report is malformed', (cache) => cache.reject(cache.begin(launch('app-1', 'L1')))],
    ['another context at the directory fails', (cache) => cache.reject(cache.begin(launch('app-2', 'L2', { CLAUDE_CONFIG_DIR: join(dir, 'config-2') })))],
    ['another config home at the directory reports it too', (cache) => observed(cache, launch('app-2', 'L2', { CLAUDE_CONFIG_DIR: join(dir, 'config-2') }), report(toy()))],
    ['an agreeing launch has other launch facts (another PATH)', (cache) => observed(cache, launch('app-2', 'L2', { PATH: join(dir, 'bin-2') }), report(toy(), other()))],
    ['the attachment clears', (cache) => cache.clear()],
    ['a clear and the same observation again', (cache) => (cache.clear(), observed(cache, launch('app-1', 'L1'), report(toy(), other())))],
    ['its directory is refused past the context bound', (cache) => {
      for (let index = 0; index < CONNECTOR_STATUS_BOUNDS.contexts; index++) observed(cache, connectorLaunchContext({ appSessionId: `fill-${index}`, launchId: 'L', cwd: join(dir, `d${index}`), environment: {} }), report());
      observed(cache, launch('app-2', 'L2', { CLAUDE_CONFIG_DIR: join(dir, 'config-2') }), report());
    }],
    ['the cache saturates', (cache) => {
      for (let index = 0; index <= CONNECTOR_STATUS_BOUNDS.launches; index++) cache.begin(launch(`s-${index}`, 'L'));
    }],
  ];
  for (const [label, mutate] of breaks) {
    it(`fails when ${label}, as a fresh lookup refuses`, async () => {
      const cache = new ConnectorStatusCache();
      observed(cache, launch('app-1', 'L1'), report(toy(), other()));
      const read = await entry(cache);
      mutate(cache);
      expect(read.stillValid()).toBe(false);
      expect((await cache.readEntryForWrite(read.source)).ok).toBe(false);
    });
  }

  it('fails for a change that lands between the lookup’s settlement and its caller’s continuation', async () => {
    const cache = new ConnectorStatusCache();
    observed(cache, launch('app-1', 'L1'), report(toy(), other()));
    const resolved = await cache.resolveSource(project, 'usertoy');
    if (!resolved.ok) throw new Error(resolved.why);
    const pending = cache.readEntryForWrite(resolved.source);
    // queued behind the lookup's settlement, ahead of the awaiting caller's continuation
    void pending.then(() => observed(cache, launch('app-2', 'L2'), report(other())));
    const read = await pending;
    if (!read.ok) throw new Error(read.why);
    expect(read.stillValid()).toBe(false);
  });

  it('stays failed once failed: a contradiction is sticky, and a clear never revives an earlier answer', async () => {
    const cache = new ConnectorStatusCache();
    observed(cache, launch('app-1', 'L1'), report(toy(), other()));
    const read = await entry(cache);
    cache.clear();
    observed(cache, launch('app-1', 'L1'), report(toy(), other()));
    await entry(cache); // a fresh lookup in the new attachment mints a new source
    expect(read.stillValid()).toBe(false);
  });
});
