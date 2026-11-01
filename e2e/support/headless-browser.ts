// The agent's browser with no app (P5 O17, docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8): what the local
// stage's scenes share. The guard the scenes that need M7 read, the pages a scene's server serves on 127.0.0.1, and the
// scene itself: a profile's `mawsd` with no app (./profile-daemon.ts), its engine the cua engine stub coming ready
// (test/support/cua-engine.ts), so each session reaches its engine through the ordinary start path (`session.create`
// and `session.start`, which tell the engine the daemon's socket in its settings), never a raw `session.launch`; the
// stub's connector is cua's host, driven over its control socket.
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { cuaSocketPath, daemonCuaSocketPath } from '@shared/browser/cua-socket';
import { cuaSocketDir, renderCuaSocketDir } from '@shared/daemon/files';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { HOST_BROWSER_WORK_CAPABILITY, PEER_CAPABILITIES } from '@shared/host/socket-protocol';
import type { DaemonRender, DaemonStatus } from '@shared/ipc/schema/daemon';
import type { SessionCapabilities } from '@shared/ipc/schema/session-capabilities';
import { machineSettingsDefaults } from '@shared/settings/defaults';
import { connectorControl, connectorReport, writeCuaEngine, type ConnectorControl, type ConnectorReport, type CuaEngineOptions } from '../../test/support/cua-engine';
import { startProfileDaemon, type ProfileDaemon } from './profile-daemon';

// ---- the guard ----------------------------------------------------------------------------------------------------------

// The one guard O17 M7 deletes: whether this build's engine host lists `host.browserWork`. Until it does no real engine
// host selects the headless route (M3's "At its end", the old-host cell), so a scene that needs it skips with BEFORE_M7,
// and turns on by itself the moment M7 lists the capability.
export const ENGINE_HOST_BROWSER_WORK = (PEER_CAPABILITIES.engineHost as readonly string[]).includes(HOST_BROWSER_WORK_CAPABILITY);
export const BEFORE_M7 = 'needs an engine host that lists host.browserWork (O17 M7, after O16 lands): until then no real engine host selects the headless route';

// §I's sentences, as the scenes read them
export const SCREENCAST = { available: true, viewed: 'screencast' } as const;
export const oldHostReason = (machine: string) => `the engine host on ${machine} predates browser work holds; it is replaced when idle`;
export const linuxReason = (machine: string) => `cua's host cannot check its peers on Linux yet, so the agent's browser is unavailable on ${machine}`;

// ---- the pages ----------------------------------------------------------------------------------------------------------

export const PAGE_MARKER = 'o17-headless-marker-5c1';
export const BUTTON = { x: 40, y: 60, width: 120, height: 40 } as const; // the input page's button, in the viewport's DIP

