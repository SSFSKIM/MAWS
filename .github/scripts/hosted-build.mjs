// The hosted group's out/ cache: GitHub artifacts supply candidates; e2e-build.sh remains the digest/build authority.
// `prepare` publishes identity and provenance-checked download inputs; `build` admits a completed download or builds.
import { execFileSync, spawn } from 'node:child_process';
import console from 'node:console';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const env = process.env;
const say = (message) => console.log(`hosted-build: ${message}`);
const write = (file, values) => appendFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const api = (path, ...args) => JSON.parse(execFileSync('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/${path}`, ...args], { encoding: 'utf8', maxBuffer: 16 << 20, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }));

function candidate(name, tree) {
  try {
    const pages = api('actions/artifacts', '--method', 'GET', '-f', `name=${name}`, '-f', 'per_page=100', '--paginate', '--slurp');
    const artifact = pages.flatMap((page) => page.artifacts)
      .filter((item) => item.name === name && item.expired === false && Date.parse(item.expires_at) > Date.now())
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
    if (!artifact) { say(`no unexpired artifact ${name}; building`); return {}; }
    const ignored = (why) => { say(`artifact ${artifact.id} ignored: ${why}; building`); return {}; };
    if (!artifact.workflow_run?.id) return ignored('no originating workflow run');
    const run = api(`actions/runs/${artifact.workflow_run.id}`);
    if (run.path !== '.github/workflows/hosted-mac.yml') return ignored('not the hosted-mac workflow');
    if (!run.head_branch?.startsWith('ci/hosted/')) return ignored('not a hosted request branch');
    const commit = api(`git/commits/${run.head_sha}`);
    if (commit.tree?.sha !== tree) return ignored('originating commit has a different tree');
    say(`artifact ${artifact.id} from run ${run.id}: provenance verified for tree ${tree}`);
    return { 'artifact-id': artifact.id, 'run-id': run.id };
  } catch (error) {
    say(`artifact lookup failed (${error.message.split('\n')[0]}); building`);
    return {};
  }
}

function prepare() {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  const variant = /^scripts\/e2e-build\.sh (plain|harness) && /.exec((scripts[env.SCRIPT] ?? '').trim())?.[1];
  if (!variant) throw new Error(`cannot derive build variant from package script ${env.SCRIPT}`);
  const tree = git('rev-parse', 'HEAD^{tree}');
  const cache = join(env.RUNNER_TEMP, 'maws-e2e-build');
  const staging = mkdtempSync(join(env.RUNNER_TEMP, 'maws-e2e-download-'));
  const name = `e2e-build-${tree}-${variant}`;
  write(env.GITHUB_ENV, { MAWS_E2E_BUILD_CACHE: cache, MAWS_E2E_BUILD_KEY: tree, MAWS_E2E_BUILD_VARIANT: variant, MAWS_E2E_BUILD_DOWNLOAD: staging });
  say(`tree ${tree}, variant ${variant}, artifact ${name}`);
  write(env.GITHUB_OUTPUT, { name, variant, staging, entry: join(cache, tree, variant), 'artifact-id': '', 'run-id': '', ...candidate(name, tree) });
}

function publicBuildInputs() {
  // These are Vite/electron-vite's exposed prefixes, not runtime process.env reads in the app. A host-supplied value
  // would be both public in out/ and absent from the tree key. Never log its value or publish such a build.
  const exposed = Object.keys(env).filter((key) => /^(?:(?:MAIN|PRELOAD|RENDERER)_)?VITE_/.test(key));
  if (exposed.length) throw new Error(`public build refuses inherited Vite environment: ${exposed.join(', ')}`);
  const dotenv = ['.env', '.env.local', '.env.production', '.env.production.local'].filter(existsSync);
  for (const file of dotenv) {
    try {
      if (!lstatSync(file).isFile()) throw new Error('not a regular file');
      git('ls-files', '--error-unmatch', file);
      git('diff', '--exit-code', 'HEAD', '--', file);
    } catch { throw new Error(`public build refuses untracked or modified dotenv input ${file}`); }
  }
  say(`public build inputs: NODE_ENV=production, MAWS_BUILD_RENDERER=1, MAWS_HARNESS=${env.MAWS_E2E_BUILD_VARIANT === 'harness' ? '1' : '0'}; exposed Vite environment none; dotenv ${dotenv.join(', ') || 'none'}`);
}

async function build() {
  publicBuildInputs();
  const cache = env.MAWS_E2E_BUILD_CACHE;
  const tree = env.MAWS_E2E_BUILD_KEY;
  const variant = env.MAWS_E2E_BUILD_VARIANT;
  const staging = env.MAWS_E2E_BUILD_DOWNLOAD;
  const entry = join(cache, tree, variant);
  if (env.DOWNLOAD_OUTCOME === 'success') {
    const out = join(staging, 'out'), digest = join(staging, 'digest');
    if (existsSync(out) && lstatSync(out).isDirectory() && existsSync(digest) && lstatSync(digest).isFile()) {
      mkdirSync(join(cache, tree), { recursive: true });
      rmSync(entry, { recursive: true, force: true });
      renameSync(staging, entry);
      say('download staged; e2e-build will verify its digest');
    } else say('download has no complete out/ and digest; building');
  } else if (env.DOWNLOAD_OUTCOME === 'failure') say('artifact download failed; building');
  rmSync(staging, { recursive: true, force: true });
  // Keep the existing script's built/restored log as its status contract, streaming the build rather than buffering it.
  let tail = '';
  await new Promise((resolve, reject) => {
    const child = spawn('bash', ['scripts/e2e-build.sh', variant], {
      env: { ...env, NODE_ENV: 'production', MAWS_BUILD_RENDERER: '1', MAWS_E2E_BUILD_REQUIRE: '' }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (chunk) => { process.stdout.write(chunk); tail = (tail + chunk).slice(-65536); });
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`e2e-build failed (${signal || code})`)));
  });
  write(env.GITHUB_OUTPUT, { built: tail.includes(`e2e-build: out/ (${variant}) built and stored in `) });
}

try {
  if (process.argv[2] === 'prepare') prepare();
  else if (process.argv[2] === 'build') await build();
  else throw new Error('usage: hosted-build.mjs prepare|build');
} catch (error) {
  console.error(`hosted-build: ${error.message}`);
  process.exitCode = 1;
}
