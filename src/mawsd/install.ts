// `mawsd install` and `uninstall` (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6 "The units",
// "install --delegation-id", "The wrapper"): the unit for any profile under any label, the LaunchAgent on macOS and the
// systemd user unit on Linux (units/), with its runners, home and paths injected, so a test drives fakes in a scratch
// home and the app (M7) and the Linux package (M8) call the same code with their own program.
//
// An install, in order: the delegation id checked; under the default label, the program checked to be a packaged build
// (residue 21: never a checkout; on Linux a pack, which M8 installs as the release directory's `current`, release.ts,
// and the unit runs `current`); the profile's `mawsd/` directory made private (a symlink, another
// owner or a wider mode refuses the install, writing no unit); with `--delegation-id`, the profile's machine ref minted
// with the delegation's id as its prefix when it has none (before the unit's first start, so the daemon reads it), and
// an existing ref without that prefix kept and the id reported as ignored (O14 residue 9: the CLI warns); the
// wrapper `<profile>/mawsd/bin/mawsd` and, for the default profile, its link `~/.local/bin/mawsd`; then the unit applied
// (units/unit.ts's `apply`: written when changed, loaded, the daemon restarted when a loaded unit changed, or when
// `current` now names another release). On Linux the release is activated as one transition: a failure after `current`
// flipped (the wrapper, the unit, its restart) puts `current` back, as a failed unit transition puts its file back, so a
// retry sees the flip again and completes it; only once it is active are older releases pruned. Idempotent.
// An uninstall unloads the unit (which ends `mawsd`; the hosts and their sessions keep running, and the next app
// connects to the engine host in either shape), removes its file, the wrapper and the link if it is ours.
//
// The label: `dev.maws.mawsd` (systemd: `mawsd.service`) for the default profile; any other profile, and every test,
// names its own, which the wrapper then carries for the commands run through it.
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DAEMON_FILES } from '@shared/daemon/files';
import { defaultProfileDir } from '@shared/daemon/profile';
import { makePrivateDirectory } from '@shared/host/private-listen';
import { readOrMintMachineRef } from '@shared/machine/identity-file';
import type { MachineRef } from '@shared/machine/ref';
import { installRelease, packOf, pruneReleases, releaseProgram, restoreCurrent, type InstalledRelease, type Pack } from './release';
import { launchdUnit } from './units/launchd';
import { systemdUnit } from './units/systemd';
import { DEFAULT_LABEL, UnitError, writeWhole, type Unit, type UnitChange, type UnitDeps, type UnitProgram, type UnitSpec } from './units/unit';

export interface InstallDeps extends UnitDeps {
  platform: NodeJS.Platform;
}

// The environment variable the wrapper names its profile's label in; read only for MAWS_USER_DATA's own profile.
export const LABEL_ENV = 'MAWS_MAWSD_LABEL';
const LABEL_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DELEGATION_ID = /^[0-9a-f]{32}$/; // a devcloud delegation's id (RL5; the remote layer's Decision Log 25)

// The unit manager for `label` on this platform; not available (code 2) where there is neither.
export function unitFor(label: string, deps: InstallDeps): Unit {
  if (deps.platform === 'darwin') return launchdUnit(label, deps);
  if (deps.platform === 'linux') return systemdUnit(label, deps);
  throw new UnitError(`mawsd has no unit manager on ${deps.platform}`, 2);
}

// Whether `profileDir` is the platform's default profile, by real path (either may not exist yet).
export function isDefaultProfile(profileDir: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): boolean {
  return real(profileDir) === real(defaultProfileDir(platform, env, home));
}

export interface LabelQuery {
  profileDir: string;
  profileFrom: 'flag' | 'env' | 'default'; // how the profile was named: --profile, MAWS_USER_DATA, or the platform's default
  labelFlag?: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
}

// The label the profile's unit goes by: `--label`; else the wrapper's MAWS_MAWSD_LABEL when the profile is MAWS_USER_DATA's;
// else the default label for the default profile; else none (a profile that names no unit, as a private daemon's).
export function resolveLabel(query: LabelQuery): string | null {
  const named = query.labelFlag ?? (query.profileFrom === 'env' ? query.env[LABEL_ENV] || undefined : undefined);
  if (named !== undefined) {
    if (!LABEL_FORMAT.test(named)) throw new UnitError(`a unit label is letters, digits, dots, dashes and underscores; refusing ${JSON.stringify(named)}`);
    return named;
  }
  return isDefaultProfile(query.profileDir, query.platform, query.env, query.home) ? DEFAULT_LABEL : null;
}

export const wrapperPath = (profileDir: string): string => join(profileDir, DAEMON_FILES.dir, DAEMON_FILES.bin, 'mawsd');

const sh = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

// The command line for one profile: the unit's program, with the profile and its label. ELECTRON_RUN_AS_NODE makes the
// app binary Node on a Mac and is inert under a plain Node.
export function wrapperText({ label, profileDir, program }: UnitSpec): string {
  return [
    '#!/bin/sh',
    `# mawsd's command line for the profile ${profileDir.replace(/\n/g, ' ')}, written by \`mawsd install\``,
    `export MAWS_USER_DATA=${sh(profileDir)}`,
    `export ${LABEL_ENV}=${sh(label)}`,
    'export ELECTRON_RUN_AS_NODE=1',
    `exec ${sh(program.runtime)} --disable-sigusr1 ${sh(program.entry)} "$@"`,
    '',
  ].join('\n');
}

export interface InstallOptions {
  profileDir: string;
  label: string;
  program: UnitProgram; // the program to run; on Linux under the default label, the pack to install as the release
  delegationId?: string;
}

