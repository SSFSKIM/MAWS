// e2e:render-host, part (a) (P5 O5 M3; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M3 "Proves"): the built app
// started as the render host, `<binary> <entry> --render-host <scratch profile>`, windowless, against a fake `mawsd`: the
// fake front on the profile's `machine.sock` (test/support/fake-front.ts, the real socket server with this test's
// handlers) and the fake artifact endpoint on its `artifacts.sock` (test/support/fake-artifacts-endpoint.ts, M2's
// handler over HTTP, its one page a fixture file). No app root runs, so no window, no engine host and no `mawsd` exist.
//
// It shows the render host says hello with `render.client` and ready, is out of the Dock, keeps its Chromium profile
// under `<profile>/mawsd/render-host/`, and renders: three captures in a row, each window destroyed before the next (the
// `window-all-closed` guard keeps the process), each page loaded through the scheme proxy from the endpoint; the
// bridge's export and the library's, their files under the profile's store; then `render.exit` ends it with 0. The
// render library's e2e seams moved here from the app's specs run in the render host's main, unchanged in what they
// assert: the PDF printer's request filter (from artifacts-store.spec.ts) and a document viewport's hostile HTML (as
// document.spec.ts drives it on the document's own export).
//
// e2e:render-host, part (b) (P5 O5 M4; acceptance 2, "the app's quit changes nothing"): the built app on the daemon shape
// over a scratch profile, an `html` artifact made in its engine host, then the app quit while its private `mawsd` and the
// engine host keep running. A second client on `machine.sock` (the e2e's, as `mawsd`'s command line would be) asks the
// library's Export, which `mawsd`'s render seam renders through a render host it starts for it (`mawsd.log`), the PDF
// under the profile's store; a capture through the seam (`daemon.e2eRender`) answers a PNG of the asked size; the render
// host ends after its quiet period. The relaunched app finds the artifact and its export, and its main never rendered:
// no capture window, `mawsd`'s welcome lists `machine.render`.
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { MawsArtifactCapture, MawsArtifactCapturedResult, MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import type { RenderAnswer, RenderRequest } from '@shared/ipc/schema/render';
import { BROWSER_ENGINE_CAPABILITY, MACHINE_RENDER_CAPABILITY, RENDER_CLIENT_CAPABILITY } from '@shared/host/socket-protocol';
import { daemonPaths } from '@shared/daemon/files';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import { reachMachine } from '../src/mawsd/machine-client';
import { ipcError } from '@shared/ipc/errors';
import { startFakeArtifactsEndpoint, type FakeArtifactsEndpoint } from '../test/support/fake-artifacts-endpoint';
import { startFakeFront, type FakeFront, type FakeFrontClient, type FrontHandler } from '../test/support/fake-front';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { launchEnvironment } from './support/scratch-env';
// P5 O17 M8: pass 3
import type { AppSessionId } from '@shared/graph/ids';
import { cuaSocketPath } from '@shared/browser/cua-socket';
import { renderCuaSocketDir } from '@shared/daemon/files';
import { machineName } from '@shared/machine/identity';
import type { BrowserEngineRequest, BrowserEngineResult, EngineInventory } from '@shared/ipc/schema/browser-engine';
import { connectFakeHost, type FakeHost } from '../test/support/cua-fake-host';
import { answered, BEFORE_M7, BUTTON, ENGINE_HOST_BROWSER_WORK, linuxReason, SCREENCAST, startHeadlessScene, startPages } from './support/headless-browser';

const ARTIFACT = randomUUID();
const REVISION = 1;
const PNG_SIGNATURE = '89504e470d0a1a0a';
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

type Content = CommandInput<'artifacts.content'>;

// The scene: the profile (short, as a socket path must fit 103 bytes), its one html page, the fake mawsd, the process
interface Scene {
  profile: string;
  front: FakeFront;
  endpoint: FakeArtifactsEndpoint;
  app: ElectronApplication;
  child: ChildProcess; // kept from the launch: `app.process()` reads Playwright's live channel, disposed once the process ends
  client: FakeFrontClient;
  stderr(): string; // main's stderr so far, from its spawn on
  exited: Promise<number | null>;
  ask(request: RenderRequest): Promise<RenderAnswer>;
}

let scene: Scene | null = null;

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test.afterEach(async ({}, testInfo) => {
  const ending = scene;
  scene = null;
  if (!ending) return;
  if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('render-host-stderr', { body: ending.stderr(), contentType: 'text/plain' });
  const { child } = ending;
  if (child.exitCode === null && child.signalCode === null) {
    await ending.app.close().catch(() => child.kill('SIGKILL'));
  }
  await ending.front.close();
  await ending.endpoint.close();
  rmSync(ending.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function startScene(more: Record<string, FrontHandler> = {}): Promise<Scene> {
  const profile = mkdtempSync('/tmp/mrh-');
  const fixtures = join(profile, 'fixtures');
  mkdirSync(fixtures);
  const page = join(fixtures, 'index.html');
  writeFileSync(page, `<!doctype html><html><head><title>Red</title></head><body style="margin:0;background:#ff0000"><script>console.error('RH_CONSOLE_ERROR')</script></body></html>`);
  // the engine host's `artifacts.content` for the one page: its file at revision 1, nothing else
  const content = async (input: Content) => {
    const named = input.artifactId === ARTIFACT && (input.revision === undefined || input.revision === REVISION) && (input.path === undefined || input.path === 'index.html');
    if (!named) return { ok: false as const, error: ipcError('invalid_input', `no page ${input.artifactId} ${input.revision ?? 'live'} ${input.path ?? ''}`, { reason: 'notFound' }) };
    const bytes = readFileSync(page);
    return { ok: true as const, value: { revision: REVISION, kind: 'html' as const, name: 'index.html', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), path: page } };
  };
  const answers = new Map<string, RenderAnswer>();
  const waiting = new Map<string, (answer: RenderAnswer) => void>();
  const front = await startFakeFront(profile, {
    'artifacts.content': async (input) => {
      const found = await content(input as Content);
      if (!found.ok) throw new Error(found.error.message);
      return found.value;
    },
    'artifacts.get': (input) => {
      const { artifactId } = input as CommandInput<'artifacts.get'>;
      return { artifact: artifactId === ARTIFACT ? { id: ARTIFACT, kind: 'html', title: 'Red page', revision: REVISION } : null } as unknown as CommandOutput<'artifacts.get'>;
    },
    'render.answer': (input) => {
      const { id, answer } = input as { id: string; answer: RenderAnswer };
      answers.set(id, answer);
      waiting.get(id)?.(answer);
    },
    ...more, // P5 O17 M8: pass 3's tab engine wire
  });
  const endpoint = await startFakeArtifactsEndpoint(front.paths.artifactsSocket, content);

  // The launch environment's (the e2e mark, so the seams are installed and Chromium's keychain is a mock one), without the
  // app's userData: the render host names its own
  const env = launchEnvironment(process.env, join(profile, 'unused-app-profile'));
  delete env.MAWS_USER_DATA;
  // The binary (the packaged one MAWS_E2E_EXECUTABLE names, or this checkout's Electron with Playwright's loader and the
  // entry, as Playwright itself would start it) under stderrFromSpawn's wrapper, so main's stderr is read from its first
  // byte: a listener on the child's stderr, attached once `_electron.launch` resolves, misses what came before, and the
  // packaged binary, whose `ready` no loader holds, says it serves the profile before then (fix wave 2)
  const executable = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
  const fromRoot = createRequire(join(REPO_ROOT, 'package.json'));
  const binary = executable ?? (fromRoot('electron') as string);
  // a checkout's Electron is given the app root, as mawsd's renderCommand gives it (src/mawsd/render-seam.ts), never the
  // entry file: the render host finds the peer identity addon under app.getAppPath(), which a file argument would make
  // out/main (P5 O17 M8 fix 1: pass 3's relay could not be confirmed with no addon loaded)
  const entry = executable ? [] : ['-r', join(dirname(fromRoot.resolve('playwright-core/package.json')), 'lib/server/electron/loader.js'), REPO_ROOT];
  const wrapped = stderrFromSpawn(fixtures, binary);
  const app = await _electron.launch({ executablePath: wrapped.executablePath, args: [...entry, '--render-host', profile], env, cwd: REPO_ROOT });
  const child = app.process();
  const exited = new Promise<number | null>((done) => {
    if (child.exitCode !== null) return done(child.exitCode);
    child.once('exit', (code) => done(code));
  });
  const client = await front.client();
  await client.ready();
  const ask = (request: RenderRequest) => {
    answers.delete(request.id);
    const answered = new Promise<RenderAnswer>((done) => waiting.set(request.id, done));
    client.send('render.request', request);
    return answered;
  };
  return { profile, front, endpoint, app, child, client, stderr: wrapped.stderr, exited, ask };
}

// A wrapper that execs `binary` (the same pid, so the process Playwright holds is the binary's) with its stderr through
// `tee` into a file as well as on to Playwright, which reads the inspector's address from it: the file holds main's
// stderr from its spawn on, whenever the test reads it
function stderrFromSpawn(dir: string, binary: string): { executablePath: string; stderr(): string } {
  const quoted = (path: string) => `'${path.replace(/'/g, `'\\''`)}'`;
  const log = join(dir, 'render-host.stderr');
  const executablePath = join(dir, 'render-host-stderr.sh');
  writeFileSync(log, '');
  writeFileSync(executablePath, `#!/bin/bash\nexec ${quoted(binary)} "$@" 2> >(exec tee -a ${quoted(log)} >&2)\n`, { mode: 0o755 });
  return {
    executablePath,
    stderr: () => {
      try {
        return readFileSync(log, 'utf8');
      } catch {
        return ''; // the profile removed
      }
    },
  };
}

const captureOf = (requestId: string): MawsArtifactCapture => ({ appSessionId: 'app-render-host-e2e', requestId, artifactId: ARTIFACT, revision: REVISION, width: 640, height: 480 }) as MawsArtifactCapture;

test('the render host renders windowless against a fake mawsd, three captures in a row, the bridge’s and the library’s exports, and exits 0 on render.exit', async () => {
  test.setTimeout(180_000);
  scene = await startScene();
  const { app, child, client, profile, endpoint } = scene;

  await test.step('it said hello as a render client, is out of the Dock and keeps its own userData under the daemon’s directory', async () => {
    expect(client.capabilities).toEqual([RENDER_CLIENT_CAPABILITY, BROWSER_ENGINE_CAPABILITY]); // P5 O17 M4: a tab engine too
    expect(client.appPid).toBe(child.pid);
    const facts = await app.evaluate(({ app: electron, BrowserWindow }) => ({ dock: electron.dock?.isVisible() ?? false, userData: electron.getPath('userData'), windows: BrowserWindow.getAllWindows().length }));
    expect(facts).toEqual({ dock: false, userData: join(profile, 'mawsd', 'render-host'), windows: 0 });
    expect(statSync(join(profile, 'mawsd', 'render-host')).mode & 0o777).toBe(0o700);
    await expect.poll(() => scene!.stderr(), { message: 'the render host logs that it serves the profile' }).toContain(`[render-host] ready: serving ${profile} `);
  });

  await test.step('three captures in a row, each window destroyed before the next, the process kept', async () => {
    for (const n of [1, 2, 3]) {
      const answer = (await scene!.ask({ id: `cap-${n}`, kind: 'capture', request: captureOf(`rq-cap-${n}`) })) as MawsArtifactCapturedResult;
      expect(answer, JSON.stringify(answer).slice(0, 300)).toMatchObject({ ok: true, width: 640, height: 480 });
      if (!answer.ok) return;
      const png = Buffer.from(answer.png, 'base64');
      expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 480]); // IHDR
      expect(answer.consoleErrors).toContain('RH_CONSOLE_ERROR');
      const centre = await app.evaluate(({ nativeImage }, base64) => {
        const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
        const { width, height } = image.getSize();
        const bitmap = image.toBitmap();
        const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
        return [bitmap[at + 2], bitmap[at + 1], bitmap[at]]; // BGRA to RGB
      }, answer.png);
      expect(centre, 'the page rendered, not a blank window').toEqual([255, 0, 0]);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 'the capture window is gone').toBe(0);
      expect(child.exitCode, 'the last window’s destruction did not end the render host').toBeNull();
    }
    expect(endpoint.requests.filter((url) => url === artifactUrl(ARTIFACT, REVISION, 'index.html')), 'each page came through the scheme proxy from the endpoint').toHaveLength(3);
  });

  await test.step('the bridge’s export and the library’s, written under the profile’s store', async () => {
    const asked = join(profile, 'artifacts', ARTIFACT, 'exports', 'bridge.pdf');
    const exported = (await scene!.ask({ id: 'exp-1', kind: 'export', request: { appSessionId: 'app-render-host-e2e', requestId: 'rq-exp-1', artifactId: ARTIFACT, kind: 'html', format: 'pdf', revision: REVISION, path: asked } as MawsArtifactExport })) as MawsArtifactExportAnswer;
    expect(exported, JSON.stringify(exported)).toMatchObject({ ok: true, revision: REVISION, path: asked });
    expect(readFileSync(asked).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const library = (await scene!.ask({ id: 'lib-1', kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'png' } })) as CommandOutput<'artifacts.export'>;
    expect(library, JSON.stringify(library)).toMatchObject({ revision: REVISION });
    expect(library.path.startsWith(join(profile, 'artifacts', ARTIFACT, 'exports'))).toBe(true);
    const png = readFileSync(library.path);
    expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
    expect(png.readUInt32BE(16)).toBe(1280);

    const refused = await scene!.ask({ id: 'lib-2', kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'docx' } });
    expect(refused).toMatchObject({ ok: false, ipcError: { code: 'invalid_input', issues: { reason: 'exportUnavailable', data: { kind: 'html', format: 'docx' } } } });
  });

  await test.step('the PDF printer: a page naming remote resources prints, and none of them is fetched', async () => {
    const hits: string[] = [];
    const server = createServer((request, response) => {
      hits.push(request.url ?? '');
      response.end('x');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const remote = `http://127.0.0.1:${port}`;
      const printed = await app.evaluate(
        (_electron, html) => (globalThis as unknown as { __maws_exports: { print(html: string): Promise<{ head: string; blocked: string[] }> } }).__maws_exports.print(html),
        `<!doctype html><html><head><link rel="stylesheet" href="${remote}/style.css"></head><body><h1>printed</h1><img src="${remote}/a.png"><img src="data:image/png;base64,${PIXEL.toString('base64')}"></body></html>`,
      );
      expect(printed.head).toBe('%PDF-');
      expect(printed.blocked).toEqual(expect.arrayContaining([`${remote}/style.css`, `${remote}/a.png`]));
      expect(hits).toEqual([]);
    } finally {
      server.close();
    }
  });

  await test.step('document inspection permits host layout reads but blocks authored script and event handlers', async () => {
    // a governed page as the document exporter writes its head (src/artifacts/document/export/html.ts: `default-src
    // 'none'`), with an authored script and an event handler in its body
    const hostile = [
      '<!doctype html><html><head><meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: maws-artifact:; style-src 'unsafe-inline'; font-src data: maws-artifact:">`,
      '</head><body><main><p>Inspected.</p></main>',
      `<script>console.log('maws-authored-script-ran')</script><img src="data:image/png;base64,bm90LXBuZw==" onerror="console.log('maws-authored-handler-ran')">`,
      '</body></html>',
    ].join('\n');
    const capture = await app.evaluate(async ({ app: electron }, body) => {
      const messages: string[] = [];
      const watch = (_event: Electron.Event, contents: Electron.WebContents) => {
        contents.on('console-message', (event) => messages.push(event.message));
      };
      electron.on('web-contents-created', watch);
      try {
        const png = await (globalThis as unknown as { __maws_exports: { inspect(html: string): Promise<string> } }).__maws_exports.inspect(body);
        return { png, executed: messages.filter((message) => message.startsWith('maws-authored-')), csp: messages.filter((message) => /Content Security Policy/i.test(message)) };
      } finally {
        electron.off('web-contents-created', watch);
      }
    }, hostile);
    expect(Buffer.from(capture.png, 'base64').subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
    expect(capture.executed).toEqual([]);
    expect(capture.csp.length, 'the inline script and onerror handler are both refused by CSP').toBeGreaterThanOrEqual(2);
  });

  await test.step('the e2e seams’ capture runs the same library in the render host’s main', async () => {
    const result = await app.evaluate(
      (_electron, request) => (globalThis as unknown as { __maws_captures: { capture(r: unknown): Promise<MawsArtifactCapturedResult> } }).__maws_captures.capture(request),
      captureOf('rq-seam'),
    );
    expect(result, JSON.stringify(result).slice(0, 300)).toMatchObject({ ok: true, width: 640, height: 480 });
  });

  await test.step('render.exit ends it with 0', async () => {
    client.send('render.exit', {});
    expect(await scene!.exited).toBe(0);
    await client.ended();
  });
});

// ---- part (b): the daemon shape, the app quit (P5 O5 M4) ---------------------------------------------------------------

const QUIET_MS = 15_000; // the render host's quiet period under the scene (MAWS_RENDER_QUIET_MS)
const DAEMON_SHAPE = { MAWS_HOST_MODE: 'daemon', MAWS_RENDER_QUIET_MS: String(QUIET_MS) };

test('part (b): on the daemon shape, with the app quit, a second client’s library Export and a capture are rendered by mawsd’s render host, which ends when quiet; the relaunched app finds them', async () => {
  test.setTimeout(240_000);
  const userData = mkdtempSync(join(tmpdir(), 'maws-e2e-rh-b-'));
  let launch: MawsLaunch | null = null;
  const launches: MawsLaunch[] = [];
  const mawsdLog = () => {
    try {
      return readFileSync(join(userData, 'mawsd', 'mawsd.log'), 'utf8');
    } catch {
      return '';
    }
  };
  try {
    launch = await launchMaws({ userData, env: DAEMON_SHAPE });
    launches.push(launch);
    const { page } = launch;
    await expect.poll(async () => {
      const status = (await page.evaluate(() => window.maws.invoke('host.status', undefined))) as { ok: boolean; value?: { state: string; daemon: unknown } };
      return status.ok && status.value!.state === 'ready' && status.value!.daemon !== null;
    }, { timeout: 60_000, message: 'main is connected through mawsd' }).toBe(true);
    const created = (await page.evaluate(
      (html) => window.maws.invoke('artifacts.create' as never, { kind: 'html', title: 'Quit-proof page', content: { bytes: new TextEncoder().encode(html), name: 'index.html' } } as never),
      '<!doctype html><html><head><title>Red</title></head><body style="margin:0;background:#ff0000"><p>RH_DAEMON_SHAPE</p></body></html>',
    )) as { ok: true; value: { artifact: { id: string; revision: number } } } | { ok: false; error: { message: string } };
    if (!created.ok) throw new Error(`artifacts.create failed: ${created.error.message}`);
    const { id, revision } = created.value.artifact;
    const app = launch.app;
    const exited = new Promise<void>((done) => app.process().once('exit', () => done()));
    await app.evaluate(({ app: electron }) => electron.quit());
    await exited;

    await test.step('a second client’s library Export, with no app, rendered by the render host mawsd starts', async () => {
      const reached = await reachMachine(daemonPaths(userData), { build: 'e2e-render-host-b' });
      if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
      try {
        expect(reached.link.welcome.capabilities).toContain(MACHINE_RENDER_CAPABILITY);
        const exported = await reached.link.request('artifacts.export', { artifactId: id, format: 'pdf' }, 150_000);
        expect(exported, JSON.stringify(exported).slice(0, 300)).toMatchObject({ ok: true, value: { revision } });
        const path = (exported as { value: { path: string } }).value.path;
        expect(path.startsWith(join(userData, 'artifacts', id, 'exports'))).toBe(true);
        expect(readFileSync(path).subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(mawsdLog()).toContain('[render] starting the render host for the library’s Export');
        expect(mawsdLog()).toContain('[render] the render host is ready');

        // a capture through the seam, the e2e's (daemon.e2eRender), its PNG written where the scene asks
        const to = join(userData, 'capture.png');
        const captured = await reached.link.request('daemon.e2eRender', { artifactId: id, revision, width: 640, height: 480, to }, 150_000);
        expect(captured, JSON.stringify(captured)).toMatchObject({ ok: true });
        const png = readFileSync(to);
        expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 480]);
        const status = (await reached.link.request('daemon.status', undefined)) as { ok: true; value: DaemonStatus };
        expect(status.value.render, 'one render host served both').toMatchObject({ state: 'ready', starts: 1, requests: 0 });
      } finally {
        reached.link.close();
      }
    });

    await test.step('the render host ends after its quiet period', async () => {
      await expect.poll(mawsdLog, { timeout: QUIET_MS + 30_000, message: 'the quiet period’s end' }).toContain(`[render] quiet for ${QUIET_MS / 1000} s: ending the render host`);
      await expect.poll(mawsdLog, { timeout: 15_000, message: 'its exit' }).toMatch(/\[render\] the render host exited \(code 0\)/);
    });

    await test.step('the relaunched app finds the artifact and its export; its main never captured', async () => {
      launch = await launchMaws({ userData, env: DAEMON_SHAPE });
      launches.push(launch);
      const again = launch.page;
      await expect.poll(async () => {
        const row = (await again.evaluate((artifactId) => window.maws.invoke('library.get', { artifactId } as never), id)) as { ok: boolean; value?: { row: { id: string } | null } };
        return row.ok ? (row.value!.row?.id ?? null) : null;
      }, { timeout: 60_000, message: 'the library row of the artifact made before the quit' }).toBe(id);
      const formats = (await again.evaluate(() => window.maws.invoke('library.exportFormats', { kind: 'html' } as never))) as { ok: boolean; value?: { formats: string[] } };
      expect(formats.value?.formats ?? []).toContain('pdf');
      const seen = await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.webContents.getURL()));
      expect(seen.filter((url) => url.startsWith('maws-artifact:')), 'no capture window in main on the daemon shape').toEqual([]);
    });
  } finally {
    for (const each of launches.reverse()) await each.cleanup().catch((error: unknown) => console.error(error));
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ---- part (c): pass 3, the render host as the agent's tab engine (P5 O17 M8) --------------------------------------------
//
// docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8 scene 7 and acceptance 7.2's real half: the built app started as
// the render host against the fake `mawsd`, now a tab engine (its hello lists `browser.engine`). The test is `mawsd` and
// every client of it at once: it prepares a session over `browserEngine.request`, connects to the session's socket as
// `mawsd`'s relay (its process is the fake front's, the machine.sock link's peer the engine admits), drives cua's
// creation sequence with the fake cua host, holds the fence (`browserEngine.work`), reads the inventory pushes, and is
// the viewer of `DaemonServices.browser`'s engine half: it opens subscriptions, takes `browserEngine.frame`s and
// acknowledges them. Through the real Electron it checks what M4 and M6 left to the real run: a tab and an adopted
// `window.open` popup are offscreen and no window is shown; the frame subscription (`beginFrameSubscription` with
// `invalidate()`) gives an offscreen view a first frame and a still page nothing more after it; a person's wheel scrolls
// in the DOM's sense; keys reach an offscreen view no window focuses; a click lands through presence's gate. Then the
// stream across a cua screenshot, a detach and a re-attach, cua's host receiving no frame of the viewer's, and a 60 Hz
// page read by a 2 fps viewer for 60 s with the producer's counters and main's heap flat after the warm-up. It needs no
// engine host, so no M7: it runs on the mini and, with MAWS_E2E_LINUX_HEADLESS=1 under xvfb, on the Linux VM (the uid
// is the render host's socket boundary there), as `-g "pass 3"`.

const P3 = 'pass3-session-a' as AppSessionId;
type PersonInput = Extract<BrowserEngineRequest['operation'], { op: 'input' }>['event'];
// the render host's e2e seam (src/render-host/root.ts): the tab engine's sessions and the producer's counters
interface EngineFacts {
  sessions: Record<string, { tabs: number; creating: number; held: string }>;
  screencast: { tabs: number; images: number; viewers: { id: string; tabId: string; control: boolean; inFlight: number; encoding: number; waiting: number }[] };
  views: { tabId: string; appSessionId: string; contentsId: number | null }[]; // fix 2: the view the engine holds for each tab
}
const P3_IDENTITY = { ref: 'e2e-render-host-pass3', name: 'pass3', project: { key: 'e2e', name: 'e2e', smnsId: null } };

interface EngineWire {
  answers: Map<string, BrowserEngineResult>;
  work: { appSessionId: string; held: boolean }[];
  states: EngineInventory[];
  frames: { at: number; subscriptionId: string; frame: { tabId: string; seq: number; width: number; height: number; viewport: { width: number; height: number }; jpegBase64: string } }[];
  ended: { subscriptionId: string; reason: string }[];
  onFrame: ((frame: EngineWire['frames'][number]) => void) | null;
}
function engineWire(): { wire: EngineWire; handlers: Record<string, FrontHandler> } {
  const wire: EngineWire = { answers: new Map(), work: [], states: [], frames: [], ended: [], onFrame: null };
  return {
    wire,
    handlers: {
      'machine.identity': () => P3_IDENTITY, // the relay's confirmation on this link (§H)
      'browserEngine.answer': (input) => void wire.answers.set((input as { id: string }).id, (input as { result: BrowserEngineResult }).result),
      'browserEngine.work': (input) => void wire.work.push(input as EngineWire['work'][number]), // the fence held at once
      'browserEngine.state': (input) => void wire.states.push((input as { inventory: EngineInventory }).inventory),
      'browserEngine.frame': (input) => {
        const frame = { at: Date.now(), ...(input as Omit<EngineWire['frames'][number], 'at'>) };
        wire.frames.push(frame);
        wire.onFrame?.(frame);
      },
      'browserEngine.ended': (input) => void wire.ended.push(input as EngineWire['ended'][number]),
    },
  };
}

test('pass 3: the render host as the agent’s tab engine against a fake mawsd: offscreen tabs and popups, the real frame subscription, a person’s input, a stream across cua’s screenshot and re-attach, and a 2 fps viewer of a 60 Hz page for 60 s', async () => {
  test.setTimeout(300_000);
  const { wire, handlers } = engineWire();
  scene = await startScene(handlers);
  const { app, client, profile } = scene;
  const pages = await startPages();
  let host = null as FakeHost | null;
  let asked = 0;
  const send = (operation: BrowserEngineRequest['operation']) => {
    const id = `p3-${++asked}`;
    client.send('browserEngine.request', { id, appSessionId: P3, operation });
    return id;
  };
  const ask = async (operation: BrowserEngineRequest['operation']) => {
    const id = send(operation);
    await expect.poll(() => wire.answers.has(id), { timeout: 30_000, message: `the answer to ${operation.op}` }).toBe(true);
    return wire.answers.get(id)!;
  };
  // a refusal names the render host's own lines with it (its stderr since the spawn), so a CI run says why
  const ok = async (operation: BrowserEngineRequest['operation']) => {
    const answer = await ask(operation);
    expect(answer, `${operation.op}${answer.ok ? '' : `; the render host said:\n${scene!.stderr().split('\n').filter((line) => line.includes('[browser]') || line.includes('[render-host]') || line.includes('peer')).slice(-40).join('\n')}`}`).toEqual({ ok: true, value: operation.op === 'inventory' ? expect.anything() : null });
  };
  const tabIdOf = (path: string) => wire.states.at(-1)?.tabs.find((tab) => tab.url === pages.url(path))?.tabId ?? null;
  const inspect = () => app.evaluate(() => (globalThis as unknown as { __maws_tab_engine: { inspect(): EngineFacts } }).__maws_tab_engine.inspect());
  const contentsIdOf = async (tabId: string) => (await inspect()).views.find((view) => view.tabId === tabId)?.contentsId ?? null;
  // the view the engine holds for a tab (its inspection names it by webContents id), offscreen or not, and how many windows
  // show: never a URL lookup, which can miss a document not yet committed
  const viewFacts = async (tabId: string) => {
    const contentsId = await contentsIdOf(tabId);
    return app.evaluate(({ BaseWindow, webContents }, id) => {
      const contents = id === null ? undefined : webContents.fromId(id);
      return { held: contents !== undefined, offscreen: contents?.isOffscreen() ?? null, shown: BaseWindow.getAllWindows().filter((window) => window.isVisible()).length };
    }, contentsId);
  };
  // One reading of the page at `path`, in the render host's main (never through cua's lease, which a person's input may
  // hold): the tab at `path` in the inventory, its view by the engine's own id, and its document the one committed at that
  // URL; else what was missing
  const readPage = async (path: string, expression: string): Promise<{ value: unknown } | { missing: string }> => {
    const tabId = tabIdOf(path);
    if (tabId === null) return { missing: 'no tab at this URL in the inventory' };
    const contentsId = await contentsIdOf(tabId);
    if (contentsId === null) return { missing: `the engine holds no view for ${tabId}` };
    return app.evaluate(async ({ webContents }, [id, url, code]) => {
      const contents = webContents.fromId(id as number);
      if (!contents) return { missing: 'no webContents' };
      if (contents.getURL() !== url) return { missing: `the committed document is ${JSON.stringify(contents.getURL())}` };
      return { value: (await contents.executeJavaScript(code as string, true)) as unknown };
    }, [contentsId, pages.url(path), expression] as const);
  };
  // The page at `path` committed and loaded (`document.readyState` complete), waited for up to 15 s, else a failure
  // saying what was last seen. Its own loop: Playwright's expect.poll does not retry a callback that throws
  const committed = async (path: string): Promise<void> => {
    let seen = 'nothing read yet';
    for (const deadline = Date.now() + 15_000; Date.now() < deadline; await new Promise((resolve) => setTimeout(resolve, 100))) {
      const read = await readPage(path, 'document.readyState').catch((error: unknown) => ({ missing: error instanceof Error ? error.message : String(error) }));
      if ('value' in read && read.value === 'complete') return;
      seen = 'value' in read ? `document.readyState ${JSON.stringify(read.value)}` : read.missing;
    }
    throw new Error(`${path} did not commit and load within 15 s: ${seen}`);
  };
  // The page's own reading, always of its committed, loaded document: no caller can read a page before it commits, and
  // anything missing after that fails loudly with what it was, never as null
  const inPage = async <T,>(path: string, expression: string): Promise<T> => {
    await committed(path);
    const read = await readPage(path, expression);
    if ('missing' in read) throw new Error(`${path}: ${read.missing}`);
    return read.value as T;
  };
  const lines: string[] = [];
  try {
    await test.step('prepare: the session’s socket listens and admits mawsd’s relay; cua’s creation sequence makes an offscreen tab behind the fence', async () => {
      await ok({ op: 'prepare' });
      const path = cuaSocketPath(renderCuaSocketDir(profile, tmpdir()), P3)!;
      host = await connectFakeHost(path);
      expect(host.hello).toMatchObject({ extensionId: 'maws', extensionInstanceId: `maws:${P3}`, protocolVersion: 1, profileName: 'MAWS' });
      expect(await host.request('tabs.query')).toEqual([]);
      expect(await host.request('windows.query')).toEqual([{ id: 1, focused: true, type: 'normal' }]);
      expect(await host.request('windows.create', { url: 'about:blank', focused: false })).toEqual({ id: 1 });
      const tab = await host.request<{ id: number }>('tabs.create', { url: pages.url('/still'), group: { key: 's', title: 'cua' } });
      expect(typeof tab.id).toBe('number');
      expect(wire.work, 'the fence held before the first tab').toEqual([{ appSessionId: P3, held: true }]);
      await expect.poll(() => tabIdOf('/still'), { message: 'the inventory pushed with the tab' }).not.toBeNull();
      expect(await viewFacts(tabIdOf('/still')!), 'the tab renders offscreen and no window is shown').toEqual({ held: true, offscreen: true, shown: 0 });
      await expect.poll(() => inPage<number[]>('/still', '[innerWidth, innerHeight]'), { message: 'the agent’s viewport, once the page commits' }).toEqual([1280, 800]);
    });

    await test.step('the frame subscription gives an offscreen view a first frame, and a still page nothing more after its acknowledgement', async () => {
      const tabId = tabIdOf('/still')!;
      await ok({ op: 'open', subscriptionId: 'still', tabId, control: false });
      await expect.poll(() => wire.frames.filter((f) => f.subscriptionId === 'still').length, { timeout: 10_000, message: 'a first frame (invalidate() on the offscreen view)' }).toBe(1);
      const first = wire.frames.find((f) => f.subscriptionId === 'still')!;
      expect(first.frame).toMatchObject({ tabId, seq: 1, viewport: { width: 1280, height: 800 } });
      const size = await app.evaluate(({ nativeImage }, base64) => nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).getSize(), first.frame.jpegBase64);
      expect(size, 'a JPEG of the frame’s own size, within 1280×800').toEqual({ width: first.frame.width, height: first.frame.height });
      await ok({ op: 'ack', subscriptionId: 'still', seq: 1 });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect(wire.frames.filter((f) => f.subscriptionId === 'still').length, 'a still page sends its latest image and nothing more').toBeLessThanOrEqual(2);
      await ok({ op: 'close', subscriptionId: 'still' });
    });

    await test.step('a person’s input on a controlling subscription: a click through presence’s gate, the wheel in the DOM’s sense, keys and text into a view no window focuses', async () => {
      const tab = await host!.request<{ id: number }>('tabs.create', { url: pages.url('/input'), group: { key: 's', title: 'cua' } });
      await expect.poll(() => tabIdOf('/input')).not.toBeNull();
      const tabId = tabIdOf('/input')!;
      await committed('/input');
      await ok({ op: 'open', subscriptionId: 'person', tabId, control: true });
      await expect.poll(() => wire.frames.some((f) => f.subscriptionId === 'person'), { timeout: 10_000, message: 'a frame before any pointer input' }).toBe(true);
      // the agent drives the tab first (an acting command through its lease): the takeover gate gives a person's input the
      // tab only from the agent, as a local person's click does (agent/control.ts; an idle tab stays idle)
      await host!.request('debugger.attach', { tabId: tab.id });
      await host!.request('debugger.sendCommand', { debuggee: { tabId: tab.id }, method: 'Runtime.evaluate', params: { expression: 'document.title' }, timeoutMs: 10_000 });
      await expect.poll(() => wire.states.at(-1)?.tabs.find((each) => each.tabId === tabId)?.control, { message: 'the agent’s acting command takes the tab' }).toBe('agent');
      let seq = 0;
      const input = (event: PersonInput) => ok({ op: 'input', subscriptionId: 'person', seq: ++seq, event });
      const centre = { x: BUTTON.x + BUTTON.width / 2, y: BUTTON.y + BUTTON.height / 2 };
      for (const type of ['down', 'up'] as const) await input({ kind: 'pointer', type, ...centre, button: 'left', buttons: type === 'down' ? 1 : 0, clickCount: 1, modifiers: [] });
      await expect.poll(() => inPage<string>('/input', 'document.querySelector("#state").textContent'), { message: 'the click landed' }).toBe('clicked');
      await expect.poll(() => wire.states.at(-1)?.tabs.find((each) => each.tabId === tabId)?.control, { message: 'the tab is the person’s while they act' }).toBe('human');
      // the click left focus on the button: the person focuses the field through the same viewer, then types
      const field = (await inPage<{ x: number; y: number }>('/input', '(() => { const r = document.querySelector("#field").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()'))!;
      for (const type of ['down', 'up'] as const) await input({ kind: 'pointer', type, ...field, button: 'left', buttons: type === 'down' ? 1 : 0, clickCount: 1, modifiers: [] });
      await expect.poll(() => inPage<string>('/input', 'document.activeElement?.id ?? null'), { message: 'the field has focus' }).toBe('field');
      await input({ kind: 'key', type: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: [] });
      await input({ kind: 'key', type: 'up', key: 'a', code: 'KeyA', repeat: false, modifiers: [] });
      await expect.poll(() => inPage<string[]>('/input', '__keys'), { message: 'a key reaches the unfocused offscreen view' }).toContain('a');
      await input({ kind: 'text', text: 'hello' });
      await expect.poll(() => inPage<string>('/input', 'document.querySelector("#field").value'), { message: 'text through insertText into the focused field' }).toContain('hello');
      await input({ kind: 'wheel', x: 300, y: 300, deltaX: 0, deltaY: 400, modifiers: [] });
      await expect.poll(() => inPage<number>('/input', 'scrollY'), { message: 'a positive deltaY scrolls down (the DOM’s sense)' }).toBeGreaterThan(0);
      expect((await inPage<number[]>('/input', '__wheel'))!.every((delta) => delta > 0), 'the page heard a downward wheel').toBe(true);
      await ok({ op: 'close', subscriptionId: 'person' });
      await new Promise((resolve) => setTimeout(resolve, 3_500)); // the person's hand-back: the agent acts again 3 s after their last input
      await host!.request('tabs.remove', { tabId: tab.id });
    });

    await test.step('a script’s window.open with no attributed press is denied; one from the agent’s click is adopted as a tab of the session, offscreen too, and no window is shown', async () => {
      const opener = await host!.request<{ id: number }>('tabs.create', { url: pages.url('/popup'), group: { key: 's', title: 'cua' } });
      await expect.poll(() => tabIdOf('/popup')).not.toBeNull();
      await committed('/popup'); // the opener's own document, never its blank first one
      // the popup policy (src/main/browser/window-open.ts): a page's open is honoured only within 5 s of an attributed press
      // (the person's or the agent's) in it; Chromium's gesture flag on a script is no press, so it is denied, as in the app
      await inPage('/popup', `window.open(${JSON.stringify(pages.url('/child'))}, '_blank'); true`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(tabIdOf('/child'), 'a gesture-less open is denied').toBeNull();
      // the agent clicks the opener's button through its lease: an attributed press, so the open is honoured and adopted
      const centre = { x: BUTTON.x + BUTTON.width / 2, y: BUTTON.y + BUTTON.height / 2 };
      await host!.request('debugger.attach', { tabId: opener.id });
      for (const type of ['mousePressed', 'mouseReleased'] as const) {
        await host!.request('debugger.sendCommand', { debuggee: { tabId: opener.id }, method: 'Input.dispatchMouseEvent', params: { type, ...centre, button: 'left', clickCount: 1 }, timeoutMs: 10_000 });
      }
      await expect.poll(() => tabIdOf('/child'), { timeout: 10_000, message: 'the popup adopted as a tab of the session' }).not.toBeNull();
      expect(await viewFacts(tabIdOf('/child')!), 'the adopted popup renders offscreen and no window is shown').toEqual({ held: true, offscreen: true, shown: 0 });
      // the opener relation survives adoption: the child posts to its opener as it loads, as a sign-in popup posts back
      expect(await inPage<boolean>('/child', 'window.opener !== null'), 'the adopted popup keeps window.opener').toBe(true);
      await expect.poll(() => inPage<unknown[]>('/popup', '__messages'), { message: 'the opener heard its popup' }).toEqual(['from the child']);
      // what the real Electron made of a tab's view and page, the child's beside its opener's (whose view the engine made
      // itself), so a failure below says which step of the sizing differs
      const sizingFacts = async (path: string) => {
        const id = await contentsIdOf(tabIdOf(path)!);
        const main = await app.evaluate(({ BaseWindow, webContents }, contentsId) => {
          const contents = contentsId === null ? undefined : webContents.fromId(contentsId);
          if (!contents) return null;
          const viewOf = (window: Electron.BaseWindow) => window.contentView.children.find((view) => (view as Partial<Electron.WebContentsView>).webContents?.id === contentsId) as Electron.WebContentsView | undefined;
          const holder = BaseWindow.getAllWindows().find((window) => viewOf(window) !== undefined);
          return {
            type: contents.getType(), offscreen: contents.isOffscreen(), painting: contents.isPainting(), frameRate: contents.getFrameRate(),
            viewBounds: holder ? viewOf(holder)!.getBounds() : null,
            sizingWindow: holder ? { id: holder.id, size: holder.getSize(), contentSize: holder.getContentSize() } : null,
            // Electron's internal reading of the window its page is sized from (no longer in its typings)
            ownerBrowserWindowId: (contents as unknown as { getOwnerBrowserWindow?(): { id: number } | null }).getOwnerBrowserWindow?.()?.id ?? null,
            windows: BaseWindow.getAllWindows().map((window) => window.id),
          };
        }, id);
        const page = await readPage(path, '({ inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight], devicePixelRatio })').catch((error: unknown) => ({ missing: String(error) }));
        return { ...main, page };
      };
      // An Electron offscreen child is never sized by its window; the render host sizes its page through CDP's
      // Emulation.setVisibleSize (offscreen-views.ts). The upgrade tripwire: an Electron or Chromium that drops or ignores
      // the command fails here, on the exact size, with the render host's line carrying Chromium's error
      const sizingLines = () => scene!.stderr().split('\n').filter((line) => line.includes('could not be sized to the viewport'));
      await expect.poll(() => inPage<number[]>('/child', '[innerWidth, innerHeight]'), { timeout: 15_000, message: 'the popup at the agent’s viewport, once it commits and is placed' }).toEqual([1280, 800]).catch(async (error: unknown) => {
        const facts = { child: await sizingFacts('/child'), opener: await sizingFacts('/popup') };
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nthe render host's sizing lines: ${JSON.stringify(sizingLines())}\nthe sizing facts: ${JSON.stringify(facts)}`, { cause: error });
      });
      expect(sizingLines(), 'Chromium sized the popup’s page without an error').toEqual([]);
      // M6's frame source (beginFrameSubscription) on the adopted popup: frames at the size a tab's own view gives (the
      // still page's first frame, earlier in this pass)
      const childTabId = tabIdOf('/child')!;
      await ok({ op: 'open', subscriptionId: 'popup', tabId: childTabId, control: false });
      await expect.poll(() => wire.frames.some((f) => f.subscriptionId === 'popup'), { timeout: 10_000, message: 'a frame of the adopted popup through beginFrameSubscription' }).toBe(true).catch(async (error: unknown) => {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nthe sizing facts: ${JSON.stringify(await sizingFacts('/child'))}`, { cause: error });
      });
      const popupFrame = wire.frames.find((f) => f.subscriptionId === 'popup')!.frame;
      const stillFrame = wire.frames.find((f) => f.subscriptionId === 'still')!.frame;
      expect(popupFrame, 'the popup’s frame').toMatchObject({ tabId: childTabId, seq: 1, viewport: { width: 1280, height: 800 } });
      expect({ width: popupFrame.width, height: popupFrame.height }, 'the popup’s frame at the size a tab’s own view gives').toEqual({ width: stillFrame.width, height: stillFrame.height });
      expect(popupFrame.width / popupFrame.height, 'the viewport’s aspect').toBeCloseTo(1280 / 800, 2);
      const popupJpeg = await app.evaluate(({ nativeImage }, base64) => nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).getSize(), popupFrame.jpegBase64);
      expect(popupJpeg, 'a JPEG of the frame’s own size').toEqual({ width: popupFrame.width, height: popupFrame.height });
      await ok({ op: 'close', subscriptionId: 'popup' });
      const child = (await host!.request<{ id: number; url: string }[]>('tabs.query')).find((each) => each.url === pages.url('/child'))!;
      await host!.request('tabs.remove', { tabId: child.id });
      await host!.request('tabs.remove', { tabId: opener.id });
    });

    await test.step('a 60 Hz page read by a 2 fps viewer for 60 s, across cua’s screenshot, a detach and a re-attach: the page keeps its rate, cua hears no frame of the viewer’s, the counters and main’s heap stay flat', async () => {
      const tab = await host!.request<{ id: number }>('tabs.create', { url: pages.url('/anim'), group: { key: 's', title: 'cua' } });
      await expect.poll(() => tabIdOf('/anim')).not.toBeNull();
      const tabId = tabIdOf('/anim')!;
      await committed('/anim');
      const rate = async (ms: number) => {
        const before = (await inPage<number>('/anim', '__frames'))!;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return (((await inPage<number>('/anim', '__frames'))! - before) * 1_000) / ms;
      };
      const unsubscribed = await rate(3_000);
      // the viewer: each frame acknowledged 500 ms after it came
      wire.onFrame = (frame) => {
        if (frame.subscriptionId === 'anim') setTimeout(() => send({ op: 'ack', subscriptionId: 'anim', seq: frame.frame.seq }), 500);
      };
      await ok({ op: 'open', subscriptionId: 'anim', tabId, control: false });
      const frames = () => wire.frames.filter((f) => f.subscriptionId === 'anim');
      const samples: { atS: number; frames: number; heapKiB: number; images: number; inFlight: number; waiting: number }[] = [];
      const sample = async (atS: number) => {
        const facts = await inspect();
        const heapKiB = await app.evaluate(() => Math.round(process.memoryUsage().heapUsed / 1024));
        const viewers = facts.screencast.viewers.filter((viewer) => viewer.id === 'anim');
        samples.push({ atS, frames: frames().length, heapKiB, images: facts.screencast.images, inFlight: viewers.reduce((n, v) => n + v.inFlight, 0), waiting: viewers.reduce((n, v) => n + v.waiting, 0) });
      };
      const started = Date.now();
      const at = (s: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, started + s * 1_000 - Date.now())));
      // cua's own work on the tab while the viewer reads it: a screenshot through the lease, then a detach and a re-attach
      await host!.request('debugger.attach', { tabId: tab.id });
      const shot = await host!.request<{ data: string }>('debugger.sendCommand', { debuggee: { tabId: tab.id }, method: 'Page.captureScreenshot', params: { format: 'png' }, timeoutMs: 10_000 });
      expect(Buffer.from(shot.data, 'base64').subarray(1, 4).toString('latin1'), 'cua’s screenshot').toBe('PNG');
      await host!.request('debugger.detach', { tabId: tab.id });
      await host!.request('debugger.attach', { tabId: tab.id });
      let subscribed = 0;
      for (const s of [10, 20, 30, 40, 50, 60]) {
        await at(s);
        await sample(s);
        if (s === 30) subscribed = await rate(3_000);
      }
      await host!.request('debugger.detach', { tabId: tab.id });
      wire.onFrame = null;
      await ok({ op: 'close', subscriptionId: 'anim' });

      const warm = samples[0]!;
      const last = samples.at(-1)!;
      const perSecond = (last.frames - warm.frames) / (last.atS - warm.atS);
      lines.push(
        `the page's rAF: ${unsubscribed.toFixed(1)} Hz unsubscribed, ${subscribed.toFixed(1)} Hz under the 2 fps viewer`,
        `frames to the viewer: ${frames().length} in about 60 s, ${perSecond.toFixed(2)} a second after the warm-up`,
        `main's heap: ${samples.map((s) => `${s.atS}s ${s.heapKiB} KiB`).join(', ')}`,
        `counters: ${samples.map((s) => `${s.atS}s images ${s.images} in flight ${s.inFlight} waiting ${s.waiting}`).join('; ')}`,
      );
      expect(subscribed, 'the subscription keeps the page’s own rate (within the noise of a 3 s reading)').toBeGreaterThanOrEqual(unsubscribed * 0.7);
      expect(perSecond, 'the viewer’s pace, never the page’s: at most 2 a second, and some').toBeGreaterThan(0.5);
      expect(perSecond).toBeLessThanOrEqual(2.2);
      expect(samples.every((s) => s.images <= 1 && s.inFlight <= 1 && s.waiting <= 1), 'one newest image and one frame in flight, all through').toBe(true);
      expect(last.heapKiB - warm.heapKiB, `main’s heap after the warm-up (${warm.heapKiB} → ${last.heapKiB} KiB)`).toBeLessThan(16 * 1024);
      const cuaFrames = host!.notifications.filter((n) => n.method === 'debugger.event' && (n.params as { method?: string }).method === 'Page.screencastFrame');
      expect(cuaFrames, 'cua’s host hears no frame it did not ask for').toEqual([]);
      expect(wire.ended, 'no subscription ended on its own').toEqual([]);
      await host!.request('tabs.remove', { tabId: tab.id });
    });

    await test.step('the last tab’s close reports the zero, and drop answers once the session is gone here', async () => {
      for (const left of await host!.request<{ id: number }[]>('tabs.query')) await host!.request('tabs.remove', { tabId: left.id }); // the still page's
      await expect.poll(() => wire.work.at(-1), { message: 'the session’s browser work back to zero' }).toEqual({ appSessionId: P3, held: false });
      await ok({ op: 'drop' });
      await host!.closed;
      expect(await inspect()).toMatchObject({ sessions: {}, screencast: { tabs: 0, images: 0, viewers: [] } });
    });
    for (const line of lines) console.log(`[pass 3] ${line}`);
    test.info().annotations.push({ type: 'pass 3', description: lines.join('\n') });
  } finally {
    await host?.close().catch(() => {});
    await pages.close();
  }
});

// ---- part (c), on Linux: the route's reading, and pass 3 through it under the e2e switch (P5 O17 M8) ------------------
//
// M8's Decisions: on Linux the route is `none` with §I's Linux reason until cua's owner ships a Linux peer check (R6), and
// the e2e-only switch MAWS_E2E_LINUX_HEADLESS=1 (read by `mawsd` under MAWS_E2E=1 alone) lets it reach `cold` for the
// fixture connector, never for real cua. Both read a profile's `mawsd` with no app; the render runtime is installed on
// the VM first (`mawsd render install`, Concrete Steps).

test('pass 3, Linux: without the switch the browser reads the Linux reason and nothing listens for the session', async () => {
  test.skip(process.platform !== 'linux', 'the Linux route (the VM)');
  const headless = await startHeadlessScene({ env: { MAWS_E2E_LINUX_HEADLESS: '0' } });
  try {
    const id = await headless.start(headless.repo(0));
    expect((await headless.capabilities(id)).browser).toEqual({ available: false, reason: linuxReason(machineName(process.env, hostname())) });
    await expect.poll(() => headless.report(headless.repo(0))?.refused ?? 0, { timeout: 15_000, message: 'cua’s host finds nothing listening' }).toBeGreaterThan(1);
    expect(existsSync(headless.daemonSocket(id)), 'no listener on Linux (D5)').toBe(false);
  } finally {
    await headless.stop();
  }
});

test('pass 3, Linux: under the switch the fixture connector’s creation sequence runs through the route, the render host starting at its first real primitive', async () => {
  test.skip(process.platform !== 'linux', 'the Linux route (the VM)');
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  const pages = await startPages();
  const headless = await startHeadlessScene({ env: { MAWS_E2E_LINUX_HEADLESS: '1' } });
  try {
    const id = await headless.start(headless.repo(0));
    expect((await headless.capabilities(id)).browser).toEqual(SCREENCAST);
    const connector = await headless.connector(headless.repo(0));
    await expect.poll(() => headless.report(headless.repo(0))?.hellos ?? 0, { timeout: 15_000, message: 'the broker greets cua' }).toBeGreaterThan(0);
    expect(await answered('tabs.query', connector.call('tabs.query'))).toEqual([]);
    expect((await headless.render()).starts).toBe(0);
    const created = await answered('the creation sequence', connector.sequence(pages.url('/')));
    expect(created.screenshotBytes).toBeGreaterThan(0);
    expect(await headless.render()).toMatchObject({ starts: 1, browserSessions: 1, browserTabs: 1 });
    await answered('tabs.remove', connector.call('tabs.remove', { tabId: created.tabId }));
    await expect.poll(async () => (await headless.render()).browserTabs).toBe(0);
    connector.close();
  } finally {
    await headless.stop();
    await pages.close();
  }
});
