// While a measured workload runs on the `#probe` page, physical input must not reach the terminals: on this Mac the
// owner's trackpad momentum scroll reaches Playwright's Electron window and corrupted scroll and frame measurements
// in C6's early runs (coordinator, 2026-09-28). A capture-phase listener on `window` cancels every wheel, key and
// touch event the browser marks trusted (`isTrusted`), counts them, and is armed only for the measurement window,
// since the interactive items still need Playwright's synthesized input. The predicate is injectable for tests,
// which cannot dispatch trusted events.

const GUARDED_EVENTS = ['wheel', 'keydown', 'keyup', 'keypress', 'touchstart', 'touchmove', 'touchend'] as const;

export interface InputGuard {
  disarm(): number; // removes the listeners; returns how many physical events were blocked
}

export function armInputGuard(target: Window, isPhysical: (ev: Event) => boolean = (ev) => ev.isTrusted): InputGuard {
  let blocked = 0;
  const block = (ev: Event) => {
    if (!isPhysical(ev)) return;
    blocked++;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  for (const type of GUARDED_EVENTS) target.addEventListener(type, block, { capture: true, passive: false });
  return {
    disarm() {
      for (const type of GUARDED_EVENTS) target.removeEventListener(type, block, { capture: true });
      return blocked;
    },
  };
}
