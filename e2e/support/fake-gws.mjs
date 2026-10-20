#!/usr/bin/env node
// A stand-in for the Google Workspace CLI (`gws` 0.22.5) for Send to Google Drive's tests: the commands MAWS runs, with
// the real one's output, exit codes (1 api, 2 auth, 3 validation, 5 internal) and error JSON, and nothing of Google's.
// Like the npm package's run.js it re-runs itself as a child with inherited stdio, so a caller that stops only the
// process it started leaves the inner one (the listener, the upload) running.
//
// Its state lives in $FAKE_GWS_DIR, never under HOME (the paths `auth status` names there are reported, not written):
//   state.json  {client, signedIn, user?, scopes?, tokenValid?, refusal?: 'hang' | 'exit', statusDelayMs?, uploadDelayMs?, adc?}
//               (P4-B5: `adc`, gcloud's application-default credentials exist, which the real chain falls through to
//               when signed out: an upload then succeeds as that identity unless GOOGLE_APPLICATION_CREDENTIALS names a
//               file that does not exist, which is a hard auth error, as auth.rs 4a)
//               (absent: {client: true, signedIn: false}); a login that completes rewrites it signed in
//   log.jsonl   one line per invocation: {at, argv, cwd, pid (the inner process), ppid (the shim), envKeys (the names of
//               the environment it was given)}, and for `drive files create`
//               {upload: {path, size, sha256}, contentType, json, params} once the file is read
// Commands: `--version`; `auth status`; `auth login [-s <services> | --scopes <a,b>]` (a listener on 127.0.0.1:0 whose
// `?code=` signs in; `?error=` answers 400 and keeps waiting, as 0.22.5 does, under refusal 'hang' (the default), or
// ends with an auth error under 'exit', the URL then printed on stdout as the CLI's proxy path does); `drive files
// create --json --upload --upload-content-type --params` (refusing an --upload path outside its working directory;
// signed out or tokenValid false is exit 2, granted scopes without drive or drive.file a 403, the parent
// `missing-folder` a 404). Anything else is exit 3. A GOOGLE_WORKSPACE_CLI_TOKEN in its environment counts as signed in.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isAbsolute, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const INNER = 'FAKE_GWS_INNER';
const DRIVE = 'https://www.googleapis.com/auth/drive';
const MINIMAL_SCOPES = [
  DRIVE,
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/tasks',
];
const IDENTITY_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
const SCOPE_PREFIXES = { sheets: ['spreadsheets'], slides: ['presentations'], docs: ['documents'], people: ['contacts', 'directory'] };
const CLIENT_ID = '123456789012-fakegwsclient.apps.googleusercontent.com';
const LABELS = { api: 'error[api]:', auth: 'error[auth]:', validation: 'error[validation]:', other: 'error:' };

if (process.env[INNER] !== '1') {
  const inner = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, [INNER]: '1' },
  });
  process.exit(inner.status ?? 1);
}

const dir = process.env.FAKE_GWS_DIR;
const argv = process.argv.slice(2);
const entry = {
  at: new Date().toISOString(),
  argv,
  cwd: process.cwd(),
  pid: process.pid,
  ppid: process.ppid,
  envKeys: Object.keys(process.env).filter((key) => key !== INNER && key !== '__CF_USER_TEXT_ENCODING').sort(), // macOS adds the latter itself
};
let logged = false;
const log = (extra = {}) => {
  if (logged) return;
  logged = true;
  appendFileSync(join(dir, 'log.jsonl'), `${JSON.stringify({ ...entry, ...extra })}\n`);
};

const print = (value) => process.stdout.write(`${JSON.stringify(sorted(value), null, 2)}\n`);
// serde_json's default map is ordered by key, so the real CLI's objects are too.
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
}

