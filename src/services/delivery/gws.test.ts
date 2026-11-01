// Send to Google Drive's `gws` driver (gws.ts): the status mapping from literal `gws auth status` output, then real
// child processes against e2e/support/fake-gws.mjs, each test in its own scratch PATH, HOME and fake state. The PATH
// holds the fake as `gws` and a link to this `node`, never the directory of the owner's real CLI.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findGws, gwsLogin, gwsStateFromStatus, gwsUpload, NO_ADC, readGwsState } from './gws';

const FAKE = fileURLToPath(new URL('../../../e2e/support/fake-gws.mjs', import.meta.url));
const DRIVE = 'https://www.googleapis.com/auth/drive';
const IDENTITY = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
const WAIT = { timeout: 15_000, interval: 25 };

let root: string;
let binDir: string;
let nodeDir: string;
let home: string;
let fakeDir: string;
let bin: string;
let env: Record<string, string>;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-gws-'))); // /var is /private/var: the fake logs real paths
  binDir = join(root, 'bin');
  nodeDir = join(root, 'node-bin');
  home = join(root, 'home');
  fakeDir = join(root, 'fake');
  for (const dir of [binDir, nodeDir, home, fakeDir]) mkdirSync(dir);
  bin = join(binDir, 'gws');
  symlinkSync(FAKE, bin);
  symlinkSync(process.execPath, join(nodeDir, 'node'));
  env = { PATH: `${binDir}:${nodeDir}`, HOME: home, FAKE_GWS_DIR: fakeDir };
});
afterEach(() => {
  const pids = runs().flatMap((run) => [run.pid, run.ppid]);
  for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL'); // a failed test's leftovers
  expect(pids.filter(alive)).toEqual([]);
  expect(readdirSync(home)).toEqual([]); // neither the module nor the fake writes under HOME
  rmSync(root, { recursive: true, force: true });
});

interface FakeRun {
  argv: string[];
  cwd: string;
  pid: number;
  ppid: number;
  envKeys: string[];
  upload?: { path: string; size: number; sha256: string };
  contentType?: string;
  json?: unknown;
  params?: unknown;
}
const runs = (): FakeRun[] => {
  const log = join(fakeDir, 'log.jsonl');
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as FakeRun) : [];
};
const fakeState = (state: Record<string, unknown>) => writeFileSync(join(fakeDir, 'state.json'), JSON.stringify(state));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// A shell stand-in for the CLI, for output the fake never prints.
const standIn = (name: string, script: string) => {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
};
const opener = () => {
  const urls: string[] = [];
  let first!: (url: string) => void;
  const opened = new Promise<string>((resolve) => (first = resolve));
  const openUrl = (url: string) => {
    urls.push(url);
    first(url);
  };
  return { urls, opened, openUrl };
};
// The browser's redirect back to the CLI's listener (bound to 127.0.0.1; the URL names localhost).
const redirectBack = (authUrl: string, query: string) => {
  const redirect = new URL(new URL(authUrl).searchParams.get('redirect_uri') ?? '');
  expect(redirect.hostname).toBe('localhost');
  return fetch(`http://127.0.0.1:${redirect.port}/?${query}`);
};

