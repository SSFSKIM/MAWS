// U3's render host as a tab engine (O5 M7; P5 §13 U3): a windowless Electron, the M1 probe's shape (accessory policy,
// its own userData, `window-all-closed` kept open), that composes the in-app browser's main side straight from
// `src/main/browser/` (the TabStore, the partitions and their permission guard, the Navigator, the page guards, the input
// seams and cua's primitive server, unmodified, bundled by ../build.mjs) with two things the app has and this process
// lacks put in their place: a placement for each tab's view in a hidden window of its own (`headless-views.ts`, where
// the app's ViewManager places views in its windows), and the peer check's addon on Linux (`linux-peer.ts`). It opens
// one tab on the page the driver serves on the machine's loopback, serves one cua connection on the session's socket,
// and serves the screencast channel (`screencast.ts`) to the driver as a stand-in for a remote app's view.
//
// The driver (../driver.mjs) spawns it and reads its stdout lines: `READY {json}` once the tab's page has loaded and
// both sockets listen. Every step and error lands in <out>/result.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, session, WebContentsView } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import { partitionFor, Partitions } from '../../../src/main/browser/partition';
import { guardPage, preparePermissions } from '../../../src/main/browser/permissions';
import { Navigator } from '../../../src/main/browser/navigation';
import { attachWindowOpen } from '../../../src/main/browser/window-open';
import { attachInputSeams } from '../../../src/main/browser/input';
import { TabStore, type BrowserEmit } from '../../../src/main/browser/tabs';
import { createTabView, tabWebPreferences } from '../../../src/main/browser/view';
import { startCuaBackend } from '../../../src/main/browser/cua';
import { loadPeerAddon, peerAddonPath, rootOf, type PeerAddon, type ProcessRoot } from '../../../src/main/browser/cua/peer';
import { HeadlessViews, type TabWindowMode } from './headless-views';
import { linuxUidPeerAddon } from './linux-peer';
import { serveScreencast } from './screencast';

const args = process.argv;
const arg = (name: string): string | null => {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1]! : null;
};
const out = arg('--out') ?? join(process.cwd(), 'u3-out');
const appSessionId = (arg('--session') ?? '00000000-0000-4000-8000-000000000001') as AppSessionId;
const pageUrl = arg('--page-url');
const screencastSocket = arg('--screencast-socket');
const trustPid = Number(arg('--trust-pid') ?? process.ppid);
const repo = arg('--repo') ?? process.cwd();
const mode = (arg('--tab-window') ?? 'hidden') as TabWindowMode;
const accessory = args.includes('--accessory');

mkdirSync(out, { recursive: true });
const userData = arg('--user-data') ?? join(out, 'userData'); // short: the cua socket lives under it (sockaddr_un)
rmSync(userData, { recursive: true, force: true });
app.setPath('userData', userData); // the host's own profile, never the app's (M3's rule)
if (accessory && process.platform === 'darwin') app.setActivationPolicy('accessory');
app.on('window-all-closed', () => {}); // a render host outlives its windows (FINDINGS §1.2)

