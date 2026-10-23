// P4-B5's delivery group (`pnpm e2e:delivery`, MAWS_DELIVERY_E2E=1; the spec skips itself otherwise):
// docs/doperpowers/plans/2026-10-19-p4-smoothing.md P4-B5 and §4.7, acceptance §2 item 8. The built app on scratch
// profiles; nothing here reaches the owner's Notion, Google account, gws or configuration, and no model is called.
//   notion: route D's fixture (the P3-HD scene, support/connector-scene.ts) with a Notion-shaped stdio server beside H's
//          fixture in the scratch user config. The owner starts a session from an HTML page's Connectors sheet (no
//          message, no model), writes a document in the same Space, and sends it from the document's header: the sheet
//          names MAWS's own connection, Send makes exactly one `notion-create-pages` call carrying the document as
//          Notion's enhanced Markdown under its title, from MAWS's own instance of the server (not the engine's), with no
//          session started and no prompt in any journal; the receipt is the sheet's, the header's ("Sent to Notion") and
//          the library row's, and Open in Notion opens the page the server named.
//   drive: the gws CLI's stand-in (support/fake-gws.mjs) on a login-shell PATH the scratch shell home pins. The CLI absent
//          (the sheet says so, offers its install, sends nothing); present and signed out; a refused login, once
//          answered by the CLI and once a login that never ends (0.22.5's, ended by the owner's Cancel), the CLI still
//          signed out and MAWS holding nothing; then the CLI's own login completed and the upload of the document as a
//          Word file under its title, with its receipt.
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURE_SERVER } from './support/connector-engine';
import { expectQuietJournals, sessionJournals } from './support/connector-direct-scene';
import { invoke, value, withScene } from './support/connector-scene';
import { launchMaws } from './support/launch';
import { coldHttpDelivery } from './support/connector-cold-delivery';

test.skip(process.env.MAWS_DELIVERY_E2E !== '1', 'the delivery group runs under MAWS_DELIVERY_E2E=1 (pnpm e2e:delivery)');
test.describe.configure({ timeout: 300_000 });

const NOTION = 'notion';
const FAKE_GWS = join(__dirname, 'support', 'fake-gws.mjs');
const DOC = 'Q3 plan';

// The document in an `artifact` main tab, opened from the library, with the owner's text typed in (a heading, a
// paragraph with bold, a list), saved.
async function writeDocument(page: Page, spaceId?: string): Promise<{ id: string; tab: Locator }> {
  const { artifact } = value(await invoke(page, 'artifacts.create', { kind: 'document', title: DOC, ...(spaceId && { spaceId }) }));
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: DOC, exact: true }).click({ timeout: 15_000 });
  const tab = page.locator(`[data-artifact-tab="${artifact.id}"]`);
  const text = tab.locator('.ds-doc .ProseMirror');
  await expect(text).toBeVisible({ timeout: 15_000 });
  await text.click();
  await page.keyboard.type('# Revenue');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Grew by ten percent.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- Hiring');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Pricing');
  await expect(text.locator('h1')).toHaveText('Revenue');
  await expect(text.locator('li')).toHaveText(['Hiring', 'Pricing']);
  await expect(page.locator('[data-region="main"] [data-header-saved]')).toHaveText('All changes saved', { timeout: 15_000 });
  return { id: artifact.id, tab };
}

const header = (page: Page) => page.locator('[data-region="main"] [data-editor-header]');
const sheetOf = (page: Page) => page.locator('[data-send-to]');
const status = (page: Page) => sheetOf(page).locator('[data-send-to-status]');
const connection = (page: Page) => sheetOf(page).locator('[data-send-to-connection]');

