import { describe, expect, it, vi } from 'vitest';
import { armInputGuard } from './input-guard';

describe('probe input guard', () => {
  it('blocks and counts physical wheel, key and touch events while armed, and lets synthesized ones through', () => {
    const physical = new Set<Event>();
    const guard = armInputGuard(window, (ev) => physical.has(ev));
    const seen = vi.fn();
    window.addEventListener('wheel', seen);
    window.addEventListener('keydown', seen);

    const trustedWheel = new WheelEvent('wheel', { cancelable: true });
    physical.add(trustedWheel);
    const trustedKey = new KeyboardEvent('keydown', { cancelable: true, key: 'a' });
    physical.add(trustedKey);
    const synthesized = new WheelEvent('wheel', { cancelable: true });
    window.dispatchEvent(trustedWheel);
    window.dispatchEvent(trustedKey);
    window.dispatchEvent(synthesized);

    expect(trustedWheel.defaultPrevented).toBe(true);
    expect(trustedKey.defaultPrevented).toBe(true);
    expect(synthesized.defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1); // only the synthesized wheel reached later listeners
    expect(guard.disarm()).toBe(2);

    const afterDisarm = new WheelEvent('wheel', { cancelable: true });
    physical.add(afterDisarm);
    window.dispatchEvent(afterDisarm);
    expect(afterDisarm.defaultPrevented).toBe(false);
    window.removeEventListener('wheel', seen);
    window.removeEventListener('keydown', seen);
  });
});
