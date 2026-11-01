// The render runtime as the daemon reads it (P5 O5 M6; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces
// §J): the pin a build carries, the cache entry it names, and the reading the render seam and the session capabilities
// take at each check: available only with the entry published (its manifest), its sandbox helper setuid root, and a
// virtual display to run under. Each case runs in a scratch home; the helper's ownership is injected (a test cannot chown
// to root).
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readElectronPin, readRenderRuntime, renderCacheRoot, runtimeName, stagingName, watchRenderCache, type ElectronPin } from './render-runtime';

let dir: string;
let home: string;
let appRoot: string;
let bin: string;
const PIN = { version: '44.4.5', sha256: { 'linux-x64': 'a'.repeat(64), 'linux-arm64': 'b'.repeat(64) } };
const X64: ElectronPin = { version: '44.4.5', sha256: 'a'.repeat(64), target: 'linux-x64' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-render-runtime-'));
  home = join(dir, 'home');
  appRoot = join(dir, 'release');
  bin = join(dir, 'bin');
  mkdirSync(join(appRoot, 'packaging', 'mawsd'), { recursive: true });
  writeFileSync(join(appRoot, 'packaging', 'mawsd', 'electron.json'), JSON.stringify(PIN));
  mkdirSync(bin);
  writeFileSync(join(bin, 'xvfb-run'), '#!/bin/sh\n');
  chmodSync(join(bin, 'xvfb-run'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// A published entry as `mawsd render install` leaves it (render-install.ts)
function publish(pin: ElectronPin, manifest: Record<string, unknown> = { version: pin.version, sha256: pin.sha256, sandbox: 'suid', installedAt: '2026-10-31T00:00:00.000Z' }): string {
  const entry = join(renderCacheRoot(home), runtimeName(pin));
  mkdirSync(entry, { recursive: true });
  writeFileSync(join(entry, 'electron'), 'elf');
  writeFileSync(join(entry, 'chrome-sandbox'), 'elf');
  writeFileSync(join(entry, 'manifest.json'), JSON.stringify(manifest));
  return entry;
}

const read = (over: { helperConfigured?: (path: string) => boolean; path?: string; arch?: string } = {}) =>
  readRenderRuntime({ appRoot, home, arch: over.arch ?? 'x64', machine: 'vm-1', path: over.path ?? `${bin}:/nowhere`, helperConfigured: over.helperConfigured ?? (() => true) });

describe('the pin a build carries (packaging/mawsd/electron.json)', () => {
  it('is the version and this architecture’s sha256, from the build’s own root (a pack, or a checkout)', () => {
    expect(readElectronPin(appRoot, 'x64')).toEqual(X64);
    expect(readElectronPin(appRoot, 'arm64')).toEqual({ version: '44.4.5', sha256: 'b'.repeat(64), target: 'linux-arm64' });
  });

  it('is none for an architecture it names no build for, a root without the file, or a file that is not a pin', () => {
    expect(readElectronPin(appRoot, 'ia32')).toBeNull();
    expect(readElectronPin(join(dir, 'nowhere'), 'x64')).toBeNull();
    writeFileSync(join(appRoot, 'packaging', 'mawsd', 'electron.json'), JSON.stringify({ version: '44.4.5', sha256: { 'linux-x64': 'short' } }));
    expect(readElectronPin(appRoot, 'x64')).toBeNull();
  });

  it('is the repository’s Electron pin, moved together (package.json’s electron)', () => {
    const repo = join(__dirname, '..', '..');
    const pinned = JSON.parse(readFileSync(join(repo, 'packaging', 'mawsd', 'electron.json'), 'utf8')) as typeof PIN;
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
    expect(pinned.version).toBe(pkg.devDependencies.electron);
    expect(Object.keys(pinned.sha256).sort()).toEqual(['linux-arm64', 'linux-x64']);
    for (const sum of Object.values(pinned.sha256)) expect(sum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names its cache entry and the staging directory by the version and 12 hex of the zip’s sha256', () => {
    expect(runtimeName(X64)).toBe(`44.4.5-${'a'.repeat(12)}`);
    expect(stagingName(X64)).toBe(`.staged-44.4.5-${'a'.repeat(12)}`);
    expect(renderCacheRoot('/home/u')).toBe('/home/u/.local/share/maws/mawsd/render');
  });
});

describe('the reading the seam takes at each check', () => {
  it('is available with the published entry’s Electron, its sandbox helper setuid root and xvfb-run on the PATH', () => {
    const entry = publish(X64);
    const helpers: string[] = [];
    expect(read({ helperConfigured: (path) => (helpers.push(path), true) })).toEqual({ available: true, electron: join(entry, 'electron'), xvfbRun: join(bin, 'xvfb-run') });
    expect(helpers).toEqual([join(entry, 'chrome-sandbox')]);
  });

  it('says the runtime is not installed, and how to install it, when the pinned entry is absent (another version’s present)', () => {
    publish({ ...X64, version: '43.0.0' });
    expect(read()).toEqual({ available: false, reason: 'the render runtime 44.4.5 is not installed on vm-1: run mawsd render install' });
  });

  it('says so too for a build that pins none (a stand-in bundle, an architecture without a build)', () => {
    rmSync(join(appRoot, 'packaging'), { recursive: true });
    expect(read()).toEqual({ available: false, reason: 'the render runtime is not installed on vm-1' });
  });

  it('says the sandbox is not configured while the install waits for privilege (its staging directory), or the helper was changed since', () => {
    mkdirSync(join(renderCacheRoot(home), stagingName(X64)), { recursive: true });
    const sandbox = { available: false, reason: 'Chromium’s sandbox is not configured on vm-1: make sudo -n work for the user mawsd runs as, then run mawsd render install as that user, not as root' };
    expect(read()).toEqual(sandbox);
    publish(X64);
    expect(read({ helperConfigured: () => false })).toEqual(sandbox);
  });

  it('takes no entry whose manifest is missing, another pin’s or not sandboxed as published', () => {
    const entry = publish(X64, { version: '44.4.5', sha256: 'c'.repeat(64), sandbox: 'suid', installedAt: 'x' });
    expect(read()).toMatchObject({ available: false, reason: expect.stringMatching(/not installed/) });
    writeFileSync(join(entry, 'manifest.json'), JSON.stringify({ version: '44.4.5', sha256: X64.sha256, sandbox: 'none', installedAt: 'x' }));
    expect(read()).toMatchObject({ available: false, reason: expect.stringMatching(/not installed/) });
    rmSync(join(entry, 'manifest.json'));
    expect(read()).toMatchObject({ available: false, reason: expect.stringMatching(/not installed/) });
  });

  it('says the virtual display is missing when no xvfb-run is on the PATH', () => {
    publish(X64);
    expect(read({ path: '/nowhere:/neither' })).toEqual({ available: false, reason: 'the virtual display the render host needs (xvfb-run, the xvfb package) is not installed on vm-1' });
  });
});

// What an install's or an uninstall's publish looks like from the cache's root (fix wave 1): the daemon refreshes the
// tracked sessions' capabilities at each settled change, so a flip of the runtime is posted with no other transition
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function within(check: () => boolean, ms: number, what: string) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`not within ${ms} ms: ${what}`);
    await settle(10);
  }
}

describe('the watch on the render cache', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());
  // The watch in place before the scene acts: macOS's FSEvents, unlike Linux's inotify, starts its stream asynchronously
  // and may report the setup's own changes made just before it, so what it tells meanwhile is set aside (a spare change
  // costs the daemon one refresh that posts nothing)
  const watchFrom = async (root: string) => {
    const changes: number[] = [];
    close = watchRenderCache(root, () => void changes.push(Date.now()), { debounceMs: 150 }).close;
    await settle(400);
    changes.length = 0;
    return changes;
  };

  it('tells one settled change for an install’s staging, unpack and publish, and one for an uninstall', async () => {
    const root = renderCacheRoot(home);
    mkdirSync(root, { recursive: true });
    const changes = await watchFrom(root);
    const staging = join(root, stagingName(X64));
    mkdirSync(staging);
    writeFileSync(join(staging, 'electron'), 'elf');
    writeFileSync(join(staging, 'manifest.json'), '{}');
    renameSync(staging, join(root, runtimeName(X64)));
    await within(() => changes.length === 1, 5_000, 'the publish’s change');
    await settle(400);
    expect(changes).toHaveLength(1);
    rmSync(join(root, runtimeName(X64)), { recursive: true });
    await within(() => changes.length === 2, 5_000, 'the uninstall’s change');
    await settle(400);
    expect(changes).toHaveLength(2);
  });

  it('watches the nearest directory that exists until the cache does, then the cache itself', async () => {
    const root = renderCacheRoot(home);
    mkdirSync(join(home, '.local', 'share'), { recursive: true });
    const changes = await watchFrom(root);
    mkdirSync(root, { recursive: true });
    await within(() => changes.length === 1, 5_000, 'the cache’s making');
    await settle(200);
    mkdirSync(join(root, runtimeName(X64)));
    await within(() => changes.length === 2, 5_000, 'an entry inside the cache');
  });

  it('tells nothing once closed', async () => {
    const root = renderCacheRoot(home);
    mkdirSync(root, { recursive: true });
    const changes = await watchFrom(root);
    close!();
    mkdirSync(join(root, runtimeName(X64)));
    await settle(400);
    expect(changes).toEqual([]);
  });
});

