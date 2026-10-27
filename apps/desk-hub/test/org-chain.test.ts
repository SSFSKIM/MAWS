/// <reference types="node" />
// The Registry's chain (O11 M3) apart from any Durable Object, over Node's SQLite: a successor verified against the
// root transitions held when its verification began is committed only while those are still all the chain holds, so a
// transition accepted meanwhile (a recovery fencing the old root) is never outrun by a successor that root signed.
import { DatabaseSync } from 'node:sqlite';
import { generateSigningKey, verifySuccessor, type SigningKey } from 'org-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgChain } from '../src/objects/org-chain';
import type { MemberRecord } from '../src/protocol/identity';
import { genesis, memberId, newDevice, next, rootKid, signedBy, transition, type TestDevice } from './support/org';

/** A held successor verification: the next call of `verifySuccessor` waits for `release` before it answers. */
const gate = vi.hoisted(() => ({ hold: false, held: [] as Array<() => void>, calls: 0 }));
vi.mock('org-protocol', async (importOriginal) => {
  const real = await importOriginal<typeof import('org-protocol')>();
  return {
    ...real,
    verifySuccessor: async (...args: Parameters<typeof real.verifySuccessor>) => {
      gate.calls++;
      if (gate.hold) {
        gate.hold = false;
        await new Promise<void>((resolve) => gate.held.push(resolve));
      }
      return real.verifySuccessor(...args);
    },
  };
});
const release = () => {
  for (const resolve of gate.held.splice(0)) resolve();
};

const ORG = 'org-chain-unit';
const ADMIN = 'admin@example.com';

/** The Registry's storage as `OrgChain` reaches it, with the `members` and `push_subscriptions` tables the Registry
 * creates beside it. */
function storage(): DurableObjectStorage {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE members (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, created TEXT NOT NULL)');
  db.exec('CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, member TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL, device TEXT)');
  const exec = (query: string, ...values: Array<string | number | null>) => {
    if (query.includes('CREATE TABLE')) {
      db.exec(query);
      return { toArray: () => [], one: () => ({}), rowsWritten: 0 };
    }
    const stmt = db.prepare(query);
    if (/^\s*SELECT/i.test(query)) {
      const rows = stmt.all(...values);
      return { toArray: () => rows, one: () => rows[0], rowsWritten: 0, [Symbol.iterator]: () => rows[Symbol.iterator]() };
    }
    const { changes } = stmt.run(...values);
    return { toArray: () => [], one: () => ({}), rowsWritten: Number(changes), [Symbol.iterator]: () => [][Symbol.iterator]() };
  };
  return { sql: { exec }, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage;
}

let chain: OrgChain;
let admin: MemberRecord;
let a1: TestDevice;
let recovery: SigningKey;

beforeEach(async () => {
  gate.hold = false;
  gate.calls = 0;
  const store = storage();
  admin = { id: memberId(), email: ADMIN, role: 'admin', created: new Date().toISOString() };
  store.sql.exec('INSERT INTO members (id, email, role, created) VALUES (?, ?, ?, ?)', admin.id, admin.email, admin.role, admin.created);
  chain = new OrgChain(store);
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  const g = await chain.submit(await signedBy(await genesis(ORG, admin.id, ADMIN, a1, recovery), a1), admin, ORG, { email: ADMIN });
  expect(g).toMatchObject({ ok: true, value: { version: 1 } });
});

describe('a successor', () => {
  it('signed by the old root, whose verification a recovery transition outran, is not committed', async () => {
    const head = chain.head()!;
    const recovered = await newDevice('a-recovered');
    const oldRoot = await signedBy(await next(head, (s) => s.projects.push({ id: 'old-root', name: 'Old' })), a1);
    gate.hold = true;
    const submitted = chain.submit(oldRoot, admin, ORG, { email: ADMIN });
    await vi.waitFor(() => expect(gate.held.length).toBe(1));
    // The recovery lands while the old root's successor is being verified.
    expect(await chain.submitTransition(await transition(head, [recovered], recovery), admin)).toMatchObject({ ok: true });
    release();
    expect(await submitted).toMatchObject({ ok: false, status: 409, error: 'not-root-signed' });
    expect(chain.head()!.state.version).toBe(1);
    // What the chain holds still verifies for a client holding the transitions.
    const kid = await rootKid(recovered);
    const after = await signedBy(
      await next(head, (s) => {
        s.members[0].devices.push(recovered.device);
        s.root.keys = [kid];
      }),
      recovered,
    );
    expect(await verifySuccessor(head, after, chain.transitions())).toEqual({ ok: true });
    expect(await chain.submit(after, admin, ORG, { email: ADMIN })).toMatchObject({ ok: true, value: { version: 2 } });
  });

  it('signed by the new root, verified before a second transition landed, is verified again and committed', async () => {
    const head = chain.head()!;
    const [r1, r2] = await Promise.all([newDevice('r1'), newDevice('r2')]);
    expect(await chain.submitTransition(await transition(head, [r1], recovery), admin)).toMatchObject({ ok: true });
    const kid = await rootKid(r1);
    const byR1 = await signedBy(
      await next(head, (s) => {
        s.members[0].devices.push(r1.device);
        s.root.keys = [kid];
      }),
      r1,
    );
    gate.hold = true;
    const submitted = chain.submit(byR1, admin, ORG, { email: ADMIN });
    await vi.waitFor(() => expect(gate.held.length).toBe(1));
    expect(await chain.submitTransition(await transition(head, [r2], recovery), admin)).toMatchObject({ ok: true });
    release();
    expect(await submitted).toMatchObject({ ok: true, value: { version: 2 } });
    expect(gate.calls).toBe(2);
  });
});
