/// <reference types="node" />
// This Worker-typed suite executes its SQL adapter with Node's SQLite.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../src/objects/session-store';
import type { SessionMessage } from '../src/protocol/session';
function store() {
  const db = new DatabaseSync(':memory:');
  const storage = { sql: { exec(query: string, ...values: Array<string | number | null>) {
    if (query.includes('CREATE TABLE')) { db.exec(query); return { toArray: () => [] }; }
    const stmt = db.prepare(query);
    const rows = stmt.all(...values);
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } } } as unknown as DurableObjectStorage;
  return { db, storage, plane: new SessionStore(storage) };
}
const message = (rpc: string, text = ''): SessionMessage<'op'> => ({ project: 'p', machine: 'mini', session: 's', kind: 'op', sub: null, n: null, body: { rpc, op: 'command', phase: 'end', id: rpc, name: 'color', args: 'red', readback: { how: 'row', text } } });
describe('bounded command receipts', () => {
  it('keeps the newest 256, expires a receipt after a day, and replay does not renew it', () => {
    const { db, plane } = store();
    try {
      for (let i = 0; i < 257; i++) plane.putOp(message(`${i}`), i);
      expect(plane.ops(300).map((m) => m.body.rpc)).toEqual(Array.from({ length: 256 }, (_, i) => `${i + 1}`));
      plane.putOp(message('1'), 1000); // a duplicate end must not keep an old receipt forever
      expect(plane.ops(86400001).map((m) => m.body.rpc)).not.toContain('1');
      expect(plane.ops(86401000)).toEqual([]);
    } finally { db.close(); }
  });
  it('bounds UTF-8 bytes, excludes unrelated bodies and future op payloads, and survives reconstruction', () => {
    const { db, storage, plane } = store();
    try {
      const text = '한'.repeat(100000);
      for (let i = 0; i < 16; i++) plane.putOp(message(`${i}`, text), i);
      const kept = plane.ops(20);
      expect(kept.length).toBeLessThan(16);
      expect(kept.at(-1)?.body.rpc).toBe('15');
      expect(new TextEncoder().encode(JSON.stringify(kept)).byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
      plane.putOp({ ...message('null'), body: { ...message('null').body, rpc: null } }, 21);
      plane.putOp({ ...message('btw'), body: { ...message('btw').body, op: 'btw', text: 'not approved for storage' } }, 22);
      plane.putOp({ ...message('clean'), body: { ...message('clean').body, rows: [{ text: 'never retain me' }], transcript: 'never' } }, 23);
      expect(plane.ops(24).at(-1)?.body).toEqual(message('clean').body);
      expect(plane.ops(24).some((m) => m.body.rpc === null || m.body.op === 'btw')).toBe(false);
      expect(new SessionStore(storage).ops(24)).toEqual(plane.ops(24));
    } finally { db.close(); }
  });
});
