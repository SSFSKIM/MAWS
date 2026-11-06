// The hub's policy registry and its refusal at upload (P5 O18 M1, D5; docs/doperpowers/plans/2026-11-05-p5-o18-message-
// reach.md): the registry's rows by `policyRev` and `created`, a session bound to the machine that first exposed it, the
// `unlisted` notice's own rule, narrower provenance, the backstop on every named session, the tombstone a withheld
// position leaves, a device's words in the member's stream, and `state-unavailable` while the registry can't be read.
import { streamWriter } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listing } from '../fake-machine/org';
import { importOrgKey, seal } from '../src/protocol/codes';
import type { ProjectDown } from '../src/protocol/browser';
import type { HumanDraft, HumanEvent, LogEvent } from '../src/protocol/log';
import { BrowserClient, waitFor } from './support/clients';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';
import { memberId } from './support/org';
import { AUDIENCE, event, joined, lastHave, newSession, reachOrg, say, unlisted, upload, type ReachOrg } from './support/reach';
import type { Rl1Machine } from './support/rl1';

let hub: LocalHub;
let o: ReachOrg;
/** A's machine and B's, both advertising `audience`. */
let mA: Rl1Machine;
let mB: Rl1Machine;
const KEY = importOrgKey(new Uint8Array(32).fill(5));

beforeAll(async () => {
  hub = await startLocalHub();
  o = await reachOrg(hub);
  mA = await o.org.machine('reach-a', { capabilities: AUDIENCE });
  mB = await o.org.machine('reach-b', { capabilities: AUDIENCE, owners: [o.B] });
});
afterAll(async () => {
  mA?.close();
  mB?.close();
  await hub?.close();
});

let projects = 0;
/** A fresh project both machines have opened. */
async function opened(): Promise<string> {
  const project = `7d2e0b9f-4c3a-4d6f-8a81-${(++projects).toString(16).padStart(12, '0')}`;
  await mA.sync(project);
  await mB.sync(project);
  return project;
}

/** `Registry.policies`'s answer (src/objects/policies.ts, which the suites' typecheck leaves to the Worker's). */
type PoliciesAnswer = { rows: Record<string, { audience: string[] | null; policyRev: number; created: string } | null>; mine: Record<string, boolean> };

/** The registry's row of `session`, as a Project reads it before a batch. */
async function row(session: string) {
  const answer = await hub.registryRpc<{ ok: true; value: PoliciesAnswer }>('policies', { snapshots: [], sessions: [session] });
  return answer.value.rows[session];
}

const reasons = (refusals: Array<{ reason: string; seq?: number }>) => refusals.map((r) => `${r.reason}@${r.seq}`);

/** A browser of `who` following the project's log from its start. */
async function following(who: string, project: string): Promise<BrowserClient> {
  const browser = await BrowserClient.open(hub, who, project);
  browser.send({ t: 'resume', after: 0 });
  await browser.next((f) => f.t === 'caught-up', 'caught-up');
  return browser;
}

describe('the registry', () => {
  it('keeps the highest policyRev whatever the order of arrival, a tie the newer created; a titled or an addressed copy never moves it; a plain snapshot clears it', async () => {
    const project = await opened();
    const S = newSession();
    const { A, B } = o;
    // Rev 2 first, then rev 1 in another stream: rev 2 holds.
    expect(await upload(mA, project, [joined(mA, project, S, 1, [A, B], 2)])).toEqual([]);
    expect(await upload(mA, project, [joined(mA, project, S, 1, [A], 1)])).toEqual([]);
    expect(await row(S)).toMatchObject({ audience: [A, B].sort(), policyRev: 2 });
    // A tie at rev 3: the newer created holds, whichever arrived first.
    const newerOne = joined(mA, project, S, 1, [A, 'c'.repeat(32)], 3);
    const olderOne = { ...joined(mA, project, S, 2, [A], 3), created: '2026-11-05T11:00:00.000Z' } as LogEvent;
    expect(await upload(mA, project, [newerOne])).toEqual([]);
    expect(await upload(mA, project, [olderOne])).toEqual([]);
    expect(await row(S)).toMatchObject({ audience: [A, 'c'.repeat(32)].sort(), policyRev: 3 });
    // A titled at a higher rev, and a say naming S, move nothing.
    expect(await upload(mA, project, [event(mA, project, S, 2, { kind: 'titled', session: S, title: 't', policyRev: 9 }, [A, 'c'.repeat(32)])])).toEqual([]);
    expect(await row(S)).toMatchObject({ policyRev: 3 });
    // A plain snapshot of a higher rev: listed again.
    expect(await upload(mA, project, [joined(mA, project, S, 1, undefined, 4)])).toEqual([]);
    expect(await row(S)).toMatchObject({ audience: null, policyRev: 4 });
  });
});

