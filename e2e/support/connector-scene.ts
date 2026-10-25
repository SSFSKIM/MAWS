// P3-H H4: the product-app scene of the connector e2e runs (e2e/connectors.spec.ts's product cases and
// e2e/connectors-soak.spec.ts). The built app, detached host, on a scratch profile that owns everything the run touches:
// its user data, a scratch HOME and engine config home (no credentials, the scratch project's trust accepted, onboarding
// done), the scratch project directory, and the fixture MCP server's call log. The fixture server is configured in the
// scratch config home (user scope, as an owner's own server is), so any session the engine starts there has it. The
// engine is the installed Claude Code (as the naming cases run it), and the only session is the one the owner's Start
// launches from the header's Connectors sheet (the product's own start: a new session in the artifact's directory,
// the Direct route the scratch profile prefers, no message, no model turn, no cost). The HTML artifact is the owner's,
// in a Space linked to the project directory (an indexed project), so that session is its eligible route (P3
// Decision Log 83, 85).
//
// Nothing here grants, revokes or starts on the page's behalf: the specs do that as the owner, through the header's
// Connectors sheet. The scene only observes: the fixture's call log (which process answered, when), the host's live
// sessions, the supervisor's pid and the session's journal (its launches), and attaches them as evidence.
//
// E3 M4 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R5, Decision Log 13): `{liveData: true}` makes the
// scene a live dashboard's, fixture-only: the app also starts the host's dashboard acceptance seam (MAWS_DASHBOARD_E2E=1,
// read by an AgentSeam over `userData`), and the fixture server runs in its rows mode, answering the reply the scene's
// control file names (`fixtureReply`). Without it the scene is H's, unchanged.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type FrameLocator, type JSHandle, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { BrowserWindow } from 'electron';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { FIXTURE_SERVER, type CallLogEntry } from './connector-engine';
import { launchMaws, type MawsLaunch } from './launch';
import { installedEngine } from './p1-live';
import { isAlive, killScratchProcesses } from './processes';
import { tmpSocketDirOf } from './supervisor-socket';

export const SERVER = 'fixture';
export const TOOL = 'read_series';
export const TOOL_NAME = `${SERVER} · ${TOOL}`;
export const PAGE_TITLE = 'Signups, live';
export const WATCH_MS = 30_000; // the shortest watch interval main allows

// E3 start: the fixture's rows mode and what its control file may name (connector-mcp-server.mjs): flat records, an
// invalid structured result, or a tool error, each after an optional delay; read at each call
export type FixtureRow = Record<string, string | number | boolean | null>;
export type FixtureReply = ({ reply: 'rows'; rows: FixtureRow[] } | { reply: 'invalid' } | { reply: 'isError' }) & { delayMs?: number };

/** The fixture server as the scene configures it; with a control file, in its rows mode answering what that names
 * (test/support/connector-mcp-server-e3.test.ts runs it with these arguments). */
function fixtureServer(log: string, control: string | null): { type: 'stdio'; command: string; args: string[] } {
  const rows = control === null ? [] : ['--mode', 'rows', '--control', control];
  return { type: 'stdio', command: process.execPath, args: [FIXTURE_SERVER, '--id', 'series', '--log', log, '--tools', JSON.stringify([TOOL]), ...rows] };
}

/** Names the fixture's next replies, whole (written aside and renamed, so a call never reads half of it). */
function writeFixtureReply(control: string, reply: FixtureReply): void {
  writeFileSync(`${control}.tmp`, JSON.stringify(reply));
  renameSync(`${control}.tmp`, control);
}

// ConnectorSceneOptions.liveData (below, beside P3-HD's options): the dashboard seam on and the fixture in its rows mode
// E3 end