test('notion: the document header’s Send to makes a readable page through MAWS’s own connection, with no session and no turn', async () => {
  const info = test.info();
  await withScene(
    'delivery-notion',
    info,
    async (scene) => {
      const { page } = await scene.launch();
      // a live session in the project, the owner's Start from an HTML page's Connectors sheet (no message, no model)
      const pageId = await scene.createPage(page);
      await scene.openPage(page, pageId);
      const engine = await scene.ownerStart(page);
      const { spaces } = value(await invoke(page, 'spaces.list', undefined));
      const { id } = await writeDocument(page, spaces[0]!.id);
      const live = (await scene.live(page)).map((session) => session.appSessionId).sort();
      const before = scene.calls().length;

      await header(page).getByRole('button', { name: 'Send to…' }).click();
      await expect(sheetOf(page)).toHaveAttribute('data-send-to', 'notion');
      await expect(connection(page)).toHaveText(/Through MAWS’s own connection: “notion” in your user settings\./, { timeout: 30_000 });
      await expect(sheetOf(page).getByText('MAWS sends it itself: no session, no Claude turn.')).toBeVisible();
      await info.attach('notion-sheet', { body: await page.screenshot(), contentType: 'image/png' });
      await sheetOf(page).getByRole('button', { name: 'Send', exact: true }).click();
      await expect(status(page)).toHaveText(`Sent to Notion as “${DOC}”.`, { timeout: 60_000 });
      await info.attach('notion-receipt', { body: await page.screenshot(), contentType: 'image/png' });

      // exactly one page made, the document as Notion's Markdown under its title, by MAWS's own instance
      const after = scene.calls().slice(before).filter((entry) => entry.server === NOTION);
      const made = after.filter((entry) => entry.method === 'tools/call');
      expect(made, 'one notion-create-pages call').toHaveLength(1);
      const call = made[0]! as unknown as { tool: string; pid: number; arguments: { pages: { properties: { title: string }; content: string }[]; allow_async: boolean } };
      expect(call.tool).toBe('notion-create-pages');
      expect(call.arguments.pages).toHaveLength(1);
      expect(call.arguments.pages[0]!.properties).toEqual({ title: DOC });
      expect(call.arguments.pages[0]!.content).toBe('# Revenue\nGrew by ten percent.\n- Hiring\n- Pricing\n');
      expect(call.arguments.allow_async).toBe(false);
      const enginePids = new Set(scene.calls().filter((entry) => entry.server === NOTION && Date.parse(entry.at) < Date.parse(after[0]!.at)).map((entry) => entry.pid));
      expect(enginePids.has(call.pid), 'the call came from MAWS’s own instance, not the engine’s').toBe(false);

      // no session started, no prompt anywhere, the engine as it was
      expect((await scene.live(page)).map((session) => session.appSessionId).sort()).toEqual(live);
      expect(scene.launches(engine.appSessionId).spawns).toBe(1);
      expectQuietJournals(sessionJournals(scene));

      // the receipt: Open in Notion, the header's label, the library row
      await sheetOf(page).getByRole('button', { name: 'Open in Notion' }).click();
      await expect.poll(() => (existsSync(join(scene.root, 'open.log')) ? readFileSync(join(scene.root, 'open.log'), 'utf8') : '')).toMatch(/^openExternal https:\/\/www\.notion\.so\/Fixture-[0-9a-f]{32}$/m);
      await sheetOf(page).getByRole('button', { name: 'Done' }).click();
      await expect(header(page).getByRole('button', { name: 'Sent to Notion' })).toBeVisible();
      await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
      await expect(page.locator(`[data-library] [data-artifact-row="${id}"] [data-part="receipt"]`)).toHaveText(/^Sent to Notion · /);
    },
    {
      servers: (scene) => ({ [NOTION]: { type: 'stdio', command: process.execPath, args: [FIXTURE_SERVER, '--id', NOTION, '--log', scene.log, '--tools', JSON.stringify(['notion-create-pages']), '--mode', 'notion'] } }),
      env: (scene) => ({ MAWS_E2E_OPEN_LOG: join(scene.root, 'open.log') }),
    },
  );
});

// WR 76/78: the real built host and SDK, with no engine/session or synthetic observation. The test supplies loopback
// hosts only to the private host command, leaving SendToSheet's production Notion allowlist untouched.
test('notion cold HTTP: the built host locates user/app settings and sends once per source without a session', async () => {
  await coldHttpDelivery(test.info());
});

// ── Drive through the gws stand-in ──

interface GwsScratch {
  root: string;
  bin: string; // on the login shell's PATH; holds `node`, and `gws` once installed
  state: string; // the stand-in's FAKE_GWS_DIR
  openLog: string;
}