describe('the binding', () => {
  it("binds a session to the machine that listed it: another machine's snapshot racing for it is refused, the lister's accepted", async () => {
    const project = await opened();
    const X = newSession();
    const listed = await listing(mB.machine, X, 1, { owners: [o.B], project, lane: 'A', state: 'idle', title: 'x' });
    expect(await hub.registryRpc('storeListing', listed)).toMatchObject({ ok: true });
    expect(reasons(await upload(mA, project, [joined(mA, project, X, 1)]))).toEqual(['not-reachable@1']);
    expect(await upload(mB, project, [joined(mB, project, X, 1)])).toEqual([]);
  });

  it("binds an id never listed to its first snapshot's machine, and refuses another machine's snapshot or notice for it", async () => {
    const project = await opened();
    const Y = newSession();
    expect(await upload(mA, project, [joined(mA, project, Y, 1, [o.A, o.B], 1)])).toEqual([]);
    expect(reasons(await upload(mB, project, [joined(mB, project, Y, 1)]))).toEqual(['not-reachable@1']);
    expect(reasons(await upload(mB, project, [unlisted(mB, project, Y, 1, 2, [o.B])]))).toEqual(['not-reachable@1']);
  });
});

describe('an unlisted notice', () => {
  it('is admitted from the bound machine with a newer policyRev within the previous audience, and served only to the withdrawn', async () => {
    const project = await opened();
    const P = newSession();
    const { A, B } = o;
    expect(await upload(mA, project, [joined(mA, project, P, 1, [A, B], 1)])).toEqual([]);
    const theirs = await following(o.bEmail, project);
    const mine = await following(ADMIN, project);
    // The share removed: the notice to B, then the snapshot of the new audience, in one batch.
    const notice = unlisted(mA, project, P, 1, 2, [B]);
    expect(await upload(mA, project, [notice, joined(mA, project, P, 1, [A], 2)])).toEqual([]);
    expect(await row(P)).toMatchObject({ audience: [A], policyRev: 2 });
    await waitFor(() => (theirs.logged.some((l) => l.event.writer === notice.writer) ? true : undefined));
    await waitFor(() => (mine.logged.some((l) => l.event.writer === streamWriter(`${mA.name}/${P}`, [A])) ? true : undefined));
    // A, outside the withdrawn set, is not sent the notice; B is not sent the new snapshot.
    expect(mine.logged.some((l) => l.event.writer === notice.writer)).toBe(false);
    expect(theirs.logged.some((l) => l.event.writer === streamWriter(`${mA.name}/${P}`, [A]))).toBe(false);
    // Not newer than the row, or outside the previous audience: refused.
    expect(reasons(await upload(mA, project, [unlisted(mA, project, P, 2, 2, [B])]))).toEqual(['not-reachable@2']);
    expect(reasons(await upload(mA, project, [unlisted(mA, project, P, 1, 3, ['c'.repeat(32)])]))).toEqual(['not-reachable@1']);
    // A say of the notice's shape, its sender outside its audience, is no notice.
    expect(reasons(await upload(mA, project, [event(mA, project, P, 3, { kind: 'say', to: [], text: 'to B alone' }, [B])]))).toEqual(['not-reachable@3']);
    theirs.close();
    mine.close();
  });

  it('carries no session reference: one naming a private parent would be served to the members it withdraws', async () => {
    const project = await opened();
    const P = newSession();
    const Q = newSession();
    const { A, B } = o;
    expect(await upload(mA, project, [joined(mA, project, P, 1, [A, B], 1), joined(mA, project, Q, 1, [A], 1)])).toEqual([]);
    const notice = { ...unlisted(mA, project, P, 1, 2, [B]), origin: { kind: 'sminos-spawn', spawnerSession: Q } } as LogEvent;
    expect(reasons(await upload(mA, project, [notice]))).toEqual(['not-reachable@1']);
    expect(await row(P)).toMatchObject({ policyRev: 1 });
  });
});

