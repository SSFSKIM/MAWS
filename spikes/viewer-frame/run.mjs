// The spike's one command: builds, starts the listeners (and a DNS capture where it can), launches every suite in its
// own Electron process, and prints one line per condition. On Linux without a display it re-runs itself under xvfb-run.
//
//   node run.mjs [--only=<suite,suite>] [--variant=<name>] [--samples=<dir>]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));

if (process.platform === 'linux' && !process.env.DISPLAY) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const electron = createRequire(import.meta.url)('electron');
if (!existsSync(electron)) execFileSync(process.execPath, [join(here, 'node_modules', 'electron', 'install.js')], { stdio: 'inherit' });
execFileSync(process.execPath, [join(here, 'build.mjs')], { stdio: 'inherit' });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runs = join(here, 'runs', stamp);
mkdirSync(runs, { recursive: true });
const listenerLog = join(runs, 'listeners.jsonl');
const portsFile = join(runs, 'ports.json');
writeFileSync(listenerLog, '');
const listeners = spawn(process.execPath, [join(here, 'listeners.mjs'), listenerLog, portsFile], { stdio: ['ignore', 'ignore', 'inherit'] });
// A DNS capture for dns-prefetch, where tcpdump can run without a password (Linux build hosts); elsewhere none.
const dnsLog = join(runs, 'dns.txt');
let dns = null;
if (process.platform === 'linux' && spawnSync('sudo', ['-n', 'true']).status === 0) {
  // straight into the file: this runner blocks in spawnSync while a suite runs, so nothing may pass through it
  dns = spawn('sudo', ['-n', 'tcpdump', '-i', 'any', '-l', '-n', '-A', 'port', '53'], { stdio: ['ignore', openSync(dnsLog, 'w'), 'ignore'] });
}
for (let i = 0; i < 100 && !existsSync(portsFile); i++) await new Promise((r) => setTimeout(r, 50));

// suite, extra Electron switches
const ALL = [
  ['basic', ['--use-fake-device-for-media-stream']], ['boundary'], ['loop'], ['hang'], ['kill'], ['oom'], ['metrics'],
  ['egress-control'], ['egress'], ['webrtc-control'], ['webrtc-block'], ['webrtc-noblock'],
  ['input'],
  ['shared', ['--disable-site-isolation-trials']],
  ['b-basic', ['--use-fake-device-for-media-stream']], ['b-boundary'], ['b-loop'], ['b-hang'], ['b-kill'], ['b-oom'], ['b-metrics'], ['b-egress'], ['b-webrtc-block'], ['b-webrtc-noblock'], ['b-layout'],
];
const only = argv.only ? new Set(String(argv.only).split(',')) : null;
const extraSwitches = argv.switches ? String(argv.switches).split(/ (?=--)/) : []; // a switch's value may hold spaces
const results = [];
for (const [suite, switches = []] of ALL) {
  if (only && !only.has(suite)) continue;
  const args = [here, ...switches, ...extraSwitches, `--suite=${suite}`, `--variant=${argv.variant ?? 'as-specified'}`, `--ports=${portsFile}`, `--listener-log=${listenerLog}`, `--runs=${runs}`, ...(dns ? [`--dns-log=${dnsLog}`] : []), ...(argv.samples ? [`--samples=${argv.samples}`] : [])];
  const r = spawnSync(electron, args, { encoding: 'utf8', timeout: 420000, maxBuffer: 64 << 20 });
  writeFileSync(join(runs, `${suite}.log`), `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('RESULT ')).map((l) => JSON.parse(l.slice(7)));
  if (!lines.length) lines.push({ suite, cond: 'setup', part: suite, status: 'fail', observed: `no result (exit ${r.status}, signal ${r.signal}): ${(r.stderr ?? '').split('\n').slice(-5).join(' ').slice(0, 400)}` });
  for (const l of lines) { results.push(l); process.stderr.write(`  [${suite}] ${l.cond} ${l.part}: ${l.status}\n`); }
}
listeners.kill();
dns?.kill();
if (dns) spawnSync('sudo', ['-n', 'pkill', '-f', 'tcpdump -i any -l -n -A port 53']);
writeFileSync(join(runs, 'results.json'), JSON.stringify(results, null, 1));

// One line per condition: fail if any part fails, else not run if any part was not run, else pass; `record` parts
// (observations, controls) do not decide.
const order = ['setup', ...Array.from({ length: 15 }, (_, i) => String(i + 1)), 'B1', 'B2', 'B3'];
for (const arch of ['A', 'B']) {
  const mine = results.filter((r) => (arch === 'B') === r.suite.startsWith('b-'));
  if (!mine.length) continue;
  console.log(`\n== architecture ${arch} (${argv.variant ?? 'as-specified'})`);
  for (const cond of order) {
    const parts = mine.filter((r) => r.cond === cond);
    if (!parts.length) continue;
    const deciding = parts.filter((p) => p.status !== 'record');
    const status = deciding.some((p) => p.status === 'fail') ? 'FAIL' : deciding.some((p) => p.status === 'not-run') ? 'NOT RUN' : deciding.length ? 'PASS' : 'RECORD';
    console.log(`${cond.padEnd(5)} ${status.padEnd(7)} ${parts.map((p) => `[${p.part}: ${p.status}] ${p.observed}`).join('  ')}`);
  }
}
console.log(`\nevidence: ${runs}`);