// `/` a marker and a button; `/still` one colour, painting nothing more; `/input` a tall page that keeps what a person's
// input did (its button's click, keys, wheel, and a text field that has focus); `/anim` a page that repaints at every
// animation frame and counts them; `/popup` and `/child`, an opener and the page it opens.
export interface Pages {
  origin: string;
  url(path: string): string;
  close(): Promise<void>;
}
export function startPages(): Promise<Pages> {
  const html = (body: string) => `<!doctype html><meta charset="utf-8">${body}`;
  const routes: Record<string, string> = {
    '/': html(`<title>O17 first</title><p id="marker">${PAGE_MARKER}</p><button id="go" style="position:absolute;left:${BUTTON.x}px;top:${BUTTON.y}px;width:${BUTTON.width}px;height:${BUTTON.height}px">Go</button>`),
    '/still': html('<title>still</title><body style="margin:0;background:#2a6"></body>'),
    '/input': html(
      `<title>input</title><body style="margin:0;height:4000px"><button id="go" style="position:absolute;left:${BUTTON.x}px;top:${BUTTON.y}px;width:${BUTTON.width}px;height:${BUTTON.height}px" onclick="document.querySelector('#state').textContent='clicked'">Go</button>` +
        `<p id="state" style="position:absolute;top:120px">idle</p><input id="field" autofocus style="position:absolute;top:160px">` +
        `<script>window.__keys=[];window.__wheel=[];addEventListener('keydown',(e)=>__keys.push(e.key));addEventListener('wheel',(e)=>__wheel.push(e.deltaY));document.querySelector('#field').focus();</script></body>`,
    ),
    '/anim': html(`<title>anim</title><body style="margin:0"><script>window.__frames=0;const tick=()=>{__frames+=1;document.body.style.background='hsl('+(__frames%360)+',60%,50%)';requestAnimationFrame(tick)};requestAnimationFrame(tick);</script></body>`),
    '/popup': html('<title>opener</title><p>opener</p>'),
    '/child': html('<title>child</title><p>child</p>'),
  };
  const server: Server = createServer((req, res) => {
    const body = routes[(req.url ?? '/').split('?')[0]!];
    if (body === undefined) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve({ origin, url: (path) => `${origin}${path}`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

// ---- the scene ----------------------------------------------------------------------------------------------------------

export interface HeadlessScene {
  root: string;
  userData: string;
  daemon: ProfileDaemon;
  bin: string; // the engine's wrapper (MAWS_E2E_ENGINE_BIN)
  repo(n: number): string; // each session's working directory: its connector's report and control socket live there
  status(): Promise<DaemonStatus>;
  render(): Promise<DaemonRender>;
  capabilities(appSessionId: AppSessionId): Promise<SessionCapabilities>;
  sessionStatus(appSessionId: AppSessionId): Promise<EngineSessionStatus>;
  start(repo: string, prompt?: string): Promise<AppSessionId>; // the ordinary start path, to its first turn's end
  connector(repo: string): Promise<ConnectorControl>; // the session's cua host, once its control socket listens
  report(repo: string): ConnectorReport | null;
  daemonSocket(appSessionId: AppSessionId): string; // the socket a launch is told
  renderSocket(appSessionId: AppSessionId): string | null; // the render host's for the session (never an engine's to dial)
  mawsdLog(): string;
  stop(): Promise<void>;
}

export interface HeadlessSceneOptions {
  repos?: number; // the sessions' working directories (1 unless named)
  engine?: CuaEngineOptions; // the stub's switches beside `ready` and `control`
  env?: Record<string, string>; // mawsd's (MAWS_RENDER_QUIET_MS, MAWS_E2E_LINUX_HEADLESS)
  keepConfigHome?: boolean;
  keepSessions?: boolean; // no idle release and no idle exit (`supervisor.idleExitMinutes: null`), for a measured window
}

// A scratch root short enough for every socket under it (`/tmp/mh-XXXXXX`; the render host's per-session socket is the
// longest, `<profile>/mawsd/render-cua/<uuid>.sock`), each repository trusted and the user's default mode `default` in
// the daemon's engine store, so a start runs no trust bootstrap and no auto-mode fallback (the stub's prelude is
// Session's minimal one, as e2e/local-latency.spec.ts's)
export async function startHeadlessScene(o: HeadlessSceneOptions = {}): Promise<HeadlessScene> {
  const root = realpathSync(mkdtempSync('/tmp/mh-'));
  const userData = join(root, 'u');
  mkdirSync(userData);
  const repos = Array.from({ length: o.repos ?? 1 }, (_, n) => join(root, `r${n}`));
  for (const repo of repos) mkdirSync(repo);
  if (o.keepSessions) writeFileSync(join(userData, 'machine-settings.json'), JSON.stringify({ ...machineSettingsDefaults(), supervisor: { idleExitMinutes: null } }));
  const bin = writeCuaEngine(join(root, 'cua-engine'), { retry: true, control: true, ...o.engine, ready: true });
  let daemon: ProfileDaemon;
  try {
    daemon = await startProfileDaemon({
      userData,
      keepConfigHome: o.keepConfigHome,
      env: { MAWS_E2E_ENGINE_BIN: bin, ...o.env },
      prepare: ({ claudeConfigDir }) => {
        writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ projects: Object.fromEntries(repos.map((repo) => [repo, { hasTrustDialogAccepted: true }])) }, null, 2)}\n`);
        writeFileSync(join(claudeConfigDir, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
      },
    });
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const request = <T>(name: string, input?: unknown) => daemon.request<T>(name, input);
  const status = () => request<DaemonStatus>('daemon.status');
  const sessionStatus = (appSessionId: AppSessionId) => request<EngineSessionStatus>('session.status', { appSessionId });
  return {
    root,
    userData,
    daemon,
    bin,
    repo: (n) => repos[n]!,
    status,
    render: async () => (await status()).render!,
    capabilities: (appSessionId) => request<SessionCapabilities>('session.capabilities', { appSessionId }),
    sessionStatus,
    async start(repo, prompt = 'o17 headless turn') {
      const project = await request<{ id: string }>('session.projects.add', { directory: repo });
      const { appSessionId } = await request<{ appSessionId: AppSessionId }>('session.create', { projectId: project.id, location: { kind: 'directory', path: repo } });
      const started = await request<{ status: string }>('session.start', { appSessionId, message: { content: prompt, display: prompt }, options: { gateway: 'direct' } });
      expect(started.status, `the session started (${JSON.stringify(started)})`).toBe('starting');
      await expect.poll(async () => {
        const st = await sessionStatus(appSessionId).catch(() => null);
        return st !== null && st.process === 'ready' && st.turn === null && st.pid !== null;
      }, { timeout: 60_000, message: `${appSessionId}'s engine ready, its first turn ended` }).toBe(true);
      return appSessionId;
    },
    async connector(repo) {
      let control: ConnectorControl | null = null;
      await expect.poll(async () => (control = await connectorControl(repo).catch(() => null)) !== null, { timeout: 30_000, message: `the connector in ${repo} listens on its control socket` }).toBe(true);
      return control!;
    },
    report: (repo) => connectorReport(repo),
    daemonSocket: (appSessionId) => daemonCuaSocketPath(cuaSocketDir(userData), appSessionId)!,
    renderSocket: (appSessionId) => cuaSocketPath(renderCuaSocketDir(userData, tmpdir()), appSessionId),
    mawsdLog: () => (existsSync(join(userData, 'mawsd', 'mawsd.log')) ? readFileSync(join(userData, 'mawsd', 'mawsd.log'), 'utf8') : ''),
    async stop() {
      await daemon.stop().catch((error: unknown) => console.error(error));
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

// A step's answer through the connector, its value or a thrown error naming the step
export async function answered<T>(step: string, answer: Promise<{ ok: true; result: T } | { ok: false; error: string; steps?: unknown }>): Promise<T> {
  const settled = await answer;
  if (!settled.ok) throw new Error(`${step}: ${settled.error}${settled.steps ? ` (${JSON.stringify(settled.steps)})` : ''}`);
  return settled.result;
}

// The render host's process while one runs (its pid from the status), for a scene that ends it or reads its footprint
export const renderPid = async (scene: HeadlessScene): Promise<number | null> => (await scene.render()).pid;