describe('provenance', () => {
  it("refuses a listed child naming a private parent it doesn't share an audience with, and admits it redacted", async () => {
    const project = await opened();
    const P = newSession();
    const C = newSession();
    expect(await upload(mA, project, [joined(mA, project, P, 1, [o.A], 1)])).toEqual([]);
    expect(reasons(await upload(mA, project, [joined(mA, project, C, 1, undefined, 1, { origin: { kind: 'sminos-spawn', spawnerSession: P } })]))).toEqual(['not-reachable@1']);
    expect(await upload(mA, project, [joined(mA, project, C, 2, undefined, 1, { origin: { kind: 'sminos-spawn', spawnerSession: null } })])).toEqual([]);
    // An unknown provenance reference (a successor not seen yet) is no one's private session: admitted.
    expect(await upload(mA, project, [event(mA, project, C, 3, { kind: 'retired', session: C, reason: 'continued', to: newSession() })])).toEqual([]);
  });
});

describe('the backstop', () => {
  it('refuses a say to an unknown session, outside a named private audience, or from a sender outside its own audience', async () => {
    const project = await opened();
    const { A, B } = o;
    const P = newSession();
    const S = newSession();
    expect(await upload(mA, project, [joined(mA, project, P, 1, [A], 1)])).toEqual([]);
    expect(reasons(await upload(mB, project, [say(mB, project, S, 1, [newSession()])]))).toEqual(['not-reachable@1']);
    // Plain toward a private session; B's audience toward A's; A's audience from B's machine.
    expect(reasons(await upload(mB, project, [say(mB, project, S, 2, [P])]))).toEqual(['not-reachable@2']);
    expect(reasons(await upload(mB, project, [say(mB, project, S, 1, [P], [B])]))).toEqual(['not-reachable@1']);
    expect(reasons(await upload(mB, project, [say(mB, project, S, 1, [P], [A])]))).toEqual(['not-reachable@1']);
  });

  it('takes a session’s first snapshot anywhere in the same batch for a reference to it: a seat spawned and messaged at once (O18 M2)', async () => {
    const project = await opened();
    const { A } = o;
    const X = newSession();
    // The new session's snapshot under a writer later in the batch than the say naming it, listed or private.
    const listed = newSession();
    const plain = say(mA, project, X, 1, [listed]);
    expect(await upload(mA, project, [plain, joined(mA, project, listed, 1, undefined, 0)])).toEqual([]);
    const secret = newSession();
    const toSecret = say(mA, project, X, 1, [secret], [A]);
    expect(await upload(mA, project, [toSecret, joined(mA, project, secret, 1, [A], 1)])).toEqual([]);
    expect(lastHave(mA, project).have).toMatchObject({ [plain.writer]: 1, [toSecret.writer]: 1 });
    expect(lastHave(mA, project).withheld).toBeUndefined();
    // The reference still meets the session's policy: a plain say toward the private one is withheld.
    const other = newSession();
    expect(reasons(await upload(mA, project, [say(mA, project, X, 2, [other]), joined(mA, project, other, 1, [A], 1)]))).toEqual(['not-reachable@2']);
    // A snapshot from a machine the session isn't bound to satisfies nothing: B's machine can't make A's private
    // session listed for its own say by forging a newer plain snapshot of it in the same batch.
    const theirs = newSession();
    expect(await upload(mA, project, [joined(mA, project, theirs, 1, [A], 1)])).toEqual([]);
    const Y = newSession();
    expect(reasons(await upload(mB, project, [say(mB, project, Y, 1, [theirs]), joined(mB, project, theirs, 1, undefined, 5)]))).toEqual(['not-reachable@1', 'not-reachable@1']);
    expect(await row(theirs)).toMatchObject({ audience: [A], policyRev: 1 });
  });

  it('refuses after a share removal a say carrying the old audience', async () => {
    const project = await opened();
    const { A, B } = o;
    const P = newSession();
    const S = newSession();
    expect(await upload(mA, project, [joined(mA, project, P, 1, [A, B], 1)])).toEqual([]);
    expect(await upload(mB, project, [say(mB, project, S, 1, [P], [A, B])])).toEqual([]);
    expect(await upload(mA, project, [unlisted(mA, project, P, 1, 2, [B]), joined(mA, project, P, 1, [A], 2)])).toEqual([]);
    expect(reasons(await upload(mB, project, [say(mB, project, S, 2, [P], [A, B])]))).toEqual(['not-reachable@2']);
  });

  it("admits between two of one owner's private sessions only their intersection (D4's S to R)", async () => {
    const project = await opened();
    const { A, B } = o;
    const C = memberId();
    const S = newSession();
    const R = newSession();
    expect(await upload(mA, project, [joined(mA, project, S, 1, [A, B], 1), joined(mA, project, R, 1, [A, C], 1)])).toEqual([]);
    expect(await upload(mA, project, [say(mA, project, S, 1, [R], [A])])).toEqual([]);
    // S's own stream (its joined at 1): what it says to R there would reach B, outside R's audience.
    expect(reasons(await upload(mA, project, [say(mA, project, S, 2, [R], [A, B])]))).toEqual(['not-reachable@2']);
  });

  it('refuses audience a writer whose digest is not its audience’s, and an audience under a plain writer', async () => {
    const project = await opened();
    const S = newSession();
    const plain = { ...joined(mA, project, S, 1), audience: [o.A] } as LogEvent;
    expect(reasons(await upload(mA, project, [plain]))).toEqual(['audience@1']);
    const wrong = { ...joined(mA, project, S, 1, [o.A], 1), audience: [o.A, o.B].sort() } as LogEvent;
    expect(reasons(await upload(mA, project, [wrong]))).toEqual(['audience@1']);
  });
});

