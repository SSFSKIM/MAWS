import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { createNavigationRelay } from './navigation';

const MINI = 'MiniMachineRef00000000' as MachineRef;

const nav = (n: number) => ({ appSessionId: `app-${n}` as AppSessionId, attentionId: `att-${n}` as AttentionId, source: 'notification' as const });

describe('navigation relay (attention.pendingNavigate)', () => {
  it('queues a navigation that arrives before any page announced, returns it once from the snapshot, then nothing', () => {
    const emit = vi.fn();
    const relay = createNavigationRelay(emit);
    relay.deliver(nav(1));
    expect(emit).not.toHaveBeenCalled();
    expect(relay.take()).toEqual(nav(1));
    expect(relay.take()).toBeNull();
  });

  it('retains every failed action until a page subscribes, including its unsent reply', () => {
    const emit = vi.fn();
    const relay = createNavigationRelay(emit);
    const failure = { appSessionId: nav(1).appSessionId, attentionId: null, delivery: 'in-app' as const, at: '2026-10-23T00:00:00Z', error: 'Session unavailable', reply: 'Keep this reply' };
    relay.failure(failure);
    relay.failure({ ...failure, reply: 'And this one' });
    expect(emit).not.toHaveBeenCalled();
    relay.take(); // subscribe-then-snapshot announces the page
    expect(emit.mock.calls).toEqual([
      ['attention.notified', failure],
      ['attention.notified', { ...failure, reply: 'And this one' }],
    ]);
    relay.take();
    expect(emit).toHaveBeenCalledTimes(2);
    relay.failure(failure);
    expect(emit).toHaveBeenCalledTimes(3);
    relay.pageGone();
    relay.failure(failure);
    expect(emit).toHaveBeenCalledTimes(3);
    relay.take();
    expect(emit).toHaveBeenCalledTimes(4);
  });

  it('keeps only the latest queued navigation', () => {
    const relay = createNavigationRelay(vi.fn());
    relay.deliver(nav(1));
    relay.deliver(nav(2));
    expect(relay.take()).toEqual(nav(2));
  });

  it('emits directly once the current page has announced itself by asking, and queues again after a reload', () => {
    const emit = vi.fn();
    const relay = createNavigationRelay(emit);
    expect(relay.take()).toBeNull(); // the page subscribed, then asked: it is announced
    relay.deliver(nav(3));
    expect(emit).toHaveBeenCalledExactlyOnceWith('attention.navigate', nav(3));
    expect(relay.take()).toBeNull();
    relay.pageGone(); // a reload or a re-created window starts un-announced
    relay.deliver(nav(4));
    expect(emit).toHaveBeenCalledOnce();
    expect(relay.take()).toEqual(nav(4));
  });

  // P5 O7 M6: a click on another machine's item opens its session there: the navigation is that machine's (`emitFrom`), its
  // ids lifted to the machine's addresses by the page; one queued is told the page as an event at its announcement, since
  // the command's answer is this Mac's
  it('emits another machine’s navigation from that machine, and tells one queued for it at the page’s announcement', () => {
    const emit = vi.fn();
    const emitFrom = vi.fn();
    const relay = createNavigationRelay(emit, emitFrom);
    relay.deliver(nav(5), MINI);
    expect(emitFrom).not.toHaveBeenCalled();
    expect(relay.take()).toBeNull();
    expect(emitFrom).toHaveBeenCalledExactlyOnceWith(MINI, 'attention.navigate', nav(5));
    relay.deliver(nav(6), MINI);
    expect(emitFrom).toHaveBeenLastCalledWith(MINI, 'attention.navigate', nav(6));
    expect(emit).not.toHaveBeenCalled();
    relay.pageGone();
    relay.deliver(nav(7), MINI);
    relay.deliver(nav(8)); // the latest only, this Mac's
    expect(relay.take()).toEqual(nav(8));
    expect(emitFrom).toHaveBeenCalledTimes(2);
  });
});
