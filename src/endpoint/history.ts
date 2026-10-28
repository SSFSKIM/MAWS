// History re-attestation (O14 M4; docs/doperpowers/plans/2026-10-27-p5-o14-cutover.md, Interfaces §D): a cut-over
// machine signs its phase-1 (DX1) history once, per project and writer, so it stays verifiable after the shared org key
// retires. The hub's inventory says what the machine wrote, under the names it gives (its current one and the former
// ones the brief reads from `sminos hub show`); the events come from the hub too, never from sminos's files.
//
//   attest: for each inventory writer the hub holds no attestation of this machine's for at its `upTo` (one whose key
//           was revoked since counts as none), every event from seq 1 to `upTo` is read and its DX1 code checked under
//           the legacy key (a writer with an event that fails, or one the hub doesn't serve, is skipped: the machine
//           can't vouch for a body it didn't write), the digest folded, the record signed with the machine key and
//           posted. A rerun changes nothing: after the cutover no DX1 event is added under an own writer.
//   check:  for each inventory writer, the stored attestation is verified against the events the hub serves now
//           (`verifyHistoryAttestation`) and must be this machine's: `verified`, `mismatch` (the events or the record
//           don't hold, or another machine signed it), `missing` (the hub serves the events short of `upTo`), or
//           `uncovered` (no attestation reaches the inventory's `upTo`), so a check over an incomplete set can't pass.
//           A stored record under the names for a writer the inventory no longer lists is judged the same way.
import {
  HISTORY_NAMES_MAX,
  historyDigest,
  isMachineName,
  machineNameKey,
  signRecord,
  SIGNING_DOMAINS,
  verifyHistoryAttestation,
  verifyHistorySigner,
  writerMachine,
  type Certificates,
  type HistoryAttestation,
  type OrgState,
  type Signed,
  type SigningKey,
  type StoredEvent,
} from 'org-protocol';
import { fetchAttestations, fetchHistoryInventory, fetchHistoryPage, postAttestation, type Credentials, type HubDeps } from './hub-http';

/** What a run reads and signs with: the machine's enrollment, its key, its head, and its legacy key's check. */
export type HistoryContext = {
  deps: HubDeps;
  hub: string;
  credentials: Credentials;
  org: string;
  ref: string;
  key: SigningKey;
  head: OrgState;
  certificates: Certificates;
  /** Whether a v1 event's DX1 code verifies under the held legacy key (`LegacyKey.verifies`). */
  verifiesCode(project: string, event: object): Promise<boolean>;
};

type At = { project: string; writer: string };
export type Attested = At & ({ outcome: 'attested'; upTo: number } | { outcome: 'already'; upTo: number } | { outcome: 'skipped'; seq: number; reason: string } | { outcome: 'refused'; upTo: number; refusal: string });
export type Checked = At & { upTo: number } & ({ outcome: 'verified' | 'missing' | 'uncovered' } | { outcome: 'mismatch'; reason: string });

/** The names a run gives the hub: the current one first, then each former one once (by its key); a refusal's reason. */
export function historyNames(current: string, former: readonly string[]): string[] | string {
  const names = [current];
  for (const name of former) {
    if (!isMachineName(name)) return `--former ${JSON.stringify(name)} is not a machine name`;
    if (!names.some((n) => machineNameKey(n) === machineNameKey(name))) names.push(name);
  }
  return names.length > HISTORY_NAMES_MAX ? `at most ${HISTORY_NAMES_MAX - 1} former names` : names;
}

/** The inventory, narrowed to one project when asked. */
async function inventory(ctx: HistoryContext, names: string[], project?: string) {
  const { projects } = await fetchHistoryInventory(ctx.deps, ctx.hub, ctx.credentials, names);
  return projects.filter((p) => project === undefined || p.id === project);
}

/** A writer's stored events from seq 1 through `upTo` (fewer when the hub serves fewer), page by page. */
async function eventsThrough(ctx: HistoryContext, project: string, writer: string, upTo: number): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  let after = 0;
  for (;;) {
    const page = await fetchHistoryPage(ctx.deps, ctx.hub, ctx.credentials, project, writer, after);
    for (const event of page.events) if (event.seq > after && event.seq <= upTo) out.push(event);
    const last = page.events.at(-1)?.seq;
    // A page that doesn't move past `after` ends the read: a hub can't hold it in a loop.
    if (!page.more || last === undefined || last <= after || last >= upTo) return out;
    after = last;
  }
}