// GwsError::to_json and print_error_json: the JSON on stdout, the labelled line on stderr.
function fail(kind, message, api) {
  log();
  const error =
    kind === 'api' ? api : { code: kind === 'auth' ? 401 : kind === 'validation' ? 400 : 500, message, reason: { auth: 'authError', validation: 'validationError', other: 'internalError' }[kind] };
  print({ error });
  process.stderr.write(`${LABELS[kind]} ${error.message}\n`);
  process.exitCode = { api: 1, auth: 2, validation: 3, other: 5 }[kind];
}

function readState() {
  const file = join(dir, 'state.json');
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { client: true, signedIn: false, ...state };
}

function writeState(state) {
  const tmp = join(dir, `state.json.${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, join(dir, 'state.json'));
}

const tokenEnv = () => (process.env.GOOGLE_WORKSPACE_CLI_TOKEN ?? '') !== '';
// P4-B5 review: the chain's credentials-file step (auth.rs 1), which `plain_credentials_path` also reads for the status
const credsFile = () => {
  const file = process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE;
  return file && existsSync(file) ? file : null;
};
const clientEnv = () => process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID !== undefined && process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET !== undefined;
const configDir = () => process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR || join(process.env.HOME ?? '', '.config', 'gws');

// Flags as `--name value` (or `-s value`); null and an exit 3 for anything else, as clap refuses it.
function flags(args, known) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i] === '-s' ? 'services' : args[i].startsWith('--') ? args[i].slice(2) : null;
    if (name === null || !known.includes(name) || i + 1 >= args.length) {
      fail('validation', `error: unexpected argument '${args[i]}' found`);
      return null;
    }
    out[name] = args[i + 1];
  }
  return out;
}

async function status() {
  log();
  const state = readState();
  if (state.statusDelayMs) await sleep(state.statusDelayMs);
  const config = configDir();
  const signedIn = state.signedIn === true;
  const plain = credsFile(); // P4-B5 review
  const out = {
    auth_method: signedIn || plain ? 'oauth2' : 'none',
    storage: signedIn ? 'encrypted' : plain ? 'plaintext' : 'none',
    keyring_backend: 'keyring',
    encrypted_credentials: join(config, 'credentials.enc'),
    encrypted_credentials_exists: signedIn,
    plain_credentials: plain ?? join(config, 'credentials.json'),
    plain_credentials_exists: plain !== null,
    token_cache_exists: signedIn,
    client_config: join(config, 'client_secret.json'),
    client_config_exists: state.client === true,
    credential_source: tokenEnv() ? 'token_env_var' : clientEnv() ? 'environment_variables' : state.client === true ? 'client_secret.json' : 'none',
  };
  if (tokenEnv()) out.token_env_var = true;
  if (state.client === true) Object.assign(out, { project_id: 'fake-gws-project', config_client_id: '12345678...com', enabled_apis: ['drive.googleapis.com'], enabled_api_count: 1 });
  if (signedIn) {
    Object.assign(out, { client_id: '12345678...com', has_refresh_token: true, encryption_valid: true });
    if (state.tokenValid === false) Object.assign(out, { token_valid: false, token_error: 'Token has been expired or revoked.' });
    else {
      const scopes = state.scopes ?? [DRIVE, ...IDENTITY_SCOPES];
      Object.assign(out, { token_valid: true, user: state.user ?? 'owner@example.com', scopes, scope_count: scopes.length });
    }
  }
  print(out);
}

function loginScopes(options) {
  let scopes;
  if (options.scopes !== undefined) {
    scopes = options.scopes.split(',').map((s) => s.trim()).filter((s) => s !== '');
  } else {
    const services = options.services?.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s !== '');
    scopes = services?.length
      ? MINIMAL_SCOPES.filter((scope) => {
          const short = scope.replace('https://www.googleapis.com/auth/', '');
          return services.some((service) => (SCOPE_PREFIXES[service] ?? [service]).some((p) => short === p || short.startsWith(`${p}.`)));
        })
      : [...MINIMAL_SCOPES];
  }
  for (const scope of IDENTITY_SCOPES) if (!scopes.includes(scope)) scopes.push(scope);
  return scopes;
}

function login(args) {
  const options = flags(args, ['scopes', 'services']);
  if (options === null) return;
  const state = readState();
  if (state.client !== true && !clientEnv()) {
    fail('auth', `No OAuth client configured.\n\nEither:\n  1. Run \`gws auth setup\` to configure a GCP project and OAuth client\n  2. Download client_secret.json from Google Cloud Console and save it to:\n     ${join(configDir(), 'client_secret.json')}\n  3. Set env vars: GOOGLE_WORKSPACE_CLI_CLIENT_ID and GOOGLE_WORKSPACE_CLI_CLIENT_SECRET`);
    return;
  }
  const scopes = loginScopes(options);
  const exitOnRefusal = state.refusal === 'exit';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const code = url.searchParams.get('code');
    if (code !== null) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Success!</h1><p>You may now close this window.</p></body></html>', () => {
        server.closeAllConnections();
        server.close();
      });
      const account = state.user ?? 'owner@example.com';
      writeState({ ...readState(), signedIn: true, user: account, scopes, tokenValid: true });
      print({
        status: 'success',
        message: 'Authentication successful. Encrypted credentials saved.',
        account,
        credentials_file: join(configDir(), 'credentials.enc'),
        encryption: 'AES-256-GCM (key in OS keyring or local `.encryption_key`; set GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file for headless)',
        scopes,
      });
      return;
    }
    if (exitOnRefusal) {
      // the proxy path reads one request line, finds no code and returns its error without answering
      res.destroy();
      server.closeAllConnections();
      server.close();
      fail('auth', 'No authorization code in callback');
      return;
    }
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('No `code` in URL');
  });
  server.listen(0, '127.0.0.1', () => {
    log();
    const redirect = encodeURIComponent(`http://localhost:${server.address().port}`);
    const scope = encodeURIComponent(scopes.join(' '));
    const id = encodeURIComponent(CLIENT_ID);
    if (exitOnRefusal) {
      const url = `https://accounts.google.com/o/oauth2/auth?scope=${scope}&access_type=offline&redirect_uri=${redirect}&response_type=code&client_id=${id}&prompt=select_account+consent`;
      process.stdout.write(`Open this URL in your browser to authenticate:\n\n  ${url}\n\n`);
    } else {
      const url = `https://accounts.google.com/o/oauth2/auth?scope=${scope}&access_type=offline&redirect_uri=${redirect}&response_type=code&client_id=${id}&prompt=select_account`;
      process.stderr.write(`Open this URL in your browser to authenticate:\n\n  ${url}\n\n`);
    }
  });
}

