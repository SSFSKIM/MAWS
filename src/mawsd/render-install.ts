// `mawsd render install | uninstall | status` (P5 O5 M6; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M6's
// decisions, Interfaces §J): the Linux render runtime's install as a transaction, in the command line's chunk (the daemon
// only reads what this publishes, render-runtime.ts).
//
// An install, for the pin of the build it runs from, holds the cache root's lock throughout (`flock(1)` on
// `.install-lock`, which the kernel drops when its holder ends, however it ends; an uninstall holds it too): nothing when
// the entry is published already. Otherwise the zip, from beside the pack (`pnpm mawsd:pack --render` leaves it there)
// or downloaded from Electron's GitHub release, is checked against the pin's sha256 before anything is unpacked; it is
// unpacked into a directory of this installer's own (`.unpack-<entry>-<pid>`), marked whole, and renamed into the
// staging directory (`.staged-<entry>`), so a staging directory is always a whole, verified unpack. Then the one step
// that needs root: `sudo -n chown root:root` and `chmod 4755` of the staging's `chrome-sandbox` (Ubuntu 24.04 refuses
// the user-namespace sandbox, FINDINGS §1.3), never anything under the releases. Without privilege the staging stays and
// the install says so; a privileged retry finds it and completes it. Last the manifest is written and the staging
// renamed into place: an entry is published only with its helper configured. The lock is what makes that hold: no other
// installer's chown (which clears the set-user-ID bit) and no uninstall's removal lands on a staging between this one's
// helper check and its rename, and a replacement never retires an entry another installer published. A second installer
// waits for the lock, saying so once, and then finds the entry present. Then every entry nothing pins (this build, the
// installed releases) and no process runs from (`/proc/<pid>/exe` under it, as release.ts reads a running release) is
// pruned.
//
// An uninstall, holding the same lock, removes this pin's entry (and its staging), refusing while a render host runs
// from it, and prunes as an install does. A running daemon needs no telling: it reads the cache at each check, so it reports the runtime absent at
// the next one.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { releasesRoot, type RunningProcess } from './release';
import { readElectronPin, readManifest, RUNTIME_BINARY, RUNTIME_MANIFEST, renderCacheRoot, runtimeName, SANDBOX_HELPER, sandboxHelperConfigured, stagingName, zipName, type ElectronPin, type RuntimeManifest } from './render-runtime';
import type { CommandRunner } from './units/unit';

const WHOLE = '.maws-unpacked'; // an unpack's mark: written once unzip finished, holding the zip's sha256
const UNZIP_TIMEOUT_MS = 300_000;
const LOCK = '.install-lock'; // the cache root's lock file (flock(1)'s; never removed, since a lock is on the file)
const LOCKED = 'locked'; // what the lock's holder process prints once it holds the lock
const CONTENDED = 75; // flock --nonblock's exit when another holds the lock

export interface RenderInstallDeps {
  home: string;
  arch: string;
  uid: number;
  pin: ElectronPin | null; // the pin of the build this command line is
  packZip: string | null; // the zip beside the pack this command line runs from, if any
  run: CommandRunner; // unzip, sudo, ldd
  download(url: string, to: string): Promise<void>;
  processes(): RunningProcess[]; // /proc's, for the entries in use
  helperConfigured?(path: string): boolean; // a test's stand-in for the root-owned helper
  now(): number;
  checkpoint?(step: 'unpacked' | 'chown' | 'chmod' | 'publishing'): Promise<void> | void; // a test's barrier between the transaction's steps
  lock?: FileLock; // the cache root's lock (flockFile; a test's in-process stand-in where there is no flock)
  notice?(line: string): void; // a line for the person running the install (the command line's stderr)
}

// An exclusive lock on `path`, resolved once held; `waiting` is called once if another holder makes it wait
export type FileLock = (path: string, waiting: () => void) => Promise<LockHold>;
export interface LockHold {
  check(): void; // throws once the lock is lost (its holder ended before the release): checked before each step no rerun undoes
  release(): Promise<void>; // resolved once let go
}

