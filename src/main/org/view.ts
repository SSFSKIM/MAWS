// The Org page's reading of the held head (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's
// "The view"; Interfaces §M's `OrgView`, carried by `org.view`): the members with their names (`memberNames`, M5),
// roles and devices, each device marked a root (its step-up kid in `root.keys`) or this Mac, with its fingerprint for
// compare-by-eye; the machines with their owners; each root kid as `deployment admin show`'s `rootLines` reads it; and
// the recovery key's id. The signed facts only: whether a machine is up is the renderer's (`useMachines`), since a link
// can drop with no new head. The renderer reads it again at each `org.changed`, which the session fires at every
// adopted head. M4b: each machine's key id, and the certified machines (devcloud VMs): each live certificate the held
// certificates carry, judged against the head (`certificateViews`), with its delegation and that delegation's owners,
// which are its own. M4b (the architect's Fork B): `mayGrant`, whether this device's step-up key may sign a grant on each
// machine, by `grantProblems`' own eligibility (an owner's device, an admin's for `'org'`), never by `maySign`, so the page
// shows Grant… there without judging it again. M4c: the Delegations section's rows (`delegationRows`) and the stray hub
// keys, joined from the head, the pending slot, the held certificates and the hub's last key list. Electron-free.
import {
  certificateViews,
  grantProblems,
  keyId,
  NO_USE_CAP,
  pairingFingerprint,
  type CertView,
  type Certificates,
  type Delegation,
  type Device,
  type OrgState,
} from '../../../apps/org-protocol/src/index.ts';
import { YOUNG_STRAY_KEY_MS, type OrgDelegationRow, type OrgView } from '@shared/ipc/schema/org';
import { memberNames } from '@shared/org/member-name';
import type { DelegationViewInputs } from './delegations';
import type { Unsent } from './files';

/** This Mac in the org: its registration's member and device. */
export type ViewSelf = { member: string; device: string };

const NO_CERTIFICATES: Certificates = { certs: [], retirements: [] };

/**
 * M4c: what the Delegations section joins besides the head: the pending slot's state and unsent marker (an unsent
 * delegation is in its state, not the head's), the delegations part's own (the hub's key list, this run's unsent
 * delegation, the hub halves' problems), and a dropped delegation's last record, from the held chain.
 */
export type DelegationSources = DelegationViewInputs & {
  slot: { state: OrgState; unsent: Unsent | null } | null;
  history(id: string): Delegation | undefined;
};
const NO_DELEGATION_SOURCES: DelegationSources = { slot: null, keys: null, keysFailed: false, unsent: null, hubProblems: new Map(), history: () => undefined };

/** The hub's key `key` is live at `now`: neither revoked nor expired. */
const live = (key: { revoked: string | null; expires: string }, now: Date) => key.revoked === null && Date.parse(key.expires) > now.getTime();

/**
 * The Delegations section's rows and stray keys (Interfaces §S): the head's delegations, the unsent slot's (absent from
 * the head), then the dropped ones whose hub key is still live; `hubBehind` from the comparison with the hub's list
 * alone. Stray keys need a good read of that list, and are the live keys nothing here names (the head's delegations and
 * revoked holders, and any delegation the pending slot carries).
 */
function delegationRows(state: OrgState, views: readonly CertView[], sources: DelegationSources, now: Date): Pick<OrgView, 'delegations' | 'strayKeys' | 'hubKeys'> {
  const keys = sources.keys?.list ?? null;
  const hubKey = (id: string) => keys?.find((k) => k.id === id) ?? null;
  const machines = (id: string): OrgDelegationRow['machines'] => {
    const byRef = new Map<string, OrgDelegationRow['machines'][number]>();
    for (const c of views) {
      if (c.delegation !== id || c.state === 'revoked') continue;
      const seen = byRef.get(c.ref);
      byRef.set(c.ref, { ref: c.ref, name: c.name, live: (seen?.live ?? false) || c.state === 'live' });
    }
    return [...byRef.values()];
  };
  const row = (d: Delegation, rowState: OrgDelegationRow['state']): OrgDelegationRow => {
    const key = hubKey(d.id);
    const behind =
      key === null || !live(key, now) ? null : rowState === 'in-effect' && Date.parse(d.expires) > Date.parse(key.expires) ? 'renew' : rowState === 'dropped' ? 'revoke' : null;
    const mine = sources.unsent !== null && sources.unsent.id === d.id ? sources.unsent : null;
    return {
      id: d.id,
      prefix: d.prefix,
      owners: d.owners === 'org' ? 'org' : [...d.owners],
      expires: d.expires,
      maxUses: d.maxUses === NO_USE_CAP ? null : d.maxUses,
      machines: machines(d.id),
      hub: key === null ? null : { expires: key.expires, uses: key.uses, revoked: key.revoked !== null },
      state: rowState,
      unsent: rowState === 'unsent' ? { rewrite: mine?.rewrite ?? false, problem: mine?.problem ?? null } : null,
      hubBehind: behind,
      hubProblem: rowState === 'unsent' ? null : (sources.hubProblems.get(d.id) ?? null),
    };
  };
  const delegations = state.delegations.map((d) => row(d, 'in-effect'));
  const held = new Set(state.delegations.map((d) => d.id));
  const marker = sources.slot?.unsent ?? null;
  const unsentId = marker?.kind === 'delegation' && !held.has(marker.id) ? marker.id : null;
  const unsent = unsentId === null ? undefined : sources.slot!.state.delegations.find((d) => d.id === unsentId);
  if (unsent !== undefined) delegations.push(row(unsent, 'unsent'));
  const dropped = state.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder] : []));
  for (const holder of dropped) {
    const key = hubKey(holder.delegation);
    if (key === null || !live(key, now) || held.has(holder.delegation)) continue;
    const last = sources.history(holder.delegation);
    // Its last record in the held chain; failing that, what the hub's key says of it.
    const record: Delegation = last ?? { id: holder.delegation, pub: '', prefix: holder.prefix, expires: key.expires, maxUses: key.max_uses ?? NO_USE_CAP, offlineRevokeS: 0, owners: [] };
    delegations.push(row(record, 'dropped'));
  }
  // The pending slot's delegations are named too, unsent or published and not yet settled: about to be in effect.
  const named = new Set([...held, ...dropped.map((h) => h.delegation), ...(sources.slot?.state.delegations.map((d) => d.id) ?? [])]);
  const strayKeys = (keys ?? [])
    .filter((k) => live(k, now) && !named.has(k.id))
    .map((k) => ({ id: k.id, prefix: k.prefix, label: k.label, created: k.created, expires: k.expires, young: now.getTime() - Date.parse(k.created) < YOUNG_STRAY_KEY_MS }));
  return { delegations, strayKeys, hubKeys: { at: sources.keys?.at ?? null, failed: sources.keysFailed } };
}

