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
//          (PATH, cwd, argv, env, the SDK-minimal keys, H's fingerprint, an HTTP header as sent); a referencing entry
//          unattested; project and dynamic entries never direct. No engine here is ever configured with a resource that
//          advertises authorization (Decision Log 23): the needs-auth bootstrap is proven on the retained real reports
//          of runs 39007800364 and 39011899461 (src/engine-host/connectors/retained-needs-auth.test.ts).
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
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'; // P3-F (scalpel-4#2): ChildProcess
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'; // P3-HD M4b: rmSync
import { join, resolve } from 'node:path'; // P3-F W-PKG: resolve
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
// P3-HD M4b start
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { SERVERS_COPY as S } from '../src/renderer/src/tools/artifacts/viewers/connectors/copy';
import { PAGE_HTML, PAGE_TITLE, pageState, SERVER, TOOL, type ConnectorScene } from './support/connector-scene';
import { createPageIn, expectNoForbiddenFrames, expectQuietJournals, heldServer, referencingServer, Refreshes, serverConnected, serverRow, sessionJournals, sessionMeta } from './support/connector-direct-scene';
import { blankResumeStartupRejection, boundedAcquire, heldFate, isBlankResume, journalFrameShapes, oncePageHtml } from './support/connector-direct-checks';
import { allow, evidence, grantsOf, printEvidence, revokeInSheet, shot, stopEngine } from './support/connector-direct-acceptance';
// P3-HD M4b end
// P3-F W-PKG start
import { REPO_ROOT } from './support/launch';
import { packagedResolution, productionPin, resolutionProblems, resourcesOf } from './support/packaged-resolution';
// P3-F W-PKG end

// P3-F W-PKG (the tracker's packaged-SDK row): the transition scene is route D's packaged proof too. Under a packaged
// MAWS_E2E_EXECUTABLE (`pnpm e2e:packaged`, the packaged gate's bare set) it alone runs, over the packaged app; every
// other case keeps the direct group's switch.
const DIRECT_GROUP = process.env.MAWS_CONNECTORS_DIRECT_E2E === '1';
const PACKAGED = Boolean(process.env.MAWS_E2E_EXECUTABLE);
const TRANSITION = 'transition:';
test.skip(!DIRECT_GROUP && !PACKAGED, 'the direct-route e2e runs under pnpm e2e:connectors-direct (MAWS_CONNECTORS_DIRECT_E2E=1), and its transition scene under pnpm e2e:packaged');
test.beforeEach(() => test.skip(!DIRECT_GROUP && !test.info().title.startsWith(TRANSITION), 'over the packaged app only the transition scene runs (pnpm e2e:packaged); the rest under pnpm e2e:connectors-direct'));
test.describe.configure({ timeout: 180_000 });

type Reported = { name: string; status: string; scope?: string; source?: string; config?: Record<string, unknown> };
const reported = (status: McpStatusResponse) => status.mcpServers as Reported[];
const named = (status: McpStatusResponse, name: string) => reported(status).find((server) => server.name === name);
const SDK_KEYS = ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'];

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

