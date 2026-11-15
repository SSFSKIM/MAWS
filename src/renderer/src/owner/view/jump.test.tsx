// @vitest-environment happy-dom
// A jump in the to-human view (UX wave U2b; the execution document, M1's "The jump"): it opens the stretch the list
// draws its target in, over the rows the view composes, not only the store's. A standalone browser activity stays in
// sight and so splits the work around it into two stretches; a jump to the work after it opens the second, and only it.
// The carry of an opening across an update (`carriedKeys`) reads the same composition: the second stretch's opening
// passes to what stands in its place there, not to the first stretch it would share in the store's own rows.
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
import type { SessionEvent } from '@shared/graph/events';
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
const folds = () => screen.queryAllByRole('button', { name: '‹ fold to report' });

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

it('an opened thought with no text that its call replaces stays open as the call, beside a closed stretch a standalone browser activity splits off', async () => {
  const b = builder('2026-10-08T10:00:00.000Z');
  b.turn('u0', 'Look at the notes');
  b.text('m0', 0, '<to-human>Ready to tidy them.</to-human>');
  b.end(['u0']);
  b.turn('u1', 'Tidy the notes');
  b.text('m1', 0, BEFORE);
  const between = new Date(Date.parse(b.events.at(-1)!.at) + 500).toISOString();
  b.tick(1_000);
  b.emit('assistant.block.delta', { apiMessageId: api('m2'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: '', inputJsonDelta: null, userMessageUuid: null });
  let listener: ((events: SessionEvent[]) => void) | null = null;
  const snapshot = b.events.slice();
  const source: TranscriptSource = { key: KEY, subscribe: (l) => ((listener = l), () => (listener = null)), snapshot: () => Promise.resolve(snapshot) };
  render(<Transcript source={source} variant="session" ownerLane />);
  await waitFor(() => expect(useTranscriptStore.getState().entries[KEY]?.phase).toBe('live'));
  act(() => fake.event('browser.agent.activity', { appSessionId: KEY, tabId: 'b_000000000001', at: between, activity: { kind: 'navigated', url: 'http://127.0.0.1:17391/notes.html', title: '' } }));
  await waitFor(() => expect(document.querySelector('[data-kind="browser_activity"]')).not.toBeNull());
  expect(records()).toHaveLength(2); // the words before the activity, and the thought after it
  act(() => records()[1].click()); // the reader opens the thought's record
  expect(folds()).toHaveLength(1);
  expect(screen.queryByText(BEFORE)).toBeNull();
  const at = b.events.length;
  b.thinking('m2', 0, ''); // finished with no text: the thought has no row any more
  b.tick(1_000);
  b.toolUse('t1', 'Bash', { command: 'ls notes' }, 'm2', 1);
  act(() => listener?.(b.events.slice(at)));
  await waitFor(() => expect(document.querySelector('[data-kind="thinking"]')).toBeNull());
  expect(screen.queryByText(BEFORE)).toBeNull(); // the words before the activity stay folded
  expect(records()).toHaveLength(1);
  expect(folds()).toHaveLength(1); // the call, in the thought's place, is open
});
