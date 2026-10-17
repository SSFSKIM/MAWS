// P3-HD's direct-route group (`pnpm e2e:connectors-direct`, MAWS_CONNECTORS_DIRECT_E2E=1; the spec skips itself
// otherwise, so `pnpm e2e` is unchanged). docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, M1; P3 co-work
// Decision Log 98 (1)-(3) and (9). M1's cases are the no-model scratch-source probe: the installed engine launched as
// MAWS launches it under a scratch HOME and config home (support/connector-direct-probe.ts), its real mcp_status
// answers observed by route D's cache (src/engine-host/connectors/provenance.ts), and what that cache would hand MAWS's
// own instance compared with the instance the engine actually started from the same file (the fixture's start log). No
// owner configuration is read, no model is called, and no tool is called by anything here. Every listener is 127.0.0.1.
//   sources: user and local entries from a CLAUDE_CONFIG_DIR are admitted with H's fingerprint and the engine's own
//          expansion of their omitted env, PATH and cwd; project and dynamic entries stay engine-only; an HTTP entry's
//          header matches what the engine sent; a needs-auth server's source is admitted without tool metadata.
//   home: with no CLAUDE_CONFIG_DIR the file is $HOME/.claude.json.
//   git root: inside a repository, which `projects` key the engine reads is recorded, and nothing admitted is an
//          entry other than the one the engine started.
//   negative: a positive report, its engine gone, then another launch of the same context without the server (and
//          one with it disabled): engine-only until the cache is cleared, then admitted again from a fresh report.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type TestInfo } from '@playwright/test';
import type { McpStatusResponse } from '@shared/wire/control';
import { ConnectorStatusCache } from '../src/engine-host/connectors/provenance';
import { connectorToolState } from '../src/engine-host/connectors/status';
import { PROBE_ARG, PROBE_VALUE, probeLayout, readLog, startHttpFixture, startProbeEngine, stdioEntry, type ProbeEngine, type ProbeLayout } from './support/connector-direct-probe';

test.skip(process.env.MAWS_CONNECTORS_DIRECT_E2E !== '1', 'the direct-route e2e runs under pnpm e2e:connectors-direct (MAWS_CONNECTORS_DIRECT_E2E=1)');
test.describe.configure({ timeout: 180_000 });

type Reported = { name: string; status: string; scope?: string; source?: string; config?: Record<string, unknown> };
const reported = (status: McpStatusResponse) => status.mcpServers as Reported[];
const named = (status: McpStatusResponse, name: string) => reported(status).find((server) => server.name === name);

// Until the gate keeps a passing job's artifacts, each file is also printed to the job's log between markers (fixture
// values only: every path scrubbed, every value a fake the probe wrote).
function printEvidence(label: string, body: string): void {
  const bytes = Buffer.from(body, 'utf8');
  const lines = bytes.toString('base64').match(/.{1,1000}/g) ?? [];
  process.stdout.write(`MAWS-CONNECTORS-DIRECT-EVIDENCE BEGIN ${label} bytes=${bytes.length} sha256=${createHash('sha256').update(bytes).digest('hex')}\n${lines.join('\n')}\nMAWS-CONNECTORS-DIRECT-EVIDENCE END ${label}\n`);
}

async function withEngine<T>(info: TestInfo, label: string, layout: ProbeLayout, options: Parameters<typeof startProbeEngine>[1], run: (engine: ProbeEngine) => Promise<T>): Promise<T> {
  const engine = await startProbeEngine(layout, options);
  try {
    return await run(engine);
  } finally {
    await engine.close();
    const wire = engine.wire();
    await info.attach(`${label}-engine-wire.jsonl`, { body: wire, contentType: 'application/x-ndjson' });
    printEvidence(`${label}/engine-wire.jsonl`, wire);
    info.annotations.push({ type: 'engine', description: engine.version });
  }
}

