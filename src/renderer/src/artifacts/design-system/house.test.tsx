// The window's house system (the P3 spec's Decision Log 61): `useHouseDesignSystem` reads `designSystems.house` once for
// every consumer, keeps the answer, and reads it again at each `artifacts.changed` of a design system (a deletion or a
// new house system moves it) and each `artifacts.resync`; an answer overtaken by a later read is dropped.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, EventName, MawsBridge } from '@shared/ipc/schema';
import { createClient } from '../../ipc/client';
import { followHouseDesignSystem, useHouseDesignSystem } from './house';

const HOUSE = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';

/** A preload bridge whose `designSystems.house` answers are released by the test, in any order. */
function fakeBridge() {
  const answers: ((houseId: string | null) => void)[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const invoke = vi.fn((name: string) => {
    if (name !== 'designSystems.house') throw new Error(`unexpected ${name}`);
    return new Promise<CommandResult<'designSystems.house'>>((resolve) => answers.push((houseId) => resolve({ ok: true, value: { houseId } })));
  });
  const bridge = {
    invoke,
    on: (name: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? listeners.set(name, new Set()).get(name)!;
      set.add(listener);
      return () => void set.delete(listener);
    },
    pathForFile: () => '',
  } as unknown as MawsBridge;
  return {
    bridge,
    invoke,
    /** Answers the `n`th read (from 0) with `houseId`. */
    answer: (n: number, houseId: string | null) => act(async () => answers[n]!(houseId)),
    emit: (name: EventName, payload: unknown) => act(() => listeners.get(name)?.forEach((listener) => listener(payload))),
    listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}
const changed = (kind: string, change = 'updated') => ({ artifactId: DOC, kind, revision: 4, change });

afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

describe('useHouseDesignSystem', () => {
  it('reads once for every consumer, keeps the answer, and reads again when a design system changes or the store resyncs', async () => {
    const fake = fakeBridge();
    window.maws = fake.bridge;
    function Probe({ name }: { name: string }) {
      return <span data-probe={name}>{useHouseDesignSystem() ?? 'none'}</span>;
    }
    const view = render(
      <>
        <Probe name="a" />
        <Probe name="b" />
      </>,
    );
    const shown = () => [...view.container.querySelectorAll('[data-probe]')].map((probe) => probe.textContent);
    expect(shown()).toEqual(['none', 'none']); // nothing known yet: the floor
    expect(fake.invoke).toHaveBeenCalledTimes(1); // one read for both
    await fake.answer(0, HOUSE);
    expect(shown()).toEqual([HOUSE, HOUSE]);
    // another kind's change is not the house's business
    fake.emit('artifacts.changed', changed('document'));
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    // the house system deleted: read again, the copy is the house now
    fake.emit('artifacts.changed', changed('design_system', 'deleted'));
    expect(fake.invoke).toHaveBeenCalledTimes(2);
    await fake.answer(1, COPY);
    expect(shown()).toEqual([COPY, COPY]);
    // the host came back after a gap whose events were not replayed: read again
    fake.emit('artifacts.resync', {});
    await fake.answer(2, null);
    expect(shown()).toEqual(['none', 'none']);
    // the last consumer gone: no longer followed
    view.unmount();
    expect(fake.listening()).toBe(0);
  });
});

describe('followHouseDesignSystem', () => {
  it('drops an answer a later read overtook, and keeps the last answer when a read fails', async () => {
    const fake = fakeBridge();
    const house = followHouseDesignSystem(createClient(() => fake.bridge));
    const heard = vi.fn();
    const stop = house.subscribe(heard);
    fake.emit('artifacts.changed', changed('design_system', 'created'));
    expect(fake.invoke).toHaveBeenCalledTimes(2);
    await fake.answer(1, COPY); // the later read, answered first
    await fake.answer(0, HOUSE); // the earlier one, overtaken
    expect(house.current()).toBe(COPY);
    expect(heard).toHaveBeenCalledTimes(1);
    // a refused read (the host away) leaves the answer as it was
    fake.invoke.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } } as never);
    fake.emit('artifacts.resync', {});
    await act(async () => {});
    expect(house.current()).toBe(COPY);
    stop();
    expect(fake.listening()).toBe(0);
  });
});
