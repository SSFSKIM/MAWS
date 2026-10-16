// The projects open in a tab: a connection outlives its last view for a moment, and for as long as it holds a send the
// hub has not acknowledged — that send lives only in the connection, so closing it would lose the send and its status.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importOrgKey } from 'desk-hub/protocol';
import { HubDouble, DOUBLE_MEMBER } from '../../test/double/hub-double';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { useKeyHolder } from '../key/holder';

let hub: HubDouble;
vi.mock('../hub/base', () => ({ hubBase: () => hub.url.replace(/^http/, 'ws') }));
vi.mock('../log/record', async (original) => {
  const { memoryLogRecord } = await original<typeof import('../log/record')>();
  return { memoryLogRecord, idbLogRecord: memoryLogRecord };
});
const { acquireProject, releaseProject, projectConnection } = await import('./registry');

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const until = async (check: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

beforeEach(async () => {
  hub = await HubDouble.start({ orgKey: VECTOR_KEY });
  useKeyHolder.setState({ key: await importOrgKey(VECTOR_KEY) });
});
afterEach(async () => {
  await hub.close();
});

describe('leaving a project', () => {
  it('closes its connection a moment after the last view leaves', async () => {
    acquireProject(PROJECT);
    await until(() => projectConnection(PROJECT).live.getState().caughtUp);
    releaseProject(PROJECT);
    await until(() => hub.connected(PROJECT) === 0, 3000);
  });

  it('keeps it open while it holds a send the hub has not acknowledged, and closes it once acknowledged', async () => {
    acquireProject(PROJECT);
    const connection = projectConnection(PROJECT);
    await until(() => connection.live.getState().caughtUp);
    hub.ackHumans = false; // the hub's acknowledgement is lost, as when it dropped mid-write
    await connection.say(DOUBLE_MEMBER.id, [{ session: S1, alias: 'maws-45' }], 'sent, then the grid', false);
    await until(() => hub.up.some((u) => u.frame.t === 'human'));
    releaseProject(PROJECT); // off to the grid
    await new Promise((r) => setTimeout(r, 1500));
    expect(hub.connected(PROJECT)).toBe(1);
    // Back on the project: the same connection, still holding the send it will send again (and its outbox).
    acquireProject(PROJECT);
    expect(projectConnection(PROJECT)).toBe(connection);
    expect(connection.client.holdsHumans()).toBe(true);
    releaseProject(PROJECT);
    await new Promise((r) => setTimeout(r, 1500));
    // The hub comes back and acknowledges it: only then does the connection close.
    hub.ackHumans = true;
    hub.dropConnections();
    await until(() => !connection.client.holdsHumans());
    await until(() => hub.connected(PROJECT) === 0, 3000);
  }, 15_000);
});