export type InstallOutcome =
  | { state: 'present'; entry: string; pruned: string[] }
  | { state: 'installed'; entry: string; source: 'pack' | 'download' | 'staging'; pruned: string[] }
  | { state: 'staged'; staging: string; why: string }; // verified and unpacked; its helper needs root

export const releaseUrl = (pin: ElectronPin): string => `https://github.com/electron/electron/releases/download/v${pin.version}/${zipName(pin)}`;

export async function installRenderRuntime(deps: RenderInstallDeps): Promise<InstallOutcome> {
  const pin = pinOf(deps);
  if (deps.uid === 0) throw new Error('run mawsd render install as the user mawsd runs as, not as root: it asks sudo -n for the one step that needs root');
  const helperConfigured = deps.helperConfigured ?? sandboxHelperConfigured;
  const root = renderCacheRoot(deps.home);
  const entry = join(root, runtimeName(pin));
  const staging = join(root, stagingName(pin));
  const pruned = (): string[] => (hold.check(), prune(deps, root)); // under the lock, still held
  const present = (): InstallOutcome => ({ state: 'present', entry, pruned: pruned() });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const hold = await lockCache(root, deps);
  try {
    sweepAbandoned(root);
    // The entry, if there: published (nothing to do), or unusable (its helper lost its mode, its manifest is gone or
    // another pin's) and replaced whole, never repaired in place (an entry is immutable once published) and never taken
    // as installed. Read last before it is retired, so an entry published usable meanwhile is kept. Moved aside first,
    // so the entry's name is absent at once and a reader never sees it half removed; refused while a render host runs
    // from it.
    if (existsSync(entry)) {
      const users = usersOf(entry, deps.processes());
      if (published(entry, pin, helperConfigured)) return present();
      if (users > 0) throw new Error(`refusing to replace ${entry}, whose sandbox helper is not configured: a render host runs from it (${users} process${users === 1 ? '' : 'es'}); run mawsd render install again after its quiet period`);
      hold.check();
      const aside = join(root, `.retired-${runtimeName(pin)}-${process.pid}`);
      rmSync(aside, { recursive: true, force: true });
      renameSync(entry, aside);
      rmSync(aside, { recursive: true, force: true });
    }

    let source: 'pack' | 'download' | 'staging' = 'staging';
    if (!whole(staging, pin)) {
      rmSync(staging, { recursive: true, force: true }); // a killed install's half (no mark): cleaned
      source = await unpackInto(deps, pin, root, staging);
    }
    const helper = join(staging, SANDBOX_HELPER);
    if (!helperConfigured(helper)) {
      for (const args of [['-n', 'chown', 'root:root', helper], ['-n', 'chmod', '4755', helper]] as const) {
        await deps.checkpoint?.(args[1]); // a test's barrier: each privileged step next
        hold.check(); // the lock lost (during the download, say): the staging stays, whole, for the next run
        const done = deps.run('sudo', [...args]);
        if (done.status !== 0) return { state: 'staged', staging, why: `sudo ${args.join(' ')} failed: ${(done.stderr || done.stdout).trim() || `exit ${done.status ?? 'signal'}`}` };
      }
      if (!helperConfigured(helper)) return { state: 'staged', staging, why: `${helper} is not root-owned with mode 4755 after sudo` };
    }
    const manifest: RuntimeManifest = { version: pin.version, sha256: pin.sha256, sandbox: 'suid', installedAt: new Date(deps.now()).toISOString() };
    hold.check();
    const written = join(staging, `.${RUNTIME_MANIFEST}.${process.pid}`);
    writeFileSync(written, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(written, join(staging, RUNTIME_MANIFEST));
    await deps.checkpoint?.('publishing'); // a test's barrier: the staging whole and ready, its rename next
    hold.check(); // never published after the lock is lost
    try {
      // The staging keeps its whole-unpack mark into the entry: until this rename it is a whole unpack a later installer
      // may complete, and after it the mark is inert (an entry is read by its manifest)
      renameSync(staging, entry);
    } catch (error) {
      // Something that takes no lock (a hand) put an entry there or took the staging meanwhile: an entry there is taken
      // as installed only if it passes the same check this install's own would, helper and all
      if (!published(entry, pin, helperConfigured)) {
        throw new Error(`cannot publish ${entry} (${error instanceof Error ? error.message : String(error)}): ${existsSync(entry) ? 'an entry another install left there is not usable' : 'its staging went away'}; run mawsd render install again`, { cause: error });
      }
      rmSync(staging, { recursive: true, force: true });
      return present();
    }
    return { state: 'installed', entry, source, pruned: pruned() };
  } finally {
    await hold.release();
  }
}

export async function uninstallRenderRuntime(deps: RenderInstallDeps): Promise<{ removed: string[] }> {
  const root = renderCacheRoot(deps.home);
  if (!existsSync(root)) return { removed: [] };
  const hold = await lockCache(root, deps);
  try {
    const removed: string[] = [];
    if (deps.pin !== null) {
      const name = runtimeName(deps.pin);
      const users = usersOf(join(root, name), deps.processes());
      if (users > 0) throw new Error(`refusing to remove ${join(root, name)}: a render host runs from it (${users} process${users === 1 ? '' : 'es'}); it ends after its quiet period`);
      for (const dir of [name, stagingName(deps.pin)]) {
        if (!existsSync(join(root, dir))) continue;
        hold.check();
        rmSync(join(root, dir), { recursive: true, force: true });
        removed.push(dir);
      }
    }
    hold.check();
    return { removed: [...removed, ...prune({ ...deps, pin: null }, root)] };
  } finally {
    await hold.release();
  }
}

export interface RenderRuntimeStatus {
  pin: ElectronPin | null;
  state: 'installed' | 'staged' | 'absent' | 'unpinned';
  dir: string | null;
  sandbox: 'configured' | 'not configured' | null;
  installedAt: string | null;
  missingLibraries: string[] | null; // what ldd finds missing for the runtime's binary (the packages of FINDINGS §1.1)
}

export function renderRuntimeStatus(deps: RenderInstallDeps): RenderRuntimeStatus {
  const { pin } = deps;
  if (pin === null) return { pin, state: 'unpinned', dir: null, sandbox: null, installedAt: null, missingLibraries: null };
  const helperConfigured = deps.helperConfigured ?? sandboxHelperConfigured;
  const root = renderCacheRoot(deps.home);
  const entry = join(root, runtimeName(pin));
  const staging = join(root, stagingName(pin));
  const manifest = readManifest(entry, pin);
  const dir = manifest !== null ? entry : whole(staging, pin) ? staging : null;
  if (dir === null) return { pin, state: 'absent', dir: null, sandbox: null, installedAt: null, missingLibraries: null };
  return {
    pin,
    state: dir === entry ? 'installed' : 'staged',
    dir,
    sandbox: helperConfigured(join(dir, SANDBOX_HELPER)) ? 'configured' : 'not configured',
    installedAt: manifest?.installedAt ?? null,
    missingLibraries: missingLibraries(deps.run, join(dir, RUNTIME_BINARY)),
  };
}

// The download: streamed to a file, its sha256 taken on the way
export async function downloadTo(url: string, to: string): Promise<void> {
  const response = await globalThis.fetch(url);
  if (!response.ok || response.body === null) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), createWriteStream(to));
}

