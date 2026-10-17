// P3-HD's direct-route group (`pnpm e2e:connectors-direct`, MAWS_CONNECTORS_DIRECT_E2E=1; the spec skips itself
// otherwise, so `pnpm e2e` is unchanged). docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, M1; P3 co-work
// Decision Log 98 (1)-(3) and (9), with P3-HD's settings ruling (branch B, literal entries only) and local-scope key, both
// from run 39007800364 (e2e/fixtures/connectors-direct/run-39007800364). M1's cases are the no-model scratch-source probe: the
// installed engine launched as MAWS launches it under a scratch HOME and config home (support/connector-direct-probe.ts),
// its real mcp_status answers observed by route D's cache (src/engine-host/connectors/provenance.ts), and what that cache
// would hand MAWS's own instance compared with the instance the engine actually started from the same file (the
// fixture's start log). No owner configuration is read, no model is called, no tool is called. Every listener is
// 127.0.0.1. Each expectation below is what the 2.1.300 readable bundle says the engine does; a different observation
// fails the case, and the wire and the sources summary it printed are the evidence.
//   sources: user and local (outside a repository) entries from a CLAUDE_CONFIG_DIR admitted as the engine ran them
//          (PATH, cwd, argv, env, the SDK-minimal keys, H's fingerprint, an HTTP header as sent); a needs-auth server's
//          source without tool metadata; a referencing entry unattested; project and dynamic entries never direct.
//   home: with no CLAUDE_CONFIG_DIR the file is $HOME/.claude.json.
//   settings: what the engine hands a stdio server for a variable only settings set (with and without a default), one
//          settings override over the launch, a benign credential-shaped name, a known-withheld synthetic name and one
//          set nowhere; the reference policy keeps that entry unattested whichever way the override goes.
//   git root: the `projects` key the engine reads at a repository's root and in its child directory, and route D's
//          local source from it, run as the engine ran it.
//   worktree: the key the engine reads in a linked worktree, recorded; route D keeps local scope unidentified there.
//   settings sdk: what the engine hands a stdio server when file settings set PATH and SHELL, recorded beside what
//          route D would start (the launch's), the gap P3-F's effective-environment attestation owns.
//   negative: a positive report, its engine gone, then another launch of the same context without the server (and one
//          with it disabled): engine-only until the cache is cleared, then admitted again from a fresh report.
// P3-HD M4's disconnect scene is the built app (support/connector-scene.ts), with no host or route double:
//   disconnect: the owner starts a session (no message, no model), allows a page's read, the page reads through the
//          engine; the engine is stopped and the page's next refresh reads through MAWS's own stdio instance (route D,
//          via direct, no session, no engine started) and, with no call left, the idle bound ends that instance; a second
//          instance is held with a call pending (the fixture answers nothing), still up past the idle bound, and killing
//          that scratch main ends every member (wrapper, EOF-ignoring grandchild, server) within 5 s while the detached
//          host stays up: only the host's client-gone cleanup can, as the pending call's lease forbids the idle close.
// P3-HD M2's transport scenes drive MAWS's own connections (src/engine-host/connectors/direct-client.ts) against the
// same fixture server, with no engine and no artifact grant (the host's operations and main's disconnect are the
// host scenes'):
//   transport stdio: two instances through an npx stand-in wrapper (support/connector-direct-transport.ts) with an
//          EOF-ignoring grandchild: distinct pids, exactly the launch's argv/cwd/env, one tools/call per admitted call
//          and none for a refused one, then the pool's close ends wrapper, server and grandchild inside its bound.
//   transport idle: no lease left, the instance's group is gone after the 5 s idle bound and its stop.
//   transport http: the 127.0.0.1 fixture through the guarded fetch: POST only, no standalone GET, one call per
//          admitted call, none for a refused one.
//   transport host death: a stand-in host starts the same plan and is SIGKILLed; the lifeline alone ends the group.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type TestInfo } from '@playwright/test';
import type { McpStatusResponse } from '@shared/wire/control';
import { ConnectorStatusCache } from '../src/engine-host/connectors/provenance';
import { connectorToolState } from '../src/engine-host/connectors/status';
import { launchPathOf, PROBE_ARG, PROBE_VALUE, probeLayout, readLog, startHttpFixture, startProbeEngine, stdioEntry, type ProbeEngine, type ProbeLayout } from './support/connector-direct-probe';
// P3-HD M2 start
import { DirectConnectionPool, type DirectConnectionSpec, type DirectLease } from '../src/engine-host/connectors/direct-client';
import { stdioSpawnPlan } from '../src/engine-host/connectors/direct-stdio';
import type { VerifiedConnectorSource } from '../src/engine-host/connectors/provenance';
import { alive, DIRECT_HOST, until, wrappedLaunch, wrapperPids, writeWrapper } from './support/connector-direct-transport';
// P3-HD M2 end
// P3-HD M4 start
import { invoke as appInvoke, value as appValue, TOOL_NAME, wait, WATCH_MS, withScene } from './support/connector-scene';
import { holdFileOf, newMembers, wrappedServer } from './support/connector-direct-scene';
import { ps } from './support/processes';
// P3-HD M4 end

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

