// P3-HD's direct-route group (`pnpm e2e:connectors-direct`, MAWS_CONNECTORS_DIRECT_E2E=1; the spec skips itself
// otherwise, so `pnpm e2e` is unchanged). docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, M1; P3 co-work
// Decision Log 98 (1)-(3) and (9), with P3-HD's settings ruling. M1's cases are the no-model scratch-source probe: the
// installed engine launched as MAWS launches it under a scratch HOME and config home (support/connector-direct-probe.ts),
// its real mcp_status answers observed by route D's cache (src/engine-host/connectors/provenance.ts), and what that cache
// would hand MAWS's own instance compared with the instance the engine actually started from the same file (the
// fixture's start log). No owner configuration is read, no model is called, no tool is called. Every listener is
// 127.0.0.1. Each expectation below is what the 2.1.300 readable bundle says the engine does; a different observation
// fails the case, and the wire and the sources summary it printed are the evidence.
//   sources: user entries from a CLAUDE_CONFIG_DIR admitted as the engine ran them (PATH, cwd, argv, env, the SDK-minimal
//          keys, H's fingerprint, an HTTP header as sent); a needs-auth server's source without tool metadata; a
//          referencing entry unattested; local, project and dynamic entries never direct.
//   home: with no CLAUDE_CONFIG_DIR the file is $HOME/.claude.json.
//   settings: what the engine hands a stdio server for a variable only settings set (with and without a default), one
//          settings override over the launch, a benign credential-shaped name, a known-withheld synthetic name and one
//          set nowhere; the reference policy keeps that entry unattested whichever way the override goes.
//   git root: the `projects` key the engine reads at a repository's root and in its child directory.
//   negative: a positive report, its engine gone, then another launch of the same context without the server (and one
//          with it disabled): engine-only until the cache is cleared, then admitted again from a fresh report.
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
const SDK_KEYS = ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'];

// Until the gate keeps a passing job's artifacts, each file is also printed to the job's log between markers (fixture
// values only: every path scrubbed, every value a fake the probe wrote).
function printEvidence(label: string, body: string): void {
  const bytes = Buffer.from(body, 'utf8');
  const lines = bytes.toString('base64').match(/.{1,1000}/g) ?? [];
  process.stdout.write(`MAWS-CONNECTORS-DIRECT-EVIDENCE BEGIN ${label} bytes=${bytes.length} sha256=${createHash('sha256').update(bytes).digest('hex')}\n${lines.join('\n')}\nMAWS-CONNECTORS-DIRECT-EVIDENCE END ${label}\n`);
}

async function evidence(info: TestInfo, label: string, value: unknown): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await info.attach(`${label}.json`, { body, contentType: 'application/json' });
  printEvidence(`${label}.json`, body);
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

// What a run found, written before its assertions: names, statuses, scope and source labels, the reported config's field
// names (never its values) and the cache's answer.
async function summarize(info: TestInfo, label: string, cache: ConnectorStatusCache, cwd: string, status: McpStatusResponse): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const server of reported(status)) {
    const answer = await cache.resolveSource(cwd, server.name);
    rows.push({ name: server.name, status: server.status, scope: server.scope ?? null, source: server.source ?? null, configFields: Object.keys(server.config ?? {}).sort(), cache: answer.ok ? { ok: true, scope: answer.source.scope, transport: answer.source.transport, entryPath: answer.source.entryPath.map((part) => (part === cwd ? '<cwd>' : part)) } : answer });
  }
  info.annotations.push({ type: `${label}-sources`, description: JSON.stringify(rows) });
  await evidence(info, `${label}-sources`, rows);
}

const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));
const lastStart = (layout: ProbeLayout, id: string) => readLog(layout).filter((entry) => entry.event === 'start' && entry.server === id).at(-1);

