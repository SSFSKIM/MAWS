// The artifact store's acceptance in utility mode (docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4 Proves; `pnpm
// e2e:artifacts`): a document the host's test writer made syncs to replicas in two windows over the product's port
// route (main's channel, the sandboxed preload, the renderer's ArtifactHost), an edit in one reaches the other and the
// writer's reaches both; a repeated op id is a no-op; versions list their actors; restore lands whole in both windows;
// `artifacts.changed` arrives for each change; the store reopens after a relaunch on the same profile; and a SIGKILL of
// the host while a renderer types loses no acknowledged edit, every replica re-opening by itself. M7: the scheme and the
// export service (the last case).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { documents, seamReady } from './support/documents';
import { launchMaws, type MawsLaunch } from './support/launch';

const require = createRequire(__filename);

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; issues?: unknown } };
interface Changed {
  artifactId: string;
  kind: string;
  revision: number;
  change: string;
}

// A command through the page's own bridge (window.maws), as the renderer sends it.
async function invoke<T>(page: Page, name: string, input?: unknown): Promise<Result<T>> {
  return page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const) as Promise<Result<T>>;
}
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = await invoke<T>(page, name, input);
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

async function hostReady(page: Page): Promise<{ pid: number }> {
  let state: { state: string; pid: number | null } = { state: 'starting', pid: null };
  await expect.poll(async () => (state = await ok(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  return { pid: state.pid! };
}

// A second app window through main's seam, with its page.
async function secondWindow(app: ElectronApplication): Promise<Page> {
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow()),
  ]);
  await seamReady(page);
  return page;
}

// The `artifacts.changed` events a page has heard since it started listening.
async function listen(page: Page): Promise<() => Promise<Changed[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __changes: unknown[]; maws: { on(name: string, l: (p: unknown) => void): void } };
    w.__changes = [];
    w.maws.on('artifacts.changed', (payload) => w.__changes.push(payload));
  });
  return () => page.evaluate(() => (window as unknown as { __changes: Changed[] }).__changes);
}

const AGENT = 'app-e2e-agent';
let profile: string | null = null;
let launch: MawsLaunch | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (profile) rmSync(profile, { recursive: true, force: true });
  profile = null;
});