test('sources: user and local entries are admitted as the engine ran them; referencing, project and dynamic entries never direct', async () => {
  const info = test.info();
  const layout = probeLayout();
  const http = await startHttpFixture(layout, 'userhttp');
  try {
    writeJson(join(layout.config, '.claude.json'), {
      hasCompletedOnboarding: true,
      mcpServers: {
        usertoy: stdioEntry(layout, 'usertoy', { args: ['--literal', 'value'] }),
        userref: stdioEntry(layout, 'userref', { args: ['--arg', '${XDG_MAWS_PROBE_ARG}'] }),
        userhttp: { type: 'http', url: http.url, headers: { 'X-Probe-Header': PROBE_VALUE } },
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
  const wrapper = writeWrapper(layout);
  let host: ChildProcess | null = null;
  let started: { server: number; lifeline: number } | null = null;
  try {
    const plan = stdioSpawnPlan(wrappedLaunch(layout, wrapper, 'orphan'));
    const spawned = (host = spawn(process.execPath, [DIRECT_HOST, JSON.stringify({ server: plan.server, lifeline: plan.lifeline(-1) })], { stdio: ['ignore', 'pipe', 'inherit'] }));
    started = await new Promise<{ server: number; lifeline: number }>((resolve, reject) => {
      spawned.stdout!.once('data', (chunk: Buffer) => resolve(JSON.parse(chunk.toString('utf8').split('\n')[0]!) as { server: number; lifeline: number }));
      spawned.once('exit', (code) => reject(new Error(`the stand-in host exited (${code})`)));
    });
    await until(() => readLog(layout).some((entry) => entry.event === 'start') && wrapperPids(wrapper.log).sleepers.length === 1, 10_000);
    const fixture = readLog(layout).find((entry) => entry.event === 'start')!.pid;
    const pids = wrapperPids(wrapper.log);
    expect(pids.wrappers).toEqual([started.server]); // the wrapper is the spawned leader; the fixture is its child
    const members = [started.server, fixture, ...pids.sleepers];
    expect([...members, started.lifeline].every(alive)).toBe(true);
    const killed = Date.now();
    spawned.kill('SIGKILL');
    const lifeline = started.lifeline;
    await until(() => members.every((pid) => !alive(pid)) && !alive(lifeline), 5_000);
    const goneMs = Date.now() - killed;
    await evidence(info, 'transport-host-death', { goneMs, members: members.length });
    expect(goneMs).toBeLessThan(5_000);
  } finally {
    // P3-F (scalpel-4#2): the stand-in host and all it started end on every path. A failed wait or expect left the host
    // alive, and with it the wrapper's group (the wrapper, the fixture server, the bare `sleep 600` no scratch sweep can
    // match) and the lifeline, which acts only on the host's end. Each group (the wrapper and the lifeline lead their
    // own) is signalled whole; after a passing run they are gone already.
    if (host !== null && host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
    const groups = new Set([...(started ? [started.server, started.lifeline] : []), ...wrapperPids(wrapper.log).wrappers]);
    for (const group of groups) {
      try {
        process.kill(-group, 'SIGKILL');
      } catch {
        // no such group: already gone
      }
    }
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

      // that scratch main is killed: the detached host sees its client go and ends the whole instance, call pending. The
      // bound counts from just before the kill, so the wait for main's own exit is inside it.
      const killedAt = Date.now();
      await scene.killApp(run);
      await expect
        .poll(() => members.filter(alive), { timeout: 5_000, intervals: [100], message: 'wrapper, grandchild and server are gone within 5 s of main’s death' })
        .toEqual([]);
      const elapsedMs = Date.now() - killedAt;
      const supervisorSurvived = scene.pidAlive(supervisor);
      await evidence(info, 'direct-main-loss', { elapsedMs, members: members.length, heldSubmissions: scene.toolCalls().filter((entry) => entry.pid === heldServer).length, supervisorSurvived });
      expect(elapsedMs, 'from main’s kill until every member is gone').toBeLessThan(5_000);
      expect(supervisorSurvived, 'the detached host outlived main, so it was its own client-gone cleanup that ended the instance').toBe(true);
      await info.attach('direct-members.json', { body: JSON.stringify({ engineMembers, first, firstServer, second, heldServer }, null, 2), contentType: 'application/json' });
    },
    { server: wrappedServer },
  );
});
// P3-HD M4 end
// P3-HD M4b start: the integrated acceptance on the built app (support/connector-scene.ts, H's page and Connectors sheet,
// the owner's Start, no message, no model turn), docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md acceptance 1-6:
//   transition: one read grant reads through the engine, then, the engine stopped, through MAWS's own instance (route D,
//          the same grant, no engine acquired), then through the engine again once the owner's session is resumed; each
//          refresh submits exactly one call. Under D, the window hidden, minimized, or the page's surface unmounted, it
//          calls nothing past its interval and catches up once. The sheet names the verified file and scope.
//   lifecycle: under D, a call held by the fixture (submitted, unanswered) when the owner revokes, or when the artifact
//          is deleted, never reaches the page when the fixture answers it late, an Allow once already consumed by its
//          held call included; a duplicate holds no grant and restoring a version saved while the grant stood restores
//          none.
//   engine only: an entry with a `${…}` reference is the session's alone: the sheet says why, and with the engine gone
//          the page reads paused and MAWS starts no instance of its own.
// Route D's own OAuth scenes are the connectors-oauth group's (e2e/connectors-oauth.spec.ts); the helpers both files use
// are support/connector-direct-acceptance.ts's.
// The hold lifted from one held call (support/connector-mcp-server.mjs `--hold`), and what became of that very call
// (support/connector-direct-checks.ts heldFate): its instance answered it late (`released`), or the instance was torn
// down first (`teardown`, a cancelled transport's own cleanup). An instance still alive that never answers it fails.
async function liftHold(scene: ConnectorScene, hold: string, held: { pid: number }): Promise<{ fate: 'released' | 'teardown'; ms: number }> {
  const rpcId = (held as { rpcId?: unknown }).rpcId;
  expect(rpcId, 'the held call is known by its JSON-RPC id').toBeDefined();
  const from = Date.now();
  rmSync(hold);
  let fate: ReturnType<typeof heldFate> = 'pending';
  await expect
    .poll(() => (fate = heldFate(scene.calls(), { pid: held.pid, rpcId }, scene.pidAlive(held.pid))), { timeout: 3_000, intervals: [100], message: 'the held call was answered late by its instance, or the instance was torn down' })
    .not.toBe('pending');
  return { fate: fate as 'released' | 'teardown', ms: Date.now() - from };
}

test('transition: one grant reads through E, then D with no engine, then E again, one submission each; hidden, minimized or unmounted it calls nothing and catches up once', async () => {
  test.setTimeout(600_000);
  const info = test.info();
  await withScene('transition', info, async (scene) => {
    const run = await scene.launch();
    const artifactId = await scene.createPage(run.page);
    let { frame } = await scene.openPage(run.page, artifactId);
    await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
    const engine = await scene.ownerStart(run.page);
    await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
    await allow(scene, run.page, TOOL_NAME);
    await expect(frame.locator('#last')).toHaveText('ok n=1 via=engine', { timeout: 20_000 });
    const grants = await grantsOf(run.page, artifactId);
    expect(grants).toMatchObject([{ server: SERVER, tool: TOOL, mode: 'read' }]);
    const engineServer = scene.toolCalls()[0]!.pid;
    const calls = () => scene.toolCalls().length;
    const refreshes = new Refreshes(frame, calls);
    await refreshes.mark();

    // E → D: the engine stopped, the same page's next refresh reads through MAWS's own instance, no engine started
    await stopEngine(scene, run, engine);
    const direct = await refreshes.until('direct', WATCH_MS + 30_000);
    const directServer = scene.toolCalls().at(-1)!.pid;
    const directParent = Number(ps(directServer, 'ppid'));
    expect(directServer, 'a server other than the engine’s').not.toBe(engineServer);
    expect(directParent, 'not the engine’s child').not.toBe(engine.pid);
    if (run.maws.packaged) await expectPackagedHost(info, scene, directParent); // P3-F W-PKG
    expect(await grantsOf(run.page, artifactId), 'the same grant, fingerprint and mode: no new one').toEqual(grants);
    expect(await scene.live(run.page), 'route D started no engine').toEqual([]);
    expect(scene.launches(engine.appSessionId), 'the owner’s one launch, exited').toEqual({ spawns: 1, exits: 1 });

    // the trusted sheet names the verified file and scope of the source D reads
    const sheet = await scene.openSheet(run.page);
    const row = serverRow(sheet, SERVER, 'source');
    await expect(row).toContainText(S.origin('user', join(scene.userData, 'claude-config', '.claude.json')));
    await expect(row).toContainText(S.transport('stdio'));
    await expect(row.locator('[data-connector-server-state]')).toHaveText('MAWS can reach it directly'); // copy.ts SERVERS_COPY.connection, a stdio source
    await shot(info, 'transition-servers.png', sheet);
    await scene.closeSheet(run.page);

    // hidden, then minimized: nothing past the interval, then exactly one catch-up through D
    const quiet: Record<string, unknown> = {};
    const away: [string, () => Promise<void>, () => Promise<void>][] = [
      ['hidden', () => scene.hideWindow(run), () => scene.showWindow(run)],
      ['minimized', () => scene.minimizeWindow(run), () => scene.restoreWindow(run)],
    ];
    for (const [label, leave, come] of away) {
      await leave();
      const from = Date.now();
      await wait(WATCH_MS + 10_000);
      expect(scene.toolCallsBetween(from, Date.now()), `no call while ${label}`).toEqual([]);
      expect(await refreshes.since(), `nothing arrived while ${label}`).toEqual({ updates: 0, submitted: 0 });
      await come();
      const caught = await refreshes.next(15_000);
      expect(caught.last, `${label}: the catch-up reads through D`).toMatch(/^ok n=\d+ via=direct$/);
      expect(caught.submitted, `${label}: one catch-up call`).toBe(1);
      await wait(5_000);
      expect(await refreshes.since(), `${label}: and only one`).toEqual({ updates: 0, submitted: 0 });
      quiet[label] = { silentMs: WATCH_MS + 10_000, caught };
    }

    // the page's surface gone (the library over its tab unmounts it), then back: a new load reads once
    const tab = run.page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
    await run.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    await expect(tab.locator('[data-artifact-frame="html"]'), 'the page’s surface is gone').toHaveCount(0);
    const unmounted = Date.now();
    await wait(WATCH_MS + 10_000);
    expect(scene.toolCallsBetween(unmounted, Date.now()), 'no call while its surface is gone').toEqual([]);
    const before = calls();
    ({ frame } = await scene.openPage(run.page, artifactId));
    refreshes.remounted(frame, before);
    const shown = await refreshes.next(15_000);
    expect(shown.last).toMatch(/^ok n=\d+ via=direct$/);
    expect(shown.submitted, 'the new load read once').toBe(1);
    await wait(5_000);
    expect(await refreshes.since(), 'and only once').toEqual({ updates: 0, submitted: 0 });
    quiet.unmounted = { silentMs: WATCH_MS + 10_000, shown };

    // D → E: back to an engine with no message. The owner's session is resumed; the engine refuses a resume of a session
    // that never wrote a transcript (the no-message Start wrote none: existing sessions debt, outside P3-HD, Decision Log 40;
    // the related blank-chat row docs/tech-debt-tracker.md:242 names its side-thread --fork-session manifestation, parent Decision Log 102 this one;
    // and docs/doperpowers/plans/2026-09-28-c3-engine-host.md's `--resume` refusals), and then the owner's fresh eligible
    // session is started. Any other acquire answer is asserted as before: ready, or a failure with its diagnostics.
    expect(scene.launches(engine.appSessionId).spawns, 'no timer acquired an engine through all of D').toBe(1);
    const acquired = appValue(await appInvoke(run.page, 'session.acquire', { appSessionId: engine.appSessionId as LaunchSpec['appSessionId'], reason: 'read', options: { requireEmptyMessage: true } }));
    // Decision Log 39: the answer and the journals' launch rows are kept before the assertion, so a failure can be diagnosed
    const launchRows = sessionMeta(scene);
    await evidence(info, 'transition-acquire', { acquire: boundedAcquire(acquired, [scene.root, scene.userData]), journals: launchRows });
    const blankResume = isBlankResume(acquired, launchRows.find((journal) => journal.appSessionId === engine.appSessionId)?.rows ?? []);
    let returnedId = engine.appSessionId;
    let fresh: { appSessionId: string; start: unknown; signals: unknown } | null = null;
    if (!blankResume) expect(acquired).toMatchObject({ status: 'ready', launched: true });
    else {
      // The owner's gesture is not offered while D serves (H hides the sheet's Start), so main's own pair, as the product
      // runs it for an artifact in a Space linked to an indexed directory: session.create with that directory and its
      // project, then session.start with no message (requireEmptyMessage), as startArtifactSession does.
      const linked = realpathSync(scene.project);
      const project = appValue(await appInvoke(run.page, 'session.projects.list', undefined)).projects.find((entry) => entry.directory === linked);
      expect(project, 'the Space’s linked directory is an indexed project').toBeDefined();
      await expect.poll(async () => (await scene.live(run.page)).map((session) => session.appSessionId), { timeout: 15_000, message: 'the refused resume’s engine is gone: no engine is live before the fresh Start' }).toEqual([]);
      const created = appValue(await appInvoke(run.page, 'session.create', { projectId: project!.id, location: { kind: 'directory', path: scene.project } }));
      expect(created.appSessionId, 'a fresh session, not the old record').not.toBe(engine.appSessionId);
      const start = appValue(await appInvoke(run.page, 'session.start', { appSessionId: created.appSessionId, message: null, options: { requireEmptyMessage: true } }));
      expect(start).toMatchObject({ status: 'starting' });
      await expect
        .poll(async () => appValue(await appInvoke(run.page, 'engine.sessions', undefined)).find((entry) => entry.appSessionId === created.appSessionId)?.process, { timeout: 90_000, message: 'the fresh session’s engine is ready' })
        .toBe('ready');
      returnedId = created.appSessionId;
      fresh = { appSessionId: created.appSessionId, start, signals: { engineProcess: 'ready' } };
    }
    const resumed = await scene.live(run.page);
    expect(resumed.map((session) => session.appSessionId), blankResume ? 'the fresh session, alone' : 'the owner’s session, alone').toEqual([returnedId]);
    await serverConnected(run.page, returnedId, SERVER);
    if (fresh !== null) fresh.signals = { engineProcess: 'ready', mcp: `${SERVER} connected` };
    const back = await refreshes.until('engine', WATCH_MS + 30_000);
    const engineAgain = scene.toolCalls().at(-1)!.pid;
    expect(engineAgain, 'not MAWS’s own instance').not.toBe(directServer);
    expect(await grantsOf(run.page, artifactId), 'still the one grant').toEqual(grants);
    if (blankResume) {
      expect(scene.launches(engine.appSessionId), 'the old record: its first launch and stop, the refused resume and its exit').toEqual({ spawns: 2, exits: 2 });
      expect(scene.launches(returnedId), 'the fresh session: one launch, running').toEqual({ spawns: 1, exits: 0 });
    } else expect(scene.launches(engine.appSessionId), 'the explicit resume is the only other launch').toEqual({ spawns: 2, exits: 1 });

    // Decision Log 42: the E-return proof and every journal’s frame shapes are kept before the quiet guard, so a red run keeps them
    const journals = sessionJournals(scene);
    await evidence(info, 'transition', {
      refreshes: refreshes.seen,
      direct,
      back,
      quiet,
      eReturn: blankResume ? { route: 'fresh eligible session, not a resume of the old record', debt: 'blank resume (a pinned engine session id with no transcript): the related blank-chat row at docs/tech-debt-tracker.md:242 (2026-10-17, P3-F; it names the side-thread --resume --fork-session manifestation, not this plain no-message acquire), parent Decision Log 102 and P3-HD Decision Log 40', old: engine.appSessionId, fresh } : { route: 'resume of the owner’s session', session: engine.appSessionId },
      pids: { engine: engine.pid, engineServer, directServer, directParent, directParentIsSupervisor: scene.supervisors.has(directParent), resumed: resumed[0]!.pid, engineAgain, engineAgainParentIsEngine: ps(engineAgain, 'ppid') === String(resumed[0]!.pid) },
      journals: journals.map(({ turns, dirMode, fileModes }) => ({ turns, dirMode: dirMode.toString(8), fileModes: fileModes.map((mode) => mode.toString(8)) })),
      frames: journals.slice(0, 16).map(({ appSessionId, rows }) => ({ appSessionId, ...journalFrameShapes(rows) })),
      journalsTotal: journals.length,
      startupRejection: blankResume ? (({ ok, failures }) => ({ appSessionId: engine.appSessionId, ok, failures }))(blankResumeStartupRejection(journals.find((journal) => journal.appSessionId === engine.appSessionId)?.rows ?? [])) : null,
    });
    expectNoForbiddenFrames(journals);
    expectQuietJournals(journals, blankResume ? engine.appSessionId : undefined);
  });
});

// P3-F W-PKG: the read route D just served came from the packaged app's own host. Its server is the child of the
// supervisor main connected to, which runs the engine-host chunk from inside this bundle's app.asar, and the packaged
// binary in that same Node mode resolves the chunk's SDK at the repository's pin, and the SDK's whole production closure,
// inside the bundle's Resources, not from the repository the app was built in. Kept as evidence before the assertions.
async function expectPackagedHost(info: TestInfo, scene: ConnectorScene, directParent: number): Promise<void> {
  const executable = realpathSync(resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE!));
  const resources = resourcesOf(executable);
  const asar = join(resources, 'app.asar');
  const command = ps(directParent, 'command');
  const pins = { '@modelcontextprotocol/sdk': productionPin(REPO_ROOT, '@modelcontextprotocol/sdk') };
  const resolution = packagedResolution(executable, scene.userData);
  const problems = resolutionProblems(resolution, resources, pins);
  const local = (path: string | null) => (path === null ? null : path.replace(`${resources}/`, '<Resources>/'));
  await evidence(info, 'transition-packaged', {
    supervisor: { pid: directParent, connected: scene.supervisors.has(directParent), command: command.replaceAll(`${resources}/`, '<Resources>/').replaceAll(scene.root, '<scene>') },
    resolution: { chunk: local(resolution.chunk), required: resolution.required.map(({ specifier, file }) => ({ specifier, file: local(file) })), roots: resolution.roots.map(({ name, version }) => `${name}@${version}`), packages: resolution.packages.length, closure: resolution.packages.map(({ name, version }) => `${name}@${version}`).sort(), missing: resolution.missing, truncated: resolution.truncated },
    pins,
    problems,
  });
  expect(scene.supervisors.has(directParent), 'route D’s server is the child of the supervisor main connected to').toBe(true);
  expect(command, 'that supervisor runs the engine-host chunk from inside this bundle’s app.asar').toContain(`${asar}/`);
  expect(problems, 'the packaged binary resolves the host’s SDK and its production closure inside the bundle').toEqual([]);
}

const ONCE_TITLE = 'Signups, once';

test('lifecycle: under D a revoke or delete suppresses a held call’s late answer, a consumed Allow once included; a duplicate or a restored version gains no grant', async () => {
  test.setTimeout(600_000);
  const info = test.info();
  await withScene(
    'lifecycle',
    info,
    async (scene) => {
      const hold = holdFileOf(scene);
      const run = await scene.launch();
      const live = await createPageIn(run.page, scene, { html: PAGE_HTML, title: PAGE_TITLE });
      const artifactId = live.artifactId;
      let { frame } = await scene.openPage(run.page, artifactId);
      await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
      const engine = await scene.ownerStart(run.page);
      await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
      await allow(scene, run.page, TOOL_NAME);
      await expect(frame.locator('#last')).toHaveText('ok n=1 via=engine', { timeout: 20_000 });
      const enginePids = new Set(scene.calls().map((entry) => entry.pid));
      const calls = () => scene.toolCalls().length;
      const refreshes = new Refreshes(frame, calls);
      await refreshes.mark();
      await stopEngine(scene, run, engine);
      await refreshes.until('direct', WATCH_MS + 30_000);
      const steps: Record<string, unknown> = {};

      // a read held by the fixture, then revoked from the sheet; the fixture then answers it late
      writeFileSync(hold, '');
      const submitted = calls();
      await expect.poll(calls, { timeout: WATCH_MS + 30_000, message: 'the next refresh submitted its call' }).toBe(submitted + 1);
      const held = scene.toolCalls().at(-1)!;
      expect(enginePids.has(held.pid), 'held on MAWS’s own instance').toBe(false);
      await wait(1_000);
      expect(await refreshes.since(), 'its answer is held').toEqual({ updates: 0, submitted: 1 });
      await revokeInSheet(scene, run.page);
      await expect(frame.locator('#last')).toHaveText('revoked:revoked');
      const revokeLate = await liftHold(scene, hold, held);
      const revokedAt = Date.now();
      await wait(WATCH_MS + 5_000);
      const afterRevoke = await pageState(frame);
      expect(afterRevoke.last, 'the late answer never reached the page').not.toMatch(/^ok/);
      expect(scene.toolCallsBetween(revokedAt, Date.now()), 'no call after the revoke').toEqual([]);
      expect(await grantsOf(run.page, artifactId)).toEqual([]);
      steps.revoke = { held: held.pid, late: revokeLate, page: afterRevoke };

      // an Allow once, consumed by its call held on MAWS's instance, then revoked (the sheet offers no Revoke for a used
      // Allow once, so the owner's own command); the fixture then answers late
      const once = await createPageIn(run.page, scene, { html: oncePageHtml({ server: SERVER, tool: TOOL, title: ONCE_TITLE }), title: ONCE_TITLE, spaceId: live.spaceId });
      const { frame: onceFrame } = await scene.openPage(run.page, once.artifactId, ONCE_TITLE);
      await expect(onceFrame.locator('#declared')).toHaveText('declared');
      await allow(scene, run.page, TOOL_NAME, 'once');
      writeFileSync(hold, '');
      const onceBefore = calls();
      await onceFrame.locator('#call').click();
      await expect.poll(calls, { timeout: 30_000, message: 'the Allow once call was submitted' }).toBe(onceBefore + 1);
      const onceHeld = scene.toolCalls().at(-1)!;
      expect(enginePids.has(onceHeld.pid), 'through MAWS’s own instance').toBe(false);
      await expect.poll(() => grantsOf(run.page, once.artifactId), { timeout: 10_000, message: 'the Allow once was consumed' }).toEqual([]);
      expect((await pageState(onceFrame)).updates, 'its answer is held').toBe(0);
      appValue(await appInvoke(run.page, 'artifacts.revokeConnectorTool', { artifactId: once.artifactId, server: SERVER, tool: TOOL }));
      await expect(onceFrame.locator('#updates')).toHaveText('1', { timeout: 15_000 });
      const onceOutcome = await pageState(onceFrame);
      expect(onceOutcome.last, 'the consumed call’s result is suppressed').not.toMatch(/^ok/);
      const onceLate = await liftHold(scene, hold, onceHeld);
      const onceRevokedAt = Date.now();
      await wait(5_000);
      expect(await pageState(onceFrame), 'the late answer never arrived').toEqual(onceOutcome);
      expect(scene.toolCallsBetween(onceRevokedAt, Date.now())).toEqual([]);
      steps.once = { held: onceHeld.pid, late: onceLate, page: onceOutcome };

      // allowed again: a duplicate holds no grant; a version saved under the grant, restored after its revoke, restores none
      let before = calls();
      ({ frame } = await scene.openPage(run.page, artifactId));
      refreshes.remounted(frame, before);
      await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: 20_000 });
      await allow(scene, run.page, TOOL_NAME);
      await expect(frame.locator('#last')).toHaveText(/^ok n=\d+ via=direct$/, { timeout: 20_000 });
      const copy = appValue(await appInvoke(run.page, 'artifacts.duplicate', { artifactId })).artifact.id;
      expect(await grantsOf(run.page, copy), 'a duplicate holds no grant').toEqual([]);
      expect(await grantsOf(run.page, artifactId)).toMatchObject([{ server: SERVER, tool: TOOL, mode: 'read' }]);
      const { versionId } = appValue(await appInvoke(run.page, 'artifacts.saveVersion', { artifactId, label: 'while allowed' }));
      appValue(await appInvoke(run.page, 'artifacts.testWrite', { artifactId, opId: 'hd-m4b-edit', ops: [{ op: 'page', text: PAGE_HTML.replace('<p id="updates">0</p>', '<p id="updates">0</p>\n<p id="edited">edited</p>') }] }));
      await expect(frame.locator('#edited'), 'the edited page loaded').toHaveText('edited', { timeout: 20_000 });
      await expect(frame.locator('#last')).toHaveText(/^ok n=\d+ via=direct$/, { timeout: 20_000 });
      await revokeInSheet(scene, run.page);
      const restoreRevokedAt = Date.now();
      appValue(await appInvoke(run.page, 'artifacts.restore', { artifactId, versionId }));
      await expect(frame.locator('#edited'), 'the saved version is back').toHaveCount(0, { timeout: 20_000 });
      await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: 20_000 });
      expect(await grantsOf(run.page, artifactId), 'the restored version restores no grant').toEqual([]);
      await wait(WATCH_MS + 5_000);
      expect(scene.toolCallsBetween(restoreRevokedAt, Date.now()), 'nothing called since the revoke').toEqual([]);
      steps.restore = { versionId, duplicateGrants: 0, restoredGrants: 0 };

      // a call held when the artifact is deleted; the fixture then answers late
      await allow(scene, run.page, TOOL_NAME);
      await expect(frame.locator('#last')).toHaveText(/^ok n=\d+ via=direct$/, { timeout: 20_000 });
      writeFileSync(hold, '');
      before = calls();
      await expect.poll(calls, { timeout: WATCH_MS + 30_000, message: 'the next refresh submitted its call' }).toBe(before + 1);
      const deletedHeld = scene.toolCalls().at(-1)!;
      appValue(await appInvoke(run.page, 'artifacts.delete', { artifactId }));
      const deleteLate = await liftHold(scene, hold, deletedHeld);
      const deletedAt = Date.now();
      await wait(WATCH_MS + 5_000);
      expect(scene.toolCallsBetween(deletedAt, Date.now()), 'nothing is called for a deleted artifact').toEqual([]);
      const after = await appInvoke(run.page, 'artifacts.connectorGrants', { artifactId });
      expect(after.ok ? after.value.grants : [], 'a deleted artifact holds no grant').toEqual([]);
      expect(await grantsOf(run.page, copy), 'nor does its duplicate').toEqual([]);
      steps.delete = { held: deletedHeld.pid, late: deleteLate };

      expect(await scene.live(run.page), 'no engine was acquired').toEqual([]);
      expect(scene.launches(engine.appSessionId).spawns, 'the owner’s one launch').toBe(1);
      const journals = sessionJournals(scene);
      expectQuietJournals(journals);
      await evidence(info, 'lifecycle', { steps, refreshes: refreshes.seen, journals: journals.map(({ turns }) => turns) });
    },
    { server: heldServer },
  );
});

