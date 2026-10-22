// The proof commands' failure paths leave nothing open: a socket is registered for cleanup the moment it is acquired,
// and a browser's reconnect loop stops when cleanup stops it, closing a socket that opens too late. Stubs only: never
// the deployment.
import { describe, expect, it } from 'vitest';
import { LogFollower, type Person, type Socket } from '../../deploy/hub.ts';
import { browserCase } from '../../deploy/probe.ts';
import { Cleanup } from '../../deploy/proof.ts';

/** A socket that answers `next` with the frame it is given, and records its close. */
function fakeSocket(frame: Record<string, unknown> = {}) {
  const socket = {
    closed: false,
    close() {
      socket.closed = true;
    },
    next: async () => frame,
    send() {},
    onFrame: undefined,
  };
  return socket;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the probe's browser case", () => {
  it('closes its first socket when the second cannot be opened', async () => {
    const first = fakeSocket({ t: 'welcome', project: 'p', member: 'm' });
    let opens = 0;
    const owner = {
      socket: async () => {
        if (++opens === 1) return first;
        throw new Error('the registry socket was refused');
      },
    } as unknown as Person;
    const cleanup = new Cleanup();
    await expect(browserCase(owner, 'p', cleanup)).rejects.toThrow(/refused/);
    expect(await cleanup.run()).toEqual([]);
    expect(first.closed).toBe(true);
  });
});

describe("redeploy-check's browser", () => {
  it('stops reconnecting when cleanup stops it: no open is attempted after, and the loop settles', async () => {
    let attempts = 0;
    const owner = {
      socket: async () => {
        attempts++;
        throw new Error('the hub is down');
      },
    } as unknown as Person;
    const follower = new LogFollower(owner, '/api/projects/p/socket', () => {}, 20);
    const cleanup = new Cleanup();
    cleanup.add('stop the browser', () => follower.stop());
    const opening = follower.open();
    await sleep(70);
    expect(await cleanup.run()).toEqual([]);
    await opening;
    const after = attempts;
    await sleep(100);
    expect(attempts).toBe(after);
    expect(follower.socket).toBeUndefined();
  });

  it('closes a socket that opens after it was stopped', async () => {
    const late = fakeSocket();
    let release!: () => void;
    const owner = { socket: () => new Promise<Socket>((resolve) => (release = () => resolve(late as unknown as Socket))) } as unknown as Person;
    const follower = new LogFollower(owner, '/api/projects/p/socket', () => {}, 20);
    const opening = follower.open();
    const stopping = follower.stop();
    release();
    await Promise.all([opening, stopping]);
    expect(late.closed).toBe(true);
    expect(follower.socket).toBeUndefined();
  });

  it('waits for an open no longer than the first stop’s deadline, and closes the socket when it opens after', async () => {
    const late = fakeSocket();
    let release!: () => void;
    const owner = { socket: () => new Promise<Socket>((resolve) => (release = () => resolve(late as unknown as Socket))) } as unknown as Person;
    const follower = new LogFollower(owner, '/api/projects/p/socket', () => {}, 20);
    const opening = follower.open();
    await follower.stop(30); // the open still pending: abandoned at the deadline
    expect(late.closed).toBe(false);
    // A later stop, as cleanup's own step makes, waits no longer: the deadline is the first stop's.
    expect(await Promise.race([follower.stop().then(() => 'returned'), sleep(1000).then(() => 'waiting')])).toBe('returned');
    release();
    await opening;
    expect(late.closed).toBe(true);
    expect(follower.socket).toBeUndefined();
  });
});
