// Addresses in the specs (P5 O6 M2, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The e2e adaptation").
// The page holds every machine-bound id (`AppSessionId`, `ProjectId`, `PtyId`, `AttentionId`) as an address,
// `<machineRef>/<bareId>`, so its DOM ids, main-tab ids and stored layout values carry one, while the raw bridge
// (`window.maws`) a spec calls speaks bare ids. A spec that compares the two addresses the bare id with these.
import type { Page } from '@playwright/test';
import { addressOf } from '../../src/shared/machine/address';
import type { MachineRef } from '../../src/shared/machine/ref';

// One read per launched page: the ref belongs to the profile, so a relaunch over it answers the same.
const refs = new WeakMap<Page, Promise<MachineRef>>();

export function localRef(page: Page): Promise<MachineRef> {
  let ref = refs.get(page);
  if (!ref) {
    ref = page.evaluate(async () => {
      const result = await window.maws.invoke('machine.identity', undefined);
      if (!result.ok) throw new Error(`machine.identity: ${result.error.code}: ${result.error.message}`);
      return result.value.ref;
    });
    ref.catch(() => refs.delete(page));
    refs.set(page, ref);
  }
  return ref;
}

// The local machine's address of a bare id from the raw bridge.
export async function addressed(page: Page, id: string): Promise<string> {
  return addressOf(await localRef(page), id);
}