// validate.rs: control characters and the zero-width, bidi and separator code points.
function dangerous(value) {
  for (const c of value) {
    const n = c.codePointAt(0);
    if (n <= 0x1f || (n >= 0x7f && n <= 0x9f)) return 'control';
    if ((n >= 0x200b && n <= 0x200d) || n === 0xfeff || (n >= 0x202a && n <= 0x202e) || (n >= 0x2028 && n <= 0x2029) || (n >= 0x2066 && n <= 0x2069)) return 'Unicode';
  }
  return null;
}

// validate_safe_file_path: canonical (symlinks resolved) and inside the canonical working directory.
function safeUploadPath(path) {
  const bad = dangerous(path);
  if (bad !== null) return { error: `--upload contains invalid ${bad} characters` };
  const cwd = realpathSync(process.cwd());
  const resolved = isAbsolute(path) ? path : join(process.cwd(), path);
  const canonical = existsSync(resolved) ? realpathSync(resolved) : resolve(resolved);
  if (canonical !== cwd && !canonical.startsWith(`${cwd}${sep}`)) return { error: `--upload '${path}' resolves to '${canonical}' which is outside the current directory` };
  return { canonical };
}

function json(text, what) {
  try {
    return { value: JSON.parse(text ?? 'null') };
  } catch (error) {
    return { error: `Invalid ${what}: ${error.message}` };
  }
}