test('sources: user and local entries are admitted as the engine ran them; a needs-auth source without tools; referencing, project and dynamic entries never direct', async () => {
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
      expect(engine.context.localKey, 'outside a repository the cwd is the key').toEqual({ kind: 'directory', key: layout.project });
      expect(await cache.resolveSource(layout.project, 'localtoy')).toMatchObject({ ok: true, source: { scope: 'local', entryPath: ['projects', layout.project, 'mcpServers', 'localtoy'] } });
      await expectSameInstance(cache, layout, engine, layout.project, 'localtoy');
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
      // run 39007800364 settled branch B: file settings override a variable the launch held
      const overridden = 'from-settings';
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
      // so an entry with any reference is engine-only: its values depend on settings MAWS did not hand the engine
      expect(await cache.resolveSource(layout.project, 'envtoy')).toEqual({ ok: false, why: 'unattested' });
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
        expect(engine.context.localKey, `${label}: the key captured before the spawn`).toEqual({ kind: 'repository', key: repo });
        expect(await cache.resolveSource(cwd, 'rootkey'), `${label}: route D's local source`).toMatchObject({ ok: true, source: { scope: 'local', entryPath: ['projects', repo, 'mcpServers', 'rootkey'] } });
        await expectSameInstance(cache, layout, engine, cwd, 'rootkey');
      });
    }
    await evidence(info, 'git-keys', seen);
  } finally {
    layout.close();
  }
});

test('worktree: the projects key the engine reads in a linked worktree is recorded; route D keeps it unidentified', async () => {
  const info = test.info();
  const layout = probeLayout();
  try {
    const repo = join(layout.scratch, 'main');
    const worktree = join(layout.scratch, 'linked');
    mkdirSync(repo);
    const git = (args: string[], cwd = repo) => execFileSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    git(['init', '-q', repo]);
    git(['commit', '-q', '--allow-empty', '-m', 'probe']);
    git(['worktree', 'add', '-q', worktree]);
    writeJson(join(layout.config, '.claude.json'), {
      hasCompletedOnboarding: true,
      projects: {
        [repo]: { hasTrustDialogAccepted: true, mcpServers: { mainkey: stdioEntry(layout, 'mainkey') } },
        [worktree]: { hasTrustDialogAccepted: true, mcpServers: { linkedkey: stdioEntry(layout, 'linkedkey') } },
      },
    });
    await withEngine(info, 'worktree', layout, { cwd: worktree, configDir: true }, async (engine) => {
      const status = await engine.settled();
      const cache = new ConnectorStatusCache();
      cache.observe(cache.begin(engine.context), status);
      await summarize(info, 'worktree', cache, worktree, status);
      const keys = { mainkey: named(status, 'mainkey')?.status ?? null, linkedkey: named(status, 'linkedkey')?.status ?? null };
      await evidence(info, 'worktree-keys', keys);
      // the bundle's reading (cli.pretty.js:30725-30780): a linked worktree folds to its main checkout's key
      expect(keys, 'the engine reads the main checkout’s key').toEqual({ mainkey: 'connected', linkedkey: null });
      expect(engine.context.localKey, 'a `.git` file is not captured until this evidence is ruled on').toEqual({ kind: 'unidentified', why: 'linkedCheckout' });
      for (const name of ['mainkey', 'linkedkey']) expect(await cache.resolveSource(worktree, name), name).toEqual({ ok: false, why: named(status, name) ? 'unidentified' : 'unobserved' });
    });
  } finally {
    layout.close();
  }
});