// --- the steps ---------------------------------------------------------------------------------------------------------

function pinOf(deps: RenderInstallDeps): ElectronPin {
  if (deps.pin === null) throw new Error(`this build of mawsd pins no render runtime for linux-${deps.arch} (packaging/mawsd/electron.json)`);
  return deps.pin;
}

// The zip, verified, unpacked whole into the staging directory; where it came from
async function unpackInto(deps: RenderInstallDeps, pin: ElectronPin, root: string, staging: string): Promise<'pack' | 'download'> {
  const own = join(root, `.unpack-${runtimeName(pin)}-${process.pid}`);
  let zip: string;
  let source: 'pack' | 'download';
  let downloaded: string | null = null;
  if (deps.packZip !== null && existsSync(deps.packZip)) {
    zip = deps.packZip;
    source = 'pack';
  } else {
    downloaded = join(root, `.download-${runtimeName(pin)}-${process.pid}.zip`);
    zip = downloaded;
    source = 'download';
    await deps.download(releaseUrl(pin), downloaded);
  }
  try {
    const sum = sha256Of(zip);
    if (sum !== pin.sha256) throw new Error(`refused: ${source === 'pack' ? zip : zipName(pin)} has sha256 ${sum}, not the pinned ${pin.sha256} (packaging/mawsd/electron.json)`);
    rmSync(own, { recursive: true, force: true });
    mkdirSync(own, { mode: 0o700 });
    const unzipped = deps.run('unzip', ['-q', '-o', zip, '-d', own], { timeoutMs: UNZIP_TIMEOUT_MS });
    if (unzipped.status !== 0) throw new Error(`unzip ${zip} failed (${unzipped.status ?? 'signal'}): ${(unzipped.stderr || unzipped.stdout).trim()}${unzipped.status === 127 ? ' (the unzip package)' : ''}`);
    for (const name of [RUNTIME_BINARY, SANDBOX_HELPER]) if (!existsSync(join(own, name))) throw new Error(`${zipName(pin)} has no ${name}`);
    writeFileSync(join(own, WHOLE), `${pin.sha256}\n`);
    await deps.checkpoint?.('unpacked'); // a test's barrier: this installer's own unpack whole, its rename next
    renameSync(own, staging);
    return source;
  } finally {
    rmSync(own, { recursive: true, force: true });
    if (downloaded !== null) rmSync(downloaded, { force: true });
  }
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// A staging directory that is a whole unpack of this pin's zip
function whole(staging: string, pin: ElectronPin): boolean {
  try {
    return readFileSync(join(staging, WHOLE), 'utf8').trim() === pin.sha256 && existsSync(join(staging, RUNTIME_BINARY));
  } catch {
    return false;
  }
}

function published(entry: string, pin: ElectronPin, helperConfigured: (path: string) => boolean): boolean {
  return readManifest(entry, pin) !== null && existsSync(join(entry, RUNTIME_BINARY)) && helperConfigured(join(entry, SANDBOX_HELPER));
}

// The cache root's lock, held; its release
function lockCache(root: string, deps: RenderInstallDeps): Promise<LockHold> {
  return (deps.lock ?? flockFile)(join(root, LOCK), () => deps.notice?.('waiting for another runtime install to finish'));
}

// The lock as flock(1) holds it (util-linux; the runtime is Linux's): a child `flock` holding the lock runs a `cat` on a
// pipe from this process, so it is held until the pipe ends, which this process's release does and its exit, however it
// exits, does too; the kernel then drops the lock. Tried without blocking first, so a wait is said once. The child
// ending before the release is the lock lost, which `check` and the release then say: read from the child's exit once
// node has seen it, and from /proc at each check, since the exit is not seen while synchronous work (a sudo) runs.
export async function flockFile(path: string, waiting: () => void, running: (pid: number) => boolean = procRunning): Promise<LockHold> {
  const held = await holdFlock(path, true, running);
  if (held !== null) return held;
  waiting();
  return (await holdFlock(path, false, running))!;
}

// Whether a child of this process still runs: its /proc/<pid>/stat there and its state not Z (exited, not yet reaped)
function procRunning(pid: number): boolean {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return false;
  }
  return stat[stat.lastIndexOf(')') + 2] !== 'Z';
}

