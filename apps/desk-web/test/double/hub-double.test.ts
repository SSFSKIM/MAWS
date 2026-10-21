// The DX3 double's teardown. A browser suite's page is still open when its hub closes (the fixture's teardown runs
// first), so `close()` ends whatever connections a browser holds rather than waiting on them.
import { connect } from 'node:net';
import { expect, it } from 'vitest';
import { HubDouble } from './hub-double';
import { VECTOR_KEY } from '../vectors';

it('closes with a connection open that never sent a request, as a browser keeps one it opened and did not use', async () => {
  const hub = await HubDouble.start({ orgKey: VECTOR_KEY });
  const socket = connect(Number(new URL(hub.url).port), '127.0.0.1');
  const ended = new Promise((resolve) => socket.once('close', resolve));
  await new Promise((resolve) => socket.once('connect', resolve));
  // A request on another connection, answered: the double has taken the silent one, which was made first, by then.
  expect((await fetch(`${hub.url}/api/me`)).status).toBe(200);
  await hub.close();
  await ended;
});