describe('a withheld position', () => {
  it("is a tombstone the writer continues past, served to its readers; a byte-identical resend is withheld again, another body a conflict; the machine's have lists it", async () => {
    const project = await opened();
    const S = newSession();
    const reader = await following(o.bEmail, project);
    const refused = say(mA, project, S, 1, [newSession()]);
    const [refusal] = await upload(mA, project, [refused, say(mA, project, S, 2, [])]);
    expect(refusal).toEqual({ reason: 'not-reachable', writer: refused.writer, seq: 1 });
    await waitFor(() => (reader.logged.filter((l) => l.event.writer === refused.writer).length === 2 ? true : undefined));
    expect(reader.logged.filter((l) => l.event.writer === refused.writer).map((l) => l.event)).toEqual([{ writer: refused.writer, seq: 1, withheld: true }, expect.objectContaining({ seq: 2, kind: 'say' })]);
    expect(reasons(await upload(mA, project, [refused]))).toEqual(['not-reachable@1']);
    expect(reasons(await upload(mA, project, [{ ...refused, text: 'another' } as LogEvent]))).toEqual(['conflict@1']);
    expect(lastHave(mA, project)).toMatchObject({ have: { [refused.writer]: 2 }, withheld: { [refused.writer]: [1] } });
    // Another machine is never told of a position withheld from this one.
    await mB.settled(project);
    expect(lastHave(mB, project).withheld).toBeUndefined();
    reader.close();
  });
});

