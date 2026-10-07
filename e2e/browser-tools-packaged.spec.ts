// E4c's packaged proof (E4c execution document, Task 4.4; A-33 item 6 as amended by Decision Log 57): in the app
// `pnpm build:app` makes, playwright-core is a production dependency packed into app.asar (never bundled into main,
// nothing of it unpacked) and `ws` is no dependency at all, since Playwright reaches the tab's debugger in process; and
// the agent's route works from there: a tab opened through the e2e seam on E4c's local server, `browser_snapshot` answers
// refs, the tab's driver is connected, playwright-core was required from the asar's node_modules, and the agent opened no
// listening socket on the way (no `listen` in main, no new TCP listener in the app's processes).
// Runs only over a packaged executable, under `pnpm e2e:packaged` (MAWS_E2E_EXECUTABLE), with a scratch profile
// (support/launch.ts):
//   pnpm build:app && pnpm e2e:packaged
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { agentOk, browserToolsScene, driverState, type BrowserToolsScene } from './support/browser-tools-scene';
import { show } from './support/deliverables-scene';
import { REPO_ROOT } from './support/launch';

const EXECUTABLE = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
test.skip(EXECUTABLE === null, 'the packaged proof runs over the packaged app under pnpm e2e:packaged (MAWS_E2E_EXECUTABLE)');

const resources = () => join(dirname(dirname(EXECUTABLE!)), 'Resources');

// app.asar read as electron-builder wrote it: every file it lists (by its path inside the archive, and whether the
// archive marks it unpacked) and a packed file's text. The header is a pickled JSON string, its length at byte 12 and
// the JSON from byte 16; packed files follow the header pickle, whose size is at byte 4 (the format `@electron/asar`
// reads).
type AsarNode = { files?: Record<string, AsarNode>; unpacked?: boolean; offset?: string; size?: number };
function readAsar(archive: string): { files: Map<string, { unpacked: boolean }>; text(path: string): string } {
  const bytes = readFileSync(archive);
  const header = JSON.parse(bytes.toString('utf8', 16, 16 + bytes.readUInt32LE(12))) as AsarNode;
  const files = new Map<string, { unpacked: boolean }>();
  const walk = (node: AsarNode, path: string) => {
    if (!node.files) return void files.set(path, { unpacked: node.unpacked === true });
    for (const [name, child] of Object.entries(node.files)) walk(child, path ? `${path}/${name}` : name);
  };
  walk(header, '');
  const text = (path: string) => {
    const node = path.split('/').reduce((dir, name) => dir.files![name]!, header);
    const start = 8 + bytes.readUInt32LE(4) + Number(node.offset);
    return bytes.toString('utf8', start, start + node.size!);
  };
  return { files, text };
}