// Residue 21: the canonical unit never runs code from a working checkout. Under the default profile's label, a Mac's
// program is a packaged app (its entry inside an `app.asar`), and a Linux one is a pack (`pnpm mawsd:pack`, release.ts)
// with its runtime, which the install makes the release directory's `current`. Any other label (a scratch profile,
// every test) may run an unpackaged build, and installs no release.
export function unpackagedProgram({ label, program }: UnitSpec, platform: NodeJS.Platform): string | null {
  if (label !== DEFAULT_LABEL) return null;
  if (platform === 'darwin') return /\.asar[/\\]/.test(program.entry) ? null : `${program.entry} is not inside a packaged app's app.asar`;
  const pack = packOf(program.entry);
  if (pack === null) return `${program.entry} is not a mawsd release (pnpm mawsd:pack makes one)`;
  return pack.runtime ? null : `the release ${pack.release} at ${pack.root} has no runtime/bin/node (pnpm mawsd:pack adds it on Linux)`;
}

export interface InstallResult {
  unit: Unit;
  change: UnitChange; // 'updated' too when the unit's text is unchanged but `current` named another release (restarted)
  wrapper: string;
  linked: string | 'other' | null; // the link's path; 'other' when another mawsd is there; null when none is made
  ref: MachineRef | null; // the ref, when --delegation-id asked for one
  // O14 residue 9: the --delegation-id the profile's existing identity did not take (it is never re-minted); null when
  // none was given or the ref already carries it as its prefix
  ignoredDelegationId: string | null;
  release: InstalledRelease | null; // the Linux canonical unit's release (release.ts); null otherwise
}

export async function installDaemon(options: InstallOptions, deps: InstallDeps): Promise<InstallResult> {
  const { profileDir, label, delegationId } = options;
  if (delegationId !== undefined && !DELEGATION_ID.test(delegationId)) throw new UnitError(`a delegation id is 32 lower-case hex digits; refusing ${JSON.stringify(delegationId)}`);
  const unit = unitFor(label, deps);
  const unpackaged = unpackagedProgram({ label, profileDir, program: options.program }, deps.platform);
  if (unpackaged !== null) throw new UnitError(`refusing to install ${unit.name} for a build that is not packaged: ${unpackaged}`);
  const pack: Pack | null = deps.platform === 'linux' && label === DEFAULT_LABEL ? packOf(options.program.entry) : null;

  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  makePrivateDirectory(join(profileDir, DAEMON_FILES.dir));
  const ref = delegationId === undefined ? null : readOrMintMachineRef(profileDir, { prefix: delegationId });
  const ignoredDelegationId = delegationId !== undefined && ref !== null && !ref.startsWith(`${delegationId}_`) ? delegationId : null;
  const flip = pack === null ? null : installRelease(pack, deps.home);
  const spec: UnitSpec = { label, profileDir, program: pack === null ? options.program : releaseProgram(deps.home) };

  const wrapper = wrapperPath(profileDir);
  const unitWasInstalled = existsSync(unit.file);
  let linked: InstallResult['linked'];
  let change: UnitChange;
  try {
    mkdirSync(dirname(wrapper), { recursive: true, mode: 0o700 });
    writeWhole(wrapper, wrapperText(spec), 0o700);
    linked = isDefaultProfile(profileDir, deps.platform, deps.env, deps.home) ? link(join(deps.home, '.local', 'bin'), wrapper) : null;
    change = await unit.apply(unit.render(spec));
    if (change === 'unchanged' && flip?.flipped) {
      unit.restart(); // the unit runs `current`, which now names another release; its hosts and sessions keep running (KillMode=process)
      change = 'updated';
    }
  } catch (error) {
    // No user manager (2) and no unit file before: a host with no manager (a container), where no unit will run and the
    // command line runs `current` through the wrapper, so it stays. With a unit file, an unreachable manager may be a
    // passing one whose lingering daemon still runs the previous release: put it back, so the retry restarts the unit.
    const noManagerEver = error instanceof UnitError && error.code === 2 && !unitWasInstalled;
    if (flip?.flipped && !noManagerEver) restoreCurrent(deps.home, flip.previous);
    throw error;
  }
  const release = flip === null ? null : { ...flip, pruned: pruneReleases(deps.home) };
  return { unit, change, wrapper, linked, ref, ignoredDelegationId, release };
}

export interface UninstallResult {
  unit: Unit;
  removed: boolean; // a unit was loaded or its file was there
}

export async function uninstallDaemon({ profileDir, label }: { profileDir: string; label: string }, deps: InstallDeps): Promise<UninstallResult> {
  const unit = unitFor(label, deps);
  const removed = await unit.remove();
  const wrapper = wrapperPath(profileDir);
  const linkPath = join(deps.home, '.local', 'bin', 'mawsd');
  if (linkTarget(linkPath) === wrapper) rmSync(linkPath, { force: true });
  rmSync(wrapper, { force: true });
  return { unit, removed };
}

// `<bin>/mawsd` → the wrapper, when `bin` exists and holds no other `mawsd`.
function link(bin: string, wrapper: string): string | 'other' | null {
  try {
    if (!lstatSync(bin).isDirectory()) return null;
  } catch {
    return null;
  }
  const path = join(bin, 'mawsd');
  const target = linkTarget(path);
  if (target === wrapper) return path;
  if (target !== null || exists(path)) return 'other';
  symlinkSync(wrapper, path);
  return path;
}

function linkTarget(path: string): string | null {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null;
  } catch {
    return null;
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

// The real path of `path`, or of its nearest existing ancestor with the rest appended (so `/var/…` and `/private/var/…`
// compare equal on a Mac whether or not the profile exists yet).
function real(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(real(parent), basename(absolute));
  }
}