const startedAt = Date.now();
const result: { mode: TabWindowMode; steps: Record<string, unknown>[]; errors: { name: string; message: string }[] } = { mode, steps: [], errors: [] };
const save = () => writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
const step = (name: string, data: Record<string, unknown> = {}) => {
  result.steps.push({ name, atMs: Date.now() - startedAt, ...data });
  save();
};
const fail = (name: string, error: unknown) => {
  result.errors.push({ name, message: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  save();
  console.error(`[u3-host] ${name}: ${error instanceof Error ? error.message : String(error)}`);
};
process.on('uncaughtException', (error) => fail('uncaughtException', error));
process.on('unhandledRejection', (error) => fail('unhandledRejection', error));

// The process tree's memory: Chromium's own reading per process, the kernel's RSS per pid, and on macOS each process's
// physical footprint (acceptance 14's reader, M1's: the `phys_footprint:` line of /usr/bin/footprint).
function memory(label: string): Record<string, unknown> {
  const metrics = app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, serviceName: m.serviceName ?? null, workingSetKiB: Math.round(m.memory.workingSetSize) }));
  const rssOf = (pid: number): number | null => {
    try {
      return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) || null;
    } catch {
      return null;
    }
  };
  const footprintOf = (pid: number): number | null => {
    if (process.platform !== 'darwin') return null;
    try {
      const text = execFileSync('/usr/bin/footprint', ['-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const m = /^\s*\d*\s*phys_footprint:\s*([\d.]+)\s*(B|KB|MB|GB)\b/m.exec(text);
      if (!m) return null;
      const scale = { B: 1 / 1024, KB: 1, MB: 1024, GB: 1024 * 1024 }[m[2] as 'B' | 'KB' | 'MB' | 'GB'];
      return Math.round(Number(m[1]) * scale);
    } catch {
      return null;
    }
  };
  const processes = metrics.map((m) => ({ ...m, rssKiB: rssOf(m.pid), footprintKiB: footprintOf(m.pid) }));
  const sum = (key: 'workingSetKiB' | 'rssKiB' | 'footprintKiB') => processes.reduce((total, p) => total + (p[key] ?? 0), 0);
  const reading = { label, treeRssKiB: sum('rssKiB'), treeWorkingSetKiB: sum('workingSetKiB'), treeFootprintKiB: process.platform === 'darwin' ? sum('footprintKiB') : null, processes };
  step(`memory ${label}`, reading);
  return reading;
}

// The peer check: on macOS the committed addon, the driver (the cua client and the probe's stand-in for a session's
// engine) as the trusted root; on Linux no addon exists, and the uid is the boundary (O2's rule), which the cua server
// has no mode for: it refuses every peer without an addon, so this process gives it one that answers the uid alone.
function peerCheck(): { addon: PeerAddon | null; trustedRoots: Set<ProcessRoot>; kind: string } {
  if (process.platform === 'darwin') {
    const addon = loadPeerAddon(peerAddonPath({ packaged: false, resourcesPath: '', appRoot: repo }));
    const root = addon ? rootOf(trustPid, addon) : null;
    return { addon, trustedRoots: new Set(root ? [root] : []), kind: addon ? 'darwin addon, driver as trusted root' : 'darwin addon missing: every peer refused' };
  }
  const addon = linuxUidPeerAddon(trustPid);
  const root = rootOf(trustPid, addon);
  return { addon, trustedRoots: new Set(root ? [root] : []), kind: 'linux: uid-only stand-in addon (the socket is 0600 in a 0700 directory)' };
}

async function main() {
  await app.whenReady();
  if (accessory && process.platform === 'darwin') app.dock?.hide();
  step('ready', {
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    platform: process.platform,
    headless: app.commandLine.hasSwitch('headless'),
    noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    dockVisible: process.platform === 'darwin' ? (app.dock?.isVisible() ?? null) : null,
  });
  memory('at ready, no tab');

  const emitted: Record<string, number> = {};
  const emit: BrowserEmit = (name) => void (emitted[name] = (emitted[name] ?? 0) + 1); // nobody listens: no renderer here
  // The browser preload (out/preload/browser.js: find, comments, the extension pages) is not registered: nothing here
  // needs it for cua, and the probe does not build the preload bundle.
  const partitions = new Partitions((partition) => session.fromPartition(partition), [(ses, partition) => preparePermissions(store)(ses, partition)]);
  const store: TabStore = new TabStore({
    emit,
    createView: mode === 'offscreen'
      ? (tab, adopted) => {
          partitions.session(tab.partition);
          return adopted ? new WebContentsView({ webContents: adopted }) : new WebContentsView({ webPreferences: { partition: tab.partition, ...tabWebPreferences(), offscreen: true } });
        }
      : createTabView(partitions),
    resolvePartition: () => partitionFor(null, []).partition,
    driven: (tabId) => cua.holds(tabId),
  });
  const seam = { active: false, line: () => {}, openExternal: () => {}, reveal: () => {} };
  const navigator = new Navigator({ store, history: { visit: () => {}, setTitle: () => {} } as never, favicons: { resolve: async () => null } as never, emit, seam });
  const views = new HeadlessViews({ mode, width: 1280, height: 800, log: (line) => step('views', { line }) });
  store.onViewCreated((entry) => {
    navigator.attach(entry);
    guardPage(entry);
    attachWindowOpen(entry, { store, linkTarget: () => 'in-app', seam, childPreferences: tabWebPreferences() });
    attachInputSeams(entry);
    views.place(entry);
  });
  store.onViewDestroying((entry) => views.unplace(entry));

  const peer = peerCheck();
  const cuaLog: string[] = [];
  const cua = startCuaBackend({
    store,
    peer: { addon: peer.addon, trustedRoots: peer.trustedRoots },
    windows: () => views.windows(),
    reaches: (a, b) => a === b,
    userData,
    version: 'u3-probe',
    log: (line) => {
      cuaLog.push(line);
      step('cua log', { line });
    },
  });
  const cuaSocket = cua.socketPathFor(appSessionId);
  step('cua socket', { path: cuaSocket, peer: peer.kind, trustedRoots: [...peer.trustedRoots] });

  if (!pageUrl) throw new Error('no --page-url');
  const opened = store.open({ appSessionId, url: pageUrl, select: true });
  const entry = store.require(opened.tab.tabId);
  const wc = entry.view!.webContents;
  if (mode === 'hidden-unthrottled') wc.setBackgroundThrottling(false);
  await new Promise<void>((resolve) => {
    if (!wc.isLoading()) return resolve();
    wc.once('did-stop-loading', () => resolve());
  });
  const pageState = await wc.executeJavaScript('({visibility: document.visibilityState, hidden: document.hidden, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, title: document.title})');
  step('tab loaded', { tabId: opened.tab.tabId, url: entry.tab.url, title: entry.tab.title, loading: entry.tab.loading, pageState, osr: wc.isOffscreen() });
  memory('one tab loaded, idle');

  if (!screencastSocket) throw new Error('no --screencast-socket');
  const screencast = serveScreencast({
    path: screencastSocket,
    store,
    tabId: opened.tab.tabId,
    memory,
    step,
    fail,
    inspect: () => ({ cua: cua.inspect(), emitted, cuaLog: cuaLog.slice(-20) }),
    exit: () => {
      step('exit asked');
      screencast.close();
      cua.dispose();
      views.dispose();
      for (const { view } of store.all()) if (view && !view.webContents.isDestroyed()) view.webContents.close();
      setTimeout(() => app.exit(0), 200);
    },
  });
  await screencast.listening;
  const ready = { cuaSocket, screencastSocket, tabId: opened.tab.tabId, pid: process.pid };
  step('serving', ready);
  console.log(`READY ${JSON.stringify(ready)}`);
}

main().catch((error) => {
  fail('main', error);
  app.exit(70);
});
