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