describe('the preflight', () => {
  it("sends the registry no snapshot past a position upload stops its writer at: a conflicting resend, stored, withheld or earlier in the batch", async () => {
    const project = await opened();
    const { A } = o;
    // A stored position resent with another body, then a snapshot of a higher rev.
    const S = newSession();
    const first = joined(mA, project, S, 1, [A], 1);
    expect(await upload(mA, project, [first])).toEqual([]);
    expect(reasons(await upload(mA, project, [{ ...first, alias: 'another' } as LogEvent, joined(mA, project, S, 2, [A], 2)]))).toEqual(['conflict@1']);
    expect(await row(S)).toMatchObject({ policyRev: 1 });
    // A withheld position resent with another body.
    const T = newSession();
    const refused = say(mA, project, T, 1, [newSession()]);
    expect(reasons(await upload(mA, project, [refused]))).toEqual(['not-reachable@1']);
    expect(reasons(await upload(mA, project, [{ ...refused, text: 'another' } as LogEvent, joined(mA, project, T, 2, undefined, 5)]))).toEqual(['conflict@1']);
    expect(await row(T)).toBeNull();
    // A position the batch itself holds, sent again in it with another body.
    const U = newSession();
    const own = joined(mA, project, U, 1, [A], 1);
    expect(reasons(await upload(mA, project, [own, { ...own, alias: 'another' } as LogEvent, joined(mA, project, U, 2, [A], 2)]))).toEqual(['conflict@1']);
    expect(await row(U)).toMatchObject({ policyRev: 1 });
  });
});

describe('state-unavailable', () => {
  it('refuses while the registry cannot be read, storing nothing at the position, and takes the resend once it can', async () => {
    const project = await opened();
    const L = newSession();
    const S = newSession();
    expect(await upload(mA, project, [joined(mA, project, L, 1)])).toEqual([]);
    const words = say(mA, project, S, 1, [L]);
    await hub.registryLacks('policies');
    try {
      expect(reasons(await upload(mA, project, [words]))).toEqual(['state-unavailable@1']);
      expect(lastHave(mA, project).have[words.writer]).toBeUndefined();
    } finally {
      await hub.registryLacks(null);
    }
    expect(await upload(mA, project, [words])).toEqual([]);
    expect(lastHave(mA, project).have[words.writer]).toBe(1);
  });
});

