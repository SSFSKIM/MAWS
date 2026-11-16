// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M3; the adversarial review's third finding; Acceptance
// 9): Regenerate asks the engine for a title from the conversation's first prompt with words, read from the host's
// events. MAWS's answer envelope is no prompt of the person's: a message that is an answer alone reads as nothing
// outside the transcript (ruling A) and the walk goes on; an older host's whole joined message gives the person's part.
// Asserted on the description `session.generateTitle` is sent. The events are build G's frozen ones for the probes'
// recordings (`<name>.base-events.json`, the journal through build G's normaliser), the session's first prompt left out
// so the message after a first prompt with no words is the one read.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { FIXTURE_DIR } from '../../../../test/support/fixtures';
import { at } from '../../../../test/support/machine';
import { recordedJoin } from '../../../../test/support/recorded-joins';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { closeDialog, openDialog } from './dialogs';
import { SessionDialogs } from './SessionDialogs';

type UserMessage = Extract<SessionEvent, { kind: 'user.message' }>;
const BARE = 'a5555555-5555-4555-8555-555555555555' as AppSessionId;
const LIVE = at(BARE) as AppSessionId;

const frozenEvents = (name: string): SessionEvent[] => JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.base-events.json`), 'utf8')) as SessionEvent[];
const userMessages = (events: SessionEvent[]) => events.filter((event): event is UserMessage => event.kind === 'user.message');
// build G's event for the recording's joined replay, the joined text whole
const joinedEvent = (name: string): UserMessage => userMessages(frozenEvents(name)).find((event) => event.joined !== undefined)!;
// the session's first prompt as build G made it, as the template of a message made here
const firstPrompt = (name: string): UserMessage => userMessages(frozenEvents(name))[0]!;
const IMAGE = (joinedEvent('u704-end-image-1').content as ContentBlock[]).find((block) => block.type === 'image')!;
const withContent = (event: UserMessage, id: string, content: string | ContentBlock[]): UserMessage => ({ ...event, id: id as UserMessage['id'], content });

let fake: FakeClient;

async function regenerateWith(events: SessionEvent[]): Promise<string> {
  fake = fakeClient({ 'session.events': { events, lastSeq: events.length, complete: true }, 'session.generateTitle': { opId: 'op-1' } });
  window.maws = fake.client as unknown as PreloadBridge;
  render(<SessionDialogs />);
  act(() => openDialog({ kind: 'rename', appSessionId: LIVE }));
  const dialog = await screen.findByRole('dialog', { name: 'Rename' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
  await waitFor(() => expect(fake.invoked('session.generateTitle')).toHaveLength(1));
  return (fake.invoked('session.generateTitle')[0] as { description: string }).description;
}

beforeEach(() => {
  resetShellStores();
  useSessions.setState({ records: new Map([[LIVE, record(LIVE, { title: { text: 'Kept title', source: 'generated' }, holder: { kind: 'self' } })]]), engine: new Map([[LIVE, status(LIVE)]]) });
});
afterEach(() => {
  act(() => closeDialog());
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('Regenerate’s description and an answer envelope (ticket 704)', () => {
  it('a first message with no words, then an answer sent alone (u704-end-env-first-1’s envelope), then words: the words', async () => {
    const template = firstPrompt('u704-end-env-first-1');
    const envelope = recordedJoin('u704-end-env-first-1').envelopes[0]!;
    const events = [withContent(template, 'm1', [IMAGE]), withContent(template, 'm2', envelope), withContent(template, 'm3', 'Then this one')];
    expect(await regenerateWith(events)).toBe('Then this one');
  });

  it('an answer sent alone and nothing after it: the current title', async () => {
    const template = firstPrompt('u704-end-env-first-1');
    const envelope = recordedJoin('u704-end-env-first-1').envelopes[0]!;
    expect(await regenerateWith([withContent(template, 'm1', [IMAGE]), withContent(template, 'm2', envelope)])).toBe('Kept title');
  });

  it.each(['u704-end-prompt-first-1', 'u704-end-env-first-1', 'u704-end-image-1'])('%s: an older host’s whole joined message after a first message with no words gives the prompt alone', async (name) => {
    const template = firstPrompt(name);
    const { prompt } = recordedJoin(name);
    const words = typeof prompt === 'string' ? prompt : String(prompt!.find((block) => block.type === 'text')!.text);
    expect(await regenerateWith([withContent(template, 'm1', [IMAGE]), joinedEvent(name)])).toBe(words);
  });
});
