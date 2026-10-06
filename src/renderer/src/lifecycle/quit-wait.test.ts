// C12 M4: "Quit when idle" in the page (C12 execution document, Interfaces "The quit question"): while main holds the
// quit, one banner says how many things it waits on, with Quit now and Cancel; it goes when main stops waiting.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { connectQuitWait, QUIT_WAIT_BANNER_ID, quitWaitText } from './quit-wait';

const banners = () => useNotices.getState().notices.filter((n) => n.id === QUIT_WAIT_BANNER_ID);
const report = (midTurn: number, backgroundWork: number, busyTerminals: number, unsavedFiles: string[] = [] /* E5 */) => ({ waiting: { midTurn, backgroundWork, busyTerminals, terminalsUnknown: false, unsavedFiles } });

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
    expect(quitWaitText({ midTurn: 1, backgroundWork: 1, busyTerminals: 1, terminalsUnknown: false, unsavedFiles: [] })).toBe('MAWS will quit when 3 things finish');
    expect(quitWaitText({ midTurn: 0, backgroundWork: 0, busyTerminals: 1, terminalsUnknown: false, unsavedFiles: [] })).toBe('MAWS will quit when 1 thing finishes');
  });

  // E5 (M5): a file dirtied during the wait holds it too, until it is saved
  it('names the unsaved files it also waits on', () => {
    const r = report(1, 0, 1, ['/r/a.ts']).waiting;
    expect(quitWaitText(r)).toBe('MAWS will quit when 2 things finish and 1 unsaved file is saved');
    expect(quitWaitText({ ...r, midTurn: 0, busyTerminals: 0, unsavedFiles: ['/r/a.ts', '/r/b.ts'] })).toBe('MAWS will quit when 2 unsaved files are saved');
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
