// A landing stays "Checking" until what it may land on has verified (the M4 review's first finding): the hub's
// caught-up arrives before the pending set's codes are checked, and a request still pending must not read "no longer
// waiting" meanwhile. Readiness starts over on a reconnect and on a key change.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importOrgKey, seal, type OrgKey, type PendingRequest } from 'desk-hub/protocol';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { memoryLogRecord } from '../log/record';
import { ProjectConnection } from '../project/connection';
import { requestKey } from '../project/conversation';
import { landingReady, landingStatus } from './landing';

afterEach(() => vi.restoreAllMocks());

type Handlers = { pending(requests: PendingRequest[]): void; caughtUp(): void; welcome(frame: { head: number }): void };

/** Holds every WebCrypto verification until released, as a slow device would. */
function holdVerification() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const verify = crypto.subtle.verify.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args: Parameters<typeof verify>) => {
    await held;
    return verify(...args);
  });
  return release;
}

async function connection(key: OrgKey) {
  const c = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  c.setKey(key);
  const handlers = (c.client as unknown as { options: { handlers: Handlers } }).options.handlers;
  const ready = () => landingReady(c.live.getState().caughtUp, c.conversation.store.getState(), c.log.store.getState());
  return { c, handlers, ready };
}

describe('a landing waits for verification', () => {
  it('reads "Checking" while the pending set verifies after caught-up, and finds the request once it has', async () => {
    const key = await importOrgKey(VECTOR_KEY);
    const raised = await seal(key, 'raised', PROJECT, { request: 'toolu_pending', session: 's1', tool: 'AskUserQuestion', input: { questions: [] } });
    const { c, handlers, ready } = await connection(key);
    const release = holdVerification();
    handlers.pending([{ machine: 'mini', raised, terminal_only: false }]);
    handlers.caughtUp();
    expect(ready()).toBe(false);
    expect(landingStatus({ landing: { kind: 'request', request: 'toolu_pending' }, found: false, ready: ready(), unverified: false }).kind).toBe('checking');
    release();
    await vi.waitFor(() => expect(c.conversation.store.getState().requests[requestKey({ machine: 'mini', session: 's1', request: 'toolu_pending' })]?.pending).toBe(true));
    expect(ready()).toBe(true);
  });

  it('starts over on a reconnect, until the new pending set has verified', async () => {
    const key = await importOrgKey(VECTOR_KEY);
    const { handlers, ready } = await connection(key);
    handlers.pending([]);
    handlers.caughtUp();
    await vi.waitFor(() => expect(ready()).toBe(true));
    handlers.welcome({ head: 0 });
    handlers.caughtUp();
    expect(ready()).toBe(false); // caught up again, but the pending set of this connection has not come
    handlers.pending([]);
    await vi.waitFor(() => expect(ready()).toBe(true));
  });

  it('starts over on a key change', async () => {
    const key = await importOrgKey(VECTOR_KEY);
    const raised = await seal(key, 'raised', PROJECT, { request: 'toolu_pending', session: 's1', tool: 'AskUserQuestion', input: { questions: [] } });
    const { c, handlers, ready } = await connection(key);
    handlers.pending([{ machine: 'mini', raised, terminal_only: false }]);
    handlers.caughtUp();
    await vi.waitFor(() => expect(ready()).toBe(true));
    const release = holdVerification();
    c.setKey(await importOrgKey(new Uint8Array(32).fill(7)));
    expect(ready()).toBe(false);
    release();
    await vi.waitFor(() => expect(ready()).toBe(true));
  });
});
