// @vitest-environment happy-dom
// A jump in the to-human view (UX wave U2b; the execution document, M1's "The jump"): it opens the stretch the list
// draws its target in, over the rows the view composes, not only the store's. A standalone browser activity stays in
// sight and so splits the work around it into two stretches; a jump to the work after it opens the second, and only it.
// Every text and address is invented.
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { useTranscriptStore } from '../../stores/transcript';
import { installFakeMain, ok } from '../../test-support/code';
import { connectBrowserActivity, resetBrowserActivity } from '../../tools/browser/agent/activity';
import { rowId } from '../../transcript/model/keys';
import { api, BASH_RESULT, builder } from '../../transcript/model/test-events';
import type { TranscriptSource } from '../../transcript/source/types';
import { Transcript } from '../../transcript/view/Transcript';

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

let fake: FakeClient;
let disconnect: () => void;
beforeEach(() => {
  resetBrowserActivity();
  installFakeMain(() => ok({ activities: [] }));
  fake = fakeClient({});
  disconnect = connectBrowserActivity(fake.client);
});
afterEach(() => {
  cleanup();
  disconnect();
  resetBrowserActivity();
  delete (window as { maws?: unknown }).maws;
});

const KEY = at('App-jump' as AppSessionId);
const BEFORE = 'Listed the notes first.';
const AFTER = 'Checked the rest of them.';
const records = () => screen.queryAllByRole('button', { name: '› working record' });

it('a jump to work after a standalone browser activity opens the stretch the list draws it in, and only that one', async () => {
  const b = builder('2026-10-08T10:00:00.000Z');
  b.turn('u1', 'Tidy the notes');
  b.text('m1', 0, BEFORE);
  b.toolUse('t1', 'Bash', { command: 'ls notes' });
  b.result('t1', 'notes.md', { structured: BASH_RESULT('notes.md') });
  const between = new Date(Date.parse(b.events.at(-1)!.at) + 500).toISOString();
  b.tick(1_000);
  b.toolUse('t2', 'Bash', { command: 'ls rest' });
  b.result('t2', 'rest.md', { structured: BASH_RESULT('rest.md') });
  b.text('m2', 0, AFTER);
  b.text('m3', 0, '<to-human>The notes are tidy.</to-human>');
  b.end(['u1']);
  const source: TranscriptSource = { key: KEY, subscribe: () => () => {}, snapshot: () => Promise.resolve(b.events) };
  render(<Transcript source={source} variant="session" ownerLane />);
  await waitFor(() => expect(useTranscriptStore.getState().entries[KEY]?.phase).toBe('live'));
  act(() => fake.event('browser.agent.activity', { appSessionId: KEY, tabId: 'b_000000000001', at: between, activity: { kind: 'navigated', url: 'http://127.0.0.1:17391/notes.html', title: '' } }));
  await waitFor(() => expect(document.querySelector('[data-kind="browser_activity"]')).not.toBeNull());
  expect(records()).toHaveLength(2); // the activity stays in sight between the two halves of the work
  act(() => useTranscriptStore.getState().jumpTo(KEY, rowId.text(api('m2'), 0)));
  await waitFor(() => expect(screen.queryByText(AFTER)).not.toBeNull());
  expect(screen.queryByText(BEFORE)).toBeNull(); // the first half stays closed
  expect(records()).toHaveLength(1);
});