/**
 * Whether `grantProblems` admits `kid` as the signer of a grant to `self` on `ref`, for its key `machineKey`: the
 * machine's eligibility alone, since the member and rights are the sheet's to choose.
 */
async function grants(state: OrgState, certificates: Certificates, ref: string, machineKey: string, self: ViewSelf, kid: string | null, now: Date): Promise<boolean> {
  if (kid === null) return false;
  const probe = { org: state.org, machine: ref, machineKey, member: self.member, rights: [], version: 1, issued: now.toISOString() };
  return (await grantProblems(state, certificates, probe, kid, now)).length === 0;
}

/**
 * `state` as the Org page reads it; `maySign` is the signer's (a root, signed in, its keys marked, signing.json
 * readable); `certificates`, the ones held with it, judged at `now`; `grantKid`, this device's step-up key id while it may
 * sign a record (null: signed out, or no record signer), which `mayGrant` judges.
 */
export async function orgView(
  state: OrgState,
  self: ViewSelf,
  maySign: boolean,
  certificates: Certificates = NO_CERTIFICATES,
  now = new Date(),
  grantKid: string | null = null,
  delegations: DelegationSources = NO_DELEGATION_SOURCES,
): Promise<OrgView> {
  const names = memberNames(state.members);
  const stepUpKid = async (d: Device) => (d.stepUpPub === undefined ? null : keyId(d.stepUpPub));
  const holders = new Map<string, { member: string; device: string }>();
  const members: OrgView['members'] = [];
  for (const m of state.members) {
    const devices: OrgView['members'][number]['devices'] = [];
    for (const d of m.devices) {
      const kid = await stepUpKid(d);
      if (kid !== null) holders.set(kid, { member: m.id, device: d.id });
      devices.push({
        id: d.id,
        class: d.class,
        keyStorage: d.keyStorage,
        root: kid !== null && state.root.keys.includes(kid),
        thisMac: m.id === self.member && d.id === self.device,
        fingerprint: await pairingFingerprint(state.org, m.id, d),
      });
    }
    members.push({ id: m.id, email: m.email, name: names.get(m.id) ?? m.email, role: m.role, you: m.id === self.member, devices });
  }
  const machines: OrgView['machines'] = [];
  for (const m of state.machines) {
    const kid = await keyId(m.pub);
    const mayGrant = await grants(state, certificates, m.ref, kid, self, grantKid, now);
    machines.push({ name: m.name, ref: m.ref, owners: m.owners === 'org' ? 'org' : [...m.owners], keyId: kid, certified: false, delegation: null, mayGrant });
  }
  const views = await certificateViews(state, certificates, now);
  for (const c of views) {
    const owners = state.delegations.find((d) => d.id === c.delegation)?.owners;
    if (c.state !== 'live' || owners === undefined || machines.some((m) => m.ref === c.ref)) continue;
    const mayGrant = await grants(state, certificates, c.ref, c.kid, self, grantKid, now);
    machines.push({ name: c.name, ref: c.ref, owners: owners === 'org' ? 'org' : [...owners], keyId: c.kid, certified: true, delegation: c.delegation, mayGrant });
  }
  return {
    version: state.version,
    issued: state.issued,
    maySign,
    recoveryKid: await keyId(state.root.recoveryPub),
    members,
    machines,
    roots: state.root.keys.map((kid) => {
      const holder = holders.get(kid);
      return holder === undefined ? { kid, unlisted: true as const } : { kid, ...holder };
    }),
    ...delegationRows(state, views, delegations, now),
  };
}
