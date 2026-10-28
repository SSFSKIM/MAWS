// What `deployment admin` reads of the org's machines (P5 O14 M2): the certificates the state read serves, judged
// against the verified head by the package's own checks; a machine's name resolved to what holds it (the head's entry,
// a live certificate, a hub row); and `show`'s machines table, which joins the three.
import { keyId, machineNameKey, verifyCertRetirement, verifyMachineCert, type Certificates, type MachineEntry, type OrgState } from 'org-protocol';
import type { MachineView } from '../src/protocol/identity';

/** A served certificate as the head judges it: live, retired (and when), revoked, or refused with the package's code. */
export type CertView = { name: string; ref: string; pub: string; kid: string; delegation: string; state: 'live' | 'retired' | 'revoked' | { refused: string }; notAfter?: string };

/**
 * Each served certificate against `head`: revoked when the head revokes its key; retired at the earliest of the head's
 * `retired` entry for its key and every retirement its own delegation's key signed for it; else live when
 * `verifyMachineCert` takes it, refused with its code when not.
 */
export async function certificateViews(head: OrgState, set: Certificates, now = new Date()): Promise<CertView[]> {
  const views: CertView[] = [];
  for (const c of set.certs) {
    const kid = await keyId(c.body.pub);
    const view = { name: c.body.name, ref: c.body.machine, pub: c.body.pub, kid, delegation: c.body.delegation };
    if (head.revoked.some((r) => r.keyId === kid)) {
      views.push({ ...view, state: 'revoked' });
      continue;
    }
    let notAfter = head.retired.find((r) => r.keyId === kid)?.notAfter;
    for (const r of set.retirements) {
      if (r.body.keyId !== kid || (notAfter !== undefined && r.body.notAfter >= notAfter)) continue;
      if ((await verifyCertRetirement(head, r, set.certs)).ok) notAfter = r.body.notAfter;
    }
    if (notAfter !== undefined) {
      views.push({ ...view, state: 'retired', notAfter });
      continue;
    }
    const verdict = await verifyMachineCert(head, c, now);
    views.push({ ...view, state: verdict.ok ? 'live' : { refused: verdict.code } });
  }
  return views;
}

const named = (name: string) => (m: { name: string }) => machineNameKey(m.name) === machineNameKey(name);

/** What holds `name`: the head's entry, else its live certificates, else a hub row; null for nothing. */
export function resolveMachine(
  name: string,
  head: OrgState,
  certs: CertView[],
  rows: MachineView[],
): { kind: 'listed'; entry: MachineEntry; row?: MachineView } | { kind: 'certified'; certs: CertView[]; row?: MachineView } | { kind: 'row'; row: MachineView } | null {
  const row = rows.find(named(name));
  const entry = head.machines.find(named(name));
  if (entry) return { kind: 'listed', entry, row };
  const live = certs.filter((c) => c.state === 'live' && named(name)(c));
  if (live.length > 0) return { kind: 'certified', certs: live, row };
  return row ? { kind: 'row', row } : null;
}

export type MachineRow = { name: string; state: string; ref: string; key: string; online: string; seen: string };

/**
 * `show`'s machines: each head entry `listed`; each served certificate `certified`, `retired <notAfter>`, `revoked` or
 * `refused <code>`; each hub row neither covers, `unlisted` when it posted a v2 key the head does not list, `row` when
 * a certificate once held its name, `phase-1` otherwise. The DX2 presence (`online`, `seen`) is the hub row's, when the
 * hub reports it, on the entry or the live certificate that holds the row's name.
 */
export async function machineRows(head: OrgState, certs: CertView[], rows: MachineView[]): Promise<MachineRow[]> {
  const presence = (name: string) => {
    const row = rows.find(named(name)) as (MachineView & { online?: boolean; seen?: string | null }) | undefined;
    return { online: row?.online === undefined ? '-' : String(row.online), seen: row?.seen ?? '-' };
  };
  const out: MachineRow[] = [];
  for (const m of head.machines) out.push({ name: m.name, state: 'listed', ref: m.ref, key: await keyId(m.pub), ...presence(m.name) });
  for (const c of certs) {
    const state = c.state === 'live' ? 'certified' : c.state === 'retired' ? `retired ${c.notAfter}` : c.state === 'revoked' ? 'revoked' : `refused ${c.state.refused}`;
    out.push({ name: c.name, state, ref: c.ref, key: c.kid, ...(c.state === 'live' ? presence(c.name) : { online: '-', seen: '-' }) });
  }
  for (const row of rows) {
    if (head.machines.some(named(row.name)) || certs.some((c) => c.state === 'live' && named(row.name)(c))) continue;
    const state = row.key ? (row.key.listed ? 'listed' : 'unlisted') : certs.some(named(row.name)) ? 'row' : 'phase-1';
    out.push({ name: row.name, state, ref: row.key?.ref ?? '-', key: row.key ? await keyId(row.key.pub) : '-', ...presence(row.name) });
  }
  return out;
}

/** Rows as columns padded to their widths, a header first; the last column unpadded. */
export function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  return [header, ...rows].map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]))).join('  '));
}
