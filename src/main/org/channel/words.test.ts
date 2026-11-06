// The owner's words in a project's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's
// *Words* and Proves for words.test.ts): the v2 `human` signed by this device's channel key, which the protocol's own
// `verifyEvent` admits once the hub positions it; the same signed bytes resent at each welcome until answered; the hub's
// refusal kept beside the words; and nothing signed or sent while signed out.
import { describe, expect, it } from 'vitest';
import { NO_CERTIFICATES, verifyEvent, type LogEventV2 } from '../../../../apps/org-protocol/src/index.ts';
import { ChannelOrg, ORG, PROJECT } from '../../../../test/org/channel-world';
import type { DeviceHuman } from './project-socket';
import { createNotSent, createWords, type NotSent, type WordsSigner } from './words';

async function setup(notSent: NotSent = createNotSent()) {
  const o = await ChannelOrg.make();
  const A = o.A;
  const head = o.head();
  const sent: DeviceHuman[] = [];
  let open = true;
  const mine: WordsSigner = { org: ORG, member: A, device: 'app', key: o.app.channel };
  let signer: WordsSigner | null = mine;
  let signers: Array<WordsSigner | null> = []; // the signer each next call reads, then `signer`
  const changes: number[] = [];
  const signerNow = () => (signers.length > 0 ? signers.shift()! : signer);
  const send = (human: DeviceHuman) => {
    if (!open) return false;
    sent.push(human);
    return true;
  };
  const words = createWords({ project: PROJECT, signer: signerNow, send, notSent });
  words.onChanged(() => changes.push(1));
  return {
    A,
    o,
    mine,
    head,
    sent,
    words,
    changes,
    setOpen: (v: boolean) => void (open = v),
    signOut: () => void (signer = null),
    signIn: (next: WordsSigner) => void (signer = next),
    reads: (next: Array<WordsSigner | null>) => void (signers = next),
    /** The project's next channel, after this one's release: the same signer, the same not-sent list. */
    next: () => createWords({ project: PROJECT, signer: signerNow, send, notSent }),
  };
}