async function create(args) {
  const options = flags(args, ['json', 'upload', 'upload-content-type', 'params']);
  if (options === null) return;
  const state = readState();
  let canonical = null;
  if (options.upload !== undefined) {
    const checked = safeUploadPath(options.upload);
    if (checked.error) return fail('validation', checked.error);
    canonical = checked.canonical;
  }
  const authed = tokenEnv() || state.signedIn === true;
  if (!tokenEnv() && state.signedIn === true && state.tokenValid === false) {
    return fail('auth', 'Authentication failed: Failed to get token: invalid_grant: Token has been expired or revoked.');
  }
  const params = json(options.params, '--params JSON');
  if (params.error) return fail('validation', params.error);
  const body = json(options.json, '--json body');
  if (body.error) return fail('validation', body.error);
  let upload;
  if (canonical !== null) {
    try {
      const bytes = readFileSync(canonical);
      upload = { path: options.upload, size: statSync(canonical).size, sha256: createHash('sha256').update(bytes).digest('hex') };
    } catch (error) {
      return fail('validation', `Failed to get metadata for upload file '${canonical}': ${error.message}`);
    }
  }
  log({ upload, contentType: options['upload-content-type'], json: body.value, params: params.value });
  if (state.uploadDelayMs) await sleep(state.uploadDelayMs);
  // P4-B5: past the CLI's own sign-in, its chain's application-default step (auth.rs 4a, 4b)
  const adcEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!authed && adcEnv !== undefined && !existsSync(adcEnv)) {
    return fail('auth', `Authentication failed: GOOGLE_APPLICATION_CREDENTIALS points to ${adcEnv}, but file does not exist`);
  }
  if (!tokenEnv() && state.signedIn !== true && credsFile()) {
    // P4-B5 review: the credentials file's identity, which outranks the CLI's own sign-in
    const id = `1${randomBytes(16).toString('hex')}`;
    print({ id, name: body.value?.name ?? 'Untitled', webViewLink: `https://drive.google.com/file/d/${id}/view`, owner: 'credentials-file' });
    return;
  }
  if (!authed && state.adc === true) {
    const id = `1${randomBytes(16).toString('hex')}`;
    print({ id, name: body.value?.name ?? 'Untitled', webViewLink: `https://drive.google.com/file/d/${id}/view`, owner: 'adc' });
    return;
  }
  if (!authed) {
    return fail('auth', 'Access denied. No credentials provided. Run `gws auth login` or set GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE to an OAuth credentials JSON file.');
  }
  const granted = tokenEnv() ? [DRIVE] : (state.scopes ?? [DRIVE]);
  if (!granted.some((scope) => scope === DRIVE || scope === `${DRIVE}.file`)) {
    return fail('api', null, { code: 403, message: 'Request had insufficient authentication scopes.', reason: 'insufficientPermissions' });
  }
  const parents = body.value?.parents ?? [];
  if (parents.includes('missing-folder')) {
    return fail('api', null, { code: 404, message: 'File not found: missing-folder.', reason: 'notFound' });
  }
  const id = `1${randomBytes(16).toString('hex')}`;
  print({ id, name: body.value?.name ?? 'Untitled', webViewLink: `https://drive.google.com/file/d/${id}/view` });
}

async function main() {
  if (!dir) {
    process.stderr.write('fake-gws: FAKE_GWS_DIR is not set\n');
    process.exitCode = 5;
    return;
  }
  if (argv.length === 1 && argv[0] === '--version') {
    log();
    process.stdout.write('gws 0.22.5\nThis is not an officially supported Google product.\n');
    return;
  }
  if (argv[0] === 'auth' && argv[1] === 'status' && argv.length === 2) return status();
  if (argv[0] === 'auth' && argv[1] === 'login') return login(argv.slice(2));
  if (argv[0] === 'drive' && argv[1] === 'files' && argv[2] === 'create') return create(argv.slice(3));
  fail('validation', `fake-gws does not stand in for: ${argv.join(' ')}`);
}

await main();