// What a run found, as an annotation and an evidence file: names, statuses, scope and source labels, the reported
// config's field names (never its values) and the cache's answer.
async function summarize(info: TestInfo, label: string, cache: ConnectorStatusCache, cwd: string, status: McpStatusResponse): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const server of reported(status)) {
    const answer = await cache.resolveSource(cwd, server.name);
    rows.push({ name: server.name, status: server.status, scope: server.scope ?? null, source: server.source ?? null, configFields: Object.keys(server.config ?? {}).sort(), cache: answer.ok ? { ok: true, scope: answer.source.scope, transport: answer.source.transport, entryPath: answer.source.entryPath.map((part) => (part === cwd ? '<cwd>' : part)) } : answer });
  }
  const body = `${JSON.stringify(rows, null, 2)}\n`;
  info.annotations.push({ type: `${label}-sources`, description: JSON.stringify(rows) });
  await info.attach(`${label}-sources.json`, { body, contentType: 'application/json' });
  printEvidence(`${label}/sources.json`, body);
  return rows;
}

const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));
const startOf = (layout: ProbeLayout, id: string) => readLog(layout).filter((entry) => entry.event === 'start' && entry.server === id);

// The instance the engine started from an entry against what the cache would start: argv after the script, cwd and
// every configured env value (MAWS_PROBE_*), from the same file under the same launch environment.
async function expectSameInstance(cache: ConnectorStatusCache, layout: ProbeLayout, engine: ProbeEngine, cwd: string, name: string, id: string): Promise<void> {
  const source = await cache.resolveSource(cwd, name);
  expect(source, name).toMatchObject({ ok: true });
  if (!source.ok) return;
  const read = await cache.readEntry(source.source);
  expect(read, name).toMatchObject({ ok: true, entry: { transport: 'stdio' } });
  if (!read.ok || read.entry.transport !== 'stdio') return;
  const entry = read.entry;
  expect(entry.executable, `${name} is found on the launch PATH`).toBe(join(layout.bin, 'probe-node'));
  expect(entry.env.PATH).toBe(engine.env.PATH);
  expect((process.env.PATH ?? '').split(':'), 'the host’s own PATH could not have found it').not.toContain(layout.bin);
  expect(Object.keys(entry.env).filter((key) => !['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'].includes(key) && !key.startsWith('MAWS_PROBE_')), 'no inherited key beyond the SDK minimum').toEqual([]);
  expect(entry.cwd).toBe(cwd);
  const starts = startOf(layout, id);
  expect(starts.length, `${id} was started by the engine`).toBeGreaterThan(0);
  const started = starts.at(-1)!;
  expect(started.cwd, `${id}'s cwd`).toBe(cwd);
  expect(started.argv, `${id}'s arguments, expanded`).toEqual(entry.args.slice(1));
  expect(entry.args).toContain(PROBE_ARG);
  const configured = Object.fromEntries(Object.entries(entry.env).filter(([key]) => key.startsWith('MAWS_PROBE_')));
  expect(configured, `${id}'s omitted env, as MAWS expands it`).toEqual(started.env);
  expect(configured.MAWS_PROBE_EXPANDED).toBe(PROBE_VALUE);
}

