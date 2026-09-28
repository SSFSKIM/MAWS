import type { SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { rowsOf } from '../model/derive';
import { applyEvents, createState } from '../model/reduce';
import { builder } from '../model/test-events';
import { attachSource } from './hydrate';
import type { TranscriptSource } from './types';

// A fake source: the snapshot resolves when told to, and batches are pushed by the test at chosen moments.
function fakeSource(snapshot: SessionEvent[]) {
  let listener: ((events: SessionEvent[]) => void) | null = null;
  let resolveSnapshot: (events: SessionEvent[]) => void = () => {};
  let unsubscribed = false;
  const source: TranscriptSource = {
    subscribe(l) {
      listener = l;
      return () => {
        unsubscribed = true;
      };
    },
    snapshot: () => new Promise((resolve) => (resolveSnapshot = resolve)),
  };
  return { source, push: (events: SessionEvent[]) => listener!(events), resolve: () => resolveSnapshot(snapshot), get unsubscribed() { return unsubscribed; } };
}

describe('hydration', () => {
  it('applies the snapshot, then buffered batches in order minus what the snapshot carried, then live batches; no id twice', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    b.turn('u2');
    b.text('m2', 0, 'Two');
    b.end(['u2']);
    b.turn('u3');
    b.text('m3', 0, 'Three');
    b.end(['u3']);
    const all = b.events;
    const snapshot = all.slice(0, 8); // through turn 2's text (its end is in the overlap batch)
    const fake = fakeSource(snapshot);
    let state = createState(null, null);
    const applied: string[] = [];
    const handle = attachSource(fake.source, {
      apply(events) {
        applied.push(...events.map((e) => e.id));
        state = applyEvents(state, events);
      },
      has: (id) => state.seen.has(id),
    });
    fake.push(all.slice(3, 5)); // before the snapshot resolves: buffered (both ids are in the snapshot)
    fake.push([...all.slice(6, 8), all[8]]); // overlaps the snapshot's last two ids, carries one new event
    expect(applied).toEqual([]);
    fake.resolve();
    await handle.hydrated;
    fake.push([all[9], all[10]]); // during the drain's microtask tail or after: applied in order either way
    fake.push([all[11]]);
    await Promise.resolve();
    expect(applied).toEqual(all.map((e) => e.id));
    expect(new Set(applied).size).toBe(applied.length);
    expect(rowsOf(state)).toEqual(rowsOf(applyEvents(createState(null, null), all)));
    handle.detach();
    expect(fake.unsubscribed).toBe(true);
  });

  it('a batch delivered during the drain keeps its order after the drained ones', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    const all = b.events;
    const fake = fakeSource(all.slice(0, 1));
    const applied: string[] = [];
    const handle = attachSource(fake.source, {
      apply(events) {
        applied.push(...events.map((e) => e.id));
        if (events[0]?.id === all[1].id) fake.push([all[3]]); // arrives while the buffer is draining
      },
      has: (id) => applied.includes(id as string),
    });
    fake.push([all[1]]);
    fake.push([all[2]]);
    fake.resolve();
    await handle.hydrated;
    expect(applied).toEqual(all.map((e) => e.id));
    handle.detach();
  });
});
