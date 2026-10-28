// The design system governing a deck in the renderer (P3-C; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10,
// Decision Log 19, 27 (2) and 28): D's chain through D's `useGoverningSystem`, so a deck with no system of its own and no
// default draws the house system the window follows, and moves when the house does.
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DesignSystemHouseContext, type HouseDesignSystem } from '@artifacts/design-system/apply';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { CommandName } from '@shared/ipc/schema';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import { resetLibrary } from '../../library/store';
import { useSettings } from '../../stores/settings';
import { installFakeMain, ok } from '../../test-support/code';
import { useDeckSystem } from './governing';

const HOUSE = '11111111-1111-4111-8111-111111111111';
const NEXT_HOUSE = '33333333-3333-4333-8333-333333333333';
const OWN = '22222222-2222-4222-8222-222222222222';

function houseSource(initial: string | null): HouseDesignSystem & { set(id: string | null): void } {
  let id = initial;
  const listeners = new Set<() => void>();
  return {
    current: () => id,
    subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    set: (next) => {
      id = next;
      for (const listener of listeners) listener();
    },
  };
}

const withHouse = (house: HouseDesignSystem) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(DesignSystemHouseContext.Provider, { value: house }, children);
  };

const row = (id: string): LibraryRow => ({
  id, kind: 'design_system', title: id, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [],
});
const counts = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0]));

beforeEach(() => {
  useSettings.setState({ state: { settings: SETTINGS_DEFAULTS_V19, resolvedTheme: 'light' } });
  // main's library, which the hook reads for the live systems
  installFakeMain((name: CommandName) => (name === 'library.list' ? ok({ rows: [HOUSE, NEXT_HOUSE, OWN].map(row), counts }) : ok(null)));
});
afterEach(() => {
  cleanup();
  resetLibrary();
  useSettings.setState({ state: null });
  delete (window as { maws?: unknown }).maws;
});

describe('useDeckSystem', () => {
  it('ends the chain at the house system the window follows, and follows it', () => {
    const house = houseSource(HOUSE);
    const { result } = renderHook(() => useDeckSystem({}), { wrapper: withHouse(house) });
    expect(result.current).toEqual({ id: HOUSE });
    act(() => house.set(NEXT_HOUSE));
    expect(result.current).toEqual({ id: NEXT_HOUSE });
    act(() => house.set(null));
    expect(result.current).toEqual({ builtin: 'maws' });
  });

  it("takes the deck's own system before the house, and answers null with no deck placed", () => {
    const house = houseSource(HOUSE);
    expect(renderHook(() => useDeckSystem({ designSystemId: OWN }), { wrapper: withHouse(house) }).result.current).toEqual({ id: OWN });
    expect(renderHook(() => useDeckSystem(null), { wrapper: withHouse(house) }).result.current).toBeNull();
  });

  it('keeps one value while the system it names stays the same', () => {
    const house = houseSource(HOUSE);
    const { result, rerender } = renderHook(() => useDeckSystem({}), { wrapper: withHouse(house) });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