test('sources: user and local entries are admitted as the engine ran them; project and dynamic stay engine-only', async () => {
  const info = test.info();
  const layout = probeLayout();
  const http = await startHttpFixture(layout, 'userhttp');
  const auth = await startHttpFixture(layout, 'userauth', { auth: true });
  try {
    writeJson(join(layout.config, '.claude.json'), {
      hasCompletedOnboarding: true,
      mcpServers: { usertoy: stdioEntry(layout, 'usertoy'), userhttp: { type: 'http', url: http.url, headers: { 'X-Probe-Header': '${XDG_MAWS_PROBE_VALUE}' } }, userauth: { type: 'http', url: auth.url } },
      projects: { [layout.project]: { hasTrustDialogAccepted: true, mcpServers: { localtoy: stdioEntry(layout, 'localtoy') } } },
    });
    writeJson(join(layout.project, '.mcp.json'), { mcpServers: { projtoy: stdioEntry(layout, 'projtoy') } });
    await withEngine(info, 'sources', layout, { cwd: layout.project, configDir: true, dynamic: { mcpServers: { dyntoy: stdioEntry(layout, 'dyntoy') } } }, async (engine) => {
      const status = await engine.settled();
      const cache = new ConnectorStatusCache();
      cache.observe(cache.begin(engine.context), status);
      await summarize(info, 'sources', cache, layout.project, status);

      for (const [name, scope] of [['usertoy', 'user'], ['localtoy', 'local']] as const) {
        expect(named(status, name), name).toMatchObject({ status: 'connected', scope });
        const ready = connectorToolState(status, name, 'rows');
        const resolved = await cache.resolve(layout.project, name, 'rows');
        expect(resolved, name).toMatchObject({ ok: true, source: { scope, path: join(layout.config, '.claude.json') }, tool: { readOnly: true } });
        expect(ready.ready && resolved.ok && resolved.tool.fingerprint === ready.fingerprint, `${name}: H's fingerprint on both routes`).toBe(true);
        await expectSameInstance(cache, layout, engine, layout.project, name, name);
      }

      expect(named(status, 'userhttp'), 'userhttp').toMatchObject({ status: 'connected', scope: 'user' });
      const httpSource = await cache.resolve(layout.project, 'userhttp', 'rows');
      expect(httpSource).toMatchObject({ ok: true, source: { transport: 'http', url: http.url } });
      const httpReady = connectorToolState(status, 'userhttp', 'rows');
      expect(httpReady.ready && httpSource.ok && httpSource.tool.fingerprint === httpReady.fingerprint).toBe(true);
      if (httpSource.ok) {
        const read = await cache.readEntry(httpSource.source);
        const sent = readLog(layout).filter((entry) => entry.server === 'userhttp' && entry.event === 'http' && entry.method === 'initialize').map((entry) => entry.probeHeader);
        expect(sent.length, 'the engine initialized the http fixture').toBeGreaterThan(0);
        expect(read).toMatchObject({ ok: true, entry: { transport: 'http', headers: { 'X-Probe-Header': sent.at(-1) } } });
        expect(sent.at(-1)).toBe(PROBE_VALUE);
      }

      // the bootstrap case: a server the engine reports needs-auth (no tools) is still an attested source
      const authStatus = named(status, 'userauth')?.status;
      info.annotations.push({ type: 'needs-auth', description: JSON.stringify({ status: authStatus ?? null }) });
      if (authStatus === 'needs-auth') expect(await cache.resolve(layout.project, 'userauth', 'rows')).toMatchObject({ ok: true, source: { transport: 'http', url: auth.url }, tool: { readOnly: null } });
      else expect(['failed', 'pending']).toContain(authStatus); // recorded; such a status attests nothing

      for (const name of ['projtoy', 'dyntoy']) {
        const answer = await cache.resolveSource(layout.project, name);
        expect(answer.ok, `${name} is never a direct source in this cut`).toBe(false);
        if (named(status, name)?.status === 'connected') expect(answer).toEqual({ ok: false, why: 'engineOnly' });
      }
      expect(readLog(layout).filter((entry) => entry.method === 'tools/call'), 'nothing here calls a tool').toEqual([]);
    });
  } finally {
    http.close();
    auth.close();
    layout.close();
  }
});

test('home: with no CLAUDE_CONFIG_DIR the user file is $HOME/.claude.json', async () => {
  const info = test.info();
  const layout = probeLayout();
  try {
    writeJson(join(layout.home, '.claude.json'), { hasCompletedOnboarding: true, mcpServers: { homeuser: stdioEntry(layout, 'homeuser') } });
    writeJson(join(layout.config, '.claude.json'), { hasCompletedOnboarding: true, mcpServers: { configuser: stdioEntry(layout, 'configuser') } }); // unused by this launch
    await withEngine(info, 'home', layout, { cwd: layout.project, configDir: false }, async (engine) => {
      const status = await engine.settled();
      const cache = new ConnectorStatusCache();
      cache.observe(cache.begin(engine.context), status);
      await summarize(info, 'home', cache, layout.project, status);
      expect(named(status, 'homeuser')).toMatchObject({ status: 'connected', scope: 'user' });
      expect(named(status, 'configuser')).toBeUndefined();
      expect(await cache.resolveSource(layout.project, 'homeuser')).toMatchObject({ ok: true, source: { path: join(layout.home, '.claude.json') } });
      await expectSameInstance(cache, layout, engine, layout.project, 'homeuser', 'homeuser');
    });
  } finally {
    layout.close();
  }
});

