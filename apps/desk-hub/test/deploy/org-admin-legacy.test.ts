// The org key's retirement through the admin's signing (O14 M5a): the successor that carries `legacyRetired` at its own
// version (or drops it, the retirement undone), and the hub's purge of the wrapped copies on its word. `deployment
// admin keys retire|purge` (M2's verbs) are these helpers under its anchor; here they run as staging's `OrgAdmin`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgAdmin, purgeOrgKeys, type AdminDevice } from '../../deploy/org-admin.ts';
import { ORG, startLocalHub, type LocalHub } from '../support/local';
import { adminKeysFile, LocalPerson } from '../support/local-person';

let hub: LocalHub;
let person: LocalPerson;
let device: AdminDevice;

beforeAll(async () => {
  hub = await startLocalHub();
  person = new LocalPerson(hub);
  device = (await adminKeysFile()).device;
});
afterAll(() => hub?.close());

describe('the legacy key retired through the admin', () => {
  it('signs the retirement at its own version, once, undoes it while the copies are held, then purges them', async () => {
    const admin = await OrgAdmin.open(person, { org: ORG, throwaway: true }, device, () => {});
    const retired = await admin.retireLegacy();
    expect(retired?.state.legacyRetired).toEqual({ version: retired!.state.version, at: retired!.state.issued });
    // Retired already: nothing is signed.
    expect(await admin.retireLegacy()).toBeNull();
    const restored = await admin.restoreLegacy();
    expect(restored?.state.legacyRetired).toBeUndefined();
    expect(await admin.restoreLegacy()).toBeNull();
    await expect(purgeOrgKeys(person)).rejects.toThrow(/409 .*not-retired/);
    const again = await admin.retireLegacy();
    expect(await purgeOrgKeys(person)).toEqual({ purged: { version: again!.state.version, at: expect.any(String) as string } });
    await expect(admin.restoreLegacy()).rejects.toThrow(/409 .*key-purged/);
  });
});
