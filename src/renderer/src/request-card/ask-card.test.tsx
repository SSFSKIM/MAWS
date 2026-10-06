// E1 M4b (the architect's ruling 1): a blocking `maws` ask is a `question` attention item whose originating event is
// `maws.ask.opened`. The request card renders it compact in every placement (the ask's title, else "Questions from the
// agent"; the count; one button that opens the Question sheet through the registered `openAsk` with the event's data)
// and never answers it: the sheet does.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { resetShellStores } from '../test-support/shell-stores';
import { registerTranscriptActions, type TranscriptActions } from '../transcript';
import { RequestCard, type Placement } from './RequestCard';
import { askItemFor, askOpened } from './test-requests';

const APP = 'app-test';
let fake: FakeClient;
let openAsk: Mock<TranscriptActions['openAsk']>;
let unregister: () => void;

beforeEach(() => {
  resetShellStores();
  fake = fakeClient();
  window.maws = fake.client;
  openAsk = vi.fn<TranscriptActions['openAsk']>();
  unregister = registerTranscriptActions({ openAsk });
});
afterEach(() => {
  unregister();
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

function mount(placement: Placement, event = askOpened()) {
  const item = askItemFor(event, APP);
  render(
    <article tabIndex={0}>
      <RequestCard item={item} request={event} placement={placement} paneIndex={0} />
    </article>,
  );
  return item;
}

describe('the request card for a blocking ask', () => {
  it.each<Placement>(['docked', 'card', 'hover'])('reads the title and the count, and opens the Question sheet (%s)', async (placement) => {
    mount(placement);
    expect(screen.getByRole('heading', { name: 'Release setup' })).toBeTruthy();
    expect(screen.getByText('2 questions')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open the Question sheet' }));
    expect(openAsk).toHaveBeenCalledWith(APP, {
      askId: 'toolu_ask', toolUseId: 'toolu_ask', title: 'Release setup', context: null, blocking: true, questions: askOpened().questions, state: 'pending', answers: null, error: null,
    });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Open the Question sheet']); // no Open session, nothing that answers
    expect(fake.invoked('session.answer')).toEqual([]);
  });

  it('names an untitled ask "Questions from the agent" and counts one question in the singular', () => {
    mount('card', askOpened({ title: null, questions: [askOpened().questions[0]!] }));
    expect(screen.getByRole('heading', { name: 'Questions from the agent' })).toBeTruthy();
    expect(screen.getByText('1 question')).toBeTruthy();
  });
});
