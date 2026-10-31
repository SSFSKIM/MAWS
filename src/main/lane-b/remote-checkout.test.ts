// A remote session's checkout as main follows it (P5 O7 M4, "Changes cross as a feed, and a reconnect invalidates"): the
// session's `checkout` feed told as the machine's own events, the page's watches kept, and at each reopening (a new
// channel, or the feed ended `behind` or `unavailable`) the git watches released and made again with their status told,
// and the files watches released and invalidated; a page that ends gives its watches back to the machine.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef } from '@shared/ipc/client';
import type { CommandName, EventName } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { FakeLink, MINI, type FakeSub } from '../../../test/lane-b/fake-link';
import type { MainContext } from '../ipc/router';
import { record } from '../../../test/support/builders';
import { createRemoteCheckout } from './remote-checkout';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const APP = 'app-1';
const REPO = '/work/repo';
const status = (repoRoot = REPO) => ({ repoRoot, gitDir: `${repoRoot}/.git`, commonDir: `${repoRoot}/.git`, isWorktree: false, branch: 'main', head: 'abc', upstream: null, remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-31T00:00:00.000Z' });

function lab() {
  const link = new FakeLink();
  link.peers = ['rl2.executor.machine', 'rl2.call-session', 'rl2.feeds'];
  link.answers.set('git.watch', () => ({ ok: true, output: status() }));
  for (const name of ['git.unwatch', 'files.watch', 'files.unwatch']) link.answers.set(name, () => ({ ok: true, output: undefined }));
  const emitted: Array<{ name: EventName; payload: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const records: unknown[] = [];
  const followings: string[] = [];
  const checkout = createRemoteCheckout({
    remote: (machine) => (machine === MINI ? link : null),
    emit: (machine, name, payload) => {
      expect(machine).toBe(MINI);
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      emitted.push({ name, payload: payload as Record<string, unknown> });
    },
    recordChanged: (machine, app, record) => void records.push([machine, app, record]),
    following: (machine, app) => void followings.push(`${machine}/${app}`),
    log: (line) => void logs.push(line),
  });
  const page = endableClientRef('page-1');
  const ctx: MainContext = { client: page, target: MINI, session: APP as AppSessionId };
  const feed = () => link.open().find((s) => s.request.feed === 'checkout')!;
  const opened = (sub: FakeSub = feed()) => sub.sink.subbed('snapshot', { epoch: 'checkout:boot', seq: 0 });
  return {
    link,
    checkout,
    records,
    followings,
    emitted,
    logs,
    page,
    ctx,
    feed,
    opened,
    cmd: (name: string, input: Record<string, unknown>, c: MainContext = ctx) => checkout.dispatch(link, name as CommandName, input, c),
    of: (name: EventName) => emitted.filter((e) => e.name === name).map((e) => e.payload),
    sent: () => link.calls.map((c) => c.name),
  };
}

describe('the checkout feed', () => {
  it('opens once beside the stream and tells the machine’s files, scm and git changes as its own; anything else is left out', async () => {
    const l = lab();
    l.checkout.open(l.link, APP);
    l.checkout.open(l.link, APP);
    expect(l.link.subs.map((s) => s.request)).toEqual([{ session: { lane: 'B', id: APP }, feed: 'checkout' }]);
    l.opened();
    const files = { appSessionId: APP, path: `${REPO}/a.ts`, kind: 'created' };
    const git = { repoRoot: REPO, status: status(), reason: 'worktree' };
    l.feed().sink.event({ epoch: 'checkout:boot', seq: 1 }, { name: 'files.changed', payload: files });
    l.feed().sink.event({ epoch: 'checkout:boot', seq: 2 }, { name: 'git.changed', payload: git });
    l.feed().sink.event({ epoch: 'checkout:boot', seq: 3 }, { name: 'session.status', payload: {} });
    l.feed().sink.event({ epoch: 'checkout:boot', seq: 4 }, { name: 'files.changed', payload: { appSessionId: APP } });
    expect(l.emitted).toEqual([
      { name: 'files.changed', payload: files },
      { name: 'git.changed', payload: git },
    ]);
    expect(l.sent()).toEqual([]); // the first opening gives nothing back: nothing was let go
  });

  // O5's landing audit: the record is how an idle stream learns its session runs again, without a try on the machine.
  it('hands its session’s record to the session rather than telling it, says each opening, and follows while open', async () => {
    const l = lab();
    expect(l.checkout.follows(MINI, APP)).toBe(false);
    l.checkout.open(l.link, APP);
    expect(l.checkout.follows(MINI, APP)).toBe(false); // asked, not yet open: what changes meanwhile is not carried
    l.opened();
    expect(l.followings).toEqual([`${MINI}/${APP}`]);
    expect(l.checkout.follows(MINI, APP)).toBe(true);
    const live = { ...record(APP), holder: { kind: 'self' } };
    l.feed().sink.event({ epoch: 'checkout:boot', seq: 1 }, { name: 'session.changed', payload: { record: live, cause: 'live', revision: 7 } });
    l.feed().sink.event({ epoch: 'checkout:boot', seq: 2 }, { name: 'session.changed', payload: { record: { ...live, appId: 'app-2' }, cause: 'live', revision: 8 } });
    l.feed().sink.event({ epoch: 'checkout:boot', seq: 3 }, { name: 'session.changed', payload: { record: { appId: APP }, cause: 'live', revision: 9 } });
    expect(l.records).toEqual([[MINI, APP, live]]);
    expect(l.of('session.changed')).toEqual([]);
    l.feed().sink.ended('behind');
    expect(l.checkout.follows(MINI, APP)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    l.opened();
    expect(l.followings).toHaveLength(2);
    expect(l.checkout.follows(MINI, APP)).toBe(true);
    l.checkout.close(MINI, APP);
    expect(l.checkout.follows(MINI, APP)).toBe(false);
  });

  it('asks no feed of a peer that did not list `rl2.feeds`, and leaves the asking to the link while no channel is current', () => {
    const l = lab();
    l.link.peers = ['rl2.executor.machine'];
    l.checkout.open(l.link, APP);
    expect(l.link.subs).toEqual([]);
    l.link.set('down');
    l.checkout.open(l.link, APP);
    expect(l.link.subs.map((s) => s.request.feed)).toEqual(['checkout']);
  });

  it('closes with the stream, and a later opening subscribes again', () => {
    const l = lab();
    l.checkout.open(l.link, APP);
    l.checkout.close(MINI, APP);
    expect(l.link.open()).toEqual([]);
    l.checkout.open(l.link, APP);
    expect(l.link.open()).toHaveLength(1);
  });
});

describe('the watches across a reopening', () => {
  it('sends a page’s watch with the session it was made from, and at a new channel’s opening makes each git watch again and invalidates each files watch', async () => {
    const l = lab();
    l.checkout.open(l.link, APP);
    l.opened();
    expect(await l.cmd('git.watch', { directory: REPO })).toMatchObject({ ok: true, value: { repoRoot: REPO } });
    expect(l.link.calls.at(-1)).toEqual({ name: 'git.watch', input: { directory: REPO }, session: { lane: 'B', id: APP } });
    await l.cmd('git.watch', { directory: REPO }, { ...l.ctx, client: endableClientRef('page-2') });
    await l.cmd('files.watch', { appSessionId: APP, path: `${REPO}/src` });
    l.link.calls.length = 0;

    l.opened(); // the feed's next opening: a new channel, whose ref holds nothing
    await vi.advanceTimersByTimeAsync(0);
    // page 1's git and files watches, then page 2's git watch: each released first, as many times as it is held
    expect(l.sent()).toEqual(['git.unwatch', 'git.watch', 'files.unwatch', 'git.unwatch', 'git.watch']);
    expect(l.link.calls.filter((c) => c.name.startsWith('git.')).every((c) => c.session?.id === APP)).toBe(true);
    expect(l.of('git.changed')).toEqual([{ repoRoot: REPO, status: status(), reason: 'initial' }]);
    expect(l.of('files.changed')).toEqual([{ appSessionId: APP, path: `${REPO}/src`, kind: 'invalidated' }]);

    // The renderer's files store watches again: that is the watch the next opening invalidates.
    await l.cmd('files.watch', { appSessionId: APP, path: `${REPO}/src` });
    l.link.calls.length = 0;
    l.opened();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.sent().filter((n) => n.startsWith('files.'))).toEqual(['files.unwatch']);
    expect(l.of('files.changed')).toHaveLength(2);
  });

  it('opens a feed the endpoint ended `behind` again at once and gives the watches back at its opening; `unavailable` on the backoff', async () => {
    const l = lab();
    l.checkout.open(l.link, APP);
    l.opened();
    await l.cmd('git.watch', { directory: REPO });
    l.link.calls.length = 0;
    l.feed().sink.ended('behind');
    expect(l.link.open()).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.open()).toHaveLength(1);
    l.opened();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.sent()).toEqual(['git.unwatch', 'git.watch']); // released first: the same channel still held it

    l.feed().sink.ended('unavailable');
    await vi.advanceTimersByTimeAsync(999);
    expect(l.link.open()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(l.link.open()).toHaveLength(1);
  });

  it('leaves a feed ended `removed` or `not-offered` closed until the stream opens again', async () => {
    const l = lab();
    l.checkout.open(l.link, APP);
    l.feed().sink.ended('not-offered');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(l.link.open()).toEqual([]);
    l.checkout.open(l.link, APP);
    l.feed().sink.ended('removed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(l.link.open()).toEqual([]);
    expect(l.link.subs).toHaveLength(2);
  });

  it('forgets an unwatched watch, and gives a page’s watches back to the machine when the page ends', async () => {
    const l = lab();
    l.checkout.open(l.link, APP);
    l.opened();
    await l.cmd('git.watch', { directory: REPO });
    await l.cmd('git.watch', { directory: REPO });
    await l.cmd('git.unwatch', { directory: REPO });
    await l.cmd('files.watch', { appSessionId: APP, path: `${REPO}/src` });
    l.link.calls.length = 0;
    l.page.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.sent().sort()).toEqual(['files.unwatch', 'git.unwatch']);
    l.link.calls.length = 0;
    l.opened();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.sent()).toEqual([]); // nothing left to give back
  });

  it('keeps no watch the machine refused', async () => {
    const l = lab();
    l.link.answers.set('git.watch', () => ({ ok: false, error: { code: 'no-target' } }));
    l.checkout.open(l.link, APP);
    l.opened();
    expect(await l.cmd('git.watch', { directory: '/elsewhere' })).toMatchObject({ ok: false, error: { issues: { refusal: 'no-target' } } });
    l.link.calls.length = 0;
    l.opened();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.sent()).toEqual([]);
  });
});