describe("a device's words", () => {
  async function words(project: string, member: string, to: string[], audience?: string[]): Promise<HumanEvent> {
    const draft = { kind: 'human', from: 'human', member, to: to.map((session) => ({ session, alias: 'p' })), text: 'hello', created: new Date().toISOString(), ...(audience ? { audience: [...audience].sort() } : {}) } as HumanDraft;
    return seal(await KEY, 'log', project, draft);
  }
  async function send(browser: BrowserClient, event: HumanEvent) {
    const from = browser.frames.length;
    browser.send({ t: 'human', event });
    return (await browser.next((f) => (f.t === 'human-ack' && f.nonce === event.mac.nonce) || (f.t === 'refused' && f.refusal.nonce === event.mac.nonce), 'the answer', from)) as ProjectDown;
  }

  it("toward a private session go into the member's stream and reach only its audience; an old browser's, or an outsider's, are refused", async () => {
    const project = await opened();
    const { A, B } = o;
    const P = newSession();
    expect(await upload(mA, project, [joined(mA, project, P, 1, [A], 1)])).toEqual([]);
    const mine = await following(ADMIN, project);
    const theirs = await following(o.bEmail, project);
    const ack = await send(mine, await words(project, A, [P], [A]));
    expect(ack).toMatchObject({ t: 'human-ack', writer: streamWriter(`hub/${A}`, [A]), seq: 1 });
    await waitFor(() => (mine.logged.some((l) => l.event.writer === streamWriter(`hub/${A}`, [A])) ? true : undefined));
    await waitFor(() => (mA.log.get(project)?.get(streamWriter(`hub/${A}`, [A]))?.size === 1 ? true : undefined));
    expect(mB.log.get(project)?.has(streamWriter(`hub/${A}`, [A])) ?? false).toBe(false);
    expect(await send(mine, await words(project, A, [P]))).toMatchObject({ t: 'refused', refusal: { reason: 'not-reachable' } });
    expect(await send(theirs, await words(project, B, [P], [A]))).toMatchObject({ t: 'refused', refusal: { reason: 'not-reachable' } });
    expect(await send(theirs, await words(project, B, [P], [B]))).toMatchObject({ t: 'refused', refusal: { reason: 'not-reachable' } });
    // The member signed in is the sender, whatever owners the words claim.
    const forged = { kind: 'human', from: 'human', member: B, to: [{ session: P, alias: 'p' }], text: 'as A', created: new Date().toISOString(), audience: [A], attest: { owners: [A] } } as unknown as HumanDraft;
    expect(await send(theirs, await seal(await KEY, 'log', project, forged))).toMatchObject({ t: 'refused', refusal: { reason: 'not-reachable' } });
    expect(theirs.logged.some((l) => l.event.writer.startsWith(`hub/${A}~`))).toBe(false);
    mine.close();
    theirs.close();
  });

  // P5 O18 M2b: desk-web's frozen DX6 client seals no audience. Its words toward a private session are refused here,
  // whole, and nothing of them reaches an outsider; toward a listed session, or to everyone, they go as before.
  it("from an unchanged browser are refused toward a private session, an @all naming one included, with nothing to an outsider, and go as before toward a listed one", async () => {
    const project = await opened();
    const { A } = o;
    const P = newSession();
    const L = newSession();
    expect(await upload(mA, project, [joined(mA, project, P, 1, [A], 1), joined(mA, project, L, 1)])).toEqual([]);
    const mine = await following(ADMIN, project);
    const theirs = await following(o.bEmail, project);
    const everyone = await seal(await KEY, 'log', project, { kind: 'human', from: 'human', member: A, to: '*', text: 'a note', created: new Date().toISOString() } as HumanDraft);
    expect(await send(mine, await words(project, A, [P]))).toMatchObject({ t: 'refused', refusal: { reason: 'not-reachable' } });
    expect(await send(mine, await words(project, A, [L, P]))).toMatchObject({ t: 'refused', refusal: { reason: 'not-reachable' } });
    expect(await send(mine, await words(project, A, [L]))).toMatchObject({ t: 'human-ack', writer: `hub/${A}`, seq: 1 });
    expect(await send(mine, everyone)).toMatchObject({ t: 'human-ack', writer: `hub/${A}`, seq: 2 });
    await waitFor(() => (theirs.logged.filter((l) => l.event.writer === `hub/${A}`).length === 2 ? true : undefined));
    await waitFor(() => (mB.log.get(project)?.get(`hub/${A}`)?.size === 2 ? true : undefined));
    // The outsider holds the two that went, and nothing of the refused: no event naming P.
    const named = (l: { event: LogEvent }) => JSON.stringify(l.event).includes(P);
    expect(theirs.logged.filter((l) => l.event.writer.startsWith('hub/')).some(named)).toBe(false);
    // The audit record shows a plain writer's refusals to the project, as a withheld position's tombstone is in a plain
    // stream (D5): content-free, naming no session and carrying no message, as one toward a session that doesn't exist.
    const rows = theirs.frames.filter((f) => f.t === 'refused').map((f) => (f as Extract<ProjectDown, { t: 'refused' }>).refusal);
    expect(rows.map((r) => r.reason)).toEqual(['not-reachable', 'not-reachable']);
    for (const r of rows) {
      expect(JSON.stringify(r)).not.toContain(P);
      expect(r.message).toBeUndefined();
    }
    expect([...(mB.log.get(project)?.get(`hub/${A}`)?.values() ?? [])].some((e) => JSON.stringify(e).includes(P))).toBe(false);
    mine.close();
    theirs.close();
  });
});

describe('the welcome', () => {
  it('advertises the audience capability', async () => {
    const welcome = await mA.endpoint.connect();
    expect(welcome.capabilities).toContain('audience');
  });
});