// A diagnostic, not a restriction: what file settings do to the SDK-minimal keys a stdio server starts with. Route D
// starts its instance with the launch's (and MAWS's flag settings'); file settings are not attested (P3-F's lift).
test('settings sdk: file settings PATH and SHELL reach the engine’s server; route D’s instance keeps the launch’s', async () => {
  const info = test.info();
  const layout = probeLayout();
  try {
    const settingsBin = join(layout.scratch, 'settings-bin');
    mkdirSync(settingsBin);
    const settingsPath = `${settingsBin}:${launchPathOf(layout)}`;
    writeJson(join(layout.config, 'settings.json'), { env: { PATH: settingsPath, SHELL: '/bin/sh' } });
    writeJson(join(layout.config, '.claude.json'), { hasCompletedOnboarding: true, mcpServers: { sdktoy: stdioEntry(layout, 'sdktoy') } });
    await withEngine(info, 'settings-sdk', layout, { cwd: layout.project, configDir: true }, async (engine) => {
      const status = await engine.settled();
      const cache = new ConnectorStatusCache();
      cache.observe(cache.begin(engine.context), status);
      await summarize(info, 'settings-sdk', cache, layout.project, status);
      expect(named(status, 'sdktoy')).toMatchObject({ status: 'connected', scope: 'user' });
      const started = lastStart(layout, 'sdktoy');
      expect(started, 'the engine started sdktoy').toBeDefined();
      const source = await cache.resolveSource(layout.project, 'sdktoy');
      expect(source).toMatchObject({ ok: true });
      const read = source.ok ? await cache.readEntry(source.source) : null;
      const routeD = read?.ok && read.entry.transport === 'stdio' ? Object.fromEntries(Object.entries(read.entry.env).filter(([key]) => SDK_KEYS.includes(key))) : null;
      await evidence(info, 'settings-sdk-observed', { engineServer: started!.sdk, routeD, settings: { PATH: settingsPath, SHELL: '/bin/sh' } });
      // branch B's rule for these keys too, recorded; route D's instance is the launch's either way
      expect([settingsPath, launchPathOf(layout)], 'the server’s PATH').toContain(started!.sdk!.PATH);
      info.annotations.push({ type: 'settings-sdk', description: JSON.stringify({ path: started!.sdk!.PATH === settingsPath ? 'settings' : 'launch', shell: started!.sdk!.SHELL }) });
      expect(routeD).toMatchObject({ PATH: launchPathOf(layout), SHELL: engine.env.SHELL });
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

// P3-HD M2 start: the transport scenes.
const directSource = (layout: ProbeLayout, id: string, transport: 'stdio' | 'http', url?: string): VerifiedConnectorSource => ({ sourceId: `source-${id}`, generation: 1, cwd: layout.project, server: id, scope: 'user', transport, ...(url && { url }), path: join(layout.config, '.claude.json'), entryPath: ['mcpServers', id], observedAt: new Date().toISOString(), entryDigest: `digest-${id}` });

async function leased(pool: DirectConnectionPool, spec: DirectConnectionSpec): Promise<DirectLease> {
  const acquired = await pool.acquire(spec, new AbortController().signal);
  if (!acquired.ok) throw new Error(`acquire: ${acquired.failure} (${acquired.message})`);
  return acquired.lease;
}

const live = () => new AbortController().signal;

test('transport stdio: own instances through a wrapper, exact launch, one call per admission, the whole group gone at close', async () => {
  const info = test.info();
  const layout = probeLayout();
  const pool = new DirectConnectionPool();
  try {
    const wrapper = writeWrapper(layout);
    const a = await leased(pool, { source: directSource(layout, 'owna', 'stdio'), entry: wrappedLaunch(layout, wrapper, 'owna'), fence: () => true });
    const b = await leased(pool, { source: directSource(layout, 'ownb', 'stdio'), entry: wrappedLaunch(layout, wrapper, 'ownb'), fence: () => true });
    expect(await a.listTools(live())).toEqual({ ok: true, tools: [{ name: 'rows', readOnly: true }] });
    expect(await a.callTool({ name: 'rows', arguments: { q: 1 } }, { admit: () => true, signal: live() })).toMatchObject({ ok: true, result: { structuredContent: { server: 'owna', tool: 'rows', n: 1 } } });
    expect(await a.callTool({ name: 'rows', arguments: { q: 2 } }, { admit: () => false, signal: live() })).toMatchObject({ ok: false, failure: 'refused', admitted: false });
    expect((await b.callTool({ name: 'rows', arguments: {} }, { admit: () => true, signal: live() })).ok).toBe(true);

    const log = readLog(layout);
    const starts = log.filter((entry) => entry.event === 'start');
    const pids = wrapperPids(wrapper.log);
    const calls = log.filter((entry) => entry.method === 'tools/call').map((entry) => entry.server);
    const scrub = (value: string | undefined) => value?.replaceAll(layout.scratch, '<scratch>');
    await evidence(info, 'transport-stdio-instances', { starts: starts.map(({ server, cwd, argv, env, sdk }) => ({ server, cwd: scrub(cwd), argv: argv?.map(scrub), env: Object.fromEntries(Object.entries(env ?? {}).map(([key, value]) => [key, scrub(value)])), sdk: Object.fromEntries(Object.entries(sdk ?? {}).map(([key, value]) => [key, scrub(value)])) })), wrappers: pids.wrappers.length, sleepers: pids.sleepers.length, calls });
    expect(starts.map((entry) => entry.server)).toEqual(['owna', 'ownb']);
    const serverPids = starts.map((entry) => entry.pid);
    expect(new Set([...serverPids, ...pids.wrappers, process.pid]).size, 'two wrappers, two servers and this process are distinct').toBe(5);
    for (const start of starts) {
      expect(start.cwd).toBe(layout.project);
      expect(start.argv).toEqual(['stdio', '--id', start.server, '--log', layout.log, 'an arg with spaces', '$NOT_EXPANDED']);
      expect(start.env).toEqual({ MAWS_PROBE_PLAIN: `plain-${start.server}`, MAWS_PROBE_WRAPPER_LOG: wrapper.log });
      expect(start.sdk).toEqual({ HOME: layout.home, PATH: '/usr/bin:/bin' });
    }
    expect(calls).toEqual(['owna', 'ownb']);
    const members = [...serverPids, ...pids.wrappers, ...pids.sleepers];
    expect(members.every(alive)).toBe(true);

    const started = Date.now();
    await pool.close();
    const closedMs = Date.now() - started;
    const gone = members.filter((pid) => !alive(pid));
    await evidence(info, 'transport-stdio-close', { closedMs, members: members.length, gone: gone.length });
    expect(closedMs).toBeLessThan(5_000);
    expect(gone).toEqual(members);
    expect(pool.size).toBe(0);
  } finally {
    await pool.close();
    layout.close();
  }
});

test('transport idle: with no lease left the instance and its group are gone after the 5 s idle bound', async () => {
  const info = test.info();
  const layout = probeLayout();
  const pool = new DirectConnectionPool();
  try {
    const wrapper = writeWrapper(layout);
    const lease = await leased(pool, { source: directSource(layout, 'idle', 'stdio'), entry: wrappedLaunch(layout, wrapper, 'idle'), fence: () => true });
    const server = readLog(layout).find((entry) => entry.event === 'start')!.pid;
    const pids = wrapperPids(wrapper.log);
    const members = [server, ...pids.wrappers, ...pids.sleepers];
    lease.release();
    const released = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(members.every(alive), 'still open inside the idle bound').toBe(true);
    await until(() => members.every((pid) => !alive(pid)), 10_000);
    const goneMs = Date.now() - released;
    await evidence(info, 'transport-idle', { goneMs, members: members.length });
    expect(goneMs).toBeGreaterThanOrEqual(5_000);
    expect(goneMs).toBeLessThan(10_000);
  } finally {
    await pool.close();
    layout.close();
  }
});

test('transport http: the 127.0.0.1 fixture through the guarded fetch, POST only, one call per admission', async () => {
  const info = test.info();
  const layout = probeLayout();
  const fixture = await startHttpFixture(layout, 'ownhttp');
  const pool = new DirectConnectionPool();
  try {
    expect(new URL(fixture.url).hostname).toBe('127.0.0.1');
    const lease = await leased(pool, { source: directSource(layout, 'ownhttp', 'http', fixture.url), entry: { transport: 'http', url: fixture.url, headers: { 'x-probe-header': 'configured-literal' } }, fence: () => true });
    expect(await lease.listTools(live())).toEqual({ ok: true, tools: [{ name: 'rows', readOnly: true }] });
    expect(await lease.callTool({ name: 'rows', arguments: {} }, { admit: () => true, signal: live() })).toMatchObject({ ok: true, result: { structuredContent: { server: 'ownhttp', n: 1 } } });
    expect(await lease.callTool({ name: 'rows', arguments: {} }, { admit: () => false, signal: live() })).toMatchObject({ ok: false, failure: 'refused', admitted: false });
    lease.release();
    await pool.close();
    const http = readLog(layout).filter((entry) => entry.event === 'http') as Array<{ method?: string | null; httpMethod?: string; path?: string; probeHeader?: string | null }>;
    await evidence(info, 'transport-http', http.map(({ method, httpMethod, path, probeHeader }) => ({ method, httpMethod, path, probeHeader })));
    expect(http.map((entry) => entry.httpMethod)).toEqual(http.map(() => 'POST')); // the standalone GET never left
    expect(http.every((entry) => entry.probeHeader === 'configured-literal')).toBe(true);
    expect(http.filter((entry) => entry.method === 'tools/call')).toHaveLength(1);
  } finally {
    await pool.close();
    fixture.close();
    layout.close();
  }
});

test('transport host death: a host killed outright leaves no member of its instance behind', async () => {
  const info = test.info();
  const layout = probeLayout();
  try {
    const wrapper = writeWrapper(layout);
    const plan = stdioSpawnPlan(wrappedLaunch(layout, wrapper, 'orphan'));
    const host = spawn(process.execPath, [DIRECT_HOST, JSON.stringify({ server: plan.server, lifeline: plan.lifeline(-1) })], { stdio: ['ignore', 'pipe', 'inherit'] });
    const started = await new Promise<{ server: number; lifeline: number }>((resolve, reject) => {
      host.stdout!.once('data', (chunk: Buffer) => resolve(JSON.parse(chunk.toString('utf8').split('\n')[0]!) as { server: number; lifeline: number }));
      host.once('exit', (code) => reject(new Error(`the stand-in host exited (${code})`)));
    });
    await until(() => readLog(layout).some((entry) => entry.event === 'start') && wrapperPids(wrapper.log).sleepers.length === 1, 10_000);
    const fixture = readLog(layout).find((entry) => entry.event === 'start')!.pid;
    const pids = wrapperPids(wrapper.log);
    expect(pids.wrappers).toEqual([started.server]); // the wrapper is the spawned leader; the fixture is its child
    const members = [started.server, fixture, ...pids.sleepers];
    expect([...members, started.lifeline].every(alive)).toBe(true);
    const killed = Date.now();
    host.kill('SIGKILL');
    await until(() => members.every((pid) => !alive(pid)) && !alive(started.lifeline), 5_000);
    const goneMs = Date.now() - killed;
    await evidence(info, 'transport-host-death', { goneMs, members: members.length });
    expect(goneMs).toBeLessThan(5_000);
  } finally {
    layout.close();
  }
});
// P3-HD M2 end
// P3-HD M4 start
test('disconnect: the page reads through MAWS’s own instance after the engine stops, and killing main ends every member of it within 5 s', async () => {
  test.setTimeout(300_000);
  const info = test.info();
  await withScene(
    'direct',
    info,
    async (scene) => {
      const run = await scene.launch();
      const artifactId = await scene.createPage(run.page);
      const { frame } = await scene.openPage(run.page, artifactId);
      await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });

      // the owner's one session and grant: the page reads through the engine
      const engine = await scene.ownerStart(run.page);
      await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
      const sheet = await scene.openSheet(run.page);
      await sheet.locator(`[data-connector-tool="${TOOL_NAME}"]`).getByRole('button', { name: `Allow ${TOOL_NAME} to read` }).click();
      await scene.closeSheet(run.page);
      await expect(frame.locator('#last')).toHaveText('ok n=1 via=engine', { timeout: 20_000 });
      const engineServer = scene.toolCalls()[0]!.pid;

      // the engine exits: its instance's members stay the engine's; the page then reads through MAWS's own
      appValue(await appInvoke(run.page, 'session.stop', { appSessionId: engine.appSessionId, reason: 'stop' }));
      await expect.poll(() => scene.pidAlive(engine.pid), { timeout: 30_000, message: 'the engine stopped' }).toBe(false);
      expect(await scene.live(run.page), 'no engine is live').toEqual([]);
      const before = { wrappers: [] as number[], sleepers: [] as number[] };
      const engineMembers = newMembers(scene, before);
      await expect(frame.locator('#last')).toHaveText('ok n=1 via=direct', { timeout: WATCH_MS + 30_000 });
      expect(await scene.live(run.page), 'route D started no engine').toEqual([]);
      expect(scene.launches(engine.appSessionId).spawns, 'the owner’s one launch, never another').toBe(1);

      // MAWS's own first instance: a new wrapper, grandchild and server, none of them the engine's; with no call left it
      // is the ordinary idle bound (5 s) that ends it, which is not what the client-gone proof below may rest on
      const first = newMembers(scene, engineMembers);
      expect(first.wrappers, 'one new wrapper').toHaveLength(1);
      expect(first.sleepers, 'one new grandchild').toHaveLength(1);
      const firstServer = scene.toolCalls().at(-1)!.pid;
      expect(firstServer, 'a server other than the engine’s').not.toBe(engineServer);
      expect(ps(firstServer, 'ppid'), 'the server is the wrapper’s child').toBe(String(first.wrappers[0]));
      const firstGroup = [...first.wrappers, ...first.sleepers, firstServer];
      writeFileSync(holdFileOf(scene), ''); // from here the fixture answers no tools/call: the next refresh's call will be held
      await expect.poll(() => firstGroup.filter(alive), { timeout: 20_000, intervals: [250], message: 'the idle bound ended the first instance with no call pending' }).toEqual([]);

      // a call held pending on a second instance (the fixture answers nothing while the hold file exists): its lease keeps
      // the instance from idling, so only the host's cleanup at main's death can end it
      const seen = new Set([engineServer, firstServer]);
      await expect
        .poll(() => scene.toolCalls().filter((entry) => !seen.has(entry.pid)).length, { timeout: WATCH_MS + 30_000, message: 'the next refresh submitted its call to a second instance of MAWS’s' })
        .toBe(1);
      const heldServer = scene.toolCalls().find((entry) => !seen.has(entry.pid))!.pid;
      const second = newMembers(scene, { wrappers: [...engineMembers.wrappers, ...first.wrappers], sleepers: [...engineMembers.sleepers, ...first.sleepers] });
      expect(second.wrappers, 'one new wrapper').toHaveLength(1);
      expect(second.sleepers, 'one new grandchild').toHaveLength(1);
      expect(ps(heldServer, 'ppid'), 'the held call’s server is that wrapper’s child').toBe(String(second.wrappers[0]));
      const members = [...second.wrappers, ...second.sleepers, heldServer];
      expect(members.every(alive), 'the second instance is running with a call pending').toBe(true);
      await wait(7_000); // past the 5 s idle bound: a leased instance is still up
      expect(members.every(alive), 'the idle bound does not end an instance with a call pending').toBe(true);
      expect(scene.toolCalls().filter((entry) => entry.pid === heldServer), 'the held call was submitted once and never answered').toHaveLength(1);
      expect(await scene.live(run.page), 'route D started no engine').toEqual([]);
      const supervisor = await scene.supervisor(run.page);
      scene.note('direct instance', { members, supervisor });

      // that scratch main is killed: the detached host sees its client go and ends the whole instance, call pending
      await scene.killApp(run);
      await expect
        .poll(() => members.filter(alive), { timeout: 5_000, intervals: [100], message: 'wrapper, grandchild and server are gone within 5 s of main’s death' })
        .toEqual([]);
      expect(scene.pidAlive(supervisor), 'the detached host outlived main, so it was its own client-gone cleanup that ended the instance').toBe(true);
      await info.attach('direct-members.json', { body: JSON.stringify({ engineMembers, first, firstServer, second, heldServer }, null, 2), contentType: 'application/json' });
    },
    { server: wrappedServer },
  );
});
// P3-HD M4 end