test('engine only: an entry with a reference is the session’s alone; with its engine gone the page reads paused and MAWS starts nothing', async () => {
  test.setTimeout(300_000);
  const info = test.info();
  await withScene(
    'engineonly',
    info,
    async (scene) => {
      const run = await scene.launch();
      const artifactId = await scene.createPage(run.page);
      const { frame } = await scene.openPage(run.page, artifactId);
      await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
      const engine = await scene.ownerStart(run.page);
      await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
      const sheet = await scene.openSheet(run.page);
      await expect(serverRow(sheet, SERVER, 'engineOnly'), 'the sheet says the server is the session’s alone, and why').toContainText(S.engineOnly('unattested'));
      await expect(serverRow(sheet, SERVER, 'source'), 'no direct source for it').toHaveCount(0);
      await shot(info, 'engine-only-servers.png', sheet);
      await scene.closeSheet(run.page);
      await allow(scene, run.page, TOOL_NAME);
      await expect(frame.locator('#last')).toHaveText('ok n=1 via=engine', { timeout: 20_000 });
      const enginePids = new Set(scene.calls().map((entry) => entry.pid));

      await stopEngine(scene, run, engine);
      await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: WATCH_MS + 30_000 });
      await wait(WATCH_MS + 5_000);
      const own = scene.calls().filter((entry) => !enginePids.has(entry.pid));
      expect(own, 'MAWS started no instance of its own: no request reached a server the engine did not start').toEqual([]);
      expect(scene.toolCalls(), 'the one call, the engine’s').toHaveLength(1);
      expect(await scene.live(run.page)).toEqual([]);
      expect(scene.launches(engine.appSessionId).spawns).toBe(1);
      const journals = sessionJournals(scene);
      expectQuietJournals(journals);
      await evidence(info, 'engine-only', { last: (await pageState(frame)).last, serverPids: enginePids.size, toolCalls: scene.toolCalls().length, journals: journals.map(({ turns }) => turns) });
    },
    { server: referencingServer },
  );
});

// P3-HD M4b end