test('a document syncs across two windows and the test writer, versions and restores whole, and reopens after a relaunch', async () => {
  profile = mkdtempSync(join(tmpdir(), 'maws-e2e-artifacts-'));
  launch = await launchMaws({ userData: profile });
  const { app, page } = launch;
  await seamReady(page);
  await hostReady(page);
  const changes = await listen(page);
  const forThis = async (id: string) => (await changes()).filter((c) => c.artifactId === id);

  const { artifact } = await ok<{ artifact: { id: string; revision: number } }>(page, 'artifacts.create', { kind: 'document', title: 'Plan' });
  await expect.poll(async () => (await forThis(artifact.id)).map((c) => c.change), { message: 'created is announced' }).toEqual(['created']);
  const first = await ok<{ revision: number }>(page, 'artifacts.testWrite', {
    artifactId: artifact.id, opId: 'w1', appSessionId: AGENT,
    ops: [{ op: 'setAttr', key: 'title', value: 'one' }, { op: 'insertText', index: 0, text: 'hello' }],
  });
  await expect.poll(async () => (await forThis(artifact.id)).some((c) => c.change === 'updated' && c.revision >= first.revision), { message: 'the write is announced' }).toBe(true);

  // Two windows' replicas of the one host doc.
  const pageB = await secondWindow(app);
  const [a, b] = [documents(page), documents(pageB)];
  const [ha, hb] = [await a.open(artifact.id), await b.open(artifact.id)];
  for (const [seam, id] of [[a, ha], [b, hb]] as const) expect(await seam.json(id)).toEqual({ attrs: { title: 'one' }, text: 'hello' });
  expect(await a.state(ha)).toMatchObject({ phase: 'live', synced: true, readOnly: false });

  // An edit in one window reaches the other, and is acknowledged durable.
  await a.insertText(ha, 5, ' world');
  await expect.poll(async () => (await b.json(hb)).text, { message: 'window A’s edit reaches window B' }).toBe('hello world');
  await expect.poll(async () => (await a.state(ha)).unsaved, { message: 'window A’s edit is acknowledged' }).toBe(0);

  // The writer's edit reaches both; a repeated op id answers the first result and writes nothing.
  const w2 = { artifactId: artifact.id, opId: 'w2', appSessionId: AGENT, ops: [{ op: 'insertText', index: 0, text: '>' }] };
  const second = await ok<{ revision: number }>(page, 'artifacts.testWrite', w2);
  for (const [seam, id] of [[a, ha], [b, hb]] as const) await expect.poll(async () => (await seam.json(id)).text, { message: 'the writer’s edit reaches both windows' }).toBe('>hello world');
  expect(await ok(page, 'artifacts.testWrite', w2)).toEqual(second);
  await expect.poll(async () => (await b.json(hb)).text).toBe('>hello world');
  expect(await ok<{ artifact: { revision: number } }>(page, 'artifacts.get', { artifactId: artifact.id })).toMatchObject({ artifact: { revision: second.revision } });

  // Versions with their actors: the human's named version; the view-time auto version credited to the agent that wrote last.
  const { versionId: before } = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: artifact.id, label: 'Before' });
  const third = await ok<{ revision: number }>(page, 'artifacts.testWrite', { artifactId: artifact.id, opId: 'w3', appSessionId: AGENT, ops: [{ op: 'setAttr', key: 'title', value: 'two' }, { op: 'deleteText', index: 0, length: 1 }] });
  await ok(page, 'artifacts.markViewed', { artifactId: artifact.id });
  const { versions } = await ok<{ versions: { id: number; seq: number; kind: string; label?: string; actor: unknown }[] }>(page, 'artifacts.versions', { artifactId: artifact.id });
  expect(versions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: before, kind: 'named', label: 'Before', actor: { kind: 'human' } }),
    expect.objectContaining({ kind: 'auto', seq: third.revision, actor: { kind: 'session', appSessionId: AGENT } }),
  ]));
  for (const [seam, id] of [[a, ha], [b, hb]] as const) await expect.poll(async () => seam.json(id)).toEqual({ attrs: { title: 'two' }, text: 'hello world' });

  // Restore lands whole in both windows, each told of the restore it did not make.
  const restored = await ok<{ revision: number; versionId: number }>(page, 'artifacts.restore', { artifactId: artifact.id, versionId: before });
  for (const [seam, id] of [[a, ha], [b, hb]] as const) {
    await expect.poll(async () => seam.json(id), { message: 'the restore reaches every window' }).toEqual({ attrs: { title: 'one' }, text: '>hello world' });
    await expect.poll(async () => seam.restores(id)).toEqual([restored.versionId]);
  }
  await expect.poll(async () => (await forThis(artifact.id)).some((c) => c.revision >= restored.revision), { message: 'the restore is announced' }).toBe(true);
  const revisions = (await forThis(artifact.id)).map((c) => c.revision);
  expect(revisions, 'announced revisions only rise').toEqual([...revisions].sort((x, y) => x - y));

  // Quit and relaunch on the same profile: the store reopens with the document as it was.
  await launch.app.close();
  launch = await launchMaws({ userData: profile });
  const relaunched = launch.page;
  await seamReady(relaunched);
  await hostReady(relaunched);
  const c = documents(relaunched);
  const hc = await c.open(artifact.id);
  expect(await c.json(hc)).toEqual({ attrs: { title: 'one' }, text: '>hello world' });
  const after = await ok<{ versions: { id: number }[] }>(relaunched, 'artifacts.versions', { artifactId: artifact.id });
  expect(after.versions.map((v) => v.id)).toEqual(expect.arrayContaining([before, restored.versionId]));
});

