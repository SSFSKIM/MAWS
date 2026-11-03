import { chmodSync, mkdirSync, renameSync, statSync, symlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PEER_AUTH_VERSION, type PeerAddon } from './peer';
import { A, harness, takeDown } from './server.fake';

// The cua primitive server's peer policy by platform (P5 O17 M2, condition 5; docs/doperpowers/plans/2026-11-01-p5-o17-
// browser.md §H): where no peer identity addon exists (Linux), the uid is the boundary, stated as such: a private 0700
// directory and a 0600 socket this uid owns, checked by lstat at each accept, and the peer's uid where the platform
// reports it; never a stand-in addon. On darwin a missing addon still refuses every peer. Real sockets on every
// platform: the policy is chosen by the `platform` the stand names, not by the machine running the test.

afterEach(takeDown);

const uid = process.getuid!();

// A raw client: whether it heard anything before the server closed it.
function rawClient(path: string) {
  const socket = connect(path);
  let heard = 0;
  let closed = false;
  socket.on('data', (chunk) => void (heard += chunk.length));
  socket.on('error', () => {});
  socket.on('close', () => void (closed = true));
  return { heard: () => heard, closed: () => closed };
}

const until = async (done: () => boolean, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const listening = (path: string) => until(() => statSync(path, { throwIfNoEntry: false })?.isSocket() === true);

describe('on Linux: the uid boundary', () => {
  it('a same-uid peer is let in with no addon and hears the hello; the start says the uid is the boundary', async () => {
    const h = harness({ peer: { addon: null, platform: 'linux' } });
    const host = await h.host(A);
    expect(host.hello).toMatchObject({ extensionInstanceId: 'maws:A', profileName: 'MAWS' });
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 1, refused: 0 });
    expect(h.logs[0]).toBe('no peer identity check on linux: the uid is the cua sockets\' boundary (an owner-only socket in a private directory)');
    expect(statSync(dirname(h.backend.socketPathFor(A)!)).mode & 0o777).toBe(0o700);
  });

  it('a symlinked socket is refused at accept, unread', async () => {
    const h = harness({ peer: { addon: null, platform: 'linux' } });
    const path = h.backend.socketPathFor(A)!;
    await listening(path);
    renameSync(path, join(dirname(path), 'elsewhere'));
    symlinkSync(join(dirname(path), 'elsewhere'), path);
    const client = rawClient(path);
    await until(client.closed);
    expect(client.heard()).toBe(0);
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 0, refused: 1 });
    expect(h.logs.at(-1)).toBe(`cua socket of A: refused peer (not_private: ${path} is a symlink)`);
  });

  it('a directory opened to others after the start is refused at accept', async () => {
    const h = harness({ peer: { addon: null, platform: 'linux' } });
    const path = h.backend.socketPathFor(A)!;
    await listening(path);
    chmodSync(dirname(path), 0o755);
    const client = rawClient(path);
    await until(client.closed);
    expect(client.heard()).toBe(0);
    expect(h.logs.at(-1)).toBe(`cua socket of A: refused peer (not_private: ${dirname(path)} is mode 0755, more open than 0700)`);
  });

  it('a directory another uid owns is refused at the start: no session\'s socket listens', () => {
    const h = harness({ peer: { addon: null, platform: 'linux', uid: uid + 1 } });
    expect(h.backend.socketPathFor(A)).toBeNull();
    expect(h.logs).toContainEqual(expect.stringMatching(new RegExp(`^the cua socket directory .*/browser/cua is refused \\(.* is owned by uid ${uid}, not this process's ${uid + 1}\\): no session's browser is reachable$`)));
  });

  it('a peer of another uid is refused where the platform reports it', async () => {
    const addon: PeerAddon = { version: PEER_AUTH_VERSION, peer: () => ({ pid: 77, uid: uid + 1 }), process: () => null };
    const h = harness({ peer: { addon, platform: 'linux' } });
    const path = h.backend.socketPathFor(A)!;
    await listening(path);
    const client = rawClient(path);
    await until(client.closed);
    expect(client.heard()).toBe(0);
    expect(h.logs.at(-1)).toBe('cua socket of A: refused peer pid 77 (uid_mismatch)');
  });
});

describe('on darwin: no addon, no peer', () => {
  it('with the addon withheld every peer is refused, though its socket is private: darwin never falls back to the uid', async () => {
    const h = harness({ peer: { addon: null, platform: 'darwin' } });
    const path = h.backend.socketPathFor(A)!;
    await listening(path);
    const client = rawClient(path);
    await until(client.closed);
    expect(client.heard()).toBe(0);
    expect(h.logs).toEqual([
      'the peer identity addon did not load: every cua connection will be refused (run scripts/build-peer-auth.sh)',
      'cua socket of A: refused peer (module_unavailable; run scripts/build-peer-auth.sh)',
    ]);
  });

  it('a symlinked directory is refused at the start on every platform', () => {
    const h = harness({
      peer: { addon: null, platform: 'darwin' },
      prepare: (root) => {
        mkdirSync(join(root, 'browser'));
        mkdirSync(join(root, 'real'), { mode: 0o700 });
        symlinkSync(join(root, 'real'), join(root, 'browser', 'cua'));
      },
    });
    expect(h.backend.socketPathFor(A)).toBeNull();
    expect(h.logs).toContainEqual(expect.stringMatching(/^the cua socket directory .*\/browser\/cua is refused \(.*\/browser\/cua is a symlink\): no session's browser is reachable$/));
  });
});
