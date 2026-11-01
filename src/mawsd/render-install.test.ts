// `mawsd render install | uninstall | status` (P5 O5 M6; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M6's
// decisions, Interfaces §J): the render runtime's install is a transaction. The zip is verified against the pin before it
// is unpacked, unpacked into a directory of the installer's own, renamed into the staging directory once whole, its
// sandbox helper set root-owned 4755 through `sudo -n`, and only then published by one rename (its manifest written
// first). Without privilege the verified staging stays and a privileged retry completes it; a staging a killed install
// left is verified and completed, or cleaned; two installers at once leave one entry; an entry nothing pins and nothing
// runs from is pruned. Each case runs in a scratch home with the downloads, `unzip`, `sudo`, `ldd` and /proc faked, and
// the helper's ownership read from what the fake `sudo` did (a test cannot chown to root).
import { fork, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunningProcess } from './release';
import { releasesRoot } from './release';
import { flockFile, installRenderRuntime, renderRuntimeStatus, uninstallRenderRuntime, type FileLock, type RenderInstallDeps } from './render-install';
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
let lockHeld: boolean;
let lockWaiters: (() => void)[];
let waitsExpected: boolean;
let lockLost: string | null;

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
  lockHeld = false;
  lockWaiters = [];
  waitsExpected = false;
  lockLost = null;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// The cache root's lock as flock holds it, in this process (a Mac has no flock): exclusive, handed to the next waiter at
// release. A wait throws unless the case runs two at once on purpose, so no case can hang on a lock nobody releases.
// `loseLock` is its holder ending before the release (flock's child killed): `check` says so from then on.
const lock: FileLock = async (_path, waiting) => {
  if (lockHeld) {
    if (!waitsExpected) throw new Error('an unexpected wait for the cache lock');
    waiting();
    await new Promise<void>((resolve) => lockWaiters.push(resolve));
  }
  lockHeld = true;
  return {
    check: () => {
      if (lockLost !== null) throw new Error(`lost the install lock: its holder exited (status ${lockLost})`);
    },
    release: async () => {
      const next = lockWaiters.shift();
      if (next !== undefined) next();
      else lockHeld = false;
    },
  };
};
const loseLock = (status: string) => {
  lockLost = status;
  lockHeld = false; // the kernel let it go
};

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
        if (args[1] === 'chown') configured.delete(args[3]!); // Linux's chown clears the set-user-ID bit
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
    lock,
    ...over,
  };
}

// The helper's set-user-ID mode as a marker file beside it (`<helper>.suid`), so it moves with its directory as the mode
// does: `chmod 4755` writes it, `chown` clears it (Linux's chown clears the set-user-ID bit), and either fails once the
// helper is gone (its staging renamed into place)
function markerDeps(over: Partial<RenderInstallDeps> = {}): RenderInstallDeps {
  const base = deps();
  return deps({
    run: (command, args) => {
      if (command !== 'sudo') return base.run(command, args);
      calls.push([command, ...args].join(' '));
      const helper = args[3]!;
      if (!existsSync(helper)) return { status: 1, stdout: '', stderr: `${args[1]}: cannot access '${helper}': No such file or directory` };
      if (args[1] === 'chown') rmSync(`${helper}.suid`, { force: true });
      if (args[1] === 'chmod') writeFileSync(`${helper}.suid`, '');
      return ok;
    },
    helperConfigured: (path) => existsSync(`${path}.suid`),
    ...over,
  });
}