test('a SIGKILL of the host while a window types loses no acknowledged edit, and every replica re-opens by itself', async () => {
  profile = mkdtempSync(join(tmpdir(), 'maws-e2e-artifacts-'));
  launch = await launchMaws({ userData: profile });
  const { page } = launch;
  await seamReady(page);
  const { pid } = await hostReady(page);
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Typing' });
  const seam = documents(page);
  const typer = await seam.open(artifact.id);
  const watcher = await seam.open(artifact.id);

  const start = (await seam.state(typer)).revision;
  await seam.startTyping(typer, 'k', 5);
  await expect.poll(async () => (await seam.state(typer)).revision, { message: 'the typing is being acknowledged' }).toBeGreaterThan(start + 20);
  process.kill(pid, 'SIGKILL');
  // What the typer was told is durable, and nothing more: it is closed at once, so it re-sends nothing after the restart.
  const { typed, acked } = await seam.stopTyping(typer);
  await seam.close(typer);
  expect(acked).toBeGreaterThan(0);
  expect(typed).toBeGreaterThanOrEqual(acked);

  // The watcher edits while the host is down; the edit rides in its next step 2.
  await seam.insertText(watcher, 0, 'offline!');
  await expect.poll(async () => (await ok<{ state: string; pid: number | null }>(page, 'engine.hostState')).pid, { timeout: 20_000, message: 'the host restarts' }).not.toBe(pid);
  await hostReady(page);
  await expect.poll(async () => seam.state(watcher), { timeout: 20_000, message: 'the watcher re-opens by itself and saves its edit' }).toMatchObject({ phase: 'live', synced: true, unsaved: 0 });

  const text = (await seam.json(watcher)).text;
  expect(text.startsWith('offline!')).toBe(true);
  const lost = Array.from({ length: acked }, (_, i) => `k${i};`).filter((token) => !text.includes(token));
  expect(lost, 'every acknowledged keystroke survived the kill').toEqual([]);
  // A fresh replica reads the same from the restarted host.
  const fresh = await seam.open(artifact.id);
  expect((await seam.json(fresh)).text).toBe(text);
});

// M7 (Decision Log 14, 35e, 35g; X31): the `maws-artifact:` scheme serves an html artifact's page, live and at its
// revision, with the deliverable scheme's headers and sandboxing policy and the bridge script; the app page loads an
// artifact's image and font through it (the app's CSP and the scheme's CORS answer); and the export service renders the
// page to a PDF and to a PNG of the asked size in the capture partition's hidden window.
interface Served {
  status: number;
  headers: Record<string, string>;
  text: string;
}
async function served(app: ElectronApplication, url: string): Promise<Served> {
  return app.evaluate(async ({ session }, target) => {
    const response = await session.defaultSession.fetch(target);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => (headers[name] = value));
    return { status: response.status, headers, text: await response.text() };
  }, url);
}
// The width and height a PNG's IHDR chunk declares.
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const PAGE = '<!doctype html><html><head><title>Report</title><style>@page { size: A5 } body { margin: 0 } .tall { height: 2000px; background: #2a6 }</style></head><body><h1>M7_EXPORT</h1><div class="tall"></div></body></html>';

