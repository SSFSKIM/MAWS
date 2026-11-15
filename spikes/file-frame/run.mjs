// The spike's one command: launches each suite in its own Electron process (the repository's own Electron, 44.4.5),
// merges their RESULT lines into one verdict per row (a to i) and writes runs/<time>/results.json with every part, the
// ordered record of both ends of each suite, and main's own record. On Linux without a display it re-runs itself under
// xvfb-run, as spikes/viewer-frame/run.mjs does.
//
//   node run.mjs [--only=<suite,suite>] [--setuid-sandbox]
//
// --setuid-sandbox: on a host whose kernel restricts unprivileged user namespaces (Ubuntu 24.04), Chromium's sandbox
// needs its setuid helper; this sets it on the repository's Electron with `sudo -n` (spikes/viewer-frame/FINDINGS.md,
// "Linux"). The sandbox is never turned off.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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
const version = createRequire(import.meta.url)('electron/package.json').version;
if (process.platform === 'linux') {
  const helper = join(dirname(electron), 'chrome-sandbox');
  const s = statSync(helper);
  if (!(s.mode & 0o4000) || s.uid !== 0) {
    if (!argv['setuid-sandbox']) {
      console.error(`chrome-sandbox at ${helper} is not setuid root; pass --setuid-sandbox to set it with sudo -n`);
      process.exit(2);
    }
    for (const args of [['chown', 'root:root', helper], ['chmod', '4755', helper]]) {
      const r = spawnSync('sudo', ['-n', ...args], { stdio: 'inherit' });
      if (r.status !== 0) process.exit(2);
    }
    console.error(`set chrome-sandbox setuid root (${helper})`);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runs = join(here, 'runs', stamp);
const mediaDir = join(runs, 'media');
mkdirSync(mediaDir, { recursive: true });
// A launch of another program is seen even where it leaves Electron's process tree: the usual openers come first on
// the PATH, as scripts that write one line each.
const fakebin = join(runs, 'fakebin');
const opened = join(runs, 'opened.txt');
mkdirSync(fakebin);
writeFileSync(opened, '');
for (const name of ['xdg-open', 'gio', 'gvfs-open', 'kde-open', 'kde-open5', 'kfmclient', 'gnome-open', 'exo-open', 'sensible-browser', 'x-www-browser', 'www-browser', 'firefox', 'chromium', 'google-chrome', 'lp', 'lpr', 'evince', 'okular', 'sh-launch']) {
  writeFileSync(join(fakebin, name), `#!/bin/sh\necho "${name} $*" >> '${opened}'\n`);
  chmodSync(join(fakebin, name), 0o755);
}

const ALL = [['gen'], ['a'], ['bc'], ['d'], ['e'], ['f'], ['f', ['--lang=ko'], { LANGUAGE: 'ko', LANG: 'ko_KR.UTF-8' }, 'f-ko'], ['g'], ['hi'], ['hi-reversed']];
const only = argv.only ? new Set(String(argv.only).split(',')) : null;
const parts = [];
const record = {};
for (const [suite, switches = [], env = {}, label = suite] of ALL) {
  if (only && !only.has(label) && suite !== 'gen') continue;
  const args = [...switches, here, `--suite=${suite}`, `--runs=${runs}`, `--media=${mediaDir}`];
  const r = spawnSync(electron, args, { encoding: 'utf8', timeout: 300000, maxBuffer: 256 << 20, env: { ...process.env, ...env, PATH: `${fakebin}:${process.env.PATH}`, FILE_FRAME_OPENED: opened, ELECTRON_ENABLE_LOGGING: '' } });
  const lines = (r.stdout ?? '').split('\n');
  writeFileSync(join(runs, `${label}.log`), `${lines.filter((l) => !l.startsWith('REC ')).join('\n')}\n--- stderr ---\n${r.stderr ?? ''}`);
  record[label] = lines.filter((l) => l.startsWith('REC ')).map((l) => JSON.parse(l.slice(4)));
  const got = lines.filter((l) => l.startsWith('RESULT ')).map((l) => ({ suite: label, ...JSON.parse(l.slice(7)) }));
  if (!got.length) got.push({ suite: label, row: 'setup', part: label, status: 'fail', observed: `no result (exit ${r.status}, signal ${r.signal}): ${(r.stderr ?? '').split('\n').slice(-6).join(' ').slice(0, 500)}` });
  for (const g of got) {
    parts.push(g);
    process.stderr.write(`  [${label}] ${g.row} ${g.part}: ${g.status}\n`);
  }
}

// Rows h and i are judged here from both suites' reads: a fragment is honoured when the element it names shows without
// it and does not show with it, at both reads.
const shows = (box) => !!box && box.w > 0 && box.h > 0 && box.display !== 'none' && box.visibility !== 'hidden' && !box.hidden;
function judge(row, key, plainParts, fragParts) {
  const seen = (ps) => ps.map((p) => [p.first, p.second].map((x) => (x ? shows(x[key]) : null)));
  const plain = seen(plainParts).flat();
  const frag = seen(fragParts).flat();
  if (!plain.length || !frag.length || plain.includes(null) || frag.includes(null)) return { status: 'fail', why: 'a read is missing' };
  if (plain.every((v) => !v)) return { status: 'record', why: `the ${key} does not show without the fragment, so the fragment's effect cannot be seen` };
  if (!plain.every((v) => v)) return { status: 'record', why: `the ${key} shows in some reads without the fragment and not in others` };
  return frag.every((v) => !v) ? { status: 'pass', why: `the ${key} shows without the fragment and not with it, at every read` } : { status: 'fail', why: `the ${key} shows with the fragment too` };
}
const pick = (row, test) => parts.filter((p) => p.row === row && test(p.part));
const hJ = judge('h', 'toolbar', pick('h', (p) => p.startsWith('plain')), pick('h', (p) => p.startsWith('toolbar=0')));
const iJ = judge('i', 'sidenav', pick('i', (p) => p === 'plain' || p.startsWith('plain (')), pick('i', (p) => p.startsWith('navpanes=0')));
parts.push({ suite: 'run', row: 'h', part: 'verdict', status: hJ.status, observed: hJ.why });
parts.push({ suite: 'run', row: 'i', part: 'verdict', status: iJ.status, observed: iJ.why });

const rows = {};
for (const row of ['setup', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
  const mine = parts.filter((p) => p.row === row);
  if (!mine.length) continue;
  const deciding = mine.filter((p) => p.status !== 'record');
  const verdict = deciding.some((p) => p.status === 'fail') ? 'FAIL' : deciding.length ? 'PASS' : 'RECORD';
  rows[row] = { verdict, parts: mine };
}
writeFileSync(join(runs, 'results.json'), JSON.stringify({ electron: version, platform: `${process.platform} ${process.arch}`, stamp, rows, record }, null, 1));
for (const [row, { verdict, parts: ps }] of Object.entries(rows)) {
  console.log(`${row.padEnd(5)} ${verdict}`);
  for (const p of ps) console.log(`      [${p.part}: ${p.status}] ${String(p.observed).slice(0, 1200)}`);
}
console.log(`\nevidence: ${runs}`);
