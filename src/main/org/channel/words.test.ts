// The owner's words in a project's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's
// *Words* and Proves for words.test.ts): the v2 `human` signed by this device's channel key, which the protocol's own
// `verifyEvent` admits once the hub positions it; the same signed bytes resent at each welcome until answered; the hub's
// refusal kept beside the words; and nothing signed or sent while signed out.
import { describe, expect, it } from 'vitest';
import { NO_CERTIFICATES, verifyEvent, type LogEventV2 } from '../../../../apps/org-protocol/src/index.ts';
import { ChannelOrg, ORG, PROJECT } from '../../../../test/org/channel-world';
import type { DeviceHuman } from './project-socket';
import { createWords, type WordsSigner } from './words';

async function setup() {
  const o = await ChannelOrg.make();
  const A = o.A;
  const head = o.head();
  const sent: DeviceHuman[] = [];
  let open = true;
  let signer: WordsSigner | null = { org: ORG, member: A, key: o.app.channel };
  const changes: number[] = [];
  const words = createWords({
    project: PROJECT,
    signer: () => signer,
    send: (human) => {
      if (!open) return false;
      sent.push(human);
      return true;
    },
  });
  words.onChanged(() => changes.push(1));
  return { A, head, sent, words, changes, setOpen: (v: boolean) => void (open = v), signOut: () => void (signer = null) };
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
    expect(s.words.pending()).toEqual([]);
    s.words.resend();
    expect(s.sent).toHaveLength(4);
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

  it('signs and sends nothing signed out, and nothing empty', async () => {
    const s = await setup();
    expect(await s.words.say('   ', '*')).toEqual({ ok: false, reason: 'empty' });
    s.signOut();
    expect(await s.words.say('hello', '*')).toEqual({ ok: false, reason: 'signed-out' });
    expect(s.sent).toEqual([]);
    expect(s.words.pending()).toEqual([]);
  });
});
