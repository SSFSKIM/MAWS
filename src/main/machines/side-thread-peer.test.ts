// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Decision Log 52): a side thread of several
// comments carries the later ones as `from.more`, which a daemon that predates them reads past as a field it does not
// know, opening the thread from the first comment alone. This Mac's own daemon may be of another build, so such a send
// is refused before it goes, in words the card shows; one comment, a `/btw` promotion and every other command go on.
import { describe, expect, it } from 'vitest';
import type { ClientRef } from '@shared/ipc/client';
import { WIRE_MINOR, type WirePeer } from '@shared/ipc/wire';
import { THREAD_FROM_ONE_COMMENT } from '@shared/side/copy';
import { refuseUnservedSideThreads, SIDE_THREAD_COMMANDS, SIDE_THREAD_MORE_MINOR } from './side-thread-peer';

const peer = (minor: number): WirePeer => ({ major: 3, minor, build: 'theirs', capabilities: [] });
const client = { id: 'page-1' } as unknown as ClientRef;
const anchor = (n: number) => ({ kind: 'browser-element' as const, locator: `main > p:nth-of-type(${n})`, label: `Paragraph ${n}`, pageUrl: 'https://example.com/pricing' });
const comment = (n: number) => ({ anchor: anchor(n), text: `Shorten paragraph ${n}.`, screenshot: null });
const one = { appSessionId: 'a1111111-1111-4111-8111-111111111111', from: { kind: 'comment', ...comment(1) } };
const several = { ...one, from: { ...one.from, more: [comment(2), comment(3)] } };
const btw = { appSessionId: one.appSessionId, from: { kind: 'btw', exchanges: [{ question: 'Which file?', response: 'The pricing page.' }], text: null } };

describe('a side thread of several comments and this Mac’s daemon', () => {
  it('this build’s own daemon is served: the minor that brought `more` is not above the wire’s', () => {
    expect(SIDE_THREAD_MORE_MINOR).toBeLessThanOrEqual(WIRE_MINOR);
    expect(SIDE_THREAD_COMMANDS).toEqual(['side.thread.open']);
  });

  it('a daemon that predates `more`: several comments are refused in the card’s words, before they go', async () => {
    const hook = refuseUnservedSideThreads(() => peer(SIDE_THREAD_MORE_MINOR - 1), 'This Mac');
    expect(await hook('side.thread.open', several, client)).toEqual({ ok: false, error: { code: 'internal', message: THREAD_FROM_ONE_COMMENT, issues: { refusal: 'not-offered' } } });
  });

  it('a daemon that predates `more`: one comment and a /btw promotion go as before', async () => {
    const hook = refuseUnservedSideThreads(() => peer(SIDE_THREAD_MORE_MINOR - 1), 'This Mac');
    expect(await hook('side.thread.open', one, client)).toBeUndefined();
    expect(await hook('side.thread.open', btw, client)).toBeUndefined();
  });

  it('a daemon of the minor that brought `more`, or later: several comments go', async () => {
    let minor = SIDE_THREAD_MORE_MINOR;
    const hook = refuseUnservedSideThreads(() => peer(minor), 'This Mac');
    expect(await hook('side.thread.open', several, client)).toBeUndefined();
    minor += 2;
    expect(await hook('side.thread.open', several, client)).toBeUndefined();
  });

  it('no daemon welcomed: several comments are `host_unavailable`, never held for whichever welcomes next; one comment goes on', async () => {
    const hook = refuseUnservedSideThreads(() => null, 'This Mac');
    expect(await hook('side.thread.open', several, client)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(await hook('side.thread.open', one, client)).toBeUndefined();
  });

  it('any other command goes on', async () => {
    const hook = refuseUnservedSideThreads(() => peer(SIDE_THREAD_MORE_MINOR - 1), 'This Mac');
    expect(await hook('side.comment.content', { comments: [comment(1), comment(2)] }, client)).toBeUndefined();
  });
});
