// Where a launch's first window goes on a shared desktop (ci-kit's mac-lane concurrency spec, M2; its audit's H6), as
// pure functions of the runner's environment, pinned by test/support/window-origin.test.ts; launch.ts reads the display
// and moves the window. Every fresh profile opens its window at one frame, centred on the primary display
// (src/main/window-state.ts), so the windows of two jobs on one desktop would lie exactly on each other, and a covered
// window's child WebContentsViews (the browser's tab pages) stop drawing. On a ci-kit shared runner instance
// (CI_KIT_SHARED_DESKTOP=1) the window goes to a corner of the display's work area that its instance number picks, the
// `-<n>` that ends the shared instances' runner names (`ci-kit-mac-<machine>-<n>`, n ≥ 2): the same for every job of an
// instance, another for each of four instances. Main windows the app opens later follow it (they open where window.main
// was left), and so does a relaunch over the profile. Anywhere else, the exclusive instance included, nothing moves.

type Env = Record<string, string | undefined>;
export type Corner = 'top-left' | 'bottom-right' | 'top-right' | 'bottom-left';
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

// By the instance number modulo 4: 2 and 3, the mini's two shared instances, take opposite corners.
const CORNERS: readonly Corner[] = ['top-right', 'bottom-left', 'top-left', 'bottom-right'];

// The corner a shared instance's windows take, or null where the window stays where the app put it.
export function windowCorner(env: Env): Corner | null {
  if (env.CI_KIT_SHARED_DESKTOP !== '1') return null;
  const instance = /-(\d+)$/.exec(env.RUNNER_NAME ?? '')?.[1];
  if (instance === undefined) {
    throw new Error(
      `CI_KIT_SHARED_DESKTOP=1, but RUNNER_NAME (${env.RUNNER_NAME ?? 'unset'}) does not end in an instance number as ci-kit's shared runners' names do (ci-kit-mac-<machine>-<n>); a window on a shared desktop takes its corner from it`,
    );
  }
  return CORNERS[Number(instance) % CORNERS.length]!;
}

// The origin that puts a window of `size` at `corner` of `area`; a window larger than the area keeps the area's edge.
export function cornerOrigin(corner: Corner, area: Area, size: { width: number; height: number }): { x: number; y: number } {
  return {
    x: corner.endsWith('right') ? area.x + Math.max(0, area.width - size.width) : area.x,
    y: corner.startsWith('bottom') ? area.y + Math.max(0, area.height - size.height) : area.y,
  };
}
