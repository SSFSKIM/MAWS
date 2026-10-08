// Main's own build (E11's sitting, owner-notes 00-consolidated-plan §2.7, report A): the commit and time
// electron.vite.config.ts stamps on main's bundle, logged at startup and carried in `host.status` for Diagnostics. It is
// not the engine host's `appBuildId` (the hash of the bundle a supervisor is compared by): a rebuilt app could leave the
// old main process running under the profile lock, and nothing said which main was answering. A second launch hands its
// build to the running instance (`profile-lock.ts`), which says so when it is the older one.
import type { MainBuild } from '@shared/ipc/schema/host';

export type { MainBuild };

export const describeMainBuild = (build: MainBuild): string => `MAWS ${build.version} · build ${build.commit} · built ${build.builtAt}`;

const isBuild = (value: unknown): value is MainBuild => {
  const b = value as Partial<MainBuild> | null;
  return typeof b === 'object' && b !== null && typeof b.version === 'string' && typeof b.commit === 'string' && typeof b.builtAt === 'string';
};

// What a second launch passed with its lock request (`{ build }`); null from a build that passed nothing or anything else.
export const launchedBuildOf = (data: unknown): MainBuild | null => {
  const build = (data as { build?: unknown } | null)?.build;
  return isBuild(build) ? { version: build.version, commit: build.commit, builtAt: build.builtAt } : null;
};

// The running instance's word to the owner when a launched build is newer than itself; null when it is the same build,
// an older one, or one whose time cannot be read (the second launch then only focuses the running one).
export function olderInstanceNotice(running: MainBuild, launched: MainBuild | null, formatTime: (iso: string) => string): string | null {
  if (launched === null) return null;
  const ran = Date.parse(running.builtAt);
  const came = Date.parse(launched.builtAt);
  if (Number.isNaN(ran) || Number.isNaN(came) || came <= ran) return null;
  return `An older MAWS is running (built ${formatTime(running.builtAt)}); quit it to use this build`;
}

// E11 F2b (plan 2.7b; the owner's actual case): after a rebuild at the same bundle path, opening the app activates the
// running copy (macOS starts no second process), so no second launch hands its build over. The running instance then
// asks the disk: the bundle it loaded (packaged, `<resources>/app.asar`; in development, `out/main/index.js`) written
// after this process started is a newer build. The mtime is the build's own write: electron-builder writes a fresh
// archive and electron-vite a fresh main, and nothing else touches either file.
export const loadedBundlePath = ({ packaged, resourcesPath, appPath }: { packaged: boolean; resourcesPath: string; appPath: string }): string =>
  packaged ? `${resourcesPath}/app.asar` : `${appPath}/out/main/index.js`;

export interface StaleBuildCheckDeps {
  bundlePath: string;
  stat: (path: string) => number | null; // the file's mtime in ms, null when it cannot be read
  startedAt: number; // this process's start, ms
  running: MainBuild;
  formatTime: (iso: string) => string;
}

// Each call (on `activate`, and at a second launch) answers the notice when the bundle on disk is newer than this
// process, once per build on disk: the mtime shown is remembered, and a later rebuild is said again.
export function staleBuildCheck({ bundlePath, stat, startedAt, running, formatTime }: StaleBuildCheckDeps): () => string | null {
  let shown: number | null = null;
  return () => {
    const mtime = stat(bundlePath);
    if (mtime === null || mtime <= startedAt || mtime === shown) return null;
    shown = mtime;
    return `An older MAWS is running, built ${formatTime(running.builtAt)}; the build on disk is newer; quit to use it`;
  };
}
