// UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, M2, §B, "The guarantee, and the
// sign-in rule"): a press from a plugin's row in Customize (`connectors.signInDynamicServer` with the entry's revision)
// is held to the rule's four parts at three points of the operation: at the press, inside the queued call just before
// `mcp_authenticate`, and after the engine's answer before a browser opens or a sign-in is reported.
//
// Every join runs through the real derivations. The endpoints are the engine host's own reader over a scratch config
// home holding invented plugins (`readServerEndpoints`), so the engine names and revisions are the host's. Each session's
// plugin list is what the engine host's status tracker derives from a `system/init` (or a `reload_plugins` answer) shaped
// as 2.1.322 sends it (spikes/protocol-probe/fixtures/uxwave/u11-plugin-conn-names.jsonl seq 30; the record
// u11-plugin-conn.ndjson [6] to [10] for two plugins of one manifest name), carried in a whole `session.status` checked by
// the event's own schema, as the services hear it. Each server is shaped as that record's `mcp_status` entries are. The
// loopback listener is the real one. No engine runs here, and nothing signs in.
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { validateEventPayload } from '@shared/ipc/validate';
import { ReloadPluginsResponseSchema } from '@shared/wire/control';
import { status as fullStatus } from '../../../test/support/builders';
import { readServerEndpoints } from '../../engine-host/customization/inventory';
import { SessionStatusTracker } from '../../engine-host/session-status';
import { listenLoopback, type ListenLoopback } from './oauth-callback';
import { createRelayedCallbacks } from './relayed-callback';
import { createSignIn, startSignIn, type SignInHost } from './sign-in';

const PLUGINS_CHANGED = 'Plugins changed while this sign-in started. Try again.';
const KEY = 'key-tides@harbour';
const OTHER_KEY = 'key-tides@far-harbour';
const MANIFEST = 'mani-tides';
const NAME = `plugin:${MANIFEST}:tides-http`;
const TIDES_URL = 'https://tides.example.com/mcp';
const OTHER_URL = 'https://far-tides.example.com/mcp';
const SESSION = 'app-session-tides';
const SECOND = 'app-session-second';
const BUILTIN = { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' }; // as init lists one: no version
const DIFFERENT = (name = NAME) => `this session uses a different ${name}; start a new session to sign in`;
const CHANGED = (name = NAME) => `${name} changed since this page read it; refresh the page, then sign in`;

let root: string;
let home: string;
let configHome: string;
let userData: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'maws-plugin-sign-in-')));
  home = join(root, 'home');
  configHome = join(home, '.claude');
  userData = join(root, 'app');
  await Promise.all([mkdir(home), mkdir(userData), mkdir(join(root, 'work-a')), mkdir(join(root, 'work-b'))]);
});
let stop: (() => void) | null = null;
afterEach(async () => {
  stop?.();
  stop = null;
  await rm(root, { recursive: true, force: true });
});

const json = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
};
/** An invented plugin's folder: its manifest name and the servers its .mcp.json declares. */
async function pluginAt(folder: string, manifestName: string, servers: Record<string, { type: string; url: string }>): Promise<string> {
  const at = join(root, 'plugins', folder);
  await json(join(at, '.claude-plugin', 'plugin.json'), { name: manifestName, version: '1.2.0' });
  await json(join(at, '.mcp.json'), { mcpServers: servers });
  return at;
}
type Installation = { scope: 'user' | 'project' | 'local'; installPath: string; version?: string; projectPath?: string };
const install = (plugins: Record<string, Installation[]>) => json(join(configHome, 'plugins', 'installed_plugins.json'), { version: 2, plugins });
const tidesPlugin = (url = TIDES_URL, type = 'http', folder = 'tides') => pluginAt(folder, MANIFEST, { 'tides-http': { type, url } });

// A server as 2.1.322's mcp_status reports a plugin's (the record [2], `status.servers`)
type LiveEntry = { name: string; status: string; scope: string; source: string; transport: string; config: { type: string; url?: string }; serverInfo: { name: string; version: string }; tools: unknown[] };
const served = (url: string, over: Partial<LiveEntry> = {}): LiveEntry => ({ name: NAME, status: 'needs-auth', scope: 'dynamic', source: 'plugin', transport: 'http', config: { type: 'http', url }, serverInfo: { name: 'tides', version: '1.2.0' }, tools: [], ...over });
// A plugin as system/init lists it (seq 30): the manifest name, its folder in the marketplace, the key, the version
const loaded = (source: string, name = MANIFEST, version = '1.2.0') => ({ name, path: join(root, 'marketplace', source), source, version });

const spec = (appSessionId: string, cwd: string) => LaunchSpecSchema.parse({
  appSessionId, cwd, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
  resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
});

interface Hold { noticed: Promise<void>; release(): void }

