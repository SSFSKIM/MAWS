// `mawsd render install | uninstall | status` (P5 O5 M6; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M6's
// decisions, Interfaces §J): the render runtime's install is a transaction. The zip is verified against the pin before it
// is unpacked, unpacked into a directory of the installer's own, renamed into the staging directory once whole, its
// sandbox helper set root-owned 4755 through `sudo -n`, and only then published by one rename (its manifest written
// first). Without privilege the verified staging stays and a privileged retry completes it; a staging a killed install
// left is verified and completed, or cleaned; two installers at once leave one entry; an entry nothing pins and nothing
// runs from is pruned. Each case runs in a scratch home with the downloads, `unzip`, `sudo`, `ldd` and /proc faked, and
// the helper's ownership read from what the fake `sudo` did (a test cannot chown to root).
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunningProcess } from './release';
import { releasesRoot } from './release';
import { installRenderRuntime, renderRuntimeStatus, uninstallRenderRuntime, type RenderInstallDeps } from './render-install';
import { readRenderRuntime, renderCacheRoot, runtimeName, stagingName, type ElectronPin } from './render-runtime';

let dir: string;
let home: string;
let bin: string;
let zipBytes: Buffer;
let pin: ElectronPin;
let downloads: string[];
let calls: string[];
let privileged: boolean;
let configured: Set<string>;
let running: RunningProcess[];
let unzipped: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-render-install-'));
  home = join(dir, 'home');
  bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'xvfb-run'), '');
  zipBytes = Buffer.from('a zip of electron 44.4.5 for linux-x64');
  pin = { version: '44.4.5', sha256: createHash('sha256').update(zipBytes).digest('hex'), target: 'linux-x64' };
  downloads = [];
  calls = [];
  privileged = true;
  configured = new Set();
  running = [];
  unzipped = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ok = { status: 0, stdout: '', stderr: '' };
function deps(over: Partial<RenderInstallDeps> = {}): RenderInstallDeps {
  return {
    home,
    arch: 'x64',
    uid: 1000,
    pin,
    packZip: null,
    run: (command, args) => {
      calls.push([command, ...args].join(' '));
      if (command === 'unzip') {
        const into = args[args.indexOf('-d') + 1]!;
        unzipped += 1;
        for (const name of ['electron', 'chrome-sandbox', 'libffmpeg.so']) writeFileSync(join(into, name), name);
        return ok;
      }
      if (command === 'sudo') {
        if (!privileged) return { status: 1, stdout: '', stderr: 'sudo: a password is required' };
        if (args[1] === 'chmod') configured.add(args[3]!);
        return ok;
      }
      if (command === 'ldd') return { status: 0, stdout: '\tlibnss3.so => /usr/lib/libnss3.so (0x1)\n\tlibgtk-3.so.0 => not found\n\tlibcups.so.2 => not found\n', stderr: '' };
      return { status: 127, stdout: '', stderr: `${command}: not faked` };
    },
    download: async (url, to) => {
      downloads.push(url);
      await new Promise((resolve) => setTimeout(resolve, 5));
      writeFileSync(to, zipBytes);
    },
    processes: () => running,
    helperConfigured: (path) => configured.has(path),
    now: () => Date.parse('2026-10-31T12:00:00Z'),
    ...over,
  };
}

const root = () => renderCacheRoot(home);
const entry = (p: ElectronPin = pin) => join(root(), runtimeName(p));
const staging = () => join(root(), stagingName(pin));
const listing = () => (existsSync(root()) ? readdirSync(root()).sort() : []);
const appRoot = () => {
  const at = join(dir, 'release');
  mkdirSync(join(at, 'packaging', 'mawsd'), { recursive: true });
  writeFileSync(join(at, 'packaging', 'mawsd', 'electron.json'), JSON.stringify({ version: pin.version, sha256: { 'linux-x64': pin.sha256 } }));
  return at;
};
const reading = () => readRenderRuntime({ appRoot: appRoot(), home, arch: 'x64', machine: 'vm-1', path: bin, helperConfigured: (path) => configured.has(path) });
const sudoCalls = () => calls.filter((call) => call.startsWith('sudo'));

