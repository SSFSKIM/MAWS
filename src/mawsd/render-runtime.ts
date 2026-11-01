// The render runtime on Linux as `mawsd` reads it (P5 O5 M6; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M6,
// Interfaces §J): the pinned Electron's Linux build the render host runs under, outside the releases in a cache of its
// own, `~/.local/share/maws/mawsd/render/<version>-<sha256 of the zip, 12 hex>/`, immutable once published (its
// manifest.json written and the directory renamed into place by render-install.ts, the command line's transaction).
// A build names the version it needs in `packaging/mawsd/electron.json` at its root (the pack copies the file; a
// checkout has it), so the daemon resolves the entry for its own release's pin at each check: a release pinning another
// version reads the runtime absent until `mawsd render install` fetches it.
//
// On the daemon's run path, so it only reads: the pin, the entry's manifest, the sandbox helper's mode and the PATH for
// xvfb-run, a few stats per check, nothing loaded or held. The reasons are the sentences the render tools answer and the
// session capabilities carry (`the render service is unavailable on <machine>: <reason>`).
import { existsSync, lstatSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export const renderCacheRoot = (home: string): string => join(home, '.local', 'share', 'maws', 'mawsd', 'render'); // beside release.ts's releases
export const ELECTRON_PIN = join('packaging', 'mawsd', 'electron.json');
export const RUNTIME_MANIFEST = 'manifest.json';
export const SANDBOX_HELPER = 'chrome-sandbox';
export const RUNTIME_BINARY = 'electron';

// The pin for one target: `electron-v<version>-<target>.zip` and its sha256
export interface ElectronPin {
  version: string;
  sha256: string;
  target: string; // linux-<arch>
}

// What a published entry's manifest.json says (an entry is published only with its helper configured)
export interface RuntimeManifest {
  version: string;
  sha256: string;
  sandbox: 'suid';
  installedAt: string;
}

export const runtimeName = (pin: ElectronPin): string => `${pin.version}-${pin.sha256.slice(0, 12)}`;
export const stagingName = (pin: ElectronPin): string => `.staged-${runtimeName(pin)}`;
export const zipName = (pin: ElectronPin): string => `electron-v${pin.version}-${pin.target}.zip`;

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

// The pin `root` (a release, or a checkout) carries for `arch`, or null when it names none
export function readElectronPin(root: string, arch: string): ElectronPin | null {
  let pinned: { version?: unknown; sha256?: Record<string, unknown> };
  try {
    pinned = JSON.parse(readFileSync(join(root, ELECTRON_PIN), 'utf8')) as typeof pinned;
  } catch {
    return null;
  }
  const target = `linux-${arch}`;
  const sum = pinned.sha256?.[target];
  if (typeof pinned.version !== 'string' || !VERSION.test(pinned.version) || typeof sum !== 'string' || !SHA256.test(sum)) return null;
  return { version: pinned.version, sha256: sum, target };
}

// The manifest of a published entry for `pin`, or null
export function readManifest(dir: string, pin: ElectronPin): RuntimeManifest | null {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, RUNTIME_MANIFEST), 'utf8')) as Partial<RuntimeManifest>;
    return manifest.version === pin.version && manifest.sha256 === pin.sha256 && manifest.sandbox === 'suid' && typeof manifest.installedAt === 'string' ? (manifest as RuntimeManifest) : null;
  } catch {
    return null;
  }
}

// Chromium's SUID sandbox helper as Ubuntu 24.04 needs it (its user namespaces are restricted): a regular file owned by
// root with mode 4755 (FINDINGS §1.3)
export function sandboxHelperConfigured(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && stat.uid === 0 && (stat.mode & 0o7777) === 0o4755; // setuid, rwxr-xr-x
  } catch {
    return false;
  }
}

export const notInstalled = (pin: ElectronPin | null, machine: string): string => (pin === null ? `the render runtime is not installed on ${machine}` : `the render runtime ${pin.version} is not installed on ${machine}: run mawsd render install`);
export const sandboxNotConfigured = (machine: string): string => `Chromium’s sandbox is not configured on ${machine}: run mawsd render install with sudo`;
export const noDisplay = (machine: string): string => `the virtual display the render host needs (xvfb-run, the xvfb package) is not installed on ${machine}`;

// `name` on `path` (a PATH value), or null
export function onPath(name: string, path: string | undefined): string | null {
  for (const dir of (path ?? '/usr/bin:/bin').split(delimiter)) {
    if (dir === '' || !dir.startsWith('/')) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type RenderRuntimeReading = { available: true; electron: string; xvfbRun: string } | { available: false; reason: string };

export interface RuntimeQuery {
  appRoot: string; // the running build's root: its release (or checkout), where its pin is
  home: string;
  arch: string;
  machine: string;
  path: string | undefined; // the daemon's PATH, where xvfb-run is found
  helperConfigured?: (path: string) => boolean; // a test's stand-in for the root-owned helper
}

export function readRenderRuntime({ appRoot, home, arch, machine, path, helperConfigured = sandboxHelperConfigured }: RuntimeQuery): RenderRuntimeReading {
  const pin = readElectronPin(appRoot, arch);
  if (pin === null) return { available: false, reason: notInstalled(null, machine) };
  const root = renderCacheRoot(home);
  const entry = join(root, runtimeName(pin));
  if (readManifest(entry, pin) === null || !existsSync(join(entry, RUNTIME_BINARY))) {
    // a verified, unpacked runtime waiting for the one step that needs root
    return { available: false, reason: existsSync(join(root, stagingName(pin))) ? sandboxNotConfigured(machine) : notInstalled(pin, machine) };
  }
  if (!helperConfigured(join(entry, SANDBOX_HELPER))) return { available: false, reason: sandboxNotConfigured(machine) };
  const xvfbRun = onPath('xvfb-run', path);
  if (xvfbRun === null) return { available: false, reason: noDisplay(machine) };
  return { available: true, electron: join(entry, RUNTIME_BINARY), xvfbRun };
}

export const CACHE_WATCH_DEBOUNCE_MS = 500; // an install's unpack, sudo and publish settle well within it

// The watch the daemon keeps on the cache while a session's capabilities are tracked (fix wave 1): an install publishes
// by renames in the cache's root (its unpack, its staging, its entry) and an uninstall removes entries there, so one
// non-recursive watch of the root sees each, and `onChange` is called once things have been quiet for `debounceMs`. While
// the root does not exist, the nearest directory above it that does is watched instead, until the root appears. One
// descriptor, holding no loop open; the caller decides what changed (the reading is taken again, nothing is cached here).
export function watchRenderCache(root: string, onChange: () => void, { debounceMs = CACHE_WATCH_DEBOUNCE_MS }: { debounceMs?: number } = {}): { close(): void } {
  let watcher: FSWatcher | null = null;
  let watched: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const nearest = (): string => {
    let dir = root;
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    return dir;
  };
  const unwatch = () => {
    watcher?.close();
    watcher = null;
    watched = null;
  };
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (closed) return;
      arm(); // first: a change after this reaches the new watch, one before it the reading onChange takes
      onChange();
    }, debounceMs);
    timer.unref();
  };
  const arm = () => {
    const dir = nearest();
    if (dir === watched) return;
    unwatch();
    try {
      watcher = watch(dir, { persistent: false }, changed);
      watcher.on('error', () => (unwatch(), changed())); // the directory went away: the next arm finds what is left
      watched = dir;
    } catch {
      changed(); // gone between the check and the watch: tried again once quiet
    }
  };
  arm();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      unwatch();
    },
  };
}