describe('gwsStateFromStatus maps `gws auth status` by its field rules', () => {
  // The owner's machine on 2026-10-19 (0.22.5): a client configured, never logged in.
  const PRESENT_SIGNED_OUT = `{
  "auth_method": "none",
  "client_config": "/Users/owner/.config/gws/client_secret.json",
  "client_config_exists": true,
  "config_client_id": "10164181....com",
  "credential_source": "client_secret.json",
  "enabled_api_count": 2,
  "enabled_apis": [
    "drive.googleapis.com",
    "gmail.googleapis.com"
  ],
  "encrypted_credentials": "/Users/owner/.config/gws/credentials.enc",
  "encrypted_credentials_exists": false,
  "keyring_backend": "keyring",
  "plain_credentials": "/Users/owner/.config/gws/credentials.json",
  "plain_credentials_exists": false,
  "project_id": "gws-testing",
  "storage": "none",
  "token_cache_exists": false
}
`;
  const SIGNED_IN = {
    auth_method: 'oauth2',
    client_config_exists: true,
    client_id: '10164181....com',
    credential_source: 'client_secret.json',
    encrypted_credentials_exists: true,
    encryption_valid: true,
    has_refresh_token: true,
    storage: 'encrypted',
    token_cache_exists: true,
  };
  const status = (fields: Record<string, unknown>) => JSON.stringify(fields, null, 2);

  it('a client and no saved sign-in is signedOut (the owner today)', () => {
    expect(gwsStateFromStatus(PRESENT_SIGNED_OUT)).toEqual({ state: 'signedOut' });
    expect(gwsStateFromStatus(status({ auth_method: 'none', storage: 'none', client_config_exists: false, credential_source: 'environment_variables' }))).toEqual({ state: 'signedOut' });
  });

  it('no client and no saved sign-in is needsSetup, an unreadable client file included', () => {
    expect(gwsStateFromStatus(status({ auth_method: 'none', storage: 'none', client_config_exists: false, credential_source: 'none' }))).toEqual({ state: 'needsSetup' });
    expect(gwsStateFromStatus(status({ auth_method: 'none', client_config_exists: true, client_config_error: 'missing field `installed`', credential_source: 'none' }))).toEqual({ state: 'needsSetup' });
  });

  it('a token in the environment is ready whatever else is saved', () => {
    expect(gwsStateFromStatus(status({ auth_method: 'none', credential_source: 'token_env_var', token_env_var: true }))).toEqual({ state: 'ready' });
    expect(gwsStateFromStatus(status({ ...SIGNED_IN, credential_source: 'token_env_var', token_env_var: true, token_valid: true, scopes: ['openid'] }))).toEqual({ state: 'ready' });
  });

  it('a saved sign-in the CLI cannot decrypt is expired (P4-B5: its next call would delete it and fall through)', () => {
    expect(gwsStateFromStatus(status({ ...SIGNED_IN, encryption_valid: false, encryption_error: 'Could not decrypt. May have been created on a different machine.' }))).toEqual({ state: 'expired', message: 'Could not decrypt. May have been created on a different machine.' });
  });

  it('a saved sign-in the token endpoint refused is expired, with its error when it gave one', () => {
    expect(gwsStateFromStatus(status({ ...SIGNED_IN, token_valid: false, token_error: 'Token has been expired or revoked.' }))).toEqual({ state: 'expired', message: 'Token has been expired or revoked.' });
    expect(gwsStateFromStatus(status({ ...SIGNED_IN, token_valid: false }))).toEqual({ state: 'expired' });
  });

  it('a valid sign-in is ready when a granted scope is drive or drive.file, else noDrive', () => {
    const signedIn = (scopes: string[]) => status({ ...SIGNED_IN, token_valid: true, user: 'owner@example.com', scopes, scope_count: scopes.length });
    expect(gwsStateFromStatus(signedIn([DRIVE, ...IDENTITY]))).toEqual({ state: 'ready', user: 'owner@example.com', scopes: [DRIVE, ...IDENTITY] });
    expect(gwsStateFromStatus(signedIn([`${DRIVE}.file`]))).toEqual({ state: 'ready', user: 'owner@example.com', scopes: [`${DRIVE}.file`] });
    const without = [`${DRIVE}.readonly`, 'https://www.googleapis.com/auth/gmail.modify', ...IDENTITY];
    expect(gwsStateFromStatus(signedIn(without))).toEqual({ state: 'noDrive', user: 'owner@example.com', scopes: without });
  });

  it('a saved sign-in whose scopes the CLI could not learn is ready with what it did learn', () => {
    expect(gwsStateFromStatus(status(SIGNED_IN))).toEqual({ state: 'ready' }); // the token endpoint unreachable
    expect(gwsStateFromStatus(status({ ...SIGNED_IN, token_valid: true, user: 'owner@example.com' }))).toEqual({ state: 'ready', user: 'owner@example.com' }); // tokeninfo failed
    expect(gwsStateFromStatus(status({ ...SIGNED_IN, credential_source: 'none', token_valid: true, scopes: [DRIVE] }))).toEqual({ state: 'ready', scopes: [DRIVE] }); // the client file removed after login
  });

  it('takes the outermost object after noise lines, braces inside strings and all', () => {
    const noisy = `gws binary not found at /x/bin/gws\nAuto-installing... {\n${status({ ...SIGNED_IN, token_valid: false, token_error: 'bad } {grant' })}\ntrailing\n`;
    expect(gwsStateFromStatus(noisy)).toEqual({ state: 'expired', message: 'bad } {grant' });
  });

  it('anything else is failed unreadable', () => {
    for (const text of ['', 'not json', '[1, 2]', '{"auth_method": "none"}', '{"auth_method": "service_account", "credential_source": "none"}', '{ "auth_method": "none", ']) {
      expect(gwsStateFromStatus(text)).toMatchObject({ state: 'failed', why: 'unreadable' });
    }
  });
});

