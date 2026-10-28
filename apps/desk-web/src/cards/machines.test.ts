// The cut-over machines (P5 O13 M5, §B): the machines the cards list and the freeze's seam name, resolved as the
// protocol package resolves a machine's key (`machineKeys`): the head's entries, and the delegated machines a live
// certificate speaks for, by the certificate's name.
import { base64urlEncode, generateSigningKey, NO_CERTIFICATES, signRecord, SIGNING_DOMAINS, type Certificates, type MachineCert, type Signed, type SignedOrgState } from 'org-protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { memberId, nextOf, rootedOrg, signedBy } from '../../test/org';
import { cutOverMachines } from './machines';

const DAY_MS = 86_400_000;
const ref = (prefix = '') => `${prefix}${base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))}`;

let org: Awaited<ReturnType<typeof rootedOrg>>;
let head: SignedOrgState;
let mini: string;
let delegation: { id: string; key: Awaited<ReturnType<typeof generateSigningKey>>; expires: string };

async function certFor(name: string, machine = ref(`${delegation.id}_`), pub?: string): Promise<Signed<MachineCert>> {
  const key = pub === undefined ? (await generateSigningKey()).pub : pub;
  return signRecord(SIGNING_DOMAINS.machineCert, { org: org.org, machine, name, pub: key, delegation: delegation.id, use: 1, issued: new Date().toISOString() }, delegation.key.privateKey, delegation.key.pub);
}

beforeEach(async () => {
  org = await rootedOrg('org-machines');
  mini = ref();
  delegation = { id: memberId(), key: await generateSigningKey(), expires: new Date(Date.now() + DAY_MS).toISOString() };
  const miniKey = await generateSigningKey();
  head = await signedBy(
    await nextOf(org.genesis, (s) => {
      s.machines.push({ name: 'mini', ref: mini, pub: miniKey.pub, owners: [org.member] });
      s.machineNames.push({ name: 'mini', ref: mini });
      s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: delegation.expires, maxUses: 10, offlineRevokeS: 0, owners: 'org' });
    }),
    org.admin,
  );
});

describe('the cut-over machines', () => {
  it("are the head's enrolled machines, by their entries' names", async () => {
    expect(await cutOverMachines(head, NO_CERTIFICATES, new Date())).toEqual([{ ref: mini, name: 'mini', source: 'entry', until: null }]);
    expect(await cutOverMachines(org.genesis, NO_CERTIFICATES, new Date())).toEqual([]);
  });

  it("and each delegated machine a live certificate speaks for, by the certificate's name; an expired one is not", async () => {
    const cert = await certFor('vm-one');
    const certificates: Certificates = { certs: [cert], retirements: [] };
    expect(await cutOverMachines(head, certificates, new Date())).toEqual([
      { ref: mini, name: 'mini', source: 'entry', until: null },
      { ref: cert.body.machine, name: 'vm-one', source: 'certificate', until: delegation.expires },
    ]);
    // Its delegation expired: no live certificate speaks for the machine any more.
    expect(await cutOverMachines(head, certificates, new Date(Date.parse(delegation.expires) + 1000))).toEqual([{ ref: mini, name: 'mini', source: 'entry', until: null }]);
  });

  it("names a delegated machine by its authentic certificate, never by a forged one for the same ref and key before it", async () => {
    const cert = await certFor('vm-one');
    const signed = await certFor('vm-forged', cert.body.machine, cert.body.pub);
    const forged: Signed<MachineCert> = { ...signed, sig: { ...signed.sig, value: base64urlEncode(new Uint8Array(64)) } };
    expect(await cutOverMachines(head, { certs: [forged, cert], retirements: [] }, new Date())).toEqual([
      { ref: mini, name: 'mini', source: 'entry', until: null },
      { ref: cert.body.machine, name: 'vm-one', source: 'certificate', until: delegation.expires },
    ]);
  });

  it('leaves out a certificate that does not verify, and one whose ref a second live certificate contests', async () => {
    const signed = await certFor('vm-forged');
    const forged: Signed<MachineCert> = { ...signed, sig: { ...signed.sig, value: base64urlEncode(new Uint8Array(64)) } };
    const contested = ref(`${delegation.id}_`);
    const certificates: Certificates = { certs: [forged, await certFor('vm-two', contested), await certFor('vm-two', contested)], retirements: [] };
    expect(await cutOverMachines(head, certificates, new Date())).toEqual([{ ref: mini, name: 'mini', source: 'entry', until: null }]);
  });
});
