// The org's registry (DX7): one per org. It holds the org, its members, and its machines, and answers who an Access
// identity is to the hub. M2 adds enrollment, projects, and the archive designation; M3 push subscriptions and the grid.
import { DurableObject } from 'cloudflare:workers';
import type { Env, OrgConfig } from '../env';
import type { AccessIdentity } from '../identity/access';
import type { MachineRecord, MemberRecord, OrgRecord } from '../protocol/identity';

export type Principal = { kind: 'member'; org: OrgRecord; member: MemberRecord } | { kind: 'machine'; org: OrgRecord; machine: MachineRecord };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS org (id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS machines (
  name TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, client_id TEXT UNIQUE, token_name TEXT NOT NULL,
  state TEXT NOT NULL, enrollment TEXT NOT NULL, created TEXT NOT NULL, confirmed TEXT);
`;

/** 128 random bits as lowercase hex (DX7's member id). */
function newMemberId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(SCHEMA);
  }

  /** Who an identity Access admitted is to the hub: a member, an enrolled machine, or null for no one. */
  resolve(config: OrgConfig, identity: AccessIdentity): Principal | null {
    const org = this.ensureOrg(config);
    const sql = this.ctx.storage.sql;
    if (identity.kind === 'human') {
      const member = sql.exec<MemberRecord>('SELECT id, email, role, created FROM members WHERE email = ?', identity.email.toLowerCase()).toArray()[0];
      return member ? { kind: 'member', org, member } : null;
    }
    // Access's service-auth policy admits any service token of the account: only a client id this registry enrolled is
    // a machine.
    const machine = sql
      .exec<MachineRecord>('SELECT name, client_id, token_name, state, enrollment, created, confirmed FROM machines WHERE client_id = ?', identity.clientId)
      .toArray()[0];
    return machine ? { kind: 'machine', org, machine } : null;
  }

  /** The org, created from the deploy configuration the first time it is needed, with its admin as the first member. */
  private ensureOrg(config: OrgConfig): OrgRecord {
    const sql = this.ctx.storage.sql;
    const existing = sql.exec<OrgRecord>('SELECT id, name, created FROM org').toArray()[0];
    if (existing) return existing;
    const created = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      sql.exec('INSERT INTO org (id, name, created) VALUES (?, ?, ?)', config.id, config.name, created);
      sql.exec('INSERT INTO members (id, email, role, created) VALUES (?, ?, ?, ?)', newMemberId(), config.adminEmail.toLowerCase(), 'admin', created);
    });
    return { id: config.id, name: config.name, created };
  }
}
