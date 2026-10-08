// E13 (the in-app browser spec of 2026-10-08, "Action rows"; acceptance 10): what an agent did in the in-app browser
// through cua_repl, on screen. Under the `js` call's row, one line per activity in the browser action row's words, live
// as main reports them; an activity with no call to stand under is a row of its own at its time; page text is plain.
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserActivity } from '@shared/browser/activity';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { useTranscriptStore } from '../../../stores/transcript';
import { connectBrowserActivity, resetBrowserActivity } from '../../../tools/browser/agent/activity';
import { browserActivityRow } from '../../model/browser-activity';
import { builder } from '../../model/test-events';
import type { Row } from '../../model/rows';
import type { TranscriptSource } from '../../source/types';
import { Transcript } from '../Transcript';
import { renderRow, storeWith } from './test-support';

const TAB = 'b_000000000001';
const JS = 'mcp__plugin_cua_cua_repl__js';

let fake: FakeClient;
let disconnect: () => void;
const send = (appSessionId: string, at: string, activity: BrowserActivity) =>
  act(() => fake.event('browser.agent.activity', { appSessionId, tabId: TAB, at, activity }));
const later = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const lines = (root: ParentNode) => [...root.querySelectorAll('[data-browser-activity]')].map((line) => line.textContent);

// happy-dom has no layout: give the scroller a viewport and every row a height so the virtualiser mounts rows.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-transcript-scroller')) return 4000;
      if (this.hasAttribute('data-index')) return 40;
      return 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));
beforeEach(() => {
  resetBrowserActivity();
  fake = fakeClient({});
  disconnect = connectBrowserActivity(fake.client);
});
afterEach(() => {
  cleanup();
  disconnect();
  resetBrowserActivity();
});

// One open turn: a Read, then a cua_repl js call still running.
function jsTurn() {
  const b = builder('2026-10-08T10:00:00.000Z');
  b.turn('u1');
  b.toolUse('r1', 'Read', { file_path: '/tmp/a' });
  b.result('r1', 'a');
  b.toolUse('j1', JS, { code: "const t = await cua.createBrowserTab(b.browserId, 'http://127.0.0.1:17391/')" });
  return { b, started: b.events.at(-1)!.at };
}

describe('the lines under a js call', () => {
  it('shows each activity of the call under its line, and a new one as it arrives', async () => {
    const { b, started } = jsTurn();
    const store = await storeWith(b.events);
    const cell = store.rows().find((row): row is Extract<Row, { kind: 'cell' }> => row.kind === 'cell' && row.toolUseId === 'j1')!;
    expect(cell).toBeTruthy();
    send(store.key, later(started, 10), { kind: 'navigated', url: 'http://127.0.0.1:17391/features.html', title: '' });
    send(store.key, later(started, 20), { kind: 'clicked', x: 10, y: 20, label: 'button Submit' });
    send('App-other', later(started, 25), { kind: 'screenshot' }); // another session's: not here
    const view = renderRow(cell, { storeKey: store.key });
    expect(lines(view.container)).toEqual(['Navigated to 127.0.0.1:17391', 'Clicked button Submit']);
    send(store.key, later(started, 30), { kind: 'typed', chars: 1 });
    send(store.key, later(started, 40), { kind: 'screenshot' });
    send(store.key, later(started, 50), { kind: 'download', filename: 'cua-report.pdf', state: 'complete' });
    expect(lines(view.container)).toEqual(['Navigated to 127.0.0.1:17391', 'Clicked button Submit', 'Typed 1 character', 'Screenshot', 'Downloaded cua-report.pdf']);
    // under the call's own line, in the browser glyph's language
    const list = view.container.querySelector('[data-browser-activity-lines]')!;
    expect(view.container.querySelector('[data-cell-id]')!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.querySelectorAll('svg')).toHaveLength(5);
  });

  it('shows nothing under a call of another tool, or a js call with no activity', async () => {
    const { b } = jsTurn();
    const store = await storeWith(b.events);
    for (const row of store.rows().filter((row) => row.kind === 'cell' || row.kind === 'group')) {
      const view = renderRow(row, { storeKey: store.key });
      expect(view.container.querySelector('[data-browser-activity-lines]')).toBeNull();
      cleanup();
    }
  });

  it('renders page text as plain text', async () => {
    const { b, started } = jsTurn();
    const store = await storeWith(b.events);
    const cell = store.rows().find((row) => row.kind === 'cell' && row.toolUseId === 'j1')!;
    send(store.key, later(started, 10), { kind: 'clicked', x: 1, y: 2, label: 'a <img src=x onerror=1>' });
    const view = renderRow(cell, { storeKey: store.key });
    expect(lines(view.container)).toEqual(['Clicked a <img src=x onerror=1>']);
    expect(view.container.querySelector('img')).toBeNull();
  });
});

describe('an activity with no js call', () => {
  it('is a row of its own: the browser glyph and its line', () => {
    const row = browserActivityRow({ seq: 1, appSessionId: 'App-A' as AppSessionId, tabId: TAB, at: '2026-10-08T10:00:00.000Z', activity: { kind: 'dialog', type: 'confirm', excerpt: 'Delete it?', answered: 'default' } });
    const view = renderRow(row, { storeKey: 'App-A' });
    const section = view.container.querySelector('[data-kind="browser_activity"] section')!;
    expect(lines(section)).toEqual(['Confirm "Delete it?" answered by default after 30 s']);
    expect(section.querySelectorAll('svg')).toHaveLength(1);
  });

  it('stands in the session’s transcript at its time, after the turn it followed', async () => {
    const b = builder('2026-10-08T10:00:00.000Z');
    b.turn('u1');
    b.toolUse('j1', JS, { code: '1' });
    b.result('j1', 'ok');
    b.text('m1', 0, 'Done.');
    b.end(['u1']);
    b.tick(60_000);
    b.turn('u2', 'next prompt');
    b.text('m2', 0, 'Second answer.');
    b.end(['u2']);
    const turnEnded = b.events.find((event) => event.kind === 'turn.ended')!.at;
    const source: TranscriptSource = { key: 'App-standalone', subscribe: () => () => {}, snapshot: () => Promise.resolve(b.events) };
    const view = render(<Transcript source={source} variant="session" />);
    await waitFor(() => expect(useTranscriptStore.getState().entries['App-standalone']?.phase).toBe('live'));
    send('App-standalone', later(turnEnded, 5_000), { kind: 'download', filename: 'cua-report.pdf', state: 'complete' });
    const kinds = () => [...view.container.querySelectorAll('[data-kind]')].map((row) => row.getAttribute('data-kind'));
    await waitFor(() => expect(kinds()).toContain('browser_activity'));
    const order = kinds();
    const standalone = order.indexOf('browser_activity');
    expect(order.slice(0, standalone)).toContain('assistant_text'); // after the first turn's answer
    expect(order.slice(standalone + 1)).toContain('user'); // before the second prompt
    expect(lines(view.container.querySelector('[data-kind="browser_activity"]')!)).toEqual(['Downloaded cua-report.pdf']);
  });
});