describe('the gws driver against the fake CLI', { timeout: 60_000 }, () => {
  describe('findGws', () => {
    it('answers the first executable gws on the PATH, past empty, relative, non-executable and directory entries', async () => {
      const plain = join(root, 'plain');
      const dirs = join(root, 'dirs');
      mkdirSync(plain);
      mkdirSync(join(dirs, 'gws'), { recursive: true });
      writeFileSync(join(plain, 'gws'), '#!/bin/sh\n');
      expect(await findGws({ PATH: `:relative:${plain}:${dirs}:${binDir}:${nodeDir}` })).toBe(bin);
    });

    it('answers null when no gws is on the PATH', async () => {
      expect(await findGws({ PATH: `${nodeDir}:${root}` })).toBeNull();
      expect(await findGws({})).toBeNull();
    });
  });

  describe('readGwsState', () => {
    it('reads each state through the CLI, under exactly the given environment', async () => {
      const read = () => readGwsState(bin, env);
      fakeState({ client: false, signedIn: false });
      expect(await read()).toEqual({ state: 'needsSetup' });
      fakeState({ client: true, signedIn: false });
      expect(await read()).toEqual({ state: 'signedOut' });
      fakeState({ client: true, signedIn: true, user: 'owner@example.com' });
      expect(await read()).toEqual({ state: 'ready', user: 'owner@example.com', scopes: [DRIVE, ...IDENTITY] });
      fakeState({ client: true, signedIn: true, user: 'owner@example.com', scopes: [`${DRIVE}.readonly`, ...IDENTITY] });
      expect(await read()).toEqual({ state: 'noDrive', user: 'owner@example.com', scopes: [`${DRIVE}.readonly`, ...IDENTITY] });
      fakeState({ client: true, signedIn: true, tokenValid: false });
      expect(await read()).toEqual({ state: 'expired', message: 'Token has been expired or revoked.' });
      fakeState({ client: false, signedIn: false });
      expect(await readGwsState(bin, { ...env, GOOGLE_WORKSPACE_CLI_TOKEN: 'ya29.test' })).toEqual({ state: 'ready' });
      const all = runs();
      expect(all.map((run) => run.argv)).toEqual(Array(6).fill(['auth', 'status']));
      expect(all[0].envKeys).toEqual(Object.keys(env).sort());
    });

    it('a status that outlives its timeout is failed timeout, the CLI stopped', async () => {
      fakeState({ signedIn: false, statusDelayMs: 30_000 });
      expect(await readGwsState(bin, env, { timeoutMs: 1_500 })).toEqual({ state: 'failed', why: 'timeout' });
      expect(runs().flatMap((run) => [run.pid, run.ppid]).filter(alive)).toEqual([]);
    });

    it('an aborted read rejects with the abort, the CLI stopped', async () => {
      fakeState({ signedIn: false, statusDelayMs: 30_000 });
      const controller = new AbortController();
      const read = readGwsState(bin, env, { signal: controller.signal });
      await vi.waitFor(() => expect(runs()).toHaveLength(1), WAIT);
      controller.abort();
      await expect(read).rejects.toMatchObject({ name: 'AbortError' });
      const [run] = runs();
      expect([run.pid, run.ppid].filter(alive)).toEqual([]);
    });

    it('a CLI that cannot start is failed spawn', async () => {
      expect(await readGwsState(join(root, 'nowhere', 'gws'), env)).toMatchObject({ state: 'failed', why: 'spawn', message: expect.stringContaining('ENOENT') });
      const unexecutable = join(root, 'gws-text');
      writeFileSync(unexecutable, '#!/bin/sh\n');
      expect(await readGwsState(unexecutable, env)).toMatchObject({ state: 'failed', why: 'spawn', message: expect.stringContaining('EACCES') });
    });

    it('a status with no JSON, or a failing one, is failed unreadable with the CLI’s words', async () => {
      expect(await readGwsState(standIn('chatty', 'echo hello'), env)).toEqual({ state: 'failed', why: 'unreadable', message: 'gws auth status printed no JSON object' });
      const failing = standIn('failing', `printf '%s\\n' '{' '  "error": {' '    "code": 500,' '    "message": "keyring unavailable",' '    "reason": "internalError"' '  }' '}'\nexit 5`);
      expect(await readGwsState(failing, env)).toEqual({ state: 'failed', why: 'unreadable', message: 'keyring unavailable' });
      const noNode = standIn('no-node', `echo 'env: node: No such file or directory' >&2\nexit 127`);
      expect(await readGwsState(noNode, env)).toEqual({ state: 'failed', why: 'unreadable', message: 'env: node: No such file or directory' });
    });
  });

  describe('gwsLogin', () => {
    it('opens the one Google URL the CLI printed; the browser’s code signs in (-s drive by default)', async () => {
      const browser = opener();
      const login = gwsLogin(bin, env, { openUrl: browser.openUrl, signal: new AbortController().signal });
      const url = await browser.opened;
      const parsed = new URL(url);
      expect([parsed.protocol, parsed.host, parsed.pathname]).toEqual(['https:', 'accounts.google.com', '/o/oauth2/auth']);
      expect(parsed.searchParams.get('scope')).toBe([DRIVE, ...IDENTITY].join(' '));
      const answer = await redirectBack(url, 'code=x&scope=drive');
      expect(answer.status).toBe(200);
      expect(await login).toEqual({ ok: true, account: 'owner@example.com' });
      expect(browser.urls).toEqual([url]);
      expect(runs()[0]).toMatchObject({ argv: ['auth', 'login', '-s', 'drive'], envKeys: Object.keys(env).sort() });
      expect(await readGwsState(bin, env)).toEqual({ state: 'ready', user: 'owner@example.com', scopes: [DRIVE, ...IDENTITY] });
    });

    it('passes given scopes verbatim with --scopes', async () => {
      const browser = opener();
      const login = gwsLogin(bin, env, { scopes: [`${DRIVE}.file`], openUrl: browser.openUrl, signal: new AbortController().signal });
      await redirectBack(await browser.opened, 'code=x');
      expect(await login).toEqual({ ok: true, account: 'owner@example.com' });
      expect(runs()[0].argv).toEqual(['auth', 'login', '--scopes', `${DRIVE}.file`]);
      expect(JSON.parse(readFileSync(join(fakeDir, 'state.json'), 'utf8'))).toMatchObject({ signedIn: true, scopes: [`${DRIVE}.file`, ...IDENTITY] });
    });

    it('a refused consent keeps 0.22.5 waiting until the owner cancels: the CLI is gone, nothing signed in', async () => {
      const controller = new AbortController();
      const browser = opener();
      const login = gwsLogin(bin, env, { openUrl: browser.openUrl, signal: controller.signal });
      const answer = await redirectBack(await browser.opened, 'error=access_denied');
      expect(answer.status).toBe(400);
      expect(await answer.text()).toBe('No `code` in URL');
      await sleep(500);
      const [run] = runs();
      expect([run.pid, run.ppid].filter(alive)).toEqual([run.pid, run.ppid]); // still waiting
      controller.abort();
      expect(await login).toEqual({ ok: false, why: 'cancelled' });
      expect([run.pid, run.ppid].filter(alive)).toEqual([]);
      expect(browser.urls).toHaveLength(1);
      expect(await readGwsState(bin, env)).toEqual({ state: 'signedOut' });
    });

    it('a refused consent ends at the deadline, the CLI gone', async () => {
      const browser = opener();
      const login = gwsLogin(bin, env, { openUrl: browser.openUrl, signal: new AbortController().signal, deadlineMs: 4_000 });
      const first = await Promise.race([browser.opened, login.then(() => null)]);
      if (first !== null) await redirectBack(first, 'error=access_denied').catch(() => undefined); // a loaded machine may print it late
      expect(await login).toEqual({ ok: false, why: 'timeout' });
      expect(runs().flatMap((run) => [run.pid, run.ppid]).filter(alive)).toEqual([]);
    });

    it('a refusal the CLI ends itself (exit 2 after the URL, here printed on stdout) is refused', async () => {
      fakeState({ refusal: 'exit' });
      const browser = opener();
      const login = gwsLogin(bin, env, { openUrl: browser.openUrl, signal: new AbortController().signal });
      const url = await browser.opened;
      expect(new URL(url).searchParams.get('prompt')).toBe('select_account consent');
      await redirectBack(url, 'error=access_denied').catch(() => undefined); // it drops the connection unanswered
      expect(await login).toEqual({ ok: false, why: 'refused', message: 'No authorization code in callback' });
    });

    it('a CLI with no OAuth client fails before any URL', async () => {
      fakeState({ client: false });
      const browser = opener();
      expect(await gwsLogin(bin, env, { openUrl: browser.openUrl, signal: new AbortController().signal })).toMatchObject({ ok: false, why: 'failed', message: expect.stringMatching(/^No OAuth client configured\. Either: 1\. Run `gws auth setup`/) });
      expect(browser.urls).toEqual([]);
    });

    it('never opens anything but a whole https://accounts.google.com/ URL, and opens it once', async () => {
      const real = 'https://accounts.google.com/o/oauth2/auth?scope=openid&redirect_uri=http%3A%2F%2Flocalhost%3A1&client_id=1';
      const lookalikes = [
        'https://accounts.google.com.evil.example/o/oauth2/auth?x=1',
        'http://accounts.google.com/o/oauth2/auth?x=2',
        'https://evil.example/next=https://accounts.google.com/o/oauth2/auth?x=3',
        'https://accounts.google.com:8443/o/oauth2/auth?x=4',
        'https://user@accounts.google.com/o/oauth2/auth?x=5',
      ];
      const authError = `printf '%s\\n' '{"error":{"code":401,"message":"No authorization code in callback","reason":"authError"}}'\nexit 2`;
      const lines = [...lookalikes, `  ${real}`, `  ${real}&again=1`].map((line) => `'${line}'`).join(' ');
      const mixed = standIn('mixed', `printf '%s\\n' ${lines} >&2\n${authError}`);
      const browser = opener();
      expect(await gwsLogin(mixed, env, { openUrl: browser.openUrl, signal: new AbortController().signal })).toEqual({ ok: false, why: 'refused', message: 'No authorization code in callback' });
      expect(browser.urls).toEqual([real]);

      const elsewhere = standIn('elsewhere', `printf '%s\\n' ${lookalikes.map((line) => `'${line}'`).join(' ')} >&2\n${authError}`);
      const none = opener();
      expect(await gwsLogin(elsewhere, env, { openUrl: none.openUrl, signal: new AbortController().signal })).toEqual({ ok: false, why: 'failed', message: 'No authorization code in callback' });
      expect(none.urls).toEqual([]);

      // a URL split across two writes is opened whole, once its line ends
      const split = standIn('split', `printf '%s' '  ${real.slice(0, 40)}' >&2\n/bin/sleep 0.3\nprintf '%s\\n' '${real.slice(40)}' >&2\nexit 2`);
      const whole = opener();
      expect(await gwsLogin(split, env, { openUrl: whole.openUrl, signal: new AbortController().signal })).toMatchObject({ ok: false, why: 'refused' });
      expect(whole.urls).toEqual([real]);
    });

    it('an openUrl that throws stops the login', async () => {
      const result = await gwsLogin(bin, env, {
        openUrl: () => {
          throw new Error('no browser');
        },
        signal: new AbortController().signal,
      });
      expect(result).toEqual({ ok: false, why: 'failed', message: 'could not open the sign-in page: no browser' });
    });

    it('an openUrl that rejects stops the login', async () => {
      const result = await gwsLogin(bin, env, { openUrl: async () => Promise.reject(new Error('no client')), signal: new AbortController().signal });
      expect(result).toEqual({ ok: false, why: 'failed', message: 'could not open the sign-in page: no client' });
    });

    it('an already-aborted signal starts nothing', async () => {
      const controller = new AbortController();
      controller.abort();
      expect(await gwsLogin(bin, env, { openUrl: () => undefined, signal: controller.signal })).toEqual({ ok: false, why: 'cancelled' });
      expect(runs()).toEqual([]);
    });
  });

  describe('gwsUpload', () => {
    let exportDir: string;
    let file: string;
    let bytes: Buffer;
    beforeEach(() => {
      exportDir = join(root, 'export');
      mkdirSync(exportDir);
      file = join(exportDir, 'Report Q3.pdf');
      bytes = randomBytes(64 * 1024);
      writeFileSync(file, bytes);
    });
    const upload = (opts: { parent?: string; signal?: AbortSignal; timeoutMs?: number } = {}) =>
      gwsUpload(bin, env, { file, name: 'Quarterly report.pdf', mime: 'application/pdf', signal: opts.signal ?? new AbortController().signal, parent: opts.parent, timeoutMs: opts.timeoutMs });

    it('uploads the file from its own directory by its bare name, and answers the file’s id, name and link', async () => {
      fakeState({ signedIn: true });
      const result = await upload({ parent: 'folder-1' });
      expect(result).toMatchObject({ ok: true, name: 'Quarterly report.pdf' });
      const id = result.ok ? result.id : '';
      expect(result).toEqual({ ok: true, id, name: 'Quarterly report.pdf', link: `https://drive.google.com/file/d/${id}/view` });
      const [run] = runs();
      expect(run).toMatchObject({
        argv: ['drive', 'files', 'create', '--json', expect.any(String), '--upload', 'Report Q3.pdf', '--upload-content-type', 'application/pdf', '--params', expect.any(String)],
        cwd: exportDir,
        upload: { path: 'Report Q3.pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
        contentType: 'application/pdf',
        json: { name: 'Quarterly report.pdf', parents: ['folder-1'] },
        params: { fields: 'id,name,webViewLink', supportsAllDrives: true },
        envKeys: [...Object.keys(env), 'GOOGLE_APPLICATION_CREDENTIALS'].sort(), // P4-B5: NO_ADC beside the owner's environment
      });

      expect(await upload()).toMatchObject({ ok: true });
      expect(runs()[1].json).toEqual({ name: 'Quarterly report.pdf' }); // no parent: My Drive's root

      // a link elsewhere is uploaded from its target's directory, which the CLI's containment check resolves to
      mkdirSync(join(root, 'links'));
      const link = join(root, 'links', 'link.pdf');
      symlinkSync(file, link);
      expect(await gwsUpload(bin, env, { file: link, name: 'Linked.pdf', mime: 'application/pdf', signal: new AbortController().signal })).toMatchObject({ ok: true, name: 'Linked.pdf' });
      expect(runs()[2]).toMatchObject({ cwd: exportDir, upload: { path: 'Report Q3.pdf', size: bytes.length } });
    });

    it('the fake refuses an --upload path outside its working directory, as the CLI does', () => {
      fakeState({ signedIn: true });
      const outside = spawnSync(bin, ['drive', 'files', 'create', '--json', '{}', '--upload', '../export/../outside.pdf'], { cwd: exportDir, env, encoding: 'utf8' });
      expect(outside.status).toBe(3);
      expect(JSON.parse(outside.stdout)).toEqual({
        error: { code: 400, message: `--upload '../export/../outside.pdf' resolves to '${join(root, 'outside.pdf')}' which is outside the current directory`, reason: 'validationError' },
      });
    });

    it('maps the CLI’s failures: signed out or expired is auth, a missing folder notFound, no Drive scope forbidden', async () => {
      fakeState({ signedIn: false });
      // P4-B5: past the CLI's own sign-in its chain stops at the absent application-default file MAWS names (NO_ADC)
      expect(await upload()).toEqual({ ok: false, why: 'auth', message: `Authentication failed: GOOGLE_APPLICATION_CREDENTIALS points to ${NO_ADC}, but file does not exist` });
      fakeState({ signedIn: true, tokenValid: false });
      expect(await upload()).toEqual({ ok: false, why: 'auth', message: expect.stringMatching(/^Authentication failed: /) });
      fakeState({ signedIn: true });
      expect(await upload({ parent: 'missing-folder' })).toEqual({ ok: false, why: 'notFound', message: 'File not found: missing-folder.' });
      fakeState({ signedIn: true, scopes: [`${DRIVE}.readonly`, ...IDENTITY] });
      expect(await upload()).toEqual({ ok: false, why: 'forbidden', message: 'Request had insufficient authentication scopes.' });
    });

    // P4-B5: a signed-out CLI whose machine has gcloud's application-default credentials (the MacBook's service account)
    // would upload as that identity; the upload's NO_ADC makes it an auth error instead
    it('a signed-out upload never falls through to application-default credentials', async () => {
      fakeState({ signedIn: false, adc: true });
      expect(await upload()).toMatchObject({ ok: false, why: 'auth' });
      const ran = spawnSync(bin, ['drive', 'files', 'create', '--json', '{"name":"x.pdf"}', '--upload', 'Report Q3.pdf', '--params', '{}'], { cwd: exportDir, env: { ...env }, encoding: 'utf8' });
      expect(ran.status).toBe(0); // the fake's own chain does reach it without the guard
      expect(JSON.parse(ran.stdout)).toMatchObject({ owner: 'adc' });
    });

    // P4-B5 review: GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE outranks the CLI's own sign-in and its identity is never named
    // by the status; every run is handed the environment without it, so the state and the upload are the sign-in's
    it('a credentials-file override in the owner’s environment never steers the state or the upload', async () => {
      const file = join(root, 'service-account.json');
      writeFileSync(file, JSON.stringify({ type: 'service_account', client_email: 'robot@example.iam.gserviceaccount.com' }));
      const overridden = { ...env, GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: file };
      fakeState({ signedIn: false });
      expect(await readGwsState(bin, overridden)).toEqual({ state: 'signedOut' });
      expect(await gwsUpload(bin, overridden, { file: join(exportDir, 'Report Q3.pdf'), name: 'x.pdf', mime: 'application/pdf', signal: new AbortController().signal })).toMatchObject({ ok: false, why: 'auth' });
      expect(runs().every((run) => !run.envKeys.includes('GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE'))).toBe(true);
      const ran = spawnSync(bin, ['drive', 'files', 'create', '--json', '{"name":"x.pdf"}', '--upload', 'Report Q3.pdf', '--params', '{}'], { cwd: exportDir, env: overridden, encoding: 'utf8' });
      expect(JSON.parse(ran.stdout)).toMatchObject({ owner: 'credentials-file' }); // the fake's chain does take it, unguarded
    });

    it('a cancelled upload stops the CLI before it answers', async () => {
      fakeState({ signedIn: true, uploadDelayMs: 30_000 });
      const controller = new AbortController();
      const pending = upload({ signal: controller.signal });
      await vi.waitFor(() => expect(runs()[0]?.upload).toBeDefined(), WAIT);
      controller.abort();
      expect(await pending).toEqual({ ok: false, why: 'cancelled' });
      const [run] = runs();
      expect([run.pid, run.ppid].filter(alive)).toEqual([]);
    });

    it('an upload past its timeout is timeout, the CLI stopped', async () => {
      fakeState({ signedIn: true, uploadDelayMs: 30_000 });
      expect(await upload({ timeoutMs: 1_500 })).toEqual({ ok: false, why: 'timeout' });
      expect(runs().flatMap((run) => [run.pid, run.ppid]).filter(alive)).toEqual([]);
    });

    it('refuses a relative or missing file without running the CLI', async () => {
      const signal = new AbortController().signal;
      expect(await gwsUpload(bin, env, { file: 'Report Q3.pdf', name: 'x', mime: 'application/pdf', signal })).toMatchObject({ ok: false, why: 'invalid' });
      expect(await gwsUpload(bin, env, { file: join(exportDir, 'gone.pdf'), name: 'x', mime: 'application/pdf', signal })).toMatchObject({ ok: false, why: 'invalid' });
      expect(await gwsUpload(bin, env, { file: exportDir, name: 'x', mime: 'application/pdf', signal })).toMatchObject({ ok: false, why: 'invalid' });
      expect(runs()).toEqual([]);
    });
  });
});
