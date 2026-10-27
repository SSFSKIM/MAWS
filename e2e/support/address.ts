// Addresses in the specs (P5 O6 M2, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The e2e adaptation").
// The page holds every machine-bound id (`AppSessionId`, `ProjectId`, `PtyId`, `AttentionId`) as an address,
// `<machineRef>/<bareId>`, so its DOM ids, main-tab ids and stored layout values carry one, while the raw bridge
// (`window.maws`) a spec calls speaks bare ids. A spec that compares the two addresses the bare id with these.
import type { Page } from '@playwright/test';
import { addressOf } from '../../src/shared/machine/address';
import type { MachineRef } from '../../src/shared/machine/ref';

// One read per launched page: the ref belongs to the profile, so a relaunch over it answers the same.
const identities = new WeakMap<Page, Promise<{ ref: MachineRef; name: string }>>();

function identity(page: Page): Promise<{ ref: MachineRef; name: string }> {
  let read = identities.get(page);
  if (!read) {
    read = page.evaluate(async () => {
      const result = await window.maws.invoke('machine.identity', undefined);
      if (!result.ok) throw new Error(`machine.identity: ${result.error.code}: ${result.error.message}`);
      return { ref: result.value.ref, name: result.value.name };
    });
    read.catch(() => identities.delete(page));
    identities.set(page, read);
  }
  return read;
}

export const localRef = async (page: Page): Promise<MachineRef> => (await identity(page)).ref;

// P5 O6 M5: the name the local machine goes by, which its own row in the sidebar carries (T3; the host's short name, or
// `MAWS_MACHINE_NAME` when a spec sets it).
export const localName = async (page: Page): Promise<string> => (await identity(page)).name;

// The local machine's address of a bare id from the raw bridge.
export async function addressed(page: Page, id: string): Promise<string> {
  return addressOf(await localRef(page), id);
}