// The instance the engine started from an entry against what the cache would start: argv after the script, cwd, every
// configured env value and the SDK-minimal keys, from the same file under the same launch.
async function expectSameInstance(cache: ConnectorStatusCache, layout: ProbeLayout, engine: ProbeEngine, cwd: string, name: string): Promise<void> {
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
  expect(Object.keys(entry.env).filter((key) => !SDK_KEYS.includes(key) && !key.startsWith('MAWS_PROBE_')), 'no inherited key beyond the SDK minimum').toEqual([]);
  expect(entry.cwd).toBe(cwd);
  const started = lastStart(layout, name);
  expect(started, `${name} was started by the engine`).toBeDefined();
  expect(started!.cwd, `${name}'s cwd`).toBe(cwd);
  expect(started!.argv, `${name}'s arguments`).toEqual(entry.args.slice(1));
  expect(Object.fromEntries(Object.entries(entry.env).filter(([key]) => key.startsWith('MAWS_PROBE_'))), `${name}'s configured env`).toEqual(started!.env);
  expect(Object.fromEntries(Object.entries(entry.env).filter(([key]) => SDK_KEYS.includes(key))), `${name}'s SDK-minimal keys`).toEqual(started!.sdk);
}

test('sources: user entries are admitted as the engine ran them; a needs-auth source without tools; referencing, local, project and dynamic entries never direct', async () => {
  const info = test.info();
  const layout = probeLayout();
  const http = await startHttpFixture(layout, 'userhttp');
  const auth = await startHttpFixture(layout, 'userauth', { auth: true });
  try {
    writeJson(join(layout.config, '.claude.json'), {
      hasCompletedOnboarding: true,
      mcpServers: {
        usertoy: stdioEntry(layout, 'usertoy', { args: ['--literal', 'value'] }),
        userref: stdioEntry(layout, 'userref', { args: ['--arg', '${XDG_MAWS_PROBE_ARG}'] }),
        userhttp: { type: 'http', url: http.url, headers: { 'X-Probe-Header': PROBE_VALUE } },
        userauth: { type: 'http', url: auth.url },
      },
      projects: { [layout.project]: { hasTrustDialogAccepted: true, mcpServers: { localtoy: stdioEntry(layout, 'localtoy') } } },
    });
    writeJson(join(layout.project, '.mcp.json'), { mcpServers: { projtoy: stdioEntry(layout, 'projtoy') } });
    await withEngine(info, 'sources', layout, { cwd: layout.project, configDir: true, dynamic: { mcpServers: { dyntoy: stdioEntry(layout, 'dyntoy') } } }, async (engine) => {
      const status = await engine.settled();
      const cache = new ConnectorStatusCache();
      cache.observe(cache.begin(engine.context), status);
      await summarize(info, 'sources', cache, layout.project, status);

      expect(named(status, 'usertoy'), 'usertoy').toMatchObject({ status: 'connected', scope: 'user' });
      const ready = connectorToolState(status, 'usertoy', 'rows');
      const resolved = await cache.resolve(layout.project, 'usertoy', 'rows');
      expect(resolved).toMatchObject({ ok: true, source: { scope: 'user', path: join(layout.config, '.claude.json') }, tool: { readOnly: true } });
      expect(ready.ready && resolved.ok && resolved.tool.fingerprint === ready.fingerprint, "H's fingerprint on both routes").toBe(true);
      await expectSameInstance(cache, layout, engine, layout.project, 'usertoy');

      expect(named(status, 'userhttp'), 'userhttp').toMatchObject({ status: 'connected', scope: 'user' });
      const httpSource = await cache.resolve(layout.project, 'userhttp', 'rows');
      expect(httpSource).toMatchObject({ ok: true, source: { transport: 'http', url: http.url } });
      const httpReady = connectorToolState(status, 'userhttp', 'rows');
      expect(httpReady.ready && httpSource.ok && httpSource.tool.fingerprint === httpReady.fingerprint).toBe(true);
      const sent = readLog(layout).filter((entry) => entry.server === 'userhttp' && entry.event === 'http' && entry.method === 'initialize').map((entry) => entry.probeHeader);
      expect(sent.length, 'the engine initialized the http fixture').toBeGreaterThan(0);
      expect(sent.at(-1)).toBe(PROBE_VALUE);
      if (httpSource.ok) expect(await cache.readEntry(httpSource.source)).toMatchObject({ ok: true, entry: { transport: 'http', headers: { 'X-Probe-Header': sent.at(-1) } } });

      // the bootstrap case: the engine reports the protected server needs-auth with no tools, still an attested source
      expect(named(status, 'userauth'), 'userauth').toMatchObject({ status: 'needs-auth', scope: 'user' });
      expect(await cache.resolve(layout.project, 'userauth', 'rows')).toMatchObject({ ok: true, source: { transport: 'http', url: auth.url }, tool: { readOnly: null } });

      // a reference: the engine reports its expansion; MAWS does not attest it under the literal-only policy
      expect(named(status, 'userref'), 'userref').toMatchObject({ status: 'connected', scope: 'user', config: { args: expect.arrayContaining([PROBE_ARG]) } });
      expect(await cache.resolveSource(layout.project, 'userref')).toEqual({ ok: false, why: 'unattested' });

      expect(named(status, 'localtoy'), 'localtoy').toMatchObject({ status: 'connected', scope: 'local' });
      expect(await cache.resolveSource(layout.project, 'localtoy')).toEqual({ ok: false, why: 'unidentified' });
      expect(named(status, 'projtoy'), 'projtoy').toMatchObject({ status: 'connected', scope: 'project' });
      expect(named(status, 'dyntoy'), 'dyntoy').toMatchObject({ status: 'connected', scope: 'dynamic' });
      for (const name of ['projtoy', 'dyntoy']) expect(await cache.resolveSource(layout.project, name), name).toEqual({ ok: false, why: 'engineOnly' });
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
      await expectSameInstance(cache, layout, engine, layout.project, 'homeuser');
    });
  } finally {
    layout.close();
  }
});

