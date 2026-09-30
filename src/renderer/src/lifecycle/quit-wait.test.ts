// C12 M4: "Quit when idle" in the page (C12 execution document, Interfaces "The quit question"): while main holds the
// quit, one banner says how many things it waits on, with Quit now and Cancel; it goes when main stops waiting.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { connectQuitWait, QUIT_WAIT_BANNER_ID, quitWaitText } from './quit-wait';

const banners = () => useNotices.getState().notices.filter((n) => n.id === QUIT_WAIT_BANNER_ID);
const report = (midTurn: number, backgroundWork: number, busyTerminals: number) => ({ waiting: { midTurn, backgroundWork, busyTerminals, terminalsUnknown: false } });

describe('the quit-when-idle banner', () => {
  let fake: FakeClient;
  let off: () => void;
  beforeEach(() => {
    useNotices.setState({ notices: [] });
    fake = fakeClient({ 'layout.quitWaitAnswer': undefined });
    off = connectQuitWait(fake.client);
  });
  afterEach(() => off());

  it('counts the things main waits on', () => {
    expect(quitWaitText({ midTurn: 1, backgroundWork: 1, busyTerminals: 1, terminalsUnknown: false })).toBe('MAWS will quit when 3 things finish');
    expect(quitWaitText({ midTurn: 0, backgroundWork: 0, busyTerminals: 1, terminalsUnknown: false })).toBe('MAWS will quit when 1 thing finishes');
  });

  it('subscribes before it reads the snapshot, shows the wait, follows it, and goes when main stops waiting', async () => {
    expect(fake.calls).toEqual(['on layout.quitWait', 'invoke layout.quitWait']);
    await fake.reply('layout.quitWait', report(1, 1, 1));
    expect(banners()).toMatchObject([{ level: 'info', text: 'MAWS will quit when 3 things finish', dismissible: false, actions: [{ label: 'Quit now' }, { label: 'Cancel' }] }]);
    fake.event('layout.quitWait', report(0, 1, 1));
    expect(banners().map((b) => b.text)).toEqual(['MAWS will quit when 2 things finish']);
    fake.event('layout.quitWait', { waiting: null });
    expect(banners()).toEqual([]);
  });

  it('an event wins over a snapshot still on its way', async () => {
    fake.event('layout.quitWait', report(0, 0, 1));
    await fake.reply('layout.quitWait', { waiting: null });
    expect(banners().map((b) => b.text)).toEqual(['MAWS will quit when 1 thing finishes']);
  });

  it('Quit now and Cancel answer main', async () => {
    await fake.reply('layout.quitWait', report(2, 0, 0));
    banners()[0]!.actions[0]!.run();
    banners()[0]!.actions[1]!.run();
    expect(fake.invoked('layout.quitWaitAnswer')).toEqual([{ action: 'quitNow' }, { action: 'cancel' }]);
  });
});