describe('an install', () => {
  it('downloads the pinned zip, verifies it, unpacks it, sets the sandbox helper with sudo -n and publishes the entry with its manifest', async () => {
    const outcome = await installRenderRuntime(deps());
    expect(outcome).toEqual({ state: 'installed', entry: entry(), source: 'download', pruned: [] });
    expect(downloads).toEqual(['https://github.com/electron/electron/releases/download/v44.4.5/electron-v44.4.5-linux-x64.zip']);
    expect(sudoCalls()).toEqual([`sudo -n chown root:root ${join(staging(), 'chrome-sandbox')}`, `sudo -n chmod 4755 ${join(staging(), 'chrome-sandbox')}`]);
    expect(listing()).toEqual([runtimeName(pin)]); // no staging, no download left
    expect(JSON.parse(readFileSync(join(entry(), 'manifest.json'), 'utf8'))).toEqual({ version: '44.4.5', sha256: pin.sha256, sandbox: 'suid', installedAt: '2026-10-31T12:00:00.000Z' });
    configured.add(join(entry(), 'chrome-sandbox')); // the helper moved with its directory
    expect(reading()).toMatchObject({ available: true, electron: join(entry(), 'electron') });
  });

  it('refuses a download whose sha256 is not the pin’s before anything is unpacked', async () => {
    await expect(installRenderRuntime(deps({ download: async (_url, to) => writeFileSync(to, 'tampered') }))).rejects.toThrow(/has sha256 [0-9a-f]{64}, not the pinned/);
    expect(unzipped).toBe(0);
    expect(listing()).toEqual([]);
  });

  it('without privilege publishes nothing, keeps the verified staging and says so; a privileged retry completes it without downloading again', async () => {
    privileged = false;
    const first = await installRenderRuntime(deps());
    expect(first).toEqual({ state: 'staged', staging: staging(), why: expect.stringContaining('sudo: a password is required') });
    expect(listing()).toEqual([stagingName(pin)]);
    expect(reading()).toEqual({ available: false, reason: 'Chromium’s sandbox is not configured on vm-1: make sudo -n work for the user mawsd runs as, then run mawsd render install as that user, not as root' });

    privileged = true;
    const second = await installRenderRuntime(deps());
    expect(second).toMatchObject({ state: 'installed', entry: entry() });
    expect(downloads).toHaveLength(1);
    expect(unzipped).toBe(1);
    configured.add(join(entry(), 'chrome-sandbox'));
    expect(reading()).toMatchObject({ available: true });
  });

  it('finds the entry present and does nothing', async () => {
    await installRenderRuntime(deps());
    configured.add(join(entry(), 'chrome-sandbox'));
    calls = [];
    expect(await installRenderRuntime(deps())).toEqual({ state: 'present', entry: entry(), pruned: [] });
    expect(downloads).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('cleans a staging a killed install left half unpacked, and completes one it left whole', async () => {
    mkdirSync(staging(), { recursive: true });
    writeFileSync(join(staging(), 'electron'), 'half');
    expect(await installRenderRuntime(deps())).toMatchObject({ state: 'installed' });
    expect(unzipped).toBe(1); // unpacked again: the half one carried no mark of a whole unpack

    rmSync(root(), { recursive: true });
    configured.clear(); // the helper went with the directory
    privileged = false;
    await installRenderRuntime(deps()); // left whole, waiting for privilege
    privileged = true;
    expect(await installRenderRuntime(deps())).toMatchObject({ state: 'installed' });
    expect(unzipped).toBe(2); // the whole one completed, not unpacked again
  });

  // Two installers as two processes (render-install-racer.fixture.ts), each step released to both at once: both unpack
  // their own copy, both rename it to the staging (one wins, the other finds it whole), both set its helper and write its
  // manifest, both rename it into place (one wins, the other finds the published entry and checks it as its own)
  it('two processes at once leave one entry and nothing else', async () => {
    const bundle = join(dir, 'racer.mjs');
    buildSync({ entryPoints: [join(__dirname, 'render-install-racer.fixture.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
    const zip = join(dir, 'electron-v44.4.5-linux-x64.zip');
    writeFileSync(zip, zipBytes);
    const racers = [0, 1].map(() => fork(bundle, [home, zip, JSON.stringify(pin)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
    const results: unknown[] = [undefined, undefined];
    const at: (string | null)[] = [null, null];
    const steps: string[] = [];
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`the racers did not finish: ${JSON.stringify({ at, results })}`)), 20_000);
      // a step is released once every racer still running has reached it
      const release = () => {
        const waiting = at.filter((step, k) => results[k] === undefined && step !== null);
        const running = results.filter((result) => result === undefined).length;
        if (running === 0) return clearTimeout(timer), done();
        if (waiting.length < running || new Set(waiting).size !== 1) return;
        steps.push(waiting[0]!);
        racers.forEach((racer, k) => results[k] === undefined && (at[k] = null, racer.send({ go: waiting[0] })));
      };
      racers.forEach((racer, k) => {
        racer.on('message', (message: { at?: string; outcome?: unknown; error?: string }) => {
          if (message.at !== undefined) at[k] = message.at;
          else results[k] = message.outcome ?? { error: message.error };
          release();
        });
        racer.on('exit', () => results[k] === undefined && fail(new Error(`racer ${k} exited without an outcome`)));
      });
    }).finally(() => racers.forEach((racer) => racer.kill()));
    expect(steps).toEqual(['unpacked', 'publishing']); // each step reached by both together
    expect(results.map((result) => (result as { state?: string }).state).sort()).toEqual(['installed', 'present']);
    expect(listing()).toEqual([runtimeName(pin)]);
    expect(readdirSync(entry()).sort()).toEqual(['.maws-unpacked', 'chrome-sandbox', 'chrome-sandbox.suid', 'electron', 'manifest.json']);
  });

  it('replaces an entry whose sandbox helper lost its mode, never taking it as installed', async () => {
    await installRenderRuntime(deps());
    configured.delete(join(staging(), 'chrome-sandbox')); // the helper is the entry's now, and unset (a chmod since)
    calls = [];
    const outcome = await installRenderRuntime(deps());
    expect(outcome).toMatchObject({ state: 'installed', entry: entry() });
    expect(sudoCalls()).toEqual([`sudo -n chown root:root ${join(staging(), 'chrome-sandbox')}`, `sudo -n chmod 4755 ${join(staging(), 'chrome-sandbox')}`]);
    expect(listing()).toEqual([runtimeName(pin)]);
    configured.add(join(entry(), 'chrome-sandbox'));
    expect(reading()).toMatchObject({ available: true });
  });

  it('refuses to replace an unusable entry a render host runs from, leaving it as it is', async () => {
    await installRenderRuntime(deps());
    configured.clear();
    running = [{ exe: join(entry(), 'electron'), cmdline: 'electron --headless' }];
    await expect(installRenderRuntime(deps())).rejects.toThrow(/refusing to replace .*whose sandbox helper is not configured: a render host runs from it \(1 process\); run mawsd render install again after its quiet period/);
    expect(listing()).toEqual([runtimeName(pin)]);
    expect(existsSync(join(entry(), 'manifest.json'))).toBe(true);
  });

  it('takes no unusable entry that appears meanwhile as the winner: says so and keeps its staging, and a rerun replaces it', async () => {
    const download = async (_url: string, to: string) => {
      writeFileSync(to, zipBytes);
      // another install publishes an entry whose helper is not configured while this one downloads
      mkdirSync(entry(), { recursive: true });
      for (const name of ['electron', 'chrome-sandbox']) writeFileSync(join(entry(), name), name);
      writeFileSync(join(entry(), 'manifest.json'), JSON.stringify({ version: pin.version, sha256: pin.sha256, sandbox: 'suid', installedAt: 'x' }));
    };
    await expect(installRenderRuntime(deps({ download }))).rejects.toThrow(/cannot publish .*: an entry another install left there is not usable; run mawsd render install again/);
    expect(listing()).toEqual([stagingName(pin), runtimeName(pin)]);
    expect(await installRenderRuntime(deps())).toMatchObject({ state: 'installed', source: 'staging' });
    expect(listing()).toEqual([runtimeName(pin)]);
  });

  it('copies from the zip a pack carries beside it (--render) rather than downloading, after verifying it', async () => {
    const packZip = join(dir, 'dist', 'electron-v44.4.5-linux-x64.zip');
    mkdirSync(join(dir, 'dist'));
    writeFileSync(packZip, zipBytes);
    expect(await installRenderRuntime(deps({ packZip }))).toMatchObject({ state: 'installed', source: 'pack' });
    expect(downloads).toEqual([]);
    expect(existsSync(packZip), 'the pack’s zip is the pack’s').toBe(true);

    rmSync(root(), { recursive: true });
    writeFileSync(packZip, 'damaged');
    await expect(installRenderRuntime(deps({ packZip }))).rejects.toThrow(/electron-v44\.4\.5-linux-x64\.zip has sha256 [0-9a-f]{64}, not the pinned/);
  });

  it('prunes an entry nothing pins and nothing runs from; keeps one an installed release pins and one a render host runs from', async () => {
    const other = (version: string, fill: string): ElectronPin => ({ version, sha256: fill.repeat(64), target: 'linux-x64' });
    const stale = other('42.0.0', 'c');
    const pinned = other('43.0.0', 'd');
    const busy = other('41.0.0', 'e');
    for (const p of [stale, pinned, busy]) mkdirSync(entry(p), { recursive: true });
    const release = join(releasesRoot(home), 'releases', '0.0.0-aaaaaaaa-0f0f0f0f');
    mkdirSync(join(release, 'packaging', 'mawsd'), { recursive: true });
    writeFileSync(join(release, 'packaging', 'mawsd', 'electron.json'), JSON.stringify({ version: '43.0.0', sha256: { 'linux-x64': pinned.sha256 } }));
    running = [{ exe: join(entry(busy), 'electron'), cmdline: 'electron --type=zygote' }];
    const outcome = await installRenderRuntime(deps());
    expect(outcome).toMatchObject({ state: 'installed', pruned: [runtimeName(stale)] });
    expect(listing()).toEqual([runtimeName(busy), runtimeName(pinned), runtimeName(pin)].sort());
  });

  it('refuses as root (it asks sudo for the one step that needs it) and for a build that pins nothing', async () => {
    await expect(installRenderRuntime(deps({ uid: 0 }))).rejects.toThrow(/as the user mawsd runs as/);
    await expect(installRenderRuntime(deps({ pin: null }))).rejects.toThrow(/pins no render runtime for linux-x64/);
    expect(listing()).toEqual([]);
  });
});

describe('an uninstall', () => {
  it('refuses while a render host runs from the entry; otherwise removes it, and the runtime reads absent', async () => {
    await installRenderRuntime(deps());
    running = [{ exe: join(entry(), 'electron'), cmdline: 'electron --headless' }];
    expect(() => uninstallRenderRuntime(deps())).toThrow(/a render host runs from .* \(1 process\)/);
    expect(existsSync(entry())).toBe(true);
    running = [];
    expect(uninstallRenderRuntime(deps())).toEqual({ removed: [runtimeName(pin)] });
    expect(listing()).toEqual([]);
    expect(reading()).toEqual({ available: false, reason: 'the render runtime 44.4.5 is not installed on vm-1: run mawsd render install' });
  });

  it('removes a staging that waits for privilege, and with nothing installed removes nothing', async () => {
    privileged = false;
    await installRenderRuntime(deps());
    expect(uninstallRenderRuntime(deps())).toEqual({ removed: [stagingName(pin)] });
    expect(uninstallRenderRuntime(deps())).toEqual({ removed: [] });
  });
});

describe('the status', () => {
  it('says absent, staged (waiting for sudo) or installed, the helper, and what ldd finds missing', async () => {
    expect(renderRuntimeStatus(deps())).toEqual({ pin, state: 'absent', dir: null, sandbox: null, installedAt: null, missingLibraries: null });
    privileged = false;
    await installRenderRuntime(deps());
    expect(renderRuntimeStatus(deps())).toEqual({ pin, state: 'staged', dir: staging(), sandbox: 'not configured', installedAt: null, missingLibraries: ['libcups.so.2', 'libgtk-3.so.0'] });
    privileged = true;
    await installRenderRuntime(deps());
    configured.add(join(entry(), 'chrome-sandbox'));
    expect(renderRuntimeStatus(deps())).toEqual({ pin, state: 'installed', dir: entry(), sandbox: 'configured', installedAt: '2026-10-31T12:00:00.000Z', missingLibraries: ['libcups.so.2', 'libgtk-3.so.0'] });
  });

  it('says unpinned for a build that pins nothing', () => {
    expect(renderRuntimeStatus(deps({ pin: null }))).toEqual({ pin: null, state: 'unpinned', dir: null, sandbox: null, installedAt: null, missingLibraries: null });
  });
});