// The settings ruling's evidence: whether file settings env fill only what the launch lacks (branch A) or also override
// what it holds (branch B), and what the engine withholds from a stdio server.
test('settings: what the engine hands a stdio server for settings-only, overridden, credential-shaped, withheld and unset variables', async () => {
  const info = test.info();
  const layout = probeLayout();
  try {
    writeJson(join(layout.config, 'settings.json'), { env: { MAWS_SETTING_ONLY: 'from-settings', XDG_MAWS_PROBE_OVERRIDDEN: 'from-settings' } });
    writeJson(join(layout.config, '.claude.json'), {
      hasCompletedOnboarding: true,
      mcpServers: {
        envtoy: stdioEntry(layout, 'envtoy', {
          args: ['--overridden', '${XDG_MAWS_PROBE_OVERRIDDEN}', '--setting', '${MAWS_SETTING_ONLY:-arg-fallback}'],
          env: {
            MAWS_PROBE_ABSENT: '${MAWS_SETTING_ONLY}',
            MAWS_PROBE_ABSENT_FALLBACK: '${MAWS_SETTING_ONLY:-fallback}',
            MAWS_PROBE_NOWHERE_FALLBACK: '${MAWS_PROBE_NOWHERE:-fallback}',
            MAWS_PROBE_OVERRIDDEN: '${XDG_MAWS_PROBE_OVERRIDDEN}',
            MAWS_PROBE_TOKEN_SHAPED: '${XDG_MAWS_PROBE_TOKEN}',
            MAWS_PROBE_WITHHELD: '${MCP_CLIENT_SECRET}',
            MAWS_PROBE_LAUNCH: '${XDG_MAWS_PROBE_VALUE}',
          },
        }),
      },
    });
    const launchEnv = { XDG_MAWS_PROBE_OVERRIDDEN: 'from-launch', XDG_MAWS_PROBE_TOKEN: 'benign-token-shaped-not-a-credential' };
    // MCP_CLIENT_SECRET is on the engine's static stdio withheld list (cli.pretty.js:523063, `rco`); MAWS's allowlist
    // would drop it, so the probe adds a fake value past it to observe the engine's rule
    const syntheticEnv = { MCP_CLIENT_SECRET: 'fake-withheld-not-a-credential' };
    await withEngine(info, 'settings', layout, { cwd: layout.project, configDir: true, launchEnv, syntheticEnv }, async (engine) => {
      const status = await engine.settled();
      const cache = new ConnectorStatusCache();
      cache.observe(cache.begin(engine.context), status);
      await summarize(info, 'settings', cache, layout.project, status);
      expect(named(status, 'envtoy')).toMatchObject({ status: 'connected', scope: 'user' });
      const started = lastStart(layout, 'envtoy');
      expect(started, 'the engine started envtoy').toBeDefined();
      const args = (named(status, 'envtoy')!.config?.args as string[] | undefined) ?? [];
      const observed = { env: started!.env, sdk: started!.sdk, reportedArgs: args.slice(args.indexOf('--overridden')), launchPath: engine.env.PATH };
      await evidence(info, 'settings-observed', observed);
      const overridden = started!.env!.MAWS_PROBE_OVERRIDDEN;
      info.annotations.push({ type: 'settings-branch', description: overridden === 'from-launch' ? 'A: process values win, settings fill only absent' : overridden === 'from-settings' ? 'B: settings override present process values' : `unexpected: ${String(overridden)}` });
      expect(['from-launch', 'from-settings'], 'a present variable settings also set').toContain(overridden);
      expect(started!.env).toEqual({
        MAWS_PROBE_PLAIN: 'plain-envtoy',
        MAWS_PROBE_ABSENT: 'from-settings', // absent from the launch: settings supply it
        MAWS_PROBE_ABSENT_FALLBACK: 'from-settings', // a default does not stand in for a settings value
        MAWS_PROBE_NOWHERE_FALLBACK: 'fallback',
        MAWS_PROBE_OVERRIDDEN: overridden,
        MAWS_PROBE_TOKEN_SHAPED: launchEnv.XDG_MAWS_PROBE_TOKEN, // no generic credential scrub toward a stdio server
        MAWS_PROBE_WITHHELD: '', // the static withheld list blanks it
        MAWS_PROBE_LAUNCH: PROBE_VALUE,
      });
      expect(observed.reportedArgs, 'the visible arguments expand as the env does').toEqual(['--overridden', overridden, '--setting', 'from-settings']);
      expect(started!.sdk!.PATH, 'settings left the PATH the launch gave').toBe(engine.env.PATH);
      // whichever branch holds, an entry referencing in its env stays unattested
      expect(await cache.resolveSource(layout.project, 'envtoy')).toEqual({ ok: false, why: 'unattested' });
      const presentOnly = new ConnectorStatusCache({ references: 'attestedPresent' });
      presentOnly.observe(presentOnly.begin(engine.context), status);
      expect(await presentOnly.resolveSource(layout.project, 'envtoy')).toEqual({ ok: false, why: 'unattested' });
    });
  } finally {
    layout.close();
  }
});