test('packaged: playwright-core is packed in app.asar with nothing of it unpacked, and ws is no production dependency', () => {
  const { files, text } = readAsar(join(resources(), 'app.asar'));
  expect(files.get('node_modules/playwright-core/package.json'), 'app.asar lists playwright-core, packed (not unpacked)').toEqual({ unpacked: false });
  const playwright = [...files].filter(([path]) => path.startsWith('node_modules/playwright-core/'));
  expect(playwright.filter(([, file]) => file.unpacked).map(([path]) => path), 'nothing of playwright-core is marked unpacked').toEqual([]);
  expect(existsSync(join(resources(), 'app.asar.unpacked/node_modules/playwright-core')), 'nothing of playwright-core beside the asar').toBe(false);

  const packaged = JSON.parse(text('package.json')) as { dependencies: Record<string, string> };
  expect(packaged.dependencies, 'the packaged package.json').toHaveProperty('playwright-core');
  expect(packaged.dependencies, 'the packaged package.json').not.toHaveProperty('ws');
  expect([...files.keys()].filter((path) => /(^|\/)node_modules\/ws\//.test(path)), 'no ws module anywhere in app.asar').toEqual([]);
  expect(existsSync(join(resources(), 'app.asar.unpacked/node_modules/ws')), 'no ws beside the asar').toBe(false);
});

test('packaged: browser_snapshot answers refs over the in-process bridge, from the asar’s playwright-core, opening no listening socket', async () => {
  await browserToolsScene(['E4c: packaged'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    expect(await s.maws.app.evaluate(({ app }) => app.isPackaged), 'the app under test is the packaged one').toBe(true);
    await show(s, id);

    await countListens(s);
    const before = tcpListeners(s);
    const opened = await agentOk(s, id, 'browser_tabs', { action: 'open', url: s.server.url('/form.html') });
    const tabId = opened.result.tabId as string;
    const snapshot = await agentOk(s, id, 'browser_snapshot', { tabId });
    expect(snapshot.result).toMatchObject({ status: 'ok', tabId, title: 'E4c order form' });
    expect((snapshot.result as { refs: number }).refs, 'the snapshot carries refs').toBeGreaterThan(0);
    expect(snapshot.text).toMatch(/textbox "Name" \[ref=e\d+\]/);
    expect(await driverState(s, tabId)).toBe('connected');

    expect(await listens(s), 'no server in main called listen during the agent’s calls').toEqual([]);
    expect(tcpListeners(s), 'the app’s processes listen on the same TCP sockets before and after').toEqual(before);
    const loaded = await s.maws.app.evaluate(() => {
      const cache = (process.getBuiltinModule('node:module') as unknown as { _cache: Record<string, unknown> })._cache;
      return Object.keys(cache).filter((path) => path.includes('/playwright-core/'));
    });
    // required as a module from the asar's node_modules, so not bundled into main (Electron names an unpacked file by
    // its app.asar path too, which the asar case above rules out)
    expect(loaded.length, 'playwright-core was required in main').toBeGreaterThan(0);
    for (const path of loaded) expect(path, 'required from the asar’s node_modules').toContain('/Contents/Resources/app.asar/node_modules/playwright-core/');

    // The control: both readings see a listener main does open, so their silence above is a measurement.
    const port = await s.maws.app.evaluate(
      () =>
        new Promise<number>((done) => {
          const server = process.getBuiltinModule('node:net').createServer();
          (globalThis as { __e4cControl?: unknown }).__e4cControl = server;
          server.listen(0, '127.0.0.1', () => done((server.address() as { port: number }).port));
        }),
    );
    expect(await listens(s), 'the listen reading sees a server main opens').toHaveLength(1);
    expect(tcpListeners(s), 'the lsof reading sees it').toContain(`${s.maws.app.process().pid} 127.0.0.1:${port}`);
    await s.maws.app.evaluate(() => new Promise<void>((done) => ((globalThis as { __e4cControl?: { close(cb: () => void): void } }).__e4cControl!.close(() => done()))));
  });
});

// Every `net.Server#listen` main makes from now on (http servers included), kept in main.
async function countListens(s: BrowserToolsScene): Promise<void> {
  await s.maws.app.evaluate(() => {
    const g = globalThis as { __e4cListens?: string[] };
    if (g.__e4cListens) return;
    const listened: string[] = [];
    g.__e4cListens = listened;
    const { Server } = process.getBuiltinModule('node:net');
    const listen = Server.prototype.listen;
    Server.prototype.listen = function (this: InstanceType<typeof Server>, ...args: unknown[]) {
      listened.push(`${JSON.stringify(args[0])}\n${new Error().stack ?? ''}`);
      return (listen as (...a: unknown[]) => InstanceType<typeof Server>).apply(this, args);
    } as typeof listen;
  });
}
const listens = (s: BrowserToolsScene): Promise<string[]> => s.maws.app.evaluate(() => (globalThis as { __e4cListens?: string[] }).__e4cListens ?? []);

// The TCP sockets the app's processes (main and its descendants) listen on, as `lsof` names them, sorted.
function tcpListeners(s: BrowserToolsScene): string[] {
  const main = s.maws.app.process().pid!;
  const table = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number) as [number, number]);
  const pids = new Set([main]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of table) {
      if (!pids.has(ppid) || pids.has(pid)) continue;
      pids.add(pid);
      grew = true;
    }
  }
  const out = lsof(['-nP', '-a', '-p', [...pids].join(','), '-iTCP', '-sTCP:LISTEN', '-Fpn']);
  const sockets: string[] = [];
  let pid = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    else if (line.startsWith('n')) sockets.push(`${pid} ${line.slice(1)}`);
  }
  return sockets.sort();
}

// lsof's output; it exits 1 when nothing matches, which is an empty answer here.
function lsof(args: string[]): string {
  try {
    return execFileSync('lsof', args, { encoding: 'utf8' });
  } catch (error) {
    const { status, stdout } = error as { status?: number; stdout?: string };
    if (status !== 1) throw error;
    return stdout ?? '';
  }
}