test('maws-artifact: serves an html page and its assets to the app, and the export service writes its PDF and PNG', async () => {
  profile = mkdtempSync(join(tmpdir(), 'maws-e2e-artifacts-'));
  launch = await launchMaws({ userData: profile });
  const { app, page } = launch;
  await seamReady(page);
  await hostReady(page);

  const created = await page.evaluate(
    (html) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke('artifacts.create', { kind: 'html', title: 'Report', content: { bytes: new TextEncoder().encode(html), name: 'index.html' } }),
    PAGE,
  ) as Result<{ artifact: { id: string; revision: number } }>;
  if (!created.ok) throw new Error(`artifacts.create failed: ${created.error.message}`);
  const { artifact } = created.value;

  // A newer page (the test writer's page op), then each revision as it was: the deliverable scheme's headers and policy,
  // the bridge script in its head, the older revision's bytes not the live ones.
  const newer = await ok<{ revision: number }>(page, 'artifacts.testWrite', { artifactId: artifact.id, opId: 'page-2', ops: [{ op: 'page', text: PAGE.replace('M7_EXPORT', 'M7_NEWER') }] });
  const live = await served(app, `maws-artifact://${artifact.id}/live/index.html`);
  const atRevision = await served(app, `maws-artifact://${artifact.id}/${artifact.revision}/index.html`);
  for (const answer of [live, atRevision]) {
    expect(answer.status).toBe(200);
    expect(answer.headers).toMatchObject({ 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    expect(answer.headers['content-security-policy']).toMatch(/^sandbox allow-scripts; default-src 'none'/);
    expect(answer.text).toContain('data-maws-bridge');
  }
  expect(live.text).toContain('M7_NEWER');
  expect(atRevision.text).toContain('M7_EXPORT');
  expect(atRevision.text).not.toBe(live.text);
  expect((await served(app, `maws-artifact://${artifact.id}/${newer.revision}/index.html`)).text).toBe(live.text);
  expect((await served(app, `maws-artifact://${artifact.id}/${artifact.revision + 1_000}/index.html`)).status).toBe(404);
  expect((await served(app, `maws-artifact://${artifact.id}/live/%2e%2e/store.sqlite`)).status).toBe(404);

  // The app page loads an artifact's image and font through the scheme (img-src and font-src admit it; a font is a CORS load).
  const font = readFileSync(require.resolve('katex/dist/fonts/KaTeX_Main-Regular.woff2'));
  const upload = (name: string, mime: string, bytes: Buffer) =>
    page.evaluate(
      ([id, n, m, b]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke('artifacts.uploadAsset', { artifactId: id, name: n, mime: m, bytes: new Uint8Array(b as number[]) }),
      [artifact.id, name, mime, [...bytes]] as const,
    ) as Promise<Result<{ ref: string }>>;
  const image = await upload('pixel.png', 'image/png', PIXEL);
  const face = await upload('face.woff2', 'font/woff2', font);
  if (!image.ok || !face.ok) throw new Error('an asset upload failed');
  const loaded = await page.evaluate(
    async ([imageUrl, fontUrl]) => {
      const img = new Image();
      const imageLoaded = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(img.naturalWidth === 1);
        img.onerror = () => resolve(false);
        img.src = imageUrl;
      });
      const fontLoaded = await new FontFace('M7Face', `url(${fontUrl})`).load().then(
        () => true,
        (error: unknown) => String(error),
      );
      return { imageLoaded, fontLoaded };
    },
    [`maws-artifact://${artifact.id}/live/${image.value.ref}`, `maws-artifact://${artifact.id}/live/${face.value.ref}`] as const,
  );
  expect(loaded).toEqual({ imageLoaded: true, fontLoaded: true });

  // The library's Export: a PDF on the page's own page size, a PNG of the asked size, a whole-page PNG by default.
  const pdf = await ok<{ path: string; revision: number }>(page, 'artifacts.export', { artifactId: artifact.id, format: 'pdf' });
  expect(pdf).toEqual({ path: join(profile, 'artifacts', artifact.id, 'exports', `${newer.revision}-pdf.pdf`), revision: newer.revision });
  expect(readFileSync(pdf.path).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const sized = await ok<{ path: string }>(page, 'artifacts.export', { artifactId: artifact.id, format: 'png', width: 640, height: 480 });
  expect(pngSize(readFileSync(sized.path))).toEqual({ width: 640, height: 480 });
  const whole = await ok<{ path: string }>(page, 'artifacts.export', { artifactId: artifact.id, format: 'png' });
  const wholeSize = pngSize(readFileSync(whole.path));
  expect(wholeSize.width).toBe(1280);
  expect(wholeSize.height).toBeGreaterThan(2000); // the page's whole height, not the window's first 800

  // A kind no exporter serves yet is refused, naming it.
  const { artifact: doc } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Notes' });
  const refused = await invoke(page, 'artifacts.export', { artifactId: doc.id, format: 'pdf' });
  expect(refused).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: { reason: 'exportUnavailable', data: { kind: 'document', format: 'pdf' } } } });
});

