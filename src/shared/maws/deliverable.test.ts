import { expect, it } from 'vitest';
import { DeliverableRecordSchema } from './deliverable';

it("X12: a delivered file's record is strict, with a uuid id and its versions", () => {
  const record = { id: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', appSessionId: 'app-1', kind: 'file', path: '/r/hello.txt', title: 'hello.txt', caption: 'the greeting', versions: [{ path: '/r/hello.txt', at: '2026-10-05T00:00:00.000Z' }], toolUseId: 'toolu_1', createdAt: '2026-10-05T00:00:00.000Z' };
  expect(DeliverableRecordSchema.parse(record)).toEqual(record);
  const { title: _t, caption: _c, toolUseId: _u, ...minimal } = record;
  void [_t, _c, _u];
  expect(DeliverableRecordSchema.safeParse(minimal).success).toBe(true);
  expect(DeliverableRecordSchema.safeParse({ ...record, id: 'd1' }).success).toBe(false);
  expect(DeliverableRecordSchema.safeParse({ ...record, kind: 'note' }).success).toBe(false);
  expect(DeliverableRecordSchema.safeParse({ ...record, urgency: 'high' }).success).toBe(false);
});