// The page: declares the fixture's tool, watches it at the shortest interval, and writes each outcome where a spec reads
// it (`#last`: the latest as `ok n=<k>` or `<state>:<reason>`; `#updates`: how many arrived).
export const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>${PAGE_TITLE}</title></head>
<body>
<h1>Signups, live</h1>
<p id="declared">declaring</p>
<p id="watch">starting</p>
<p id="last">none</p>
<p id="updates">0</p>
<script>
const tool = { server: ${JSON.stringify(SERVER)}, tool: ${JSON.stringify(TOOL)} };
let updates = 0;
const show = (o) => {
  updates += 1;
  document.getElementById('updates').textContent = String(updates);
  const n = o.ok && o.result && o.result.structuredContent ? o.result.structuredContent.n : null;
  document.getElementById('last').textContent = o.ok ? 'ok n=' + n + ' via=' + o.via.route : o.state + ':' + o.reason;
};
(async () => {
  const declared = await mawsConnectors.declare([tool]);
  document.getElementById('declared').textContent = declared.ok ? 'declared' : declared.state + ':' + declared.reason;
  const watch = await mawsConnectors.watch({ ...tool, args: { series: 'signups' }, intervalMs: ${WATCH_MS} }, show);
  document.getElementById('watch').textContent = watch.ok ? 'watching every ' + watch.intervalMs : watch.state + ':' + watch.reason;
})();
</script>
</body></html>
`;

type Result<N extends CommandName> = CommandResult<N>;
export function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<Result<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name as string, input as unknown] as const) as Promise<Result<N>>;
}
export function value<N extends CommandName>(result: Result<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

export interface Run {
  maws: MawsLaunch;
  page: Page;
  child: ChildProcess;
  exited: Promise<void>;
}

export interface LiveEngine {
  appSessionId: string;
  launchId: string;
  pid: number;
}

// P3-HD M4 start: a scene may configure the fixture server differently (route D's disconnect scene runs it through a
// wrapper); H's scenes pass nothing and keep the plain stdio entry.
export interface ConnectorSceneOptions {
  server?: (scene: ConnectorScene) => Record<string, unknown>;
  // P3-HD M4b: more servers beside it in the same scratch config (route D's OAuth scenes: an open HTTP server), and more
  // variables for every launch (MAWS_E2E_OPEN_LOG, the fake browser's seam)
  servers?: (scene: ConnectorScene) => Record<string, Record<string, unknown>>;
  env?: (scene: ConnectorScene) => Record<string, string>;
  liveData?: boolean; // E3: the dashboard seam on and the fixture in its rows mode
}
// P3-HD M4 end

export class ConnectorScene {
  readonly root: string;
  readonly userData: string;
  readonly home: string;
  readonly project: string;
  readonly log: string;
  readonly fixtureControl: string | null; // E3: the rows mode's control file, null in H's scene
  readonly supervisors = new Set<number>();
  private readonly runs: Run[] = [];
  private readonly sockets = new Set<string>();
  private readonly timeline: { at: string; event: string; detail?: unknown }[] = [];
  private readonly engine = installedEngine();

  constructor(name: string, private readonly options: ConnectorSceneOptions = {}) {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), `maws-connectors-${name}-`)));
    this.userData = join(this.root, 'ud');
    this.home = join(this.root, 'home');
    this.project = join(this.root, 'project');
    this.log = join(this.root, 'calls.jsonl');
    this.fixtureControl = options.liveData ? join(this.root, 'fixture-reply.json') : null; // E3
    for (const dir of [this.userData, this.home, this.project]) mkdirSync(dir, { recursive: true });
  }

  // E3: the fixture's replies from its next call on (the live data scene's only)
  fixtureReply(reply: FixtureReply): void {
    if (this.fixtureControl === null) throw new Error('the fixture answers rows only in a live data scene ({liveData: true})');
    writeFixtureReply(this.fixtureControl, reply);
    this.note('fixture reply', reply);
  }

  note(event: string, detail?: unknown): void {
    this.timeline.push({ at: new Date().toISOString(), event, ...(detail === undefined ? {} : { detail }) });
  }

  // The app over the scene's profile; a relaunch keeps the engine store and the supervisor's files.
  async launch(): Promise<Run> {
    const first = this.runs.length === 0;
    const maws = await launchMaws({
      userData: this.userData,
      keepConfigHome: !first,
      env: { MAWS_HARNESS: '0', MAWS_HOST_MODE: 'detached', MAWS_E2E_ENGINE_BIN: this.engine.bin, HOME: this.home, DISABLE_AUTOUPDATER: '1', ...(this.fixtureControl !== null && { MAWS_DASHBOARD_E2E: '1' }) /* E3 */, ...this.options.env?.(this) }, // P3-HD M4b: the scene's env
      prepare: ({ claudeConfigDir }) => {
        if (!first) return;
        const mcpServers = { [SERVER]: this.options.server?.(this) ?? fixtureServer(this.log, this.fixtureControl), ...this.options.servers?.(this) }; // P3-HD M4: the optional server entry; M4b: the others. E3: the default entry through fixtureServer
        writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, mcpServers, projects: { [this.project]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
      },
    });
    const child = maws.app.process();
    const exited = new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));
    const run: Run = { maws, page: maws.page, child, exited };
    this.runs.push(run);
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
    await expect(maws.page.locator('[data-region="main"]')).toBeVisible();
    this.note('launched window', await this.windowState(run)); // P3-H H4: the window main reads for its pages' veto
    await this.supervisor(run.page);
    if (first) {
      // the owner's profile: the project indexed, and new sessions on the Direct route (no relay runs here)
      value(await invoke(run.page, 'session.projects.add', { directory: this.project }));
      value(await invoke(run.page, 'settings.set', { gateway: { defaultRoute: 'direct' } }));
    }
    this.note('launched', { pid: child.pid });
    return run;
  }

  // The connected supervisor's pid, once main reports one ready.
  async supervisor(page: Page): Promise<number> {
    let pid = 0;
    await expect
      .poll(async () => {
        const status = await invoke(page, 'host.status', undefined);
        pid = status.ok && status.value.state === 'ready' && status.value.supervisor ? status.value.supervisor.pid : 0;
        return pid;
      }, { timeout: 30_000, message: 'main is connected to a supervisor' })
      .not.toBe(0);
    this.supervisors.add(pid);
    this.rememberSocket();
    return pid;
  }

  private rememberSocket(): void {
    try {
      const lock = JSON.parse(readFileSync(join(this.userData, 'supervisor', 'host.lock'), 'utf8')) as { pid: number; socketPath: string };
      this.supervisors.add(lock.pid);
      this.sockets.add(lock.socketPath);
    } catch {
      // no lock yet
    }
  }

  // The owner's Start from the header's Connectors sheet (offered once the page found no live route): the real button,
  // then the durable outcome, never the sheet's passing words (a page that reads its new route at once hides the Start
  // row): one new session live and ready, its fixture server connected. A card or a refusal the Start row shows ends the
  // wait at once with its words. Answers the one new live session.
  async ownerStart(page: Page): Promise<LiveEngine> {
    const before = new Set((await this.live(page)).map((session) => session.appSessionId));
    const sheet = await this.openSheet(page);
    const start = sheet.locator('[data-connectors-start]');
    await start.getByRole('button', { name: 'Start session' }).click();
    const passing = new Set(['', 'Starting…', 'Starting the session…', 'The session is ready']);
    let started: LiveEngine | undefined;
    for (const deadline = Date.now() + 90_000; started === undefined; await wait(500)) {
      const words = (await start.getByRole('status').textContent({ timeout: 250 }).catch(() => null))?.trim() ?? '';
      if (!passing.has(words)) throw new Error(`the owner’s Start did not start a session: ${words}`);
      if (Date.now() > deadline) throw new Error(`the owner’s Start made no live, ready session within 90 s (the sheet said “${words}”)`);
      const fresh = value(await invoke(page, 'engine.sessions', undefined)).find((session) => !before.has(session.appSessionId) && session.process === 'ready');
      if (fresh) started = { appSessionId: fresh.appSessionId, launchId: fresh.launchId, pid: fresh.pid ?? 0 };
    }
    await this.closeSheet(page);
    const appSessionId = started.appSessionId as LaunchSpec['appSessionId'];
    await expect
      .poll(async () => {
        const status = await invoke(page, 'session.mcpStatus', { appSessionId });
        return status.ok ? status.value.mcpServers.find((server) => server.name === SERVER)?.status : 'unanswered';
      }, { timeout: 60_000, message: 'the fixture server is connected' })
      .toBe('connected');
    expect((await this.live(page)).filter((session) => !before.has(session.appSessionId)), 'exactly one new session').toHaveLength(1);
    this.note('owner start', started);
    return started;
  }

  // The engine host's sessions whose process is not gone.
  async live(page: Page): Promise<LiveEngine[]> {
    const sessions = value(await invoke(page, 'engine.sessions', undefined));
    return sessions.filter((s) => s.process !== 'exited').map((s) => ({ appSessionId: s.appSessionId, launchId: s.launchId, pid: s.pid ?? 0 }));
  }

  // How many launches the session's journal records (its `spawn` rows), and whether any of them exited.
  launches(appSessionId: string): { spawns: number; exits: number } {
    const dir = join(this.userData, 'engine-host', 'journal', appSessionId);
    if (!existsSync(dir)) return { spawns: 0, exits: 0 };
    const rows = readdirSync(dir)
      .filter((file) => file.endsWith('.jsonl'))
      .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { direction: string; frame: { event?: string } }));
    const meta = (event: string) => rows.filter((row) => row.direction === 'meta' && row.frame.event === event).length;
    return { spawns: meta('spawn'), exits: meta('exit') };
  }

  calls(): CallLogEntry[] {
    return existsSync(this.log) ? readFileSync(this.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as CallLogEntry) : [];
  }
  toolCalls(): CallLogEntry[] {
    return this.calls().filter((entry) => entry.method === 'tools/call');
  }
  toolCallsBetween(from: number, to: number): CallLogEntry[] {
    return this.toolCalls().filter((entry) => Date.parse(entry.at) >= from && Date.parse(entry.at) <= to);
  }

  // The owner's HTML artifact, in a Space linked to the project directory.
  async createPage(page: Page): Promise<string> {
    const { space } = value(await invoke(page, 'spaces.create', { name: 'Live data', linkedDir: this.project }));
    // an html artifact's content is its bytes (the store's contract), encoded in the page as the renderer sends them
    const created = await page.evaluate(
      ([html, title, spaceId]) => window.maws.invoke('artifacts.create', { kind: 'html', title, spaceId, content: { bytes: new TextEncoder().encode(html), name: 'index.html' } }),
      [PAGE_HTML, PAGE_TITLE, space.id] as const,
    );
    const id = value<'artifacts.create'>(created as CommandResult<'artifacts.create'>).artifact.id;
    this.note('artifact', { id });
    return id;
  }

  // The artifact in a main tab of its own: the tab already showing it when there is one (opening the library over it
  // would unmount the page, and its next mount is a new page load whose watch reads at once), else opened from the
  // library as the owner opens it. Answers the tab and its page's frame.
  async openPage(page: Page, artifactId: string, title = PAGE_TITLE /* P3-HD M4b: another page's */): Promise<{ tab: Locator; frame: FrameLocator }> {
    const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
    if (!(await tab.locator('[data-artifact-frame="html"]').isVisible())) {
      await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
      await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
    }
    await expect(tab.locator('[data-artifact-frame="html"]')).toBeVisible();
    return { tab, frame: tab.frameLocator('[data-artifact-frame="html"]') };
  }

  // After a relaunch on the profile: the artifact's tab as the app restored it, never navigated to (a library open would
  // remount the page, a second load and so a second read). Fails when the app did not restore it.
  async restoredPage(page: Page, artifactId: string): Promise<{ tab: Locator; frame: FrameLocator }> {
    const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
    await expect(tab.locator('[data-artifact-frame="html"]'), 'the app restored the artifact’s tab').toBeVisible({ timeout: 20_000 });
    this.note('restored page');
    return { tab, frame: tab.frameLocator('[data-artifact-frame="html"]') };
  }

  // The header's Connectors sheet, opened by the owner.
  async openSheet(page: Page): Promise<Locator> {
    await page.locator('[data-region="main"]').getByRole('button', { name: 'Connectors' }).click();
    const sheet = page.locator('[data-connectors-sheet]');
    await expect(sheet).toBeVisible();
    return sheet;
  }
  async closeSheet(page: Page): Promise<void> {
    await page.locator('[data-connectors-sheet]').getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-connectors-sheet]')).toHaveCount(0);
  }

  // The page's own window hidden and shown again without taking focus (P3 Decision Log 89). What a spec holds the product
  // to is the native window's state, main's veto of its pages; the document's visibility is evidence only, with the
  // Chromium switches the Playwright Electron loader adds, under which a hidden window's document may still read visible.
  async hideWindow(run: Run): Promise<void> {
    const win = await this.windowOf(run);
    await win.evaluate((w) => w.hide());
    await expect.poll(() => win.evaluate((w) => w.isVisible()), { message: 'the page’s window reads hidden' }).toBe(false);
    this.note('hidden', await this.windowState(run));
  }
  async showWindow(run: Run): Promise<void> {
    const win = await this.windowOf(run);
    await win.evaluate((w) => w.showInactive());
    await expect.poll(() => win.evaluate((w) => w.isVisible() && !w.isMinimized()), { message: 'the page’s window reads shown, not minimized' }).toBe(true);
    this.note('shown', await this.windowState(run));
  }
  // P3-HD M4b: the page's window minimized and restored (main's veto reads a minimized window as hidden).
  async minimizeWindow(run: Run): Promise<void> {
    const win = await this.windowOf(run);
    await win.evaluate((w) => w.minimize());
    await expect.poll(() => win.evaluate((w) => w.isMinimized()), { message: 'the page’s window reads minimized' }).toBe(true);
    this.note('minimized', await this.windowState(run));
  }
  async restoreWindow(run: Run): Promise<void> {
    const win = await this.windowOf(run);
    await win.evaluate((w) => w.restore());
    await expect.poll(() => win.evaluate((w) => w.isVisible() && !w.isMinimized()), { message: 'the page’s window reads restored' }).toBe(true);
    this.note('restored', await this.windowState(run));
  }
  private async windowOf(run: Run): Promise<JSHandle<BrowserWindow>> {
    return (await run.maws.app.browserWindow(run.page)) as JSHandle<BrowserWindow>;
  }
  // The evidence: the native window's state, its document's visibility, and which backgrounding switches the app runs with.
  private async windowState(run: Run): Promise<unknown> {
    const native = await (await this.windowOf(run)).evaluate((w) => ({ visible: w.isVisible(), minimized: w.isMinimized() }));
    const documentVisibility = await run.page.evaluate(() => document.visibilityState);
    const switches = await run.maws.app.evaluate(({ app }) =>
      Object.fromEntries(['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows'].map((name) => [name, app.commandLine.hasSwitch(name)])),
    );
    return { native, documentVisibility, switches };
  }

  // The app killed (no quit, no question): a detached supervisor and its engines are left running with no client.
  async killApp(run: Run): Promise<void> {
    run.child.kill('SIGKILL');
    await run.exited;
    this.note('app killed');
  }
  // The ordinary quit: an idle app stops every engine and its supervisor's sessions with it.
  async quit(run: Run): Promise<void> {
    await run.maws.app.evaluate(({ app }) => app.quit());
    await Promise.race([run.exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('MAWS did not quit')), 30_000))]);
    this.note('app quit');
  }

  pidAlive(pid: number): boolean {
    return pid > 0 && isAlive(pid);
  }

  async attachEvidence(info: TestInfo): Promise<void> {
    const calls = this.calls().map((entry) => JSON.stringify({ ...entry })).join('\n') + '\n';
    const scrub = (text: string) => text.replaceAll(this.root, '<scratch>');
    await info.attach('fixture-calls.jsonl', { body: scrub(calls), contentType: 'application/x-ndjson' });
    await info.attach('timeline.json', { body: scrub(JSON.stringify(this.timeline, null, 2)), contentType: 'application/json' });
    info.annotations.push({ type: 'engine', description: this.engine.version });
  }

  // Every app this scene launched is killed, then the scratch's argv/cwd owners (including detached engines whose
  // process title carries no scratch path) are killed and awaited, then the files. Removal retries are only a backstop.
  async cleanup(): Promise<void> {
    for (const run of this.runs) {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
      await run.exited;
      await run.maws.cleanup().catch(() => {});
    }
    this.rememberSocket();
    let leftover: unknown = null;
    await killScratchProcesses(this.root, this.supervisors).catch((error: unknown) => (leftover = error));
    for (const socket of this.sockets) {
      const dir = tmpSocketDirOf(this.userData, socket);
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    }
    rmSync(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (leftover !== null) throw leftover;
  }
}

export async function withScene(name: string, info: TestInfo, body: (scene: ConnectorScene) => Promise<void>, options: ConnectorSceneOptions = {}): Promise<void> {
  const scene = new ConnectorScene(name, options); // P3-HD M4: the optional scene options (E3: liveData among them)
  let failed = false;
  try {
    await body(scene);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await scene.attachEvidence(info).catch((error: unknown) => console.error(error));
    await scene.cleanup().catch((error: unknown) => {
      if (!failed) throw error;
      console.error(error);
    });
  }
}

// What the page shows now: its latest outcome and how many arrived.
export async function pageState(frame: FrameLocator): Promise<{ last: string; updates: number }> {
  const last = (await frame.locator('#last').textContent()) ?? '';
  const updates = Number((await frame.locator('#updates').textContent()) ?? '0');
  return { last, updates };
}

// Waits `ms` of wall clock (the silence the specs measure is real time, never a faked clock).
export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
