// The desk's local stand-in for a dry run of the harness: the hub under `wrangler dev` behind its stand-in for Access
// (`pnpm --filter desk-hub local`, serving the built desk-web), an org key set up in a headless Chrome whose profile
// keeps it unlocked, and DC3's fake machine enrolled through that browser and replaying its recordings — a live
// session that raises a permission prompt and a question and waits for the web's answers, and one that ends. The
// numbers mean nothing here (the fake answers at once, and nothing streams a model's reply); the point is that every
// script runs clean. As desk-web's e2e-hub suites run it (apps/desk-web/e2e-hub, test/local/hub.ts).
//
//   pnpm --filter desk-web build                          (the app the hub serves, the instrument in it)
//   node spikes/desk-latency/standin/up.mjs [--dir /tmp/dsk-lat-standin] [--speed 1]
//
// Prints one JSON line — the hub's URL, the profile, the project, the sessions — and keeps the hub and the machine up
// until interrupted. Then, with that profile (headless, a browser of its own, never the owner's):
//   playwright-cli -s=lat-standin open --browser=chrome --profile=<profile> <url>
//   node spikes/desk-latency/build.mjs --target desk --load … --url <url> --project … --session … --out x.js
//   playwright-cli -s=lat-standin --raw run-code --filename=x.js
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../../..');
const { values } = parseArgs({ options: { dir: { type: 'string', default: '/tmp/dsk-lat-standin' }, speed: { type: 'string', default: '1' } } });
const dir = resolve(values.dir);
const PASSPHRASE = 'desk latency stand-in passphrase';

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const children = [];
const stop = () => {
  for (const child of children) if (child.exitCode === null) process.kill(-child.pid, 'SIGTERM');
};
process.on('SIGINT', () => (stop(), process.exit(0)));
process.on('SIGTERM', () => (stop(), process.exit(0)));
process.on('exit', stop);

const free = (port) => new Promise((done) => {
  const server = createServer();
  server.once('error', () => done(false));
  server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
});
let port;
for (;;) {
  port = 20_000 + Math.floor(Math.random() * 12_000);
  if ((await free(port)) && (await free(port + 1))) break;
}

const run = (cmd, args, options = {}) => {
  const child = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  const log = [];
  child.stdout.on('data', (c) => log.push(String(c)));
  child.stderr.on('data', (c) => log.push(String(c)));
  child.log = log;
  children.push(child);
  return child;
};

// The hub.
const hub = run('pnpm', ['--filter', 'desk-hub', 'local', '--port', String(port), '--state', join(dir, 'hub'), '--heartbeat-ms', '2000']);
const url = `http://localhost:${port}`;
for (const deadline = Date.now() + 120_000; ; ) {
  const me = await fetch(`http://127.0.0.1:${port}/api/me`).catch(() => null);
  if (me?.status === 200) break;
  if (hub.exitCode !== null || Date.now() > deadline) throw new Error(`the local hub did not come up:\n${hub.log.join('')}`);
  await new Promise((r) => setTimeout(r, 500));
}

// The org key, set up and kept unlocked in the profile; two machines enrolled through the browser, as the owner would:
// each recording on a machine of its own (the two share request ids, which one machine would confuse).
const profile = join(dir, 'profile');
const names = { live: `lat-live-${randomUUID().slice(0, 4)}`, history: `lat-hist-${randomUUID().slice(0, 4)}` };
const context = await chromium.launchPersistentContext(profile, { channel: process.platform === 'darwin' ? 'chrome' : undefined, headless: true });
const codes = {};
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  await page.getByTestId('key-state').click();
  const dialog = page.getByRole('dialog', { name: 'Org key' });
  await dialog.getByLabel('Keep unlocked on this device').check();
  const form = dialog.getByRole('form', { name: 'New passphrase' });
  await form.getByLabel(/Or a passphrase/).fill(PASSPHRASE);
  await form.getByLabel('The passphrase again').fill(PASSPHRASE);
  await form.getByRole('button', { name: 'Set up', exact: true }).click();
  await dialog.getByTestId('unlocked').waitFor({ timeout: 90_000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  for (const [key, name] of Object.entries(names)) {
    await page.getByRole('button', { name: 'Machines', exact: true }).click();
    const machines = page.getByRole('dialog', { name: 'Machines' });
    await machines.getByRole('button', { name: 'Enroll a machine' }).click();
    await machines.getByLabel(/machine's name/).fill(name);
    await machines.getByRole('button', { name: 'Continue' }).click();
    const confirm = machines.getByRole('form', { name: 'Passphrase', exact: true });
    await confirm.getByLabel(/passphrase/).fill(PASSPHRASE);
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await machines.getByTestId('enrollment-code').waitFor({ timeout: 90_000 });
    codes[key] = (await machines.getByTestId('enrollment-code').textContent()).trim();
    await machines.getByRole('button', { name: 'Done' }).click();
    await page.keyboard.press('Escape');
  }
} finally {
  await context.close();
}

// The fake machines: each enrolled with its code on its stdin (never an argument), then replaying into one project.
const project = randomUUID();
const live = randomUUID();
const history = randomUUID();
const RECORDINGS = resolve(ROOT, 'apps/desk-hub/fake-machine/recordings');
const machine = async (key, args) => {
  const state = join(dir, `${key}.json`);
  const enroll = run('pnpm', ['--filter', 'desk-hub', 'fake-machine', 'enroll', '--state', state]);
  enroll.stdin.end(codes[key]);
  if ((await new Promise((done) => enroll.on('exit', done))) !== 0) throw new Error(`the fake machine ${key} did not enroll:\n${enroll.log.join('')}`);
  const fm = run('pnpm', ['--filter', 'desk-hub', 'fake-machine', 'run', '--state', state, '--project', project, '--name', 'latency stand-in', ...args]);
  for (const deadline = Date.now() + 120_000; ; ) {
    if (fm.log.join('').includes('connected to')) break;
    if (fm.exitCode !== null || Date.now() > deadline) throw new Error(`the fake machine ${key} did not connect:\n${fm.log.join('')}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  fm.stdout.on('data', () => writeFileSync(join(dir, `${key}.log`), fm.log.join('')));
  return fm;
};
// A live session that raises a permission prompt and a question and waits for the web's answers.
await machine('live', ['--recording', join(RECORDINGS, 'two-subagents'), '--session', live, '--decisions', 'wait', '--producer', 'dc8', '--speed', values.speed]);
// A session with history past one snapshot, played to its end at once: an older page to load, an ended session to resume.
await machine('history', ['--recording', join(RECORDINGS, 'session-view'), '--session', history, '--producer', 'dc8', '--speed', '0']);
await new Promise((r) => setTimeout(r, 1500));
const info = { url, profile, project, machines: names, live, history, dir };
writeFileSync(join(dir, 'standin.json'), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info));
await new Promise(() => {});