/** The attestations a project keeps, by writer. */
async function stored(ctx: HistoryContext, project: string): Promise<Map<string, Signed<HistoryAttestation>>> {
  return new Map((await fetchAttestations(ctx.deps, ctx.hub, ctx.credentials, project)).records.map((r) => [r.body.writer, r]));
}

export async function attestHistory(ctx: HistoryContext, names: string[], project?: string): Promise<Attested[]> {
  const out: Attested[] = [];
  for (const p of await inventory(ctx, names, project)) {
    const held = await stored(ctx, p.id);
    for (const { writer, upTo } of p.writers) {
      const at = { project: p.id, writer };
      if (await attestedAlready(ctx, held.get(writer), upTo)) out.push({ ...at, outcome: 'already', upTo });
      else out.push(await attestWriter(ctx, names, at, upTo));
    }
  }
  return out;
}

/** Whether `record` covers `upTo` and is still this machine's own: one whose key was revoked since is attested again. */
async function attestedAlready(ctx: HistoryContext, record: Signed<HistoryAttestation> | undefined, upTo: number): Promise<boolean> {
  if (record === undefined || record.body.upTo < upTo) return false;
  const signer = await verifyHistorySigner(record, ctx.head, ctx.certificates, new Date(ctx.deps.now()));
  return signer.ok && signer.by.ref === ctx.ref;
}

async function attestWriter(ctx: HistoryContext, names: string[], at: At, upTo: number): Promise<Attested> {
  const events = await eventsThrough(ctx, at.project, at.writer, upTo);
  for (let seq = 1; seq <= upTo; seq++) {
    const event = events[seq - 1];
    if (event?.seq !== seq) return { ...at, outcome: 'skipped', seq, reason: 'is not served by the hub' };
    if (!(await ctx.verifiesCode(at.project, event))) return { ...at, outcome: 'skipped', seq, reason: 'fails its code' };
  }
  const body: HistoryAttestation = { org: ctx.org, project: at.project, writer: at.writer, names, upTo, digest: await historyDigest(events), created: new Date(ctx.deps.now()).toISOString() };
  const record = await signRecord(SIGNING_DOMAINS.historyAttest, body, ctx.key.privateKey, ctx.key.pub);
  const posted = await postAttestation(ctx.deps, ctx.hub, ctx.credentials, record);
  return posted.ok ? { ...at, outcome: 'attested', upTo } : { ...at, outcome: 'refused', upTo, refusal: posted.refusal };
}

export async function checkHistory(ctx: HistoryContext, names: string[], project?: string): Promise<Checked[]> {
  const out: Checked[] = [];
  const keys = new Set(names.map(machineNameKey));
  for (const p of await inventory(ctx, names, project)) {
    const held = await stored(ctx, p.id);
    for (const { writer, upTo } of p.writers) {
      const record = held.get(writer);
      held.delete(writer);
      if (record === undefined || record.body.upTo < upTo) out.push({ project: p.id, writer, upTo, outcome: 'uncovered' });
      else out.push(await checkRecord(ctx, p.id, record));
    }
    // What the hub keeps under the names for a writer its inventory no longer lists.
    for (const record of held.values()) {
      const name = writerMachine(record.body.writer);
      if (name !== null && keys.has(machineNameKey(name))) out.push(await checkRecord(ctx, p.id, record));
    }
  }
  return out;
}

async function checkRecord(ctx: HistoryContext, project: string, record: Signed<HistoryAttestation>): Promise<Checked> {
  const { writer, upTo } = record.body;
  const at = { project, writer, upTo };
  const events = await eventsThrough(ctx, project, writer, upTo);
  const verdict = await verifyHistoryAttestation(record, events, ctx.head, ctx.certificates, new Date(ctx.deps.now()));
  if (!verdict.ok) return verdict.reason === 'short' ? { ...at, outcome: 'missing' } : { ...at, outcome: 'mismatch', reason: verdict.reason };
  if (verdict.by.ref !== ctx.ref) return { ...at, outcome: 'mismatch', reason: `signed by another machine (${verdict.by.name})` };
  return { ...at, outcome: 'verified' };
}