// One installer's steps, driven by the test: it pauses at the steps named in `holds` (its checkpoints, and `lock` for
// a wait on the install lock) until released, and passes the rest; `free()` lets it run on without pausing
function stepper(holds: string[]) {
  const paused = new Map<string, () => void>();
  let arrival: ((step: string) => void) | null = null;
  let running = false;
  const at = (): Promise<string> => (paused.size > 0 ? Promise.resolve([...paused.keys()][0]!) : new Promise((resolve) => (arrival = resolve)));
  const reached = async (step: string): Promise<void> => {
    while (!paused.has(step)) await new Promise<string>((resolve) => (arrival = resolve));
  };
  return {
    pass: (step: string): Promise<void> => {
      if (running || !holds.includes(step)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        paused.set(step, resolve);
        arrival?.(step);
      });
    },
    at,
    reached,
    release: async (step: string) => {
      await reached(step);
      const resume = paused.get(step)!;
      paused.delete(step);
      resume();
    },
    free: () => {
      running = true;
      for (const resume of paused.values()) resume();
      paused.clear();
    },
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

  // Two installers as two processes (render-install-racer.fixture.ts) holding the real lock (flock, so Linux's): started
  // together, one takes the lock and goes through every step, each released once the other is known to be waiting for
  // it; the other gets the lock once the first has finished, and finds the published entry
  it.runIf(process.platform === 'linux')('two processes at once leave one entry and nothing else', async () => {
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
      // a step is released once every racer still running and not waiting for the lock has reached it; a racer waiting
      // for the lock (the kernel holds it there) is marked through once no other racer runs
      const release = () => {
        const running = [0, 1].filter((k) => results[k] === undefined);
        if (running.length === 0) return clearTimeout(timer), done();
        if (running.some((k) => at[k] === null)) return;
        const stepping = running.filter((k) => at[k] !== 'lock');
        const go = stepping.length === 0 ? running : stepping;
        if (new Set(go.map((k) => at[k])).size !== 1) return;
        steps.push(at[go[0]!]!);
        for (const k of go) {
          racers[k]!.send({ go: at[k] });
          at[k] = null;
        }
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
    expect(steps).toEqual(['unpacked', 'chown', 'chmod', 'publishing', 'lock']); // the second held at the lock throughout
    expect(results.map((result) => (result as { state?: string }).state).sort()).toEqual(['installed', 'present']);
    expect(listing()).toEqual(['.install-lock', runtimeName(pin)]); // the lock's file stays: a lock is on the file
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

  // The panel's interleaving (PR #428, scalpel-2#1): B finds the staging A unpacked with its helper unset, and B's chown
  // lands after A's final helper check, clearing the set-user-ID bit A set, before A renames the staging into place.
  // The install lock, held from the staging through publication, keeps B off the staging until A has published.
  it('a second installer never touches a staging another is publishing: no entry is published with its helper cleared', async () => {
    waitsExpected = true;
    const a = stepper(['chown', 'chmod', 'publishing']);
    const b = stepper(['chown', 'chmod', 'lock']);
    const said: string[] = [];
    const installedA = installRenderRuntime(markerDeps({ checkpoint: a.pass }));
    await a.reached('chown'); // A owns the staging, found its helper unset; its chown next
    const installedB = installRenderRuntime(markerDeps({ checkpoint: b.pass, notice: (line) => (said.push(line), void b.pass('lock')) }));
    const bAt = await b.at(); // held off at the lock, or (with nothing excluding it) at its own chown of A's staging
    await a.release('chown');
    await a.release('chmod');
    await a.reached('publishing'); // A's helper set and checked; its rename next
    if (bAt === 'chown') {
      await b.release('chown'); // B's delayed chown lands now
      await b.reached('chmod');
    }
    await a.release('publishing');
    const outcomeA = await installedA;
    b.free();
    const outcomeB = await installedB;
    expect(outcomeA).toMatchObject({ state: 'installed', entry: entry() });
    expect(existsSync(join(entry(), 'chrome-sandbox.suid')), 'the published helper keeps the mode A set').toBe(true);
    expect(outcomeB).toEqual({ state: 'present', entry: entry(), pruned: [] });
    expect(said).toEqual(['waiting for another runtime install to finish']); // once
    expect(sudoCalls()).toEqual([`sudo -n chown root:root ${join(staging(), 'chrome-sandbox')}`, `sudo -n chmod 4755 ${join(staging(), 'chrome-sandbox')}`]); // A's alone
    expect(listing()).toEqual([runtimeName(pin)]);
  });

  // The panel's second interleaving (PR #428, scalpel-2#2): A finds the entry unusable; B replaces it with a verified one
  // while A reads the processes running from it; A must not then retire B's entry (its own download then failing would
  // leave nothing published)
  it('a replacement never retires an entry published, usable, after it found the old one unusable', async () => {
    await installRenderRuntime(markerDeps());
    rmSync(join(entry(), 'chrome-sandbox.suid')); // the entry's helper lost its mode
    let published = false;
    const publishVerified = () => {
      rmSync(entry(), { recursive: true });
      mkdirSync(entry());
      for (const name of ['electron', 'chrome-sandbox', 'chrome-sandbox.suid']) writeFileSync(join(entry(), name), name);
      writeFileSync(join(entry(), 'manifest.json'), JSON.stringify({ version: pin.version, sha256: pin.sha256, sandbox: 'suid', installedAt: 'by B' }));
      published = true;
    };
    const outcome = installRenderRuntime(
      markerDeps({
        processes: () => (published || publishVerified(), running),
        download: () => Promise.reject(new Error('offline')),
      }),
    );
    await expect(outcome).resolves.toEqual({ state: 'present', entry: entry(), pruned: [] });
    expect(JSON.parse(readFileSync(join(entry(), 'manifest.json'), 'utf8'))).toMatchObject({ installedAt: 'by B' });
    expect(listing()).toEqual([runtimeName(pin)]);
  });

  // The panel's third interleaving (PR #428 task review): an uninstall's removal of the staging lands while an installer
  // that has checked its helper renames the staging into place. The uninstall holds the same lock, so it runs once the
  // entry is published whole.
  it('an uninstall while an install publishes waits for it: no entry is published without its helper', async () => {
    waitsExpected = true;
    const a = stepper(['publishing']);
    const installed = installRenderRuntime(markerDeps({ checkpoint: a.pass }));
    await a.reached('publishing'); // A's helper set and checked, its manifest written; its rename next
    let whole: boolean | null = null;
    const uninstalled = uninstallRenderRuntime(
      markerDeps({
        processes: () => {
          whole ??= existsSync(join(entry(), 'chrome-sandbox.suid')) && existsSync(join(entry(), 'manifest.json'));
          return running;
        },
      }),
    );
    await a.release('publishing');
    await expect(installed).resolves.toMatchObject({ state: 'installed', entry: entry() });
    await expect(uninstalled).resolves.toEqual({ removed: [runtimeName(pin)] });
    expect(whole, 'the uninstall began on the entry as published, helper and all').toBe(true);
    expect(listing()).toEqual([]);
  });

  // The real lock where flock(1) cannot run (here a PATH without it): a named refusal before anything is fetched or
  // unpacked, never an install without the lock
  it('refuses, naming flock, where flock cannot run: never an unlocked install', async () => {
    const path = process.env.PATH;
    process.env.PATH = bin; // xvfb-run alone
    try {
      await expect(installRenderRuntime(deps({ lock: undefined }))).rejects.toThrow(/cannot lock .*\.install-lock: flock \(util-linux\) did not run/);
      await expect(uninstallRenderRuntime(deps({ lock: undefined }))).rejects.toThrow(/flock \(util-linux\) did not run/);
    } finally {
      process.env.PATH = path;
    }
    expect(downloads).toEqual([]);
    expect(unzipped).toBe(0);
    expect(listing()).toEqual([]);
  });

  // The lock lost midway (its holder ended while the installer lives: PR #428 re-review): nothing that no rerun undoes is
  // done after the loss, nothing is published, and a whole staging is left for the next run
  it('stops when the lock is lost during the download: no helper set, nothing published, the staging left', async () => {
    const download = async (_url: string, to: string) => {
      writeFileSync(to, zipBytes);
      loseLock('9');
    };
    await expect(installRenderRuntime(markerDeps({ download }))).rejects.toThrow(/lost the install lock: its holder exited \(status 9\)/);
    expect(sudoCalls()).toEqual([]);
    expect(listing()).toEqual([stagingName(pin)]);
  });

  it('stops when the lock is lost at the helper step or before the rename: nothing published', async () => {
    for (const step of ['chown', 'chmod', 'publishing']) {
      rmSync(root(), { recursive: true, force: true });
      lockLost = null;
      calls = [];
      const checkpoint = (at: string) => void (at === step && loseLock('SIGKILL'));
      await expect(installRenderRuntime(markerDeps({ checkpoint })), step).rejects.toThrow(/lost the install lock/);
      expect(existsSync(entry()), `lost at ${step}`).toBe(false);
      expect(sudoCalls(), `lost at ${step}`).toEqual(step === 'chown' ? [] : step === 'chmod' ? [`sudo -n chown root:root ${join(staging(), 'chrome-sandbox')}`] : expect.any(Array));
      expect(listing(), `lost at ${step}`).toEqual([stagingName(pin)]);
    }
  });

  it('an uninstall stops when the lock is lost before it removes anything', async () => {
    await installRenderRuntime(markerDeps());
    const outcome = uninstallRenderRuntime(markerDeps({ processes: () => (loseLock('9'), running) }));
    await expect(outcome).rejects.toThrow(/lost the install lock/);
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
    await expect(uninstallRenderRuntime(deps())).rejects.toThrow(/a render host runs from .* \(1 process\)/);
    expect(existsSync(entry())).toBe(true);
    running = [];
    expect(await uninstallRenderRuntime(deps())).toEqual({ removed: [runtimeName(pin)] });
    expect(listing()).toEqual([]);
    expect(reading()).toEqual({ available: false, reason: 'the render runtime 44.4.5 is not installed on vm-1: run mawsd render install' });
  });

  it('removes a staging that waits for privilege, and with nothing installed removes nothing', async () => {
    privileged = false;
    await installRenderRuntime(deps());
    expect(await uninstallRenderRuntime(deps())).toEqual({ removed: [stagingName(pin)] });
    expect(await uninstallRenderRuntime(deps())).toEqual({ removed: [] });
  });
});

// The real lock (flock(1), util-linux: Linux's)
describe.runIf(process.platform === 'linux')('the cache lock', () => {
  it('is exclusive: a second taker waits, says so once, and holds it once the first lets go', async () => {
    const path = join(dir, '.install-lock');
    const first = await flockFile(path, () => expect.unreachable('the first taker waited'));
    let said = 0;
    let saidOnce: () => void = () => {};
    const waiting = new Promise<void>((resolve) => (saidOnce = resolve));
    let secondHolds = false;
    const second = flockFile(path, () => (said += 1, saidOnce())).then((hold) => ((secondHolds = true), hold));
    await waiting; // its try without blocking found the lock held
    expect(secondHolds).toBe(false);
    await first.release();
    await (await second).release();
    expect(secondHolds).toBe(true);
    expect(said).toBe(1);
  });

  it('says it is lost when its holder child ends before the release', async () => {
    const hold = await flockFile(join(dir, '.install-lock'), () => expect.unreachable('waited'));
    hold.check();
    expect(spawnSync('pkill', ['-KILL', '-P', String(process.pid), '-x', 'flock']).status).toBe(0);
    const lost = () => {
      try {
        hold.check();
        return false;
      } catch {
        return true;
      }
    };
    while (!lost()) await new Promise((resolve) => setImmediate(resolve)); // the child's exit, once node has read it
    expect(() => hold.check()).toThrow(/lost the install lock .*: its holder exited \(status SIGKILL\)/);
    await hold.release();
  });

  it('is let go when its holder dies, however it dies', async () => {
    const path = join(dir, '.install-lock');
    const bundle = join(dir, 'holder.mjs');
    buildSync({
      stdin: { contents: `import { flockFile } from './render-install';\nawait flockFile(process.argv[2], () => {});\nprocess.send('held');\nsetInterval(() => {}, 60_000);\n`, resolveDir: __dirname, loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: bundle,
      logLevel: 'silent',
    });
    const holder = fork(bundle, [path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    await new Promise<void>((resolve) => holder.once('message', () => resolve()));
    let said = 0;
    const taken = flockFile(path, () => (said += 1));
    holder.kill('SIGKILL'); // no release ran: its pipe to the flock ends with it
    await (await taken).release();
    expect(said).toBeLessThanOrEqual(1);
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
