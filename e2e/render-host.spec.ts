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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { MawsArtifactCapture, MawsArtifactCapturedResult, MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import type { RenderAnswer, RenderRequest } from '@shared/ipc/schema/render';
import { MACHINE_RENDER_CAPABILITY, RENDER_CLIENT_CAPABILITY } from '@shared/host/socket-protocol';
import { daemonPaths } from '@shared/daemon/files';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import { reachMachine } from '../src/mawsd/machine-client';
import { ipcError } from '@shared/ipc/errors';
import { startFakeArtifactsEndpoint, type FakeArtifactsEndpoint } from '../test/support/fake-artifacts-endpoint';
import { startFakeFront, type FakeFront, type FakeFrontClient } from '../test/support/fake-front';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { launchEnvironment } from './support/scratch-env';

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

async function startScene(): Promise<Scene> {
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
  const entry = executable ? [] : ['-r', join(dirname(fromRoot.resolve('playwright-core/package.json')), 'lib/server/electron/loader.js'), join(REPO_ROOT, 'out/main/index.js')];
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
    expect(client.capabilities).toEqual([RENDER_CLIENT_CAPABILITY]);
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
