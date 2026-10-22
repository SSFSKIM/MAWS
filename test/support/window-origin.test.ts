// A launch's first window on a shared desktop (ci-kit's mac-lane concurrency spec, M2; e2e/support/window-origin.ts):
// a corner of its own per ci-kit shared runner instance, and no move anywhere else.
import { describe, expect, it } from 'vitest';
import { cornerOrigin, windowCorner } from '../../e2e/support/window-origin';

const shared = (name: string | undefined) => ({ CI_KIT_SHARED_DESKTOP: '1', RUNNER_NAME: name });

describe('windowCorner', () => {
  // ci-kit's guest (its VM lane) has a desktop of its own and never sets the flag; its name ends in no instance number.
  it('moves nothing without CI_KIT_SHARED_DESKTOP=1: the exclusive instance, ci-kit\'s guest, any other runner, a desk', () => {
    for (const env of [{}, { RUNNER_NAME: 'ci-kit-mac-mini' }, { RUNNER_NAME: 'ci-kit-mac-mini-2' }, { CI_KIT_SHARED_DESKTOP: '0', RUNNER_NAME: 'ci-kit-mac-mini-3' }, { CI_KIT_VM_GUEST: '1', RUNNER_NAME: 'ci-kit-mac-mini-vm' }]) {
      expect(windowCorner(env), JSON.stringify(env)).toBeNull();
    }
  });

  it("gives each of four shared instances a corner of its own, the mini's two opposite, the same for every job of one", () => {
    const corners = [2, 3, 4, 5].map((n) => windowCorner(shared(`ci-kit-mac-mini-${n}`)));
    expect(corners.slice(0, 2)).toEqual(['top-left', 'bottom-right']);
    expect(new Set(corners).size).toBe(4);
    expect(windowCorner(shared('ci-kit-mac-mini-3'))).toBe(corners[1]);
  });

  it("refuses a shared desktop whose runner name carries no instance number, rather than stack its windows on another's", () => {
    expect(() => windowCorner(shared('ci-kit-mac-mini'))).toThrow(/RUNNER_NAME \(ci-kit-mac-mini\) does not end in an instance number/);
    expect(() => windowCorner(shared(undefined))).toThrow(/RUNNER_NAME \(unset\)/);
  });
});

describe('cornerOrigin', () => {
  // A 1920 × 1080 display less a 25 px menu bar, and the default window (src/main/window-state.ts).
  const area = { x: 0, y: 25, width: 1920, height: 1055 };
  const size = { width: 1280, height: 820 };

  it("puts the window's edges on the work area's at its corner", () => {
    expect(cornerOrigin('top-left', area, size)).toEqual({ x: 0, y: 25 });
    expect(cornerOrigin('bottom-right', area, size)).toEqual({ x: 640, y: 260 });
    expect(cornerOrigin('top-right', area, size)).toEqual({ x: 640, y: 25 });
    expect(cornerOrigin('bottom-left', { ...area, x: -1920 }, size)).toEqual({ x: -1920, y: 260 });
  });

  it("keeps a window larger than the work area at the area's own edge", () => {
    expect(cornerOrigin('bottom-right', area, { width: 2400, height: 1200 })).toEqual({ x: 0, y: 25 });
  });
});
