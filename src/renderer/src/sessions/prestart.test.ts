// Ticket 851, M3 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D8, D10): the composer's prestart trigger. The
// leading edge of the first edit that leaves the document non-empty asks at once; after that at most once every 10 s
// while it stays non-empty. A tab that moves to another machine withdraws by the token it was given, whichever way the
// answer and the move cross; an older spine's refusal reads as skipped, with nothing shown.
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
    expect(fake.invoked('session.intent.prestart')).toEqual([{ appSessionId: TAB }]);
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
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([]);
  });
});

describe('a spawn target on another machine, both orders', () => {
  it('the answer first: picking another machine withdraws by its token, and the next edit back here asks at once', async () => {
    edit();
    await fake.reply('session.intent.prestart', { status: 'started', token: 't1' });
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([{ appSessionId: TAB, token: 't1' }]);
    now += 1_000;
    edit(); // back on this machine
    expect(fake.invoked('session.intent.prestart')).toHaveLength(2);
  });

  it('the move first: an answer that arrives after it is withdrawn by its token at once', async () => {
    edit();
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([]);
    await fake.reply('session.intent.prestart', { status: 'running', token: 't2' });
    await settle();
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([{ appSessionId: TAB, token: 't2' }]);
  });

  it('a skipped answer leaves nothing to withdraw', async () => {
    edit();
    await fake.reply('session.intent.prestart', { status: 'skipped', token: null, reason: 'needs_trust' });
    leftThisMachine(TAB, fake.client);
    expect(fake.invoked('session.intent.prestart.withdraw')).toEqual([]);
  });
});