test('git root: inside a repository nothing admitted is an entry other than the one the engine started', async () => {
  const info = test.info();
  const layout = probeLayout();
  try {
    const repo = join(layout.scratch, 'repo');
    const sub = join(repo, 'sub');
    mkdirSync(sub, { recursive: true });
    execFileSync('git', ['init', '-q', repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    writeJson(join(layout.config, '.claude.json'), {
      hasCompletedOnboarding: true,
      projects: {
        [repo]: { hasTrustDialogAccepted: true, mcpServers: { rootlocal: stdioEntry(layout, 'rootlocal'), twin: stdioEntry(layout, 'twin', { MAWS_PROBE_WHICH: 'root' }) } },
        [sub]: { hasTrustDialogAccepted: true, mcpServers: { sublocal: stdioEntry(layout, 'sublocal'), twin: stdioEntry(layout, 'twin', { MAWS_PROBE_WHICH: 'sub' }) } },
      },
    });
    await withEngine(info, 'git-root', layout, { cwd: sub, configDir: true }, async (engine) => {
      const status = await engine.settled();
      const cache = new ConnectorStatusCache();
      cache.observe(cache.begin(engine.context), status);
      const rows = await summarize(info, 'git-root', cache, sub, status);
      info.annotations.push({ type: 'projects-key', description: JSON.stringify({ rootlocal: named(status, 'rootlocal')?.scope ?? null, sublocal: named(status, 'sublocal')?.scope ?? null }) });
      expect(rows.length, 'the engine reported its local servers').toBeGreaterThan(0);
      // An entry from the repository's key is never found under the cwd's; a same-visible twin is never told apart.
      if (named(status, 'rootlocal')) expect(await cache.resolveSource(sub, 'rootlocal')).toEqual({ ok: false, why: 'changed' });
      if (named(status, 'twin')) expect(await cache.resolveSource(sub, 'twin')).toEqual({ ok: false, why: 'ambiguous' });
      if (named(status, 'sublocal')?.status === 'connected') await expectSameInstance(cache, layout, engine, sub, 'sublocal', 'sublocal');
    });
  } finally {
    layout.close();
  }
});

test('negative: positive, exit, then a launch without it or with it disabled is engine-only until a reset and a fresh report', async () => {
  const info = test.info();
  const layout = probeLayout();
  const file = join(layout.config, '.claude.json');
  const config = (extra: { remove?: boolean; disabled?: boolean } = {}) =>
    writeJson(file, {
      hasCompletedOnboarding: true,
      mcpServers: { ...(!extra.remove && { usertoy: stdioEntry(layout, 'usertoy') }), steady: stdioEntry(layout, 'steady') },
      projects: { [layout.project]: { hasTrustDialogAccepted: true, ...(extra.disabled && { disabledMcpServers: ['usertoy'] }) } },
    });
  try {
    const cache = new ConnectorStatusCache();
    const observe = (label: string, appSessionId: string) =>
      withEngine(info, label, layout, { cwd: layout.project, configDir: true, appSessionId }, async (engine) => {
        const status = await engine.settled();
        cache.observe(cache.begin(engine.context), status);
        return status;
      });
    config();
    const first = await observe('negative-positive', 'probe-a');
    expect(named(first, 'usertoy')).toMatchObject({ status: 'connected', scope: 'user' });
    expect(await cache.resolveSource(layout.project, 'usertoy')).toMatchObject({ ok: true }); // its engine has exited

    config({ remove: true });
    const absent = await observe('negative-absent', 'probe-b');
    expect(named(absent, 'usertoy')).toBeUndefined();
    config(); // the file is back as it was: the contradiction, not the file, is what refuses
    expect(await cache.resolveSource(layout.project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
    expect(await cache.resolveSource(layout.project, 'steady')).toMatchObject({ ok: true });

    cache.clear();
    expect(await cache.resolveSource(layout.project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
    await observe('negative-fresh', 'probe-c');
    expect(await cache.resolveSource(layout.project, 'usertoy')).toMatchObject({ ok: true });

    config({ disabled: true });
    const disabled = await observe('negative-disabled', 'probe-d');
    info.annotations.push({ type: 'disabled', description: JSON.stringify({ status: named(disabled, 'usertoy')?.status ?? null }) });
    config();
    const disabledStatus = named(disabled, 'usertoy')?.status;
    if (disabledStatus === undefined || disabledStatus === 'disabled') expect(await cache.resolveSource(layout.project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
  } finally {
    layout.close();
  }
});
