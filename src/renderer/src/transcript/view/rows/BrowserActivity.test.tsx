// E13 (the in-app browser spec of 2026-10-08, "Action rows"; acceptance 10): what an agent did in the in-app browser
// through cua_repl, on screen. Each activity is a persistent row of its own kind: directly under its `js` call's cell
// while the call runs, live as main reports it, and still in view at the call's place once the turn folds (M3 fix
// wave); one with no call to stand under is a row at its time. A transcript that mounts lists what main kept, so a
// reload or a re-mount shows the rows again. Page text is plain.
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserActivity } from '@shared/browser/activity';
import type { SessionEvent } from '@shared/graph/events';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { useTranscriptStore } from '../../../stores/transcript';
import { installFakeMain, ok } from '../../../test-support/code';
import { browserActivityOf, connectBrowserActivity, resetBrowserActivity } from '../../../tools/browser/agent/activity';
import { browserActivityRow } from '../../model/browser-activity';
import { builder } from '../../model/test-events';
import type { TranscriptSource } from '../../source/types';
import { Transcript } from '../Transcript';
import { renderRow } from './test-support';

const TAB = 'b_000000000001';
const JS = 'mcp__plugin_cua_cua_repl__js';

let fake: FakeClient;
let disconnect: () => void;
const send = (appSessionId: string, at: string, activity: BrowserActivity) =>
  act(() => fake.event('browser.agent.activity', { appSessionId, tabId: TAB, at, activity }));
const later = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const lines = (root: ParentNode) => [...root.querySelectorAll('[data-browser-activity]')].map((line) => line.textContent);
// The list's rows in order: a cell by its id, an activity row by its line, any other row by its kind.
const shape = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-kind]')].map((row) => {
    const kind = row.getAttribute('data-kind');
    if (kind === 'cell') return row.querySelector('[data-cell-id]')?.getAttribute('data-cell-id') ?? 'cell';
    if (kind === 'browser_activity') return `act:${lines(row)[0]}`;
    return kind ?? '';
  });
const activityRows = (root: HTMLElement) => shape(root).filter((row) => row.startsWith('act:'));

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
  delete (window as { maws?: unknown }).maws;
});

// An open turn: a Read, then a cua_repl js call still running.
function runningTurn() {
  const b = builder('2026-10-08T10:00:00.000Z');
  b.turn('u1');
  b.toolUse('r1', 'Read', { file_path: '/tmp/a' });
  b.result('r1', 'a');
  b.toolUse('j1', JS, { code: "const t = await cua.createBrowserTab(b.browserId, 'http://127.0.0.1:17391/')" });
  return { b, started: b.events.at(-1)!.at };
}

// A session transcript over a source the test pushes later batches to.
async function mount(key: string, events: SessionEvent[]) {
  let push: (batch: SessionEvent[]) => void = () => {};
  const source: TranscriptSource = {
    key,
    subscribe(listener) {
      push = listener;
      return () => (push = () => {});
    },
    snapshot: () => Promise.resolve([...events]),
  };
  const view = render(<Transcript source={source} variant="session" />);
  await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
  return { view, push: (batch: SessionEvent[]) => act(() => push(batch)) };
}

const ACTIONS: BrowserActivity[] = [
  { kind: 'navigated', url: 'http://127.0.0.1:17391/features.html', title: '' },
  { kind: 'clicked', x: 10, y: 20, label: 'button Submit' },
  { kind: 'typed', chars: 1 },
  { kind: 'screenshot' },
  { kind: 'download', filename: 'cua-report.pdf', state: 'complete' },
];
const ACTION_ROWS = ['act:Navigated to 127.0.0.1:17391', 'act:Clicked button Submit', 'act:Typed 1 character', 'act:Screenshot', 'act:Downloaded cua-report.pdf'];

describe('the rows of a js call', () => {
  it('sit directly under the running call, live, and stay in view at its place when the turn folds', async () => {
    const { b, started } = runningTurn();
    const { view, push } = await mount('App-attached', b.events);
    send('App-attached', later(started, 10), ACTIONS[0]);
    send('App-attached', later(started, 20), ACTIONS[1]);
    send('App-other', later(started, 25), { kind: 'screenshot' }); // another session's: not here
    await waitFor(() => expect(activityRows(view.container)).toEqual(ACTION_ROWS.slice(0, 2)));
    ACTIONS.slice(2).forEach((activity, i) => send('App-attached', later(started, 30 + i * 10), activity));
    await waitFor(() => expect(activityRows(view.container)).toEqual(ACTION_ROWS));
    const open = shape(view.container);
    const cell = open.indexOf('cell:j1');
    expect(cell).toBeGreaterThan(-1);
    expect(open.slice(cell + 1, cell + 1 + ACTION_ROWS.length)).toEqual(ACTION_ROWS);

    // the call returns, the agent answers, the turn ends and folds under the following reader
    const from = b.events.length;
    b.result('j1', 'ok');
    b.text('m1', 0, 'Done.');
    b.end(['u1']);
    push(b.events.slice(from));
    await waitFor(() => expect(shape(view.container)).not.toContain('cell:j1'));
    const folded = shape(view.container);
    expect(activityRows(view.container)).toEqual(ACTION_ROWS);
    expect(folded.indexOf('divider')).toBeLessThan(folded.indexOf(ACTION_ROWS[0]));
    expect(folded.indexOf(ACTION_ROWS.at(-1)!)).toBeLessThan(folded.indexOf('assistant_text')); // the call's place, before the answer
    expect(view.container.querySelector('[data-kind="divider"]')!.textContent).toContain('2 tool calls'); // the folded js call still counts
  });

  it('come back from main’s list when the transcript mounts again, as after a reload', async () => {
    const { b, started } = runningTurn();
    const kept = ACTIONS.map((activity, i) => ({ appSessionId: 'App-listed', tabId: TAB, at: later(started, 10 + i * 10), activity }));
    const main = installFakeMain((name) => (name === 'browser.agent.activities.list' ? ok({ activities: kept }) : ok()));
    const first = await mount('App-listed', b.events);
    await waitFor(() => expect(activityRows(first.view.container)).toEqual(ACTION_ROWS));
    expect(main.callsOf('browser.agent.activities.list')).toEqual([{ appSessionId: 'App-listed' }]);
    // a reload: the window's stores are empty and the transcript mounts afresh
    cleanup();
    resetBrowserActivity();
    useTranscriptStore.getState().drop('App-listed');
    expect(browserActivityOf('App-listed' as AppSessionId)).toEqual([]);
    const second = await mount('App-listed', b.events);
    await waitFor(() => expect(activityRows(second.view.container)).toEqual(ACTION_ROWS));
    expect(main.callsOf('browser.agent.activities.list')).toHaveLength(2);
  });

  it('render page text as plain text', () => {
    const row = browserActivityRow({ seq: 1, appSessionId: 'App-A' as AppSessionId, tabId: TAB, at: '2026-10-08T10:00:00.000Z', activity: { kind: 'clicked', x: 1, y: 2, label: 'a <img src=x onerror=1>' } });
    const view = renderRow(row, { storeKey: 'App-A' });
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
    const { view } = await mount('App-standalone', b.events);
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