describe('words', () => {
  it("signs a v2 human with this device's channel key, a nonce and no mac, which verifies once the hub positions it", async () => {
    const s = await setup();
    const result = await s.words.say('hello, everyone', '*');
    expect(result).toEqual({ ok: true, nonce: expect.any(String) });
    expect(s.sent).toHaveLength(1);
    const human = s.sent[0];
    expect(human).toMatchObject({ kind: 'human', from: 'human', member: s.A, to: '*', text: 'hello, everyone', nonce: (result as { nonce: string }).nonce });
    expect(human).not.toHaveProperty('mac');
    expect(human.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const positioned = { ts: new Date().toISOString(), writer: `hub/${s.A}`, seq: 1, ...human } as unknown as LogEventV2;
    expect(await verifyEvent({ org: ORG, project: PROJECT }, s.head.state, positioned, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
    expect(await verifyEvent({ org: ORG, project: 'other-project' }, s.head.state, positioned, NO_CERTIFICATES, new Date())).toMatchObject({ ok: false });
    expect(s.words.pending()).toEqual([{ nonce: human.nonce, text: 'hello, everyone', to: '*', state: 'sending' }]);
  });

  it('addresses the sessions it is given', async () => {
    const s = await setup();
    await s.words.say('@maws-45 look', [{ session: 's1', alias: 'maws-45' }]);
    expect(s.sent[0].to).toEqual([{ session: 's1', alias: 'maws-45' }]);
  });

  it('resends every unanswered word at a welcome with the same nonce and signature, and none once answered', async () => {
    const s = await setup();
    s.setOpen(false);
    const first = await s.words.say('one', '*');
    const second = await s.words.say('two', '*');
    expect(s.sent).toHaveLength(0);
    s.setOpen(true);
    s.words.resend();
    expect(s.sent.map((h) => h.text)).toEqual(['one', 'two']);
    const [one, two] = s.sent;
    s.words.resend();
    expect(s.sent.slice(2)).toEqual([one, two]); // the same signed bytes: the hub dedupes by nonce
    if (!first.ok || !second.ok) throw new Error('unsent');
    s.words.answered({ t: 'human-ack', nonce: first.nonce, offset: 4, writer: `hub/${s.A}`, seq: 1 });
    s.words.logged([{ offset: 5, event: { writer: `hub/${s.A}`, seq: 2, member: s.A, nonce: second.nonce } }]);
    expect(s.words.pending()).toEqual([{ nonce: first.nonce, text: 'one', to: '*', state: 'sent' }]); // acknowledged, not yet logged
    s.words.resend();
    expect(s.sent).toHaveLength(4);
  });

  // Task 2's fix wave: an ack may come before any publication listed the word (the changes are coalesced), so main says
  // `sent` itself, until the log holds the word; the renderer never infers it
  it('keeps an acknowledged word, read sent, until the log holds it; a refusal or another sign-in never touches it', async () => {
    const s = await setup();
    const said = await s.words.say('acked', '*');
    if (!said.ok) throw new Error('unsent');
    s.words.answered({ t: 'human-ack', nonce: said.nonce, offset: 4, writer: `hub/${s.A}`, seq: 1 });
    expect(s.words.pending()).toEqual([{ nonce: said.nonce, text: 'acked', to: '*', state: 'sent' }]);
    s.words.answered({ t: 'refused', refusal: { reason: 'not-reachable', nonce: said.nonce } });
    s.words.answered({ t: 'human-ack', nonce: said.nonce, offset: 4, writer: `hub/${s.A}`, seq: 1 });
    s.signIn({ ...s.mine, member: 'someone-else' });
    expect(s.words.pending()).toEqual([]);
    s.signIn(s.mine);
    expect(s.words.pending()).toEqual([{ nonce: said.nonce, text: 'acked', to: '*', state: 'sent' }]);
    s.words.resend();
    expect(s.sent).toHaveLength(1);
    s.words.logged([{ offset: 4, event: { writer: `hub/${s.A}`, seq: 1, member: s.A, nonce: said.nonce } }]);
    expect(s.words.pending()).toEqual([]);
  });

  it("keeps the hub's refusal under the words, and sends a refused word no more", async () => {
    const s = await setup();
    const result = await s.words.say('@hidden hi', [{ session: 's9', alias: 'hidden' }]);
    if (!result.ok) throw new Error('unsent');
    const before = s.changes.length;
    s.words.answered({ t: 'refused', refusal: { reason: 'not-reachable', nonce: result.nonce } });
    s.words.answered({ t: 'refused', refusal: { reason: 'not-reachable', nonce: 'someone-elses' } });
    expect(s.words.pending()).toEqual([{ nonce: result.nonce, text: '@hidden hi', to: [{ session: 's9', alias: 'hidden' }], state: { refused: 'not-reachable' } }]);
    expect(s.changes.length).toBe(before + 1);
    s.words.resend();
    expect(s.sent).toHaveLength(1);
  });

  it("reads a refusal's reason only in the hub's grammar", async () => {
    const s = await setup();
    const result = await s.words.say('hi', '*');
    if (!result.ok) throw new Error('unsent');
    s.words.answered({ t: 'refused', refusal: { reason: 'Bearer eyJhbGciOi…', nonce: result.nonce } });
    expect(s.words.pending()[0].state).toEqual({ refused: 'unrecognized' });
  });

  // Task 2's fix round 2: main is the one source of a word's state, and shows only the signed-in context's words, so a
  // tab never draws another member's (or another org's) word as this one's
  it("shows only the signed-in signer's words: another org, member or device sees none, and nothing is resent or refused", async () => {
    for (const other of [{ org: 'another-org' }, { member: 'someone-else' }, { device: 'another-device' }]) {
      const s = await setup();
      s.setOpen(false);
      const said = await s.words.say('before', '*');
      const acked = await s.words.say('acked', '*');
      if (!said.ok || !acked.ok) throw new Error('unsent');
      s.words.answered({ t: 'human-ack', nonce: acked.nonce, offset: 4, writer: `hub/${s.A}`, seq: 1 });
      const mine = [
        { nonce: said.nonce, text: 'before', to: '*', state: 'sending' },
        { nonce: acked.nonce, text: 'acked', to: '*', state: 'sent' },
      ];
      s.signOut();
      expect(s.words.pending()).toEqual([]);
      s.signIn({ ...s.mine, ...other });
      expect(s.words.pending()).toEqual([]);
      s.setOpen(true);
      s.words.resend();
      expect(s.sent).toEqual([]);
      s.signIn(s.mine); // its signer is back: its words as they were
      expect(s.words.pending()).toEqual(mine);
      s.words.resend();
      expect(s.sent.map((h) => h.text)).toEqual(['before']);
    }
  });

  it('at release drops what was acknowledged, and keeps the rest for its signer’s next open of the project, Not sent', async () => {
    const notSent = createNotSent();
    const s = await setup(notSent);
    const unacked = await s.words.say('unacked', '*');
    const acked = await s.words.say('acked', '*');
    const refused = await s.words.say('refused', '*');
    if (!unacked.ok || !acked.ok || !refused.ok) throw new Error('unsent');
    s.words.answered({ t: 'human-ack', nonce: acked.nonce, offset: 4, writer: `hub/${s.A}`, seq: 1 });
    s.words.answered({ t: 'refused', refusal: { reason: 'not-reachable', nonce: refused.nonce } });
    s.words.release();
    expect(s.words.pending()).toEqual([]);
    const lost = [
      { nonce: unacked.nonce, text: 'unacked', to: '*', state: 'not-sent' },
      { nonce: refused.nonce, text: 'refused', to: '*', state: 'not-sent' },
    ];
    // another signer's open takes none of them
    s.signIn({ ...s.mine, member: 'someone-else' });
    const theirs = s.next();
    theirs.recall(() => false);
    expect(theirs.pending()).toEqual([]);
    theirs.release();
    s.signIn(s.mine);
    const next = s.next();
    next.recall(() => false);
    expect(next.pending()).toEqual(lost);
    next.resend();
    expect(s.sent.map((h) => h.text)).toEqual(['unacked', 'acked', 'refused']); // a lost word is never sent again
    next.recall(() => false); // taken once
    expect(next.pending()).toEqual(lost);
    next.release(); // shown for that channel's life: gone for good at its release
    const after = s.next();
    after.recall(() => false);
    expect(after.pending()).toEqual([]);
  });

  it('a word Not sent that the log turns out to hold is gone', async () => {
    const s = await setup();
    const said = await s.words.say('delivered after all', '*');
    if (!said.ok) throw new Error('unsent');
    s.words.release();
    const next = s.next();
    next.recall(() => false);
    next.logged([{ offset: 9, event: { writer: `hub/${s.A}`, seq: 3, member: s.A, nonce: said.nonce } }]);
    expect(next.pending()).toEqual([]);
  });

  // Task 2's fix round 3: the log holding a word main let go ends it, heard by any channel of the project, or held already
  it('a word let go that the log holds, heard by another member’s channel or already held at recall, is never Not sent', async () => {
    const s = await setup();
    const heard = await s.words.say('heard by another channel', '*');
    const held = await s.words.say('held at recall', '*');
    if (!heard.ok || !held.ok) throw new Error('unsent');
    s.words.release();
    s.signIn({ ...s.mine, member: 'someone-else' });
    const theirs = s.next();
    theirs.logged([{ offset: 7, event: { writer: `hub/${s.A}`, seq: 1, member: 'someone-else', nonce: heard.nonce } }]); // not the signer's: kept
    theirs.logged([{ offset: 8, event: { writer: `hub/${s.A}`, seq: 2, member: s.A, nonce: heard.nonce } }]);
    theirs.release();
    s.signIn(s.mine);
    const next = s.next();
    next.recall((nonce, member) => nonce === held.nonce && member === s.A);
    expect(next.pending()).toEqual([]);
  });

  it('keeps the newest NOT_SENT_KEPT words not sent', () => {
    const notSent = createNotSent(2);
    const word = (nonce: string) => ({ project: PROJECT, context: 'c', member: 'm', nonce, text: nonce, to: '*' as const });
    for (const nonce of ['a', 'b', 'c']) notSent.put(word(nonce));
    expect(notSent.take(PROJECT, 'other')).toEqual([]);
    expect(notSent.take('another-project', 'c')).toEqual([]);
    expect(notSent.take(PROJECT, 'c').map((w) => w.nonce)).toEqual(['b', 'c']);
    expect(notSent.take(PROJECT, 'c')).toEqual([]);
  });

  it('resends a word only under the signer that signed it', async () => {
    const s = await setup();
    s.setOpen(false);
    await s.words.say('mine', '*');
    s.setOpen(true);
    s.signIn({ ...s.mine, member: 'someone-else' });
    s.words.resend();
    expect(s.sent).toEqual([]);
  });

  it('sends nothing for a word whose signing outlives a change of signer', async () => {
    const s = await setup();
    s.reads([s.mine, { ...s.mine, member: 'someone-else' }]);
    expect(await s.words.say('in flight', '*')).toEqual({ ok: false, reason: 'context-changed' });
    s.reads([s.mine, null]);
    expect(await s.words.say('in flight', '*')).toEqual({ ok: false, reason: 'signed-out' });
    expect(s.sent).toEqual([]);
    expect(s.words.pending()).toEqual([]);
  });

  it('signs and sends nothing signed out, and nothing empty', async () => {
    const s = await setup();
    expect(await s.words.say('   ', '*')).toEqual({ ok: false, reason: 'empty' });
    s.signOut();
    expect(await s.words.say('hello', '*')).toEqual({ ok: false, reason: 'signed-out' });
    expect(s.sent).toEqual([]);
    expect(s.words.pending()).toEqual([]);
  });
});
