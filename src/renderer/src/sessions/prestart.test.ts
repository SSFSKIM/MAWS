// Ticket 851, M3 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D8, D10): the composer's prestart trigger. The
// leading edge of the first edit that leaves the document non-empty asks at once; after that at most once every 10 s
// while it stays non-empty. Each request carries a token the window minted; a tab that moves to another machine withdraws
// the last one it sent, whatever its answer did; an older spine's refusal reads as skipped, with nothing shown.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { leftThisMachine, notePrestartEdit, PRESTART_EVERY_MS, resetPrestarts } from './prestart';

const TAB = at('tab-1' as AppSessionId);
let fake: FakeClient;
let now: number;
const edit = (empty = false) => notePrestartEdit(TAB, { empty }, fake.client, now);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetPrestarts();
  fake = fakeClient();
  now = 1_000_000;
});
afterEach(() => resetPrestarts());

describe('the trigger', () => {
  it('asks on the leading edge of the first non-empty edit, never for an empty document', async () => {
    edit(true);
    expect(fake.invoked('session.intent.prestart')).toEqual([]);
    edit();
    expect(fake.invoked('session.intent.prestart')).toEqual([{ appSessionId: TAB, token: expect.any(String) }]);
  });

  it('asks at most once every 10 s while the document stays non-empty, and again once 10 s have passed', async () => {
    edit();
    await fake.reply('session.intent.prestart', { status: 'started', token: 't1' });
    now += 1_000;
    edit();
    now += PRESTART_EVERY_MS - 1_001;
    edit();
    expect(fake.invoked('session.intent.prestart')).toHaveLength(1);
    now += 1;
    edit();
    expect(fake.invoked('session.intent.prestart')).toHaveLength(2);
    expect(PRESTART_EVERY_MS).toBe(10_000);
  });

  it('reads an older spine’s refusal (and any error) as skipped: nothing thrown, and the next ask waits its 10 s', async () => {
    edit();
    await fake.fail('session.intent.prestart', 'unknown command session.intent.prestart');
    now += 1_000;
    edit();
    expect(fake.invoked('session.intent.prestart')).toHaveLength(1);
    leftThisMachine(TAB, fake.client);
    await fake.fail('session.intent.prestart.withdraw', 'unknown command session.intent.prestart.withdraw'); // refused as well, nothing thrown
  });
});

describe('a spawn target on another machine, both orders', () => {
  const sent = (nth = 0) => (fake.invoked('session.intent.prestart')[nth] as { token: string }).token;

  it('the answer first: picking another machine withdraws by the request’s token, and the next edit back here asks at once', async () => {
    edit();
    await fake.reply('session.intent.prestart', { status: 'started', token: sent() });
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([{ appSessionId: TAB, token: sent() }]);
    now += 1_000;
    edit(); // back on this machine
    expect(fake.invoked('session.intent.prestart')).toHaveLength(2);
    expect(sent(1)).not.toBe(sent(0));
  });

  it('the move first: the withdraw goes at once, and the answer that lands after it asks for nothing more', async () => {
    edit();
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([{ appSessionId: TAB, token: sent() }]);
    await fake.reply('session.intent.prestart', { status: 'running', token: sent() });
    await settle();
    expect(fake.invoked('session.intent.prestart.withdraw')).toHaveLength(1);
  });

  it('a second move with no request since withdraws nothing more', async () => {
    edit();
    await fake.reply('session.intent.prestart', { status: 'skipped', token: null, reason: 'needs_trust' });
    leftThisMachine(TAB, fake.client);
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toHaveLength(1);
  });
});

// M3's medium review (Decision Log 13): the window's own findings. The window mints each request's token before it asks,
// so what a move withdraws never waits for, nor is changed by, an answer.
describe('M3’s review: the window’s findings', () => {
  const sentTokens = () => (fake.invoked('session.intent.prestart') as { token?: string }[]).map((input) => input.token);

  it('6. two requests answered in reverse: the older one’s late skip never hides the newer one’s token from a move', async () => {
    edit(); // request 1
    now += PRESTART_EVERY_MS;
    edit(); // request 2
    expect(fake.invoked('session.intent.prestart')).toHaveLength(2);
    await fake.reply('session.intent.prestart', { status: 'started', token: sentTokens()[1] }, 1);
    await fake.reply('session.intent.prestart', { status: 'skipped', token: null, reason: 'ended: a newer request came first' });
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([{ appSessionId: TAB, token: sentTokens()[1] }]);
  });

  it('7. a move while the request is unanswered (its caller’s deadline passed, or still on its way) withdraws by the token it carried', async () => {
    edit();
    const [token] = sentTokens();
    expect(token).toEqual(expect.any(String));
    await fake.fail('session.intent.prestart', 'the request timed out', 'timeout' as never);
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([{ appSessionId: TAB, token }]);
  });
});

// The xhigh panel on ticket 851 (scalpel-3, finding 6): a refresh the window sent may not have reached the spine when the
// tab moves, so the token before it may still be the spine's line; the move withdraws both, the older first.
describe('the xhigh panel: a refresh overtaken by a move', () => {
  const sentTokens = () => (fake.invoked('session.intent.prestart') as { token: string }[]).map((input) => input.token);

  it('scalpel-3 6. withdraws the earlier token too while the refresh is unanswered, the older first', async () => {
    edit(); // request 1
    await fake.reply('session.intent.prestart', { status: 'started', token: sentTokens()[0] });
    now += PRESTART_EVERY_MS;
    edit(); // request 2, the refresh, not yet at the spine
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([{ appSessionId: TAB, token: sentTokens()[0] }, { appSessionId: TAB, token: sentTokens()[1] }]);
  });

  it('scalpel-3 6. once the refresh is answered, only its token is withdrawn', async () => {
    edit();
    await fake.reply('session.intent.prestart', { status: 'started', token: sentTokens()[0] });
    now += PRESTART_EVERY_MS;
    edit();
    await fake.reply('session.intent.prestart', { status: 'running', token: sentTokens()[1] });
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([{ appSessionId: TAB, token: sentTokens()[1] }]);
  });
});
