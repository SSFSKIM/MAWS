// The signed records the hub keeps beside the org state (O11 M4; RL §5.3, RL6), in the Registry's own storage as
// OrgChain keeps the chain:
//   - each v2 machine's posted key: its public key, ref and pairing MAC, per enrollment, for the enrolling member's
//     device to check (the hub never checks the MAC);
//   - delegation-signed machine certificates and their delegations' retirements, served beside the state;
//   - machine-signed listings, per (machine ref, session) at the highest revision, and endpoint records per machine ref
//     at the newest `issued`.
// Every record is verified by the protocol package against the head, a courtesy (RL §5.5): it refuses early what a
// machine or an app would refuse, and nothing it keeps confers authority. A record is verified against the head and the
// certificates read before the verification's awaits, and kept only if neither moved meanwhile (else verified again),
// so a record is never kept against a head that has since dropped its key, and two certificates that would contest
// each other are never both kept.
import {
  canonicalize,
  contestedRefs,
  isCertRetirement,
  isEndpointRecord,
  isListing,
  isListingGone,
  isMachineCert,
  isMachineRef,
  isPublicKey,
  isSigned,
  keyId,
  LISTING_GONE,
  machineNameKey,
  refOfName,
  verifyCertRetirement,
  verifyEndpointRecord,
  verifyListing,
  verifyMachineCert,
  type CertRetirement,
  type Certificates,
  type EndpointRecord,
  type Listing,
  type MachineCert,
  type OrgState,
  type Signed,
  type Verdict,
  type VerdictCode,
} from 'org-protocol';
import { isBase64urlOf } from '../protocol/base64url';
import { utf8Length } from '../protocol/parts';
import type { CertConflict, EnrollmentKey, Listings, MemberId } from '../protocol/identity';
import type { OrgChain } from './org-chain';
import type { Result } from './registry';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS machine_keys (
  enrollment TEXT PRIMARY KEY, machine TEXT NOT NULL, pub TEXT NOT NULL, ref TEXT NOT NULL, mac TEXT NOT NULL, posted TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS machine_certs (
  key_id TEXT PRIMARY KEY, ref TEXT NOT NULL, name_key TEXT NOT NULL, body TEXT NOT NULL, stored TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cert_retirements (body TEXT PRIMARY KEY, key_id TEXT NOT NULL, stored TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS listings (
  machine TEXT NOT NULL, session TEXT NOT NULL, revision INTEGER NOT NULL, project TEXT, owners TEXT NOT NULL,
  body TEXT NOT NULL, stored TEXT NOT NULL, PRIMARY KEY (machine, session));
CREATE TABLE IF NOT EXISTS endpoints (machine TEXT PRIMARY KEY, issued TEXT NOT NULL, body TEXT NOT NULL, stored TEXT NOT NULL);
`;

/** A `listings` row's condition for a live listing (not withdrawn), bound to `LISTING_GONE`. */
const LIVE = `json_extract(body, '$.body.fields.state') IS NOT ?`;
/** What `storeListing` did: whether it stored the listing, and whether the revision it replaced was a live one. */
export type StoredListing = { stored: boolean; replacedLive: boolean };

/** The `kv` key of a counter raised by every certificate or retirement kept, so a verification sees the set move. */
const CERTS_VERSION = 'certs-version';
/** How many times a record is verified again when the head or the certificates move under it, before `503 busy`. */
const ATTEMPTS = 5;
const KEY_FIELDS = ['pub', 'ref', 'mac'];

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (status: number, error: string, message?: string, conflicts?: CertConflict[]): Result<never> => ({
  ok: false,
  status,
  error,
  ...(message ? { message } : {}),
  ...(conflicts ? { conflicts } : {}),
});
const iso = () => new Date().toISOString();
const parsed = <T>(rows: Array<{ body: string }>) => rows.map((r) => JSON.parse(r.body) as T);

/** The posting machine, as the Worker resolved it: its name, and how it enrolled. */
export type Poster = { name: string; delegation: string | null; use: number | null };
/** Whether the one posting still stands (a member still listed, a machine still enrolled): a failure refuses the post. */
export type Authority = () => Result<unknown>;
const always: Authority = () => ({ ok: true, value: null });

/** A record's refusal by the package's verdict: `400 malformed`, `409` for a contest, `403` for any other key failure. */
function refusedRecord(code: VerdictCode): Result<never> {
  if (code === 'malformed') return fail(400, code);
  return fail(code === 'contested' ? 409 : 403, code);
}

export class OrgRecords {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly chain: OrgChain,
  ) {
    storage.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.storage.sql;
  }

  // ---- A v2 machine's key (RL §5.3) ----------------------------------------------------------------------------

  /** Keeps the machine's `{pub, ref, mac}` for its enrollment: `201` kept, `200` the same again, `409 key-posted` another. */
  keepMachineKey(machine: { name: string; enrollment: string }, body: unknown): Result<{ key: EnrollmentKey; kept: boolean }> {
    const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : null) as Record<string, unknown> | null;
    if (!b || !Object.keys(b).every((k) => KEY_FIELDS.includes(k)) || !isPublicKey(b.pub) || !isMachineRef(b.ref) || !isBase64urlOf(b.mac, 32)) {
      return fail(400, 'bad-shape', 'the body is {pub: the machine key’s uncompressed P-256 point, ref: its MachineRef, mac: 32 bytes}, base64url');
    }
    const held = this.machineKey(machine.enrollment);
    if (held) {
      if (held.pub === b.pub && held.ref === b.ref && held.mac === b.mac) return ok({ key: held, kept: false });
      return fail(409, 'key-posted', 'this enrollment holds another key; enroll again with a new code to post another');
    }
    // A ref the state or a certificate gives other names is theirs: a key posted with it would claim their relay (O11 M6).
    const names = this.namesOfRef(b.ref);
    if (names.length > 0 && !names.includes(machineNameKey(machine.name))) {
      return fail(409, 'ref-taken', `the ref ${b.ref} is another machine's in the org state or a certificate: mint a fresh ref`);
    }
    const key: EnrollmentKey = { enrollment: machine.enrollment, machine: machine.name, pub: b.pub as string, ref: b.ref, mac: b.mac as string, posted: iso() };
    this.sql.exec('INSERT INTO machine_keys (enrollment, machine, pub, ref, mac, posted) VALUES (?, ?, ?, ?, ?, ?)', key.enrollment, key.machine, key.pub, key.ref, key.mac, key.posted);
    return ok({ key, kept: true });
  }

  machineKey(enrollment: string): EnrollmentKey | null {
    return this.sql.exec<EnrollmentKey>('SELECT enrollment, machine, pub, ref, mac, posted FROM machine_keys WHERE enrollment = ?', enrollment).toArray()[0] ?? null;
  }

  // ---- Machine certificates and their retirements (RL §5.2, §5.3) ---------------------------------------------

  /** The certificates and retirements kept, in the order they were kept. */
  certificates(): Certificates {
    return {
      certs: parsed<Signed<MachineCert>>(this.sql.exec<{ body: string }>('SELECT body FROM machine_certs ORDER BY rowid').toArray()),
      retirements: parsed<Signed<CertRetirement>>(this.sql.exec<{ body: string }>('SELECT body FROM cert_retirements ORDER BY rowid').toArray()),
    };
  }

  /**
   * A delegated machine's certificate, for its own name under the delegation it enrolled through, at the use its
   * redemption counted: kept only on a clean `verifyMachineCert`, and never when it would contest a live certificate
   * (`409 contested`, naming each and the remedies). `201` kept, `200` the same again, `409 conflict` another for a
   * key a kept one certifies. `held` re-checks the poster's standing in the commit's synchronous step.
   */
  async storeCert(poster: Poster, body: unknown, held: Authority = always): Promise<Result<{ stored: boolean }>> {
    if (!isSigned(body, isMachineCert)) return fail(400, 'malformed', 'the body is a delegation-signed MachineCert, {body, sig}');
    const cert = body.body;
    if (machineNameKey(cert.name) !== machineNameKey(poster.name) || cert.delegation !== poster.delegation) {
      return fail(403, 'not-yours', `a machine posts only its own certificate: the name "${poster.name}" under the delegation it enrolled through`);
    }
    if (poster.use !== null && cert.use !== poster.use) return fail(409, 'wrong-use', `this machine's enrollment was use ${poster.use} of its provisioning key`);
    const kid = await keyId(cert.pub);
    return this.underHead<{ stored: boolean }>(held, async (state, certs, now) => {
      const verdict = await verifyMachineCert(state, body, now);
      if (!verdict.ok) {
        if (verdict.code !== 'contested') return fail(409, verdict.code);
        const entry = state.machines.find((m) => m.ref === cert.machine)!;
        const conflicts: CertConflict[] = [{ ref: entry.ref, name: entry.name, keyId: await keyId(entry.pub), holder: 'state' }];
        return fail(409, 'contested', `the ref ${cert.machine} is the org state's machine "${entry.name}": mint a fresh ref under the delegation`, conflicts);
      }
      const held = certs.certs.find((c) => c.body.pub === cert.pub);
      if (held) return canonicalize(held) === canonicalize(body) ? ok(() => ok({ stored: false })) : fail(409, 'conflict', 'a certificate for this key is held; a new key takes a new certificate');
      const contested = new Set(await contestedRefs(state, { certs: [...certs.certs, body], retirements: certs.retirements }, now));
      if (contested.has(cert.machine)) {
        const rivals = certs.certs.filter((c) => contested.has(c.body.machine) && (c.body.machine === cert.machine || machineNameKey(c.body.name) === machineNameKey(cert.name)));
        const conflicts = await Promise.all(rivals.map(async (c): Promise<CertConflict> => ({ ref: c.body.machine, name: c.body.name, keyId: await keyId(c.body.pub), holder: 'certificate' })));
        const named = conflicts.map((c) => `"${c.name}" (ref ${c.ref}, key ${c.keyId})`).join(', ');
        return fail(
          409,
          'contested',
          `the live certificate of ${named} claims this name or ref: boot under a fresh name, or retire that certificate first (a retirement signed by its delegation's key) or revoke it (an admin's org-state edit)`,
          conflicts,
        );
      }
      return ok(() => {
        this.sql.exec('INSERT INTO machine_certs (key_id, ref, name_key, body, stored) VALUES (?, ?, ?, ?, ?)', kid, cert.machine, machineNameKey(cert.name), canonicalize(body), iso());
        this.raiseCertsVersion();
        return ok({ stored: true });
      });
    });
  }

  /** A certificate's retirement signed by its own delegation's key (`verifyCertRetirement`), kept once; `held` as `storeCert`'s. */
  async storeRetirement(body: unknown, held: Authority = always): Promise<Result<{ stored: boolean }>> {
    if (!isSigned(body, isCertRetirement)) return fail(400, 'malformed', 'the body is a delegation-signed CertRetirement, {body, sig}');
    return this.underHead<{ stored: boolean }>(held, async (state, certs) => {
      const verdict = await verifyCertRetirement(state, body, certs.certs);
      if (!verdict.ok) return fail(409, verdict.code);
      return ok(() => {
        const stored = this.sql.exec('INSERT OR IGNORE INTO cert_retirements (body, key_id, stored) VALUES (?, ?, ?)', canonicalize(body), body.body.keyId, iso()).rowsWritten > 0;
        if (stored) this.raiseCertsVersion();
        return ok({ stored });
      });
    });
  }

  private raiseCertsVersion(): void {
    this.storage.kv.put(CERTS_VERSION, (this.storage.kv.get<number>(CERTS_VERSION) ?? 0) + 1);
  }

  // ---- Listings and endpoint records (RL6, RL §4.1) -----------------------------------------------------------

  /**
   * A session's listing, kept at its highest revision; `409 stale-listing` for one not above it (the same again is
   * taken). A withdrawn one (`LISTING_GONE`) is kept like any other, never deleted, so its revision still refuses a
   * replay of an earlier one. `replacedLive`: whether the revision it replaced was a live one, which every app may have
   * cached (read before the overwrite).
   */
  async storeListing(body: unknown): Promise<Result<StoredListing>> {
    if (!isSigned(body, isListing)) return fail(400, 'malformed', 'a listing is a machine-signed Listing, {body, sig}');
    const l = body.body;
    return this.machineSigned<Listing, StoredListing>(verifyListing, body, () => {
      const held = this.sql.exec<{ revision: number; body: string }>('SELECT revision, body FROM listings WHERE machine = ? AND session = ?', l.machine, l.session).toArray()[0];
      if (held && held.body === canonicalize(body)) return ok({ stored: false, replacedLive: false });
      if (held && l.revision <= held.revision) return fail(409, 'stale-listing', `the listing held is at revision ${held.revision}`);
      const replacedLive = held !== undefined && !isListingGone((JSON.parse(held.body) as Signed<Listing>).body);
      this.sql.exec(
        'INSERT OR REPLACE INTO listings (machine, session, revision, project, owners, body, stored) VALUES (?, ?, ?, ?, ?, ?, ?)',
        l.machine,
        l.session,
        l.revision,
        l.fields.project,
        JSON.stringify(l.fields.owners),
        canonicalize(body),
        iso(),
      );
      return ok({ stored: true, replacedLive });
    });
  }

  /** A machine's endpoint record, kept at its newest `issued`; `409 stale-endpoint` for one not newer (the same again is taken). */
  async storeEndpoint(body: unknown): Promise<Result<{ stored: boolean }>> {
    if (!isSigned(body, isEndpointRecord)) return fail(400, 'malformed', 'an endpoint record is a machine-signed EndpointRecord, {body, sig}');
    const r = body.body;
    return this.machineSigned<EndpointRecord, { stored: boolean }>(verifyEndpointRecord, body, () => {
      const held = this.sql.exec<{ issued: string; body: string }>('SELECT issued, body FROM endpoints WHERE machine = ?', r.machine).toArray()[0];
      if (held && held.body === canonicalize(body)) return ok({ stored: false });
      if (held && r.issued <= held.issued) return fail(409, 'stale-endpoint', `the endpoint record held was issued ${held.issued}`);
      this.sql.exec('INSERT OR REPLACE INTO endpoints (machine, issued, body, stored) VALUES (?, ?, ?, ?)', r.machine, r.issued, canonicalize(body), iso());
      return ok({ stored: true });
    });
  }

  /** A machine-signed record verified by `verify`, then judged against what is held and committed by `keep`, in one
   * synchronous step, so two submissions at once never both pass the freshness check. */
  private machineSigned<T extends Listing | EndpointRecord, V extends { stored: boolean }>(
    verify: (state: OrgState, record: Signed<T>, certs: Certificates, now: Date) => Promise<Verdict>,
    record: Signed<T>,
    keep: () => Result<V>,
  ): Promise<Result<V>> {
    return this.underHead<V>(always, async (state, certs, now) => {
      const verdict = await verify(state, record, certs, now);
      return verdict.ok ? ok(keep) : refusedRecord(verdict.code);
    });
  }

  /** Every live listing kept (a withdrawn one is left out), or a project's alone, with the endpoint records of their machines. */
  listings(project: string | null): Listings {
    const rows =
      project === null
        ? this.sql.exec<{ machine: string; body: string }>(`SELECT machine, body FROM listings WHERE ${LIVE} ORDER BY machine, session`, LISTING_GONE).toArray()
        : this.sql
            .exec<{ machine: string; body: string }>(`SELECT machine, body FROM listings WHERE project = ? AND ${LIVE} ORDER BY machine, session`, project, LISTING_GONE)
            .toArray();
    const machines = [...new Set(rows.map((r) => r.machine))];
    const endpoints = machines.flatMap((m) => this.sql.exec<{ body: string }>('SELECT body FROM endpoints WHERE machine = ?', m).toArray());
    return { listings: parsed<Signed<Listing>>(rows), endpoints: parsed<Signed<EndpointRecord>>(endpoints) };
  }

  /**
   * Every live listing kept (a withdrawn one is left out), in pages whose records come to at most `budget` bytes of JSON
   * each, a record larger than that alone in its page; one empty page when none is kept. The Registry socket's snapshot
   * (OX8; O11 M7), so that no frame grows with the org's listings.
   */
  listingPages(budget: number): Signed<Listing>[][] {
    const pages: Signed<Listing>[][] = [[]];
    let bytes = 0;
    for (const { body } of this.sql.exec<{ body: string }>(`SELECT body FROM listings WHERE ${LIVE} ORDER BY machine, session`, LISTING_GONE)) {
      const size = utf8Length(body);
      if (pages.at(-1)!.length > 0 && bytes + size > budget) {
        pages.push([]);
        bytes = 0;
      }
      pages.at(-1)!.push(JSON.parse(body) as Signed<Listing>);
      bytes += size;
    }
    return pages;
  }

  /**
   * A machine's endpoint record, named by its ref or by its name: the ref `machineNames` gives the name in the head, or
   * that of the certificate last kept under the name.
   */
  endpoint(machine: string): Signed<EndpointRecord> | null {
    const byRef = (ref: string) => this.sql.exec<{ body: string }>('SELECT body FROM endpoints WHERE machine = ?', ref).toArray()[0];
    let row = byRef(machine);
    if (!row) {
      const ref = this.refOf(machine);
      if (ref !== null) row = byRef(ref);
    }
    return row ? (JSON.parse(row.body) as Signed<EndpointRecord>) : null;
  }

  /** The ref a machine name stands for: the one `machineNames` gives it in the head, or that of the certificate last
   * kept under it; null for neither. */
  refOf(name: string): string | null {
    const head = this.chain.head();
    return (
      (head ? refOfName(head.state, name) : undefined) ??
      this.sql.exec<{ ref: string }>('SELECT ref FROM machine_certs WHERE name_key = ? ORDER BY rowid DESC LIMIT 1', machineNameKey(name)).toArray()[0]?.ref ??
      null
    );
  }

  /**
   * The ref RL1 routes a machine name to (O11 M6): the one the head's live `machines` entry of the name holds, else that
   * of the certificate last kept under the name; null for neither. Only a binding a signed record makes: never a ref a
   * machine posted with its key, which any enrollment can post, nor `machineNames`' history of names a machine had.
   */
  boundRef(name: string): string | null {
    const key = machineNameKey(name);
    return (
      this.chain.head()?.state.machines.find((m) => machineNameKey(m.name) === key)?.ref ??
      this.sql.exec<{ ref: string }>('SELECT ref FROM machine_certs WHERE name_key = ? ORDER BY rowid DESC LIMIT 1', key).toArray()[0]?.ref ??
      null
    );
  }

  /** Whether a signed record binds `ref` to a machine: the head's live `machines`, or a kept certificate (`boundRef`). */
  refBound(ref: string): boolean {
    if (!isMachineRef(ref)) return false;
    if (this.chain.head()?.state.machines.some((m) => m.ref === ref)) return true;
    return this.sql.exec('SELECT 1 FROM machine_certs WHERE ref = ? LIMIT 1', ref).toArray().length > 0;
  }

  /** The names (as `machineNameKey`s) the head, in `machines` or `machineNames`, or a kept certificate gives `ref`. */
  private namesOfRef(ref: string): string[] {
    const state = this.chain.head()?.state;
    const named = state ? [...state.machines, ...state.machineNames].filter((m) => m.ref === ref).map((m) => machineNameKey(m.name)) : [];
    const certified = this.sql.exec<{ name_key: string }>('SELECT name_key FROM machine_certs WHERE ref = ?', ref).toArray().map((r) => r.name_key);
    return [...new Set([...named, ...certified])];
  }

  /** The owners a session's listing names (none for a withdrawn one), or null when the machine listed none for it. */
  ownersOf(machine: string, session: string): MemberId[] | null {
    const row = this.sql.exec<{ owners: string }>('SELECT owners FROM listings WHERE machine = ? AND session = ?', machine, session).toArray()[0];
    return row ? (JSON.parse(row.owners) as MemberId[]) : null;
  }

  /** The ref and owners of the listing the machine named `name` (a log writer's prefix) keeps for a session, or null
   * when that machine listed none for it: another machine's listing of the same session id never answers. */
  listingOfNamed(name: string, session: string): { ref: string; owners: MemberId[] } | null {
    const ref = this.refOf(name);
    if (ref === null) return null;
    const owners = this.ownersOf(ref, session);
    return owners === null ? null : { ref, owners };
  }

  // ---- Verification against the head -----------------------------------------------------------------------------

  /**
   * Runs `judge` against the head and the certificates as they stand, and runs the commit it answers only while
   * neither moved during its awaits; otherwise it judges again. The commit runs in one synchronous transaction and may
   * still refuse: a check against what is kept (a listing's revision, say) belongs there, since another submission can
   * commit during this one's awaits. `held` runs in that same synchronous step, so a poster removed during the awaits
   * is refused there. `409 no-state` before any state.
   */
  private async underHead<T>(held: Authority, judge: (state: OrgState, certs: Certificates, now: Date) => Promise<Result<() => Result<T>>>): Promise<Result<T>> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const head = this.chain.head();
      if (head === null) return fail(409, 'no-state', 'the org has no signed state yet');
      const certsVersion = this.storage.kv.get<number>(CERTS_VERSION) ?? 0;
      const judged = await judge(head.state, this.certificates(), new Date());
      if (!judged.ok) return judged;
      if (this.chain.head()?.state.version === head.state.version && (this.storage.kv.get<number>(CERTS_VERSION) ?? 0) === certsVersion) {
        const standing = held();
        if (!standing.ok) return standing;
        return this.storage.transactionSync(judged.value);
      }
    }
    return fail(503, 'busy', 'the org state moved while this was verified; send it again');
  }
}