// M7 fix wave 1 (Decision Log 44a, 44b): the scheme's reach. Only the app's own session and the capture partition serve
// it, never the browser pane's; an artifact frame's XHR to the scheme is refused (its own policy's `connect-src`), its
// navigation to another artifact is prevented (the frame policies) while the app may point it anywhere; and the PDF
// printer refuses a page's remote requests and counts them.
const postTo = (message: string) => `parent.postMessage({ m7: ${JSON.stringify(message)} }, '*')`;

test('maws-artifact: reaches the app and the capture partition only, an artifact frame its own artifact only, and the PDF printer nothing remote', async () => {
  profile = mkdtempSync(join(tmpdir(), 'maws-e2e-artifacts-'));
  launch = await launchMaws({ userData: profile });
  const { app, page } = launch;
  await seamReady(page);
  await hostReady(page);

  // Which sessions serve the scheme.
  const handled = await app.evaluate(({ session }) => ({
    app: session.defaultSession.protocol.isProtocolHandled('maws-artifact'),
    capture: session.fromPartition('maws-capture').protocol.isProtocolHandled('maws-artifact'),
    browser: session.fromPartition('persist:maws-browser').protocol.isProtocolHandled('maws-artifact'),
  }));
  expect(handled).toEqual({ app: true, capture: true, browser: false });

  // Y says it loaded; X says so, tries an XHR to its own page, then navigates itself to Y.
  const create = async (html: string) => {
    const result = (await page.evaluate(
      (text) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke('artifacts.create', { kind: 'html', title: 'Frame', content: { bytes: new TextEncoder().encode(text), name: 'index.html' } }),
      html,
    )) as Result<{ artifact: { id: string } }>;
    if (!result.ok) throw new Error(`artifacts.create failed: ${result.error.message}`);
    return result.value.artifact.id;
  };
  const y = await create(`<!doctype html><script>${postTo('Y')}</script>`);
  const yUrl = `maws-artifact://${y}/live/index.html`;
  const x = await create(
    `<!doctype html><script>${postTo('X')};
    try { const xhr = new XMLHttpRequest(); xhr.open('GET', new URL('index.html', location.href).href); xhr.onload = () => ${postTo('xhr-loaded')}; xhr.onerror = () => ${postTo('xhr-refused')}; xhr.send(); } catch { ${postTo('xhr-refused')}; }
    setTimeout(() => { location.href = ${JSON.stringify(yUrl)}; }, 300);</script>`,
  );
  await page.evaluate((src) => {
    const w = window as unknown as { __m7: string[] };
    w.__m7 = [];
    window.addEventListener('message', (event) => {
      const data = event.data as { m7?: string } | null;
      if (data && typeof data.m7 === 'string') w.__m7.push(data.m7);
    });
    const frame = document.createElement('iframe');
    frame.id = 'm7-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = src;
    document.body.append(frame);
  }, `maws-artifact://${x}/live/index.html`);
  const heard = () => page.evaluate(() => (window as unknown as { __m7: string[] }).__m7);
  await expect.poll(heard, { message: 'X loads and its XHR is refused' }).toEqual(expect.arrayContaining(['X', 'xhr-refused']));
  await page.waitForTimeout(1_500); // X's navigation to Y had its time
  expect(await heard()).not.toContain('Y');
  expect(await heard()).not.toContain('xhr-loaded');
  // The app points its frame at Y: allowed.
  await page.evaluate((src) => void ((document.getElementById('m7-frame') as HTMLIFrameElement).src = src), yUrl);
  await expect.poll(heard, { message: 'the app’s own navigation of the frame to Y' }).toContain('Y');

  // The PDF printer: a page naming remote resources prints, and none of them is fetched.
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(request.url ?? '');
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
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