function holdFlock(path: string, nonblock: boolean, running: (pid: number) => boolean): Promise<LockHold | null> {
  return new Promise((resolve, reject) => {
    const args = ['--exclusive', ...(nonblock ? ['--nonblock', '--conflict-exit-code', String(CONTENDED)] : []), path, 'sh', '-c', `echo ${LOCKED}; exec cat`];
    const child = spawn('flock', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    let out = '';
    let err = '';
    let holding = false;
    let released = false;
    let lost: string | null = null; // the holder's exit status, when it ended before the release
    child.stdin.on('error', () => {}); // a holder already gone: its pipe refuses the end
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      out += chunk;
      if (holding || !out.includes(`${LOCKED}\n`)) return;
      holding = true;
      const check = () => {
        if (lost === null && !released && !running(child.pid!)) lost = 'unreaped';
        if (lost !== null) throw new Error(`lost the install lock ${path}: its holder exited (status ${lost}); run mawsd render install again`);
      };
      resolve({
        check,
        release: async () => {
          let loss: unknown = null;
          try {
            check(); // a loss found only now is said, not let go with the lock
          } catch (error) {
            loss = error;
          }
          released = true;
          child.stdin.end();
          await exited;
          if (loss !== null) throw loss;
        },
      });
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
    child.once('error', (error) => reject(new Error(`cannot lock ${path}: flock (util-linux) did not run (${error.message})`, { cause: error })));
    child.once('exit', (code, signal) => {
      if (holding) {
        if (!released) lost = String(code ?? signal);
        return;
      }
      if (nonblock && code === CONTENDED) resolve(null);
      else reject(new Error(`cannot lock ${path}: flock exited ${code ?? signal}${err.trim() === '' ? '' : `: ${err.trim()}`}`));
    });
  });
}

// An installer's own unpack, download or retired entry whose process is gone
function sweepAbandoned(root: string): void {
  for (const name of readdirSync(root)) {
    const owner = /^\.(?:unpack|download|retired)-.+-(\d+)(?:\.zip)?$/.exec(name)?.[1];
    if (owner !== undefined && !alive(Number(owner))) rmSync(join(root, name), { recursive: true, force: true });
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// The entries every installed release pins, beside this build's own
function pinnedNames(deps: RenderInstallDeps): Set<string> {
  const names = new Set<string>(deps.pin === null ? [] : [runtimeName(deps.pin)]);
  const releases = join(releasesRoot(deps.home), 'releases');
  let installed: string[] = [];
  try {
    installed = readdirSync(releases).filter((name) => !name.startsWith('.'));
  } catch {
    // no release installed (a checkout's command line)
  }
  for (const release of installed) {
    const pin = readElectronPin(join(releases, release), deps.arch);
    if (pin !== null) names.add(runtimeName(pin));
  }
  return names;
}

// Removes every entry nothing pins and no process runs from; the removed names, sorted
function prune(deps: RenderInstallDeps, root: string): string[] {
  const keep = pinnedNames(deps);
  const running = deps.processes();
  const pruned = readdirSync(root)
    .filter((name) => !name.startsWith('.') && !keep.has(name) && usersOf(join(root, name), running) === 0)
    .sort();
  for (const name of pruned) rmSync(join(root, name), { recursive: true, force: true });
  return pruned;
}

// How many running processes' executables lie under `dir`
function usersOf(dir: string, running: RunningProcess[]): number {
  const prefixes = [...new Set([dir, realOr(dir)])].map((path) => `${path}${sep}`);
  return running.filter(({ exe }) => exe !== null && prefixes.some((prefix) => exe.startsWith(prefix))).length;
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// ldd's `not found` libraries for `binary`, sorted; null when ldd could not run
function missingLibraries(run: CommandRunner, binary: string): string[] | null {
  const ldd = run('ldd', [binary]);
  if (ldd.status !== 0 && ldd.stdout === '') return null;
  return [...ldd.stdout.matchAll(/^\s*(\S+) => not found$/gm)].map((match) => match[1]!).sort();
}