function gwsScratch(): GwsScratch {
  const root = mkdtempSync(join(tmpdir(), 'maws-delivery-gws-'));
  const scratch = { root, bin: join(root, 'bin'), state: join(root, 'gws-state'), openLog: join(root, 'open.log') };
  for (const dir of [scratch.bin, scratch.state]) mkdirSync(dir);
  symlinkSync(process.execPath, join(scratch.bin, 'node')); // the stand-in is a Node script, as the npm shim is
  writeFileSync(join(scratch.state, 'state.json'), JSON.stringify({ client: true, signedIn: false, refusal: 'exit' }));
  return scratch;
}
const gwsState = (scratch: GwsScratch, patch: Record<string, unknown>) => {
  const file = join(scratch.state, 'state.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...patch }));
};
const gwsRuns = (scratch: GwsScratch) => {
  const log = join(scratch.state, 'log.jsonl');
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { argv: string[]; pid: number; ppid: number; envKeys: string[]; upload?: { path: string; size: number }; contentType?: string; json?: { name?: string } }) : [];
};
const sh = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;

// The sign-in URL the app opened (the e2e's opener log), and its listener's address.
async function signInUrl(scratch: GwsScratch, nth: number): Promise<URL> {
  let url: URL | null = null;
  await expect
    .poll(() => {
      const lines = existsSync(scratch.openLog) ? readFileSync(scratch.openLog, 'utf8').split('\n').filter((line) => line.startsWith('openExternal https://accounts.google.com/')) : [];
      url = lines[nth] ? new URL(lines[nth].slice('openExternal '.length)) : null;
      return url !== null;
    }, { timeout: 30_000, message: `the app opened sign-in URL ${nth + 1}` })
    .toBe(true);
  return url!;
}
const callback = (url: URL, query: string) => fetch(`${decodeURIComponent(url.searchParams.get('redirect_uri')!)}/?${query}`).then((response) => response.status);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('drive: gws absent, a refused login and a cancelled one leave it signed out with nothing kept by MAWS; its own login, then the upload', async () => {
  const info = test.info();
  const scratch = gwsScratch();
  const maws = await launchMaws({
    env: { MAWS_HARNESS: '0', MAWS_E2E_OPEN_LOG: scratch.openLog },
    prepare: ({ shellHome }) => {
      // the login shell's PATH holds the scratch bin and the system's alone, so no real gws is ever found
      const profile = `export PATH=${sh(scratch.bin)}:/usr/bin:/bin:/usr/sbin:/sbin\nexport FAKE_GWS_DIR=${sh(scratch.state)}\n`;
      for (const file of ['.zshrc', '.bash_profile']) appendFileSync(join(shellHome, file), profile);
    },
  });
  try {
    const { page } = maws;
    await writeDocument(page);
    await header(page).getByRole('button', { name: 'Send to…' }).click();
    await sheetOf(page).getByRole('radio', { name: 'Google Drive' }).click();
    await expect(sheetOf(page)).toHaveAttribute('data-send-to', 'drive');

    await test.step('absent: the sheet says so and offers its install; nothing is sent', async () => {
      await expect(connection(page)).toHaveAttribute('data-send-to-connection', 'absent', { timeout: 30_000 });
      await expect(connection(page)).toContainText('which isn’t installed');
      await expect(connection(page)).toContainText('npm install -g @googleworkspace/cli');
      await expect(connection(page).getByRole('button', { name: 'Install in Terminal' })).toBeVisible();
      await expect(sheetOf(page).getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
      await info.attach('drive-absent', { body: await page.screenshot(), contentType: 'image/png' });
      expect(gwsRuns(scratch)).toEqual([]);
    });

    await test.step('installed, signed out: the CLI’s own login is offered', async () => {
      symlinkSync(FAKE_GWS, join(scratch.bin, 'gws'));
      chmodSync(FAKE_GWS, 0o755);
      await connection(page).getByRole('button', { name: 'Check again' }).click();
      await expect(connection(page)).toHaveAttribute('data-send-to-connection', 'signedOut', { timeout: 30_000 });
      await expect(connection(page).getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    });

    await test.step('a refused login the CLI answers: said, still signed out', async () => {
      await connection(page).getByRole('button', { name: 'Sign in with Google' }).click();
      const url = await signInUrl(scratch, 0);
      expect(url.hostname).toBe('accounts.google.com');
      await callback(url, 'error=access_denied').catch(() => 0); // the stand-in drops the connection and exits 2, as the proxy path does
      await expect(status(page)).toHaveText(/^The sign-in was refused\./, { timeout: 30_000 });
      await expect(connection(page)).toHaveAttribute('data-send-to-connection', 'signedOut');
      await info.attach('drive-refused', { body: await page.screenshot(), contentType: 'image/png' });
    });

    await test.step('a refused login that never ends (0.22.5’s): the owner’s Cancel ends the CLI’s login', async () => {
      gwsState(scratch, { refusal: 'hang' });
      await connection(page).getByRole('button', { name: 'Sign in with Google' }).click();
      const url = await signInUrl(scratch, 1);
      expect(await callback(url, 'error=access_denied')).toBe(400); // "No `code` in URL", and the login keeps waiting
      await expect(connection(page)).toHaveText(/Finish signing in in your browser\. If you declined, cancel here\./);
      const login = gwsRuns(scratch).filter((run) => run.argv[0] === 'auth' && run.argv[1] === 'login').at(-1)!;
      expect(login.argv).toEqual(['auth', 'login', '-s', 'drive']);
      expect(alive(login.pid)).toBe(true);
      await sheetOf(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(sheetOf(page)).toHaveCount(0);
      await expect.poll(() => alive(login.pid) || alive(login.ppid), { timeout: 15_000, message: 'the login process group is gone' }).toBe(false);
      expect(JSON.parse(readFileSync(join(scratch.state, 'state.json'), 'utf8'))).toMatchObject({ signedIn: false });
    });

    await test.step('its own login completed, then the upload', async () => {
      gwsState(scratch, { refusal: 'exit' });
      await header(page).getByRole('button', { name: 'Send to…' }).click();
      await sheetOf(page).getByRole('radio', { name: 'Google Drive' }).click();
      await expect(connection(page)).toHaveAttribute('data-send-to-connection', 'signedOut', { timeout: 30_000 });
      await connection(page).getByRole('button', { name: 'Sign in with Google' }).click();
      expect(await callback(await signInUrl(scratch, 2), 'code=granted')).toBe(200);
      await expect(connection(page)).toHaveAttribute('data-send-to-connection', 'ready', { timeout: 30_000 });
      await expect(sheetOf(page).getByRole('combobox', { name: 'Format' })).toHaveValue('docx');
      await sheetOf(page).getByRole('button', { name: 'Send', exact: true }).click();
      await expect(status(page)).toHaveText(`Sent to Google Drive as “${DOC}.docx”.`, { timeout: 60_000 });
      await info.attach('drive-receipt', { body: await page.screenshot(), contentType: 'image/png' });
      const upload = gwsRuns(scratch).filter((run) => run.upload).at(-1)!;
      expect(upload.json?.name).toBe(`${DOC}.docx`);
      expect(upload.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(upload.upload!.size).toBeGreaterThan(1_000);
      expect(upload.envKeys, 'the upload never falls through to application-default credentials').toContain('GOOGLE_APPLICATION_CREDENTIALS');
      await sheetOf(page).getByRole('button', { name: 'Done' }).click();
      await expect(header(page).getByRole('button', { name: 'Sent to Google Drive' })).toBeVisible();
    });

    await test.step('MAWS kept nothing of the sign-in: the CLI’s own state holds it', async () => {
      expect(JSON.parse(readFileSync(join(scratch.state, 'state.json'), 'utf8'))).toMatchObject({ signedIn: true });
      // MAWS's own files under its user data (Chromium's caches and storage are the page's, not MAWS's records)
      const CHROMIUM = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage', 'Local Storage', 'Session Storage', 'IndexedDB', 'Shared Dictionary', 'Network', 'Crashpad', 'shell-home']);
      const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (CHROMIUM.has(entry.name) ? [] : entry.isDirectory() ? files(join(dir, entry.name)) : entry.isFile() ? [join(dir, entry.name)] : []));
      const account = JSON.parse(readFileSync(join(scratch.state, 'state.json'), 'utf8')).user as string;
      const holding = files(maws.userData).filter((file) => statSync(file).size < 50_000_000 && readFileSync(file).includes(account));
      expect(holding, 'no MAWS file names the Google account').toEqual([]);
      expect(execFileSync('ls', [scratch.state]).toString().split('\n').filter(Boolean).sort()).toEqual(['log.jsonl', 'state.json']);
    });
  } finally {
    await maws.cleanup();
    rmSync(scratch.root, { recursive: true, force: true });
  }
});
