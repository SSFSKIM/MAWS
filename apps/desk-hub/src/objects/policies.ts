// The org's session policy registry (P5 O18 D5, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md), kept by
// the Registry in its own storage as it keeps OrgRecords: one row per session id, with
//   - the machine it is bound to: the one that first exposed the id, by its RL6 listing (`listed`, `bound`) or by a
//     snapshot (`apply`). A machine is held by its ref; one with no ref (a machine of phase 1) by its name, which is
//     taken as its ref once the name has one. A binding never moves;
//   - its latest policy: its audience (null for a listed or org-wide session), its `policyRev` and the signed `created`
//     of the snapshot that set it. The highest `policyRev` wins, a tie the newer `created` (`newer`); a listing of a
//     session no snapshot set yet stands as listed below every revision (`LISTED_REV`).
// Only the session's own `joined` and `state` snapshots move a policy, through the one call a Project makes per upload
// batch (`Registry.policies`); nothing here admits anything: the Project refuses what the rows say is out of reach.
//
// The table is filled once (`filled`) from every project's newest snapshot per session at the deploy that brings it,
// each row bound to that snapshot's machine at revision 0 with no audience; until then a Project asks in vain and
// refuses `state-unavailable`.
import { machineNameKey } from 'org-protocol';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session_policies (
  session TEXT PRIMARY KEY, machine TEXT NOT NULL, audience TEXT, policy_rev INTEGER, created TEXT);
`;
const FILLED = 'policies-filled';

/** A session's policy as the registry holds it. */
export type Policy = { audience: string[] | null; policyRev: number; created: string };
/** A snapshot's policy, as a `joined` or `state` under the session's own writer states it. */
export type Snapshot = Policy & { session: string };
/** What `Registry.policies` answers: each session's policy as it stood before the batch (null for none), so the Project
 * judges the batch's events in order against it, replaying the batch's snapshots by `newer`; and, for each of them,
 * whether it is bound to the caller once the batch's snapshots are taken (a binding never moves). */
export type PoliciesAnswer = { rows: Record<string, Policy | null>; mine: Record<string, boolean> };
/** A machine as a binding names it: its ref, or `name:<name key>` for a machine with no ref. */
export type Bindable = { ref: string | null; name: string };

/** The revision a listing alone stands at: below a snapshot of any revision. */
export const LISTED_REV = -1;

/** Whether policy `a` supersedes `b`: a higher `policyRev`, or the same and a newer `created`. */
export const newer = (a: Policy, b: Policy | null): boolean => b === null || a.policyRev > b.policyRev || (a.policyRev === b.policyRev && a.created > b.created);

const byName = (name: string) => `name:${machineNameKey(name)}`;

type Row = { machine: string; audience: string | null; policy_rev: number | null; created: string | null };

export class Policies {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.storage.sql;
  }

  get filled(): boolean {
    return this.storage.kv.get<boolean>(FILLED) === true;
  }

  private row(session: string): Row | undefined {
    return this.sql.exec<Row>('SELECT machine, audience, policy_rev, created FROM session_policies WHERE session = ?', session).toArray()[0];
  }

  /** The session's policy, or null when none is held (unknown, or bound by a withdrawn listing alone). */
  policy(session: string): Policy | null {
    const row = this.row(session);
    if (!row || row.policy_rev === null) return null;
    return { audience: row.audience === null ? null : (JSON.parse(row.audience) as string[]), policyRev: row.policy_rev, created: row.created ?? '' };
  }

  /** Whether the session is bound to `machine`, a name-held binding taken as the machine's ref once it has one. */
  boundTo(session: string, machine: Bindable): boolean {
    const row = this.row(session);
    if (!row) return false;
    if (machine.ref !== null && row.machine === machine.ref) return true;
    if (row.machine !== byName(machine.name)) return false;
    if (machine.ref !== null) this.sql.exec('UPDATE session_policies SET machine = ? WHERE session = ?', machine.ref, session);
    return true;
  }

  /** Binds an unbound session to `machine`; a bound one keeps its machine. */
  bind(session: string, machine: Bindable): void {
    this.sql.exec('INSERT OR IGNORE INTO session_policies (session, machine) VALUES (?, ?)', session, machine.ref ?? byName(machine.name));
  }

  /** A live listing of the session by `ref`: the binding, and a listed policy below every revision when none is held. */
  listed(session: string, ref: string, live: boolean): void {
    this.bind(session, { ref, name: ref });
    if (live) this.sql.exec('UPDATE session_policies SET policy_rev = ?, created = ? WHERE session = ? AND policy_rev IS NULL', LISTED_REV, '', session);
  }

  /** A snapshot `machine` uploaded: taken when the session is bound to it (binding it first when unbound) and it is
   * newer than the policy held. Answers whether the session is the machine's. */
  apply(machine: Bindable, snapshot: Snapshot): boolean {
    this.bind(snapshot.session, machine);
    if (!this.boundTo(snapshot.session, machine)) return false;
    if (newer(snapshot, this.policy(snapshot.session))) {
      this.sql.exec(
        'UPDATE session_policies SET audience = ?, policy_rev = ?, created = ? WHERE session = ?',
        snapshot.audience === null ? null : JSON.stringify(snapshot.audience),
        snapshot.policyRev,
        snapshot.created,
        snapshot.session,
      );
    }
    return true;
  }

  /** The fill (see the header): each session's newest snapshot across the projects, bound to its machine, under no row
   * a snapshot or a listing set meanwhile. */
  fill(seeds: Array<{ session: string; machine: Bindable; created: string }>): void {
    this.storage.transactionSync(() => {
      for (const { session, machine, created } of seeds) {
        this.sql.exec('INSERT OR IGNORE INTO session_policies (session, machine, audience, policy_rev, created) VALUES (?, ?, NULL, 0, ?)', session, machine.ref ?? byName(machine.name), created);
        // A row a listing alone made: the log's snapshot is its policy.
        this.sql.exec('UPDATE session_policies SET audience = NULL, policy_rev = 0, created = ? WHERE session = ? AND (policy_rev IS NULL OR policy_rev = ?)', created, session, LISTED_REV);
      }
      this.storage.kv.put(FILLED, true);
    });
  }
}
