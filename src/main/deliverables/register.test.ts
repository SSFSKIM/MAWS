import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { validateCommandInput } from '@shared/ipc/validate';
import { recordPath, writeRecord } from '@shared/maws/deliverable-files';
import { DeliverableReader } from './reader';
import { registerDeliverablesHandlers } from './register';

const A = 'App-A' as AppSessionId;
const ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

let userData: string;
let handlers: Map<CommandName, (input: unknown) => unknown>;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-deliverables-register-'));
  handlers = new Map();
  registerDeliverablesHandlers(new DeliverableReader(userData), (name, handler) => void handlers.set(name, handler as (input: unknown) => unknown));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('deliverables.* in main (E2 Interfaces "IPC")', () => {
  it('registers the three reads over the reader', async () => {
    expect([...handlers.keys()]).toEqual(['deliverables.list', 'deliverables.listAll', 'deliverables.get']);
    const record = { id: ID, appSessionId: A, kind: 'file' as const, path: '/w/a.txt', title: 'a.txt', versions: [{ path: '/w/a.txt', at: 't' }], createdAt: 't' };
    await writeRecord(recordPath(userData, A, ID), record);
    expect(await handlers.get('deliverables.list')!({ appSessionId: A })).toEqual({ records: [record] });
    expect(await handlers.get('deliverables.listAll')!({})).toEqual({ records: [record] });
    expect(await handlers.get('deliverables.get')!({ appSessionId: A, id: ID })).toEqual({ record, present: [false] });
  });

  it('refuses a deliverables.get id that is not a uuid at the boundary, before any path is built', () => {
    expect(validateCommandInput('deliverables.get', { appSessionId: A, id: '../../x' }).ok).toBe(false);
    expect(validateCommandInput('deliverables.get', { appSessionId: A, id: ID }).ok).toBe(true);
  });
});