test('git root: the projects key the engine reads at a repository root and in its child directory', async () => {
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
        [repo]: { hasTrustDialogAccepted: true, mcpServers: { rootkey: stdioEntry(layout, 'rootkey') } },
        [sub]: { hasTrustDialogAccepted: true, mcpServers: { childkey: stdioEntry(layout, 'childkey') } },
      },
    });
    const seen: Record<string, unknown> = {};
    for (const [label, cwd] of [['root', repo], ['child', sub]] as const) {
      await withEngine(info, `git-${label}`, layout, { cwd, configDir: true }, async (engine) => {
        const status = await engine.settled();
        const cache = new ConnectorStatusCache();
        cache.observe(cache.begin(engine.context), status);
        await summarize(info, `git-${label}`, cache, cwd, status);
        seen[label] = { rootkey: named(status, 'rootkey')?.status ?? null, childkey: named(status, 'childkey')?.status ?? null };
        // the bundle's rule (cli.pretty.js:959390-959396): the canonical git root's key, at the root and below it
        expect(named(status, 'rootkey'), `${label}: the repository's key`).toMatchObject({ status: 'connected', scope: 'local' });
        expect(named(status, 'childkey'), `${label}: the child directory's own key is not read`).toBeUndefined();
        expect(lastStart(layout, 'rootkey')?.cwd, `${label}: started in the launch cwd`).toBe(cwd);
        expect(await cache.resolveSource(cwd, 'rootkey'), `${label}: local stays engine-only until the ruling`).toEqual({ ok: false, why: 'unidentified' });
      });
    }
    await evidence(info, 'git-keys', seen);
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
    const statuses: Record<string, unknown> = {};
    const observe = (label: string, appSessionId: string) =>
      withEngine(info, label, layout, { cwd: layout.project, configDir: true, appSessionId }, async (engine) => {
        const status = await engine.settled();
        cache.observe(cache.begin(engine.context), status);
        statuses[label] = reported(status).map((server) => ({ name: server.name, status: server.status }));
        return status;
      });
    try {
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
      expect(named(disabled, 'usertoy'), 'the project entry disables it').toMatchObject({ status: 'disabled' });
      config();
      expect(await cache.resolveSource(layout.project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
    } finally {
      await evidence(info, 'negative-statuses', statuses);
    }
  } finally {
    layout.close();
  }
});