function serve() {
  const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
  const events: ConnectorSignInChanged[] = [];
  const opened: string[] = [];
  const asked: { name: string; input: Record<string, unknown> }[] = [];
  const statusListeners = new Set<(payload: { appSessionId: string; status: { process: string; cwd: string } }) => void>();
  const changedListeners = new Set<() => void>();
  const operationListeners = new Set<(event: { opId: string; phase: string }) => void>();
  const live = new Map<string, LiveEntry[]>(); // each session's servers, as its engine holds them now
  const trackers = new Map<string, { tracker: SessionStatusTracker; cwd: string }>();
  const holds = new Map<string, (() => Promise<void>)[]>(); // per command, the next calls held open after their answer is made
  const listenHolds: (() => Promise<void>)[] = [];
  let binds = 0;
  let clock = Date.UTC(2026, 10, 14, 22, 39, 19);
  const t = {
    endpointsError: null as string | null,
    endpointsAnswer: null as unknown, // an engine host's answer of another build, in place of the reader's
    authenticate: (redirectUri: string | null): unknown => ({ ok: true, answer: { authUrl: `http://127.0.0.1:9/authorize?state=engine-state&redirect_uri=${encodeURIComponent(redirectUri ?? '')}`, requiresUserAction: true, callbackExpected: true, redirectScheme: 'custom', state: 'engine-state' } }),
  };
  const environment = () => Promise.resolve({ HOME: home, CLAUDE_CONFIG_DIR: configHome });
  const host: SignInHost = {
    async call(name, input) {
      const i = input as Record<string, unknown>;
      asked.push({ name, input: i });
      let answer: unknown;
      switch (name) {
        case 'customization.serverEndpoints':
          answer = t.endpointsError !== null ? { ok: false, error: { code: 'internal', message: t.endpointsError } } : { ok: true, value: t.endpointsAnswer ?? await readServerEndpoints(i.cwd as string | null, { userData, captureEnv: environment }) };
          break;
        case 'session.mcpStatus':
          answer = { ok: true, value: { mcpServers: structuredClone(live.get(i.appSessionId as string) ?? []) } };
          break;
        case 'session.mcpAuthenticate':
          answer = { ok: true, value: t.authenticate(i.redirectUri as string | null) };
          break;
        case 'session.mcpOAuthCallback':
          answer = { ok: true, value: { ok: true } };
          break;
        case 'session.mcpReconnect':
          for (const server of live.get(i.appSessionId as string) ?? []) if (server.name === i.serverName) server.status = 'connected';
          answer = { ok: true, value: { opId: 'reconnect-1' } };
          break;
        default:
          throw new Error(`unexpected ${name}`);
      }
      const held = holds.get(name)?.shift();
      if (held) await held();
      return answer as never;
    },
  };
  const listen: ListenLoopback = async (handle, options) => {
    binds += 1;
    const held = listenHolds.shift();
    if (held) await held();
    return listenLoopback(handle, options);
  };
  const holdOpen = (queue: (() => Promise<void>)[]): Hold => {
    let noticed!: () => void;
    let release!: () => void;
    const seen = new Promise<void>((resolve) => (noticed = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    queue.push(() => (noticed(), released));
    return { noticed: seen, release };
  };

  const service = startSignIn({
    bus: { register: ((name: string, handler: (input: unknown, ctx: unknown) => unknown) => handlers.set(name, handler)) as never, emit: ((_name: string, event: ConnectorSignInChanged) => events.push(event)) as never },
    host,
    onSessionStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
    onHostLost: () => () => {},
    sessions: async () => [],
    hostStreaming: () => true,
    onHostStreaming: () => () => {},
    onPluginsChanged: (listener) => (changedListeners.add(listener), () => changedListeners.delete(listener)),
    onPluginsOperation: (listener) => (operationListeners.add(listener), () => operationListeners.delete(listener)),
    port: { openExternal: async (_client, target) => (opened.push((target as { url: string }).url), { opened: true }) },
    listen,
    relayed: createRelayedCallbacks(),
    machine: 'this-mac',
  });
  stop = () => service.stop();

  // The whole status the engine host would send for the session now, checked by the event's schema, to every listener
  const announce = (appSessionId: string, process: 'ready' | 'exited' = 'ready') => {
    const { tracker, cwd } = trackers.get(appSessionId)!;
    const snapshot = tracker.snapshot();
    const payload = { appSessionId, status: { ...fullStatus(appSessionId), cwd, process, plugins: snapshot.plugins, pluginErrors: snapshot.pluginErrors, pluginWarnings: snapshot.pluginWarnings, pluginsObservedAt: snapshot.pluginsObservedAt, mcpServers: snapshot.mcpServers } };
    const checked = validateEventPayload('session.status', payload);
    if (!checked.ok) throw new Error(`invalid session.status: ${JSON.stringify(checked.issues)}`);
    for (const listener of [...statusListeners]) listener(checked.value as never);
  };
  const session = {
    /** A launch MAWS started in `cwd` with these servers: ready, its plugins not reported yet (no system/init). */
    launch(appSessionId: string, cwd: string, servers: LiveEntry[]) {
      trackers.set(appSessionId, { tracker: new SessionStatusTracker(spec(appSessionId, cwd), () => {}), cwd });
      live.set(appSessionId, servers);
      announce(appSessionId);
    },
    /** Its main lane's system/init, listing these plugins and its servers as 2.1.322 does (seq 30). */
    init(appSessionId: string, plugins: unknown[]) {
      const { tracker, cwd } = trackers.get(appSessionId)!;
      clock += 1000;
      tracker.observe({
        type: 'system', subtype: 'init', cwd, session_id: '00000000-0000-4000-8000-000000000030', model: 'claude-test', claude_code_version: '2.1.322', permissionMode: 'default',
        plugins, mcp_servers: (live.get(appSessionId) ?? []).map(({ name, status, source }) => ({ name, status, source })),
      }, new Date(clock).toISOString());
      announce(appSessionId);
    },
    /** A reload_plugins answer, which the tracker takes as the session's plugins now (E8). */
    reload(appSessionId: string, plugins: unknown[]) {
      trackers.get(appSessionId)!.tracker.applyReload(ReloadPluginsResponseSchema.parse({ commands: [], agents: [], plugins, error_count: 0 }));
      announce(appSessionId);
    },
    exit: (appSessionId: string) => announce(appSessionId, 'exited'),
    /** What the session's engine holds under its names, swapped with no word to MAWS (the engine reconciles by itself). */
    serve: (appSessionId: string, servers: LiveEntry[]) => void live.set(appSessionId, servers),
  };
  const plugins = {
    changed() {
      if (!validateEventPayload('plugins.changed', {}).ok) throw new Error('invalid plugins.changed');
      for (const listener of [...changedListeners]) listener();
    },
    operation(opId: string, phase: 'started' | 'output' | 'done') {
      const payload = { opId, action: 'install', target: 'key-reef@harbour', phase, ...(phase === 'done' && { outcome: { ok: true, result: {} } }) };
      const checked = validateEventPayload('plugins.operation', payload);
      if (!checked.ok) throw new Error(`invalid plugins.operation: ${JSON.stringify(checked.issues)}`);
      for (const listener of [...operationListeners]) listener(checked.value as never);
    },
  };

  /** The revision the row was drawn with: the plugin's entry of the name as the engine host answers it now. */
  const revisionOf = async (cwd: string, plugin = KEY, name = NAME) => {
    const read = await readServerEndpoints(cwd, { userData, captureEnv: environment });
    const entry = read.pluginServers.find((candidate) => candidate.plugin === plugin && candidate.name === name);
    if (!entry?.revision) throw new Error(`no revision for ${plugin} ${name} at ${cwd}`);
    return entry.revision;
  };
  const press = (revision: string, appSessionId = SESSION, name = NAME) => (handlers.get('connectors.signInDynamicServer')!({ name, appSessionId, entry: { revision } }, { client: null }) as { opId: string }).opId;
  const pressFromDialog = (name: string, appSessionId = SESSION) => (handlers.get('connectors.signInDynamicServer')!({ name, appSessionId }, { client: null }) as { opId: string }).opId;
  const of = (opId: string) => events.filter((event) => event.opId === opId);
  const last = (opId: string) => of(opId).at(-1);
  const until = async (check: () => boolean, what: string) => {
    for (let i = 0; i < 400 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    if (!check()) throw new Error(`timed out waiting for ${what}`);
  };
  const ended = (opId: string) => until(() => ['done', 'failed', 'cancelled'].includes(last(opId)?.state ?? ''), `${opId} to end`);
  const named = (name: string) => asked.filter((call) => call.name === name);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return {
    t, session, plugins, revisionOf, press, pressFromDialog, events, opened, asked, last, until, ended, settle,
    states: (opId: string) => of(opId).map((event) => event.state),
    authenticated: () => named('session.mcpAuthenticate').map((call) => call.input),
    statusReads: () => named('session.mcpStatus').length,
    endpointReads: () => named('customization.serverEndpoints').map((call) => call.input),
    binds: () => binds,
    hold: (name: string) => {
      const queue = holds.get(name) ?? [];
      holds.set(name, queue);
      return holdOpen(queue);
    },
    holdListen: () => holdOpen(listenHolds),
    redirect: () => new URL(new URL(opened.at(-1)!).searchParams.get('redirect_uri')!),
  };
}

/** The tides plugin installed at user scope, and a session in folder A that loaded it alone and reported it. */
async function tidesSession(url = TIDES_URL) {
  const s = serve();
  await install({ [KEY]: [{ scope: 'user', installPath: await tidesPlugin(url), version: '1.2.0' }] });
  s.session.launch(SESSION, join(root, 'work-a'), [served(TIDES_URL)]);
  s.session.init(SESSION, [loaded(KEY), BUILTIN]);
  return { ...s, revision: await s.revisionOf(join(root, 'work-a')) };
}

describe('a press from a plugin’s row (UX wave U11h, M2)', () => {
  it('signs in through the session that reported this row’s plugin as the one owner, at the row’s address, through every state to connected here', async () => {
    const s = await tidesSession();
    const opId = s.press(s.revision);
    await s.until(() => s.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    expect(s.endpointReads()).toEqual([{ cwd: join(root, 'work-a') }]); // the session's own folder
    // point 1's read, the baseline, point 2's read before the call, and point 3's after its answer
    expect(s.statusReads()).toBe(4);
    const redirect = s.redirect();
    expect(s.authenticated()).toEqual([{ appSessionId: SESSION, serverName: NAME, redirectUri: `${redirect.origin}/callback` }]);
    expect((await fetch(`${redirect.origin}/callback?code=the-code&state=engine-state`)).status).toBe(200);
    await s.ended(opId);
    expect(s.states(opId)).toEqual(['starting', 'waiting_browser', 'waiting_callback', 'submitting', 'watching_status', 'done']);
    expect(s.last(opId)).toEqual({ opId, name: NAME, state: 'done', reason: null, message: null, where: 'here' });
  });

  describe('(a) the owner, from the plugin list the session reported', () => {
    it('no list reported yet (a session MAWS started with no message has sent no system/init) is refused', async () => {
      const s = serve();
      await install({ [KEY]: [{ scope: 'user', installPath: await tidesPlugin(), version: '1.2.0' }] });
      s.session.launch(SESSION, join(root, 'work-a'), [served(TIDES_URL)]); // its mcp_status answers before any init
      const opId = s.press(await s.revisionOf(join(root, 'work-a')));
      await s.ended(opId);
      expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: 'that session has not reported its plugins yet; send it a message, then sign in' });
      expect(s.authenticated()).toEqual([]);
      // its first turn's init reports the list: the same press now passes
      s.session.init(SESSION, [loaded(KEY)]);
      const again = s.press(await s.revisionOf(join(root, 'work-a')));
      await s.until(() => s.last(again)?.state === 'waiting_callback', 'waiting_callback');
    });

    it('a session that loaded no possible owner, or the name from another plugin, or another version, is refused', async () => {
      const s = await tidesSession();
      s.session.reload(SESSION, [BUILTIN]);
      let opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)?.message).toBe(`that session loaded no plugin that supplies ${NAME}`);
      s.session.reload(SESSION, [loaded(OTHER_KEY)]);
      opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)?.message).toBe(`that session loaded ${NAME} from another plugin`);
      s.session.reload(SESSION, [loaded(KEY, MANIFEST, '1.1.0')]);
      opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)?.message).toBe('that session loaded another version of this plugin; start a new session to sign in');
      expect(s.authenticated()).toEqual([]);
      expect(s.opened).toEqual([]);
    });

    it('two plugins of one manifest name are the collision for either row, whichever the session lists first (the record’s lines 6 and 7)', async () => {
      const s = serve();
      const cwd = join(root, 'work-a');
      await install({ [KEY]: [{ scope: 'user', installPath: await tidesPlugin(), version: '1.2.0' }], [OTHER_KEY]: [{ scope: 'user', installPath: await tidesPlugin(OTHER_URL, 'http', 'far-tides'), version: '1.2.0' }] });
      const rows = [await s.revisionOf(cwd, KEY), await s.revisionOf(cwd, OTHER_KEY)];
      expect(rows[0]).not.toBe(rows[1]); // two entries of one engine name, told apart by their revisions
      s.session.launch(SESSION, cwd, [served(OTHER_URL)]); // the engine keeps one of them and says nothing
      for (const order of [[loaded(KEY), loaded(OTHER_KEY)], [loaded(OTHER_KEY), loaded(KEY)]]) {
        s.session.init(SESSION, order);
        for (const revision of rows) {
          const opId = s.press(revision);
          await s.ended(opId);
          expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: `more than one plugin in that session supplies ${NAME}; turn the others off, start a new session, then sign in` });
        }
      }
      expect(s.authenticated()).toEqual([]);
    });

    it('the colon pair: alpha with a server beta:gamma and alpha:beta with a server gamma, the second installed for folder B alone', async () => {
      const s = serve();
      const [a, b] = [join(root, 'work-a'), join(root, 'work-b')];
      const name = 'plugin:alpha:beta:gamma';
      const alpha = served('https://alpha.example.com/mcp', { name });
      await install({
        'alpha@harbour': [{ scope: 'user', installPath: await pluginAt('alpha', 'alpha', { 'beta:gamma': { type: 'http', url: 'https://alpha.example.com/mcp' } }), version: '1.2.0' }],
        'alpha-beta@harbour': [{ scope: 'project', projectPath: b, installPath: await pluginAt('alpha-beta', 'alpha:beta', { gamma: { type: 'http', url: 'https://alpha-beta.example.com/mcp' } }), version: '1.2.0' }],
      });
      // folder B's session loaded both: there it is the collision, for either row
      s.session.launch(SECOND, b, [alpha]);
      s.session.init(SECOND, [loaded('alpha@harbour', 'alpha'), loaded('alpha-beta@harbour', 'alpha:beta')]);
      for (const plugin of ['alpha@harbour', 'alpha-beta@harbour']) {
        const opId = s.press(await s.revisionOf(b, plugin, name), SECOND, name);
        await s.ended(opId);
        expect([plugin, s.last(opId)?.message]).toEqual([plugin, `more than one plugin in that session supplies ${name}; turn the others off, start a new session, then sign in`]);
      }
      expect(s.endpointReads().map((input) => input.cwd)).toEqual([b, b]);
      // folder A's session did not load the second: the first is its one possible owner, and signs in
      s.session.launch(SESSION, a, [alpha]);
      s.session.init(SESSION, [loaded('alpha@harbour', 'alpha')]);
      const opId = s.press(await s.revisionOf(a, 'alpha@harbour', name), SESSION, name);
      await s.until(() => s.last(opId)?.state === 'waiting_callback', 'waiting_callback');
      expect(s.authenticated()).toEqual([expect.objectContaining({ appSessionId: SESSION, serverName: name })]);
    });
  });

  describe('(b) the server and (c) the address, in the session’s status read at the press', () => {
    it('no server of the name, a server not dynamic, and another transport are refused', async () => {
      const s = await tidesSession();
      for (const [servers, message] of [
        [[], `that session has no ${NAME} server`],
        [[served(TIDES_URL, { scope: 'user' })], DIFFERENT()],
        [[served(TIDES_URL, { source: 'sdk' })], DIFFERENT()],
        [[served(TIDES_URL, { transport: 'sse', config: { type: 'sse', url: TIDES_URL } })], DIFFERENT()],
      ] as const) {
        s.session.serve(SESSION, [...servers]);
        const opId = s.press(s.revision);
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message });
      }
      expect(s.authenticated()).toEqual([]);
    });

    it('another address is refused; a templated address signs in at a live address that matches it', async () => {
      const s = await tidesSession();
      s.session.serve(SESSION, [served('https://tides.example.com/mcp/')]);
      let opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)?.message).toBe(DIFFERENT());
      await tidesPlugin('https://tides.example.com/${TENANT}/mcp');
      s.session.serve(SESSION, [served('https://tides.example.com/harbour/mcp')]);
      opId = s.press(await s.revisionOf(join(root, 'work-a')));
      await s.until(() => s.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    });

    it('an address whose origin is set when a chat starts is refused in the launch’s words', async () => {
      const s = await tidesSession('https://${TIDES_HOST}/mcp');
      const opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)?.message).toBe(`${NAME}’s address is set when a chat starts; sign in from that chat’s Connectors dialog`);
      expect(s.authenticated()).toEqual([]);
    });

    // the architect's ruling of 2026-11-15: such a connector is not listed, so a row drawn before its address grew past the
    // bound presses a revision the host no longer answers (the check's own refusal of a remote entry with no address is
    // sign-in-entry.test.ts's)
    it('a declared address past the endpoints’ bound is not listed, so a press is refused as changed, a session whose live address is its first 4096 characters included', async () => {
      const s = await tidesSession();
      const long = `https://tides.example.com/${'a'.repeat(4100)}`;
      await tidesPlugin(long);
      await expect(s.revisionOf(join(root, 'work-a'))).rejects.toThrow('no revision');
      s.session.serve(SESSION, [served(long.slice(0, 4096))]);
      const opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)).toEqual(expect.objectContaining({ state: 'failed', reason: 'other_entry', message: CHANGED() }));
      expect(s.authenticated()).toEqual([]);
    });
  });

  describe('(d) the revision', () => {
    it('the entry gone, or its revision another as each thing it covers changes, is refused as changed', async () => {
      const s = await tidesSession();
      const cwd = join(root, 'work-a');
      const at = join(root, 'plugins', 'tides');
      const changes: [string, () => Promise<unknown>][] = [
        ['the key', () => install({ 'key-tides@new-harbour': [{ scope: 'user', installPath: at, version: '1.2.0' }] })],
        ['the installation’s scope', () => install({ [KEY]: [{ scope: 'local', projectPath: cwd, installPath: at, version: '1.2.0' }] })],
        ['the installation’s folder', async () => install({ [KEY]: [{ scope: 'user', installPath: await tidesPlugin(TIDES_URL, 'http', 'tides-moved'), version: '1.2.0' }] })],
        ['the installation’s version', () => install({ [KEY]: [{ scope: 'user', installPath: at, version: '1.2.1' }] })],
        ['the engine name', () => pluginAt('tides', 'mani-tides-2', { 'tides-http': { type: 'http', url: TIDES_URL } })],
        ['the transport', () => tidesPlugin(TIDES_URL, 'sse')],
        ['the address', () => tidesPlugin('https://tides.example.com/v2/mcp')],
        ['the entry gone', () => install({})],
      ];
      for (const [what, change] of changes) {
        await install({ [KEY]: [{ scope: 'user', installPath: await tidesPlugin(), version: '1.2.0' }] });
        expect(await s.revisionOf(cwd)).toBe(s.revision);
        await change();
        const opId = s.press(s.revision);
        await s.ended(opId);
        expect([what, s.last(opId)]).toEqual([what, expect.objectContaining({ state: 'failed', reason: 'other_entry', message: CHANGED() })]);
      }
      expect(s.authenticated()).toEqual([]);
    });

    it('an engine host that answers no plugins’ connectors (an earlier build) is refused as changed', async () => {
      const s = await tidesSession();
      s.t.endpointsAnswer = { servers: [] };
      const opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)?.message).toBe(CHANGED());
    });
  });

  describe('held open at point 1', () => {
    it('the endpoints read is out while the status has answered: nothing proceeds before both have', async () => {
      const s = await tidesSession();
      const read = s.hold('customization.serverEndpoints');
      const opId = s.press(s.revision);
      await read.noticed;
      await s.settle();
      expect(s.statusReads()).toBe(1); // point 1's, answered
      expect(s.binds()).toBe(0);
      expect(s.authenticated()).toEqual([]);
      expect(s.states(opId)).toEqual(['starting']);
      read.release();
      await s.until(() => s.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    });

    it('the read fails: that session’s configuration could not be read, and nothing is bound or sent', async () => {
      const s = await tidesSession();
      s.t.endpointsError = 'the engine host is busy';
      const opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: 'that session’s configuration could not be read: the engine host is busy' });
      expect(s.binds()).toBe(0);
      expect(s.authenticated()).toEqual([]);
    });

    it('the read is made with the session’s folder, not the page’s', async () => {
      const s = serve();
      await install({ [KEY]: [{ scope: 'project', projectPath: join(root, 'work-b'), installPath: await tidesPlugin(), version: '1.2.0' }] });
      s.session.launch(SECOND, join(root, 'work-b'), [served(TIDES_URL)]);
      s.session.init(SECOND, [loaded(KEY)]);
      const opId = s.press(await s.revisionOf(join(root, 'work-b')), SECOND);
      await s.until(() => s.last(opId)?.state === 'waiting_callback', 'waiting_callback');
      expect(s.endpointReads()).toEqual([{ cwd: join(root, 'work-b') }]);
    });
  });

  describe('what the services keep of a session’s plugins', () => {
    it('the list is dropped when the session ends, and a new launch’s list is not the old one’s', async () => {
      const s = await tidesSession();
      s.session.exit(SESSION);
      let opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'no_session' });
      // a new launch of the same session: ready, its plugins not reported in this launch
      s.session.launch(SESSION, join(root, 'work-a'), [served(TIDES_URL)]);
      opId = s.press(s.revision);
      await s.ended(opId);
      expect(s.last(opId)?.message).toBe('that session has not reported its plugins yet; send it a message, then sign in');
      expect(s.authenticated()).toEqual([]);
    });

    it('a plugins operation that is done no longer blocks', async () => {
      const s = await tidesSession();
      s.plugins.operation('op-reef', 'started');
      s.plugins.operation('op-reef', 'output');
      s.plugins.operation('op-reef', 'done');
      const opId = s.press(s.revision);
      await s.until(() => s.last(opId)?.state === 'waiting_callback', 'waiting_callback');
      expect(s.authenticated()).toHaveLength(1);
    });

    it('a press from the session’s Connectors dialog (no entry) and one of MAWS’s own list keep today’s path: no second or third status read', async () => {
      const s = await tidesSession();
      const dialog = s.pressFromDialog(NAME);
      await s.until(() => s.last(dialog)?.state === 'waiting_callback', 'the dialog’s waiting_callback');
      expect(s.statusReads()).toBe(2); // its check's and the baseline: nothing before the call or after its answer
      expect(s.endpointReads()).toEqual([]);
      const own = { name: 'fx-own', scope: 'app', path: join(userData, 'machine-settings.json'), transport: 'http', url: 'https://own.example.com/mcp', revision: 'rev-own' };
      s.t.endpointsAnswer = { servers: [own] };
      s.session.launch(SECOND, join(root, 'work-b'), [served(own.url, { name: 'fx-own', source: 'sdk' } as Partial<LiveEntry>)]);
      const reads = s.statusReads();
      const fromList = s.press('rev-own', SECOND, 'fx-own');
      await s.until(() => s.last(fromList)?.state === 'waiting_callback', 'the list’s waiting_callback');
      expect(s.statusReads() - reads).toBe(2);
      expect(s.endpointReads()).toEqual([{ cwd: null }]); // MAWS's own list, as U11a reads it
    });
  });

  // The three points, each by its own named tests. Each holds the earlier points' reads to the first state (the swap is
  // injected after they answered and before the named wait resolves) and asserts on what was not sent, not opened or not
  // reported, and on the sentence. A swap replaces the session's server of the name with another plugin's at another
  // address, as the engine may by itself; or what it reports of its plugins.
  describe('the three points', () => {
    const otherPlugins = () => served(OTHER_URL, { serverInfo: { name: 'far-tides', version: '1.2.0' } });

    describe('point 1', () => {
      it('point 1: a press the rule refuses binds no listener and reads no baseline', async () => {
        const s = await tidesSession();
        s.session.reload(SESSION, [loaded(KEY), loaded(OTHER_KEY)]); // the collision, reported
        const opId = s.press(s.revision);
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: `more than one plugin in that session supplies ${NAME}; turn the others off, start a new session, then sign in` });
        expect(s.statusReads()).toBe(1); // point 1's own read, no baseline
        expect(s.binds()).toBe(0);
        expect(s.authenticated()).toEqual([]);
        expect(s.states(opId)).toEqual(['starting', 'failed']);
      });

      it('point 1: the baseline of a server already connected at another address is not reported as already connected', async () => {
        const s = await tidesSession();
        const pointOne = s.hold('session.mcpStatus'); // point 1's own read answers the first state
        const opId = s.press(s.revision);
        await pointOne.noticed;
        s.session.serve(SESSION, [{ ...otherPlugins(), status: 'connected' }]); // the baseline reads another plugin's, connected
        pointOne.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: DIFFERENT() });
        expect(s.last(opId)?.where).toBeNull();
        expect(s.statusReads()).toBe(2);
        expect(s.binds()).toBe(0);
        expect(s.authenticated()).toEqual([]);
      });

      // "Already connected" is a report of a sign-in: before it is said, (a) is judged on the list kept now and nothing may
      // have moved since point 1, as at point 3 (M2's task review). The server is connected at the row's address from the
      // start; the baseline read is held open while the session's report changes.
      async function connectedBaseline(change: (s: Awaited<ReturnType<typeof tidesSession>>) => void) {
        const s = await tidesSession();
        s.session.serve(SESSION, [served(TIDES_URL, { status: 'connected' })]);
        s.hold('session.mcpStatus').release(); // point 1's read passes through
        const baseline = s.hold('session.mcpStatus');
        const opId = s.press(s.revision);
        await baseline.noticed; // the baseline answered connected, at the row's address, and is held
        change(s);
        baseline.release();
        await s.ended(opId);
        return { s, opId };
      }

      it('point 1: a baseline connected at the row’s address is not reported as already connected once the session reports a collision', async () => {
        const { s, opId } = await connectedBaseline((t) => t.session.reload(SESSION, [loaded(KEY), loaded(OTHER_KEY)]));
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.states(opId)).toEqual(['starting', 'failed']);
        expect(s.binds()).toBe(0);
        expect(s.authenticated()).toEqual([]);
      });

      it('point 1: a baseline connected at the row’s address is not reported as already connected once the session reports another owner', async () => {
        const { s, opId } = await connectedBaseline((t) => t.session.reload(SESSION, [loaded(OTHER_KEY)]));
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.states(opId)).toEqual(['starting', 'failed']);
      });

      it('point 1: a baseline connected at the row’s address is not reported as already connected once the session reports its plugins anew', async () => {
        const { s, opId } = await connectedBaseline((t) => t.session.init(SESSION, [loaded(KEY), BUILTIN])); // the same list, a new pluginsObservedAt
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.states(opId)).toEqual(['starting', 'failed']);
      });

      it('point 1: a baseline connected at the row’s address with nothing moved is reported as already connected', async () => {
        const { s, opId } = await connectedBaseline(() => {});
        expect(s.last(opId)).toMatchObject({ state: 'done', reason: null, where: 'here', message: 'already connected' });
        expect(s.binds()).toBe(0);
        expect(s.authenticated()).toEqual([]);
      });
    });

    describe('point 2', () => {
      it('point 2: a swap during the baseline read sends no mcp_authenticate', async () => {
        const s = await tidesSession();
        s.hold('session.mcpStatus').release(); // point 1's read passes through
        const baseline = s.hold('session.mcpStatus');
        const opId = s.press(s.revision);
        await baseline.noticed; // the baseline answered the first state and is held
        s.session.serve(SESSION, [otherPlugins()]);
        baseline.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.binds()).toBe(1); // points 1 and the baseline passed
        expect(s.authenticated()).toEqual([]);
        expect(s.opened).toEqual([]);
      });

      it('point 2: a swap while the listener is bound sends no mcp_authenticate', async () => {
        const s = await tidesSession();
        const bind = s.holdListen();
        const opId = s.press(s.revision);
        await bind.noticed;
        s.session.serve(SESSION, [otherPlugins()]);
        bind.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.statusReads()).toBe(3); // point 1's, the baseline, point 2's
        expect(s.authenticated()).toEqual([]);
        expect(s.opened).toEqual([]);
      });

      it('point 2: a swap while queued behind an earlier authentication sends no mcp_authenticate', async () => {
        const s = await tidesSession();
        const earlier = s.hold('session.mcpAuthenticate');
        const first = s.press(s.revision);
        await earlier.noticed; // the first press's call is out
        const binds = s.binds();
        const second = s.press(s.revision); // cancels the first; its own call waits behind the first's
        expect(s.last(first)?.state).toBe('cancelled');
        await s.until(() => s.binds() > binds, 'the second press’s listener');
        await s.settle();
        s.session.serve(SESSION, [otherPlugins()]);
        earlier.release();
        await s.ended(second);
        expect(s.last(second)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.authenticated()).toHaveLength(1); // the first press's alone
        expect(s.opened).toEqual([]);
      });

      it('point 2: a reload answered during the queue wait sends no mcp_authenticate', async () => {
        const s = await tidesSession();
        const earlier = s.hold('session.mcpAuthenticate');
        const first = s.press(s.revision);
        await earlier.noticed;
        const binds = s.binds();
        const second = s.press(s.revision);
        await s.until(() => s.binds() > binds, 'the second press’s listener');
        await s.settle();
        s.session.reload(SESSION, [loaded(KEY), BUILTIN]); // the same plugins, reported again: a new pluginsObservedAt
        earlier.release();
        await s.ended(second);
        expect(s.last(first)?.state).toBe('cancelled');
        expect(s.last(second)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.authenticated()).toHaveLength(1);
      });
    });

    describe('point 3', () => {
      it('point 3: a swap between the call and the engine’s answer opens no browser', async () => {
        const s = await tidesSession();
        const call = s.hold('session.mcpAuthenticate');
        const opId = s.press(s.revision);
        await call.noticed;
        s.session.serve(SESSION, [otherPlugins()]);
        s.session.reload(SESSION, [loaded(OTHER_KEY)]);
        call.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.authenticated()).toHaveLength(1);
        expect(s.opened).toEqual([]);
      });

      it('point 3: a status whose address changed between the call and the answer opens no browser', async () => {
        const s = await tidesSession();
        const call = s.hold('session.mcpAuthenticate');
        const opId = s.press(s.revision);
        await call.noticed;
        s.session.serve(SESSION, [served('https://tides.example.com/elsewhere')]);
        call.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.opened).toEqual([]);
      });

      it('point 3: a new pluginsObservedAt between the press and the answer opens no browser', async () => {
        const s = await tidesSession();
        const call = s.hold('session.mcpAuthenticate');
        const opId = s.press(s.revision);
        await call.noticed;
        s.session.init(SESSION, [loaded(KEY), BUILTIN]); // the next turn's init: the same list, reported anew
        call.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.opened).toEqual([]);
      });

      it('point 3: a plugins operation running at the answer opens no browser', async () => {
        const s = await tidesSession();
        const call = s.hold('session.mcpAuthenticate');
        const opId = s.press(s.revision);
        await call.noticed;
        s.plugins.operation('op-reef', 'started');
        call.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.opened).toEqual([]);
      });

      it('point 3: the no-browser end with a changed address is not reported as signed in', async () => {
        const s = await tidesSession();
        s.t.authenticate = () => ({ ok: true, answer: { requiresUserAction: false } }); // the engine needs no consent
        const call = s.hold('session.mcpAuthenticate');
        const opId = s.press(s.revision);
        await call.noticed;
        s.session.serve(SESSION, [served('https://tides.example.com/elsewhere')]);
        call.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        expect(s.states(opId)).not.toContain('done');
        expect(s.opened).toEqual([]);
      });

      it('point 3: a refused answer leaves the operation ended as a cancel leaves it, and sends the engine no callback and no other call', async () => {
        const s = await tidesSession();
        const call = s.hold('session.mcpAuthenticate');
        const opId = s.press(s.revision);
        await call.noticed;
        const redirect = new URL((s.authenticated()[0] as { redirectUri: string }).redirectUri);
        s.plugins.changed();
        call.release();
        await s.ended(opId);
        expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: PLUGINS_CHANGED });
        const sent = s.asked.length;
        // its listener is closed: the browser's return reaches nothing, and nothing more is asked of the engine
        await expect(fetch(`${redirect.origin}/callback?code=c&state=engine-state`)).rejects.toThrow();
        await s.settle();
        expect(s.asked.length).toBe(sent);
        expect(s.asked.at(-1)?.name).toBe('session.mcpStatus'); // point 3's read, after the call
        expect(s.asked.map((a) => a.name)).not.toContain('session.mcpOAuthCallback');
        expect(s.asked.map((a) => a.name)).not.toContain('session.mcpReconnect');
        expect(s.opened).toEqual([]);
        expect(s.states(opId)).toEqual(['starting', 'failed']);
      });
    });
  });

  // A cancel between a passing check and its side effect is honoured (M2's task review): the operation confirms it is
  // live after point 2's check before it sends, and after point 3's before it acts on the answer. The operation is driven
  // directly, its check standing in for the service's; the cancel lands a number of microtasks after the check answers,
  // swept over every step up to the side effect, and nothing may be sent or opened after the cancel.
  describe('a cancel at each resumption', () => {
    const entry = { plugin: KEY, name: NAME, version: '1.2.0', transport: 'http', url: TIDES_URL, revision: 'rev-tides' };
    const afterTicks = (ticks: number, run: () => void) => {
      let chain: Promise<void> = Promise.resolve();
      for (let i = 0; i < ticks; i += 1) chain = chain.then(() => {});
      void chain.then(run);
    };
    async function sweep(point: 2 | 3) {
      for (let ticks = 0; ticks < 16; ticks += 1) {
        const log: string[] = [];
        let opId = '';
        const host: SignInHost = {
          async call(name, input) {
            log.push(name);
            const i = input as { redirectUri?: string | null };
            if (name === 'session.mcpStatus') return { ok: true, value: { mcpServers: [served(TIDES_URL)] } } as never;
            if (name === 'session.mcpAuthenticate') return { ok: true, value: { ok: true, answer: { authUrl: `http://127.0.0.1:9/authorize?state=s&redirect_uri=${encodeURIComponent(i.redirectUri ?? '')}`, requiresUserAction: true, callbackExpected: true, redirectScheme: 'custom', state: 's' } } } as never;
            throw new Error(`unexpected ${name}`);
          },
        };
        const signIn = createSignIn({
          host,
          listen: listenLoopback,
          port: { openExternal: async () => (log.push('openExternal'), { opened: true }) },
          emit: (event) => void log.push(`event:${event.state}`),
          ready: () => true,
          onSessionGone: () => () => {},
          check: async (request, at) => {
            if (at === 1) request.kept!.pointOne = { entry, observedAt: '2026-11-14T22:39:20.000Z', changes: 0 };
            if (at === point) afterTicks(ticks, () => void signIn.cancel(opId));
            return null;
          },
        });
        opId = signIn.start({ name: NAME, scope: 'dynamic', cwd: null, entry: { revision: 'rev-tides' }, appSessionId: SESSION }, null).opId;
        for (let i = 0; i < 400 && !log.includes('event:cancelled'); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
        await new Promise((resolve) => setTimeout(resolve, 10));
        signIn.stop();
        const cancelled = log.indexOf('event:cancelled');
        expect([ticks, cancelled >= 0]).toEqual([ticks, true]);
        expect([ticks, log.slice(cancelled + 1).filter((step) => !step.startsWith('event:'))]).toEqual([ticks, []]);
      }
    }

    it('a cancel landing as point 2’s check answers sends no mcp_authenticate', () => sweep(2));
    it('a cancel landing as point 3’s check answers opens no browser', () => sweep(3));
  });
});
