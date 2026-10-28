// The org's cut-over machines (P5 O13 M5, §B): the machines moved to MAWS, whose cards are this phone's channel's and
// whose sessions the frozen views leave alone. Resolved as the protocol package resolves the key a machine speaks with
// (`machineKeys`, `apps/org-protocol/src/records.ts`): an enrolled machine by the head's entry, its name the entry's;
// a delegated machine (a devcloud VM, which has no entry) by the live certificate that speaks for it, its name the
// certificate's. A certificate that does not verify, has expired, was retired or revoked, or whose ref another live
// certificate contests speaks for nothing, and its machine is left out.
import { machineKeys, type Certificates, type SignedOrgState } from 'org-protocol';

export type CutOverMachine = { ref: string; name: string; source: 'entry' | 'certificate' };

/** The machines `head` and `certificates` resolve at `now`: the enrolled first, in the head's order, then the certified. */
export async function cutOverMachines(head: SignedOrgState, certificates: Certificates, now: Date): Promise<CutOverMachine[]> {
  const { state } = head;
  const machines: CutOverMachine[] = state.machines.map((m) => ({ ref: m.ref, name: m.name, source: 'entry' }));
  const seen = new Set(machines.map((m) => m.ref));
  for (const cert of certificates.certs) {
    const { machine: ref, name, pub } = cert.body;
    if (seen.has(ref)) continue;
    const { keys } = await machineKeys(state, ref, certificates, now);
    if (!keys.includes(pub)) continue;
    seen.add(ref);
    machines.push({ ref, name, source: 'certificate' });
  }
  return machines;
}
