// The window's house system (the P3 spec's Decision Log 61; the ledger's X28): the default chain's last link before the
// bundled floor, as the host's chain names it (`designSystems.house`, D's `DesignSystemChain.house()`). The renderer
// re-runs the portable `governingSystem` with the owner's and Spaces' defaults it already has; this supplies the one
// input only the host knows. It is read when the first consumer comes, kept, and read again at every `artifacts.changed`
// of a design system (a deletion, or a new house system, moves it) and every `artifacts.resync` (the store's events of a
// span with no ready window are not replayed). The app provides it to the portable layer through
// `DesignSystemHouseContext` (provider.tsx); renderer code reads it with `useHouseDesignSystem`.
import { useSyncExternalStore } from 'react';
import type { HouseDesignSystem } from '@artifacts/design-system/apply';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';

/**
 * The house system followed over `client` while anything listens. Only the latest read's answer is taken, so an answer a
 * later change overtook never lands. A failed read keeps the last good answer until the next read: quietly when the
 * host is away (`host_unavailable`, which `artifacts.resync` follows with a read), reported as a console error naming
 * the read for any other fault (a rejected invoke, an `invalid_output`, the host's own refusal), as the renderer's
 * stores report a read that failed.
 */
export function followHouseDesignSystem(client: MawsBridge): HouseDesignSystem {
  let houseId: string | null = null;
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;
  let asked = 0;
  const read = () => {
    const mine = ++asked;
    const failed = (fault: unknown) => console.error('[design-systems] designSystems.house failed', fault);
    client.invoke('designSystems.house', undefined).then((result) => {
      if (!result.ok) {
        if (result.error.code !== 'host_unavailable') failed(result.error);
        return;
      }
      if (mine !== asked || result.value.houseId === houseId) return;
      houseId = result.value.houseId;
      for (const listener of [...listeners]) listener();
    }, failed);
  };
  return {
    current: () => houseId,
    subscribe: (listener) => {
      listeners.add(listener);
      if (!stop) {
        const offChanged = client.on('artifacts.changed', ({ kind }) => kind === 'design_system' && read());
        const offResync = client.on('artifacts.resync', read);
        stop = () => (offChanged(), offResync());
        read();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !stop) return;
        stop();
        stop = null;
      };
    },
  };
}

/** The window's house system, followed only while a consumer renders. */
export const houseDesignSystem: HouseDesignSystem = followHouseDesignSystem(ipc);

/** The house system's id in a render; null while none is known or none is left (the floor). */
export function useHouseDesignSystem(): string | null {
  return useSyncExternalStore(houseDesignSystem.subscribe, houseDesignSystem.current);
}
