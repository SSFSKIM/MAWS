// What a browser's words are sealed with toward each session (P5 O18 D4, D8, M2b): a private session's audience from
// the member's policy row (the hub's registry, on the registry socket), none toward a listed one; a say to several
// sessions split into one event per audience, each split's text carrying only its own recipients' leading tags; and
// refused here, before anything is sent, toward a private session the member holds no row of.
import { streamWriter } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import type { LogEvent } from 'desk-hub/protocol';
import { planSay, privateInLog, type PolicyRows } from './audience';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const PUB = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const PRIV = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
const OTHER = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const pub = { session: PUB, alias: 'pub' };
const priv = { session: PRIV, alias: 'priv' };
const other = { session: OTHER, alias: 'other' };
const rows = (entries: Array<[string, string[], number]>): PolicyRows => new Map(entries.map(([s, audience, policyRev]) => [s, { audience, policyRev }]));
const never = () => false;

describe('planSay', () => {
  it('seals nothing toward a listed session or everyone, and the row’s audience toward a private one', () => {
    const held = rows([[PRIV, [A, B], 1]]);
    expect(planSay(A, '*', 'status: green', held, never)).toEqual({ ok: true, sends: [{ to: '*', text: 'status: green' }] });
    expect(planSay(A, [pub], '@pub hi', held, never)).toEqual({ ok: true, sends: [{ to: [pub], text: '@pub hi' }] });
    expect(planSay(A, [priv], '@priv hi', held, never)).toEqual({ ok: true, sends: [{ to: [priv], text: '@priv hi', audience: [A, B] }] });
  });

  it('alternating between a public and a private session seals plain and the audience in turn', () => {
    const held = rows([[PRIV, [A], 1]]);
    const sealed = [pub, priv, pub, priv].map((r) => planSay(A, [r], 'hello', held, never)).map((p) => (p.ok ? (p.sends[0].audience ?? null) : 'refused'));
    expect(sealed).toEqual([null, [A], null, [A]]);
  });

  it('seals the audience of the newest row: a policyRev that rises changes what the next message carries', () => {
    expect(planSay(A, [priv], 'hi', rows([[PRIV, [A, B], 1]]), never)).toMatchObject({ ok: true, sends: [{ audience: [A, B] }] });
    expect(planSay(A, [priv], 'hi', rows([[PRIV, [A, C], 2]]), never)).toMatchObject({ ok: true, sends: [{ audience: [A, C] }] });
  });

  it('splits a say per audience, each split carrying only its own recipients’ leading tags and the body unchanged', () => {
    const held = rows([[PRIV, [A, B], 1], [OTHER, [A, B], 4]]);
    const planned = planSay(A, [priv, pub, other], '@priv#9b2e4c6d @pub, @other look at @priv here', held, never);
    expect(planned).toEqual({
      ok: true,
      sends: [
        { to: [priv, other], text: '@priv#9b2e4c6d @other look at @priv here', audience: [A, B] },
        { to: [pub], text: '@pub look at @priv here' },
      ],
    });
    // Two private recipients of different audiences make two events.
    const apart = planSay(A, [priv, other], '@priv @other hi', rows([[PRIV, [A, B], 1], [OTHER, [A, C], 1]]), never);
    expect(apart).toEqual({ ok: true, sends: [{ to: [priv], text: '@priv hi', audience: [A, B] }, { to: [other], text: '@other hi', audience: [A, C] }] });
    // `@all` names no session: each split keeps it.
    const all = planSay(A, [pub, priv], '@all stand up', rows([[PRIV, [A], 1]]), never);
    expect(all).toEqual({ ok: true, sends: [{ to: [pub], text: '@all stand up' }, { to: [priv], text: '@all stand up', audience: [A] }] });
  });

  it('refuses before anything is sent a private session the member holds no row of, or a row it is outside', () => {
    const refusal = planSay(A, [pub, priv], '@pub @priv hi', new Map(), (s) => s === PRIV);
    expect(refusal).toEqual({ ok: false, reason: "@priv can't be reached from here: it is private, and not shared with you" });
    expect(planSay(C, [priv], '@priv hi', rows([[PRIV, [A, B], 1]]), never)).toMatchObject({ ok: false });
  });
});

describe('privateInLog', () => {
  const at = (writer: string, kind: string, session = PRIV) => ({ event: { writer, seq: 1, ts: '', kind, session } as unknown as LogEvent });
  it('reads the session private while its newest snapshot is in a stream of its own, or a notice withdrew the reader', () => {
    const plain = `mini/${PRIV}`;
    const stream = streamWriter(plain, [A]);
    expect(privateInLog([at(plain, 'joined')], PRIV)).toBe(false);
    expect(privateInLog([at(plain, 'joined'), at(stream, 'joined')], PRIV)).toBe(true);
    expect(privateInLog([at(stream, 'joined'), at(plain, 'state')], PRIV)).toBe(false);
    expect(privateInLog([at(plain, 'joined'), at(streamWriter(plain, [B]), 'unlisted')], PRIV)).toBe(true);
    // Another session's writer, or a say, says nothing of it.
    expect(privateInLog([at(streamWriter(`mini/${OTHER}`, [A]), 'joined')], PRIV)).toBe(false);
    expect(privateInLog([at(stream, 'say')], PRIV)).toBe(false);
  });
});
