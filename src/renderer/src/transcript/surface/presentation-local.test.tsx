// P2-E1 (M2): a transcript mounted with `presentation: 'local'` (the comment card's) draws the owner channel's marks
// through MAWS's own presenter even while the engine's surface is attached, asks the surface nothing for assistant text,
// and records its ink as local; without the option the same session draws through the surface as before (P2-E1
// document, D6). The presenter's resume line is left out there, since the card's Reply sits under it.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { builder } from '../model/test-events';
import { Disclosures, NO_ACTIONS, TranscriptProvider } from '../view/context';
import { RowView } from '../view/rows/Row';
import type { TranscriptSource } from '../source/types';

afterEach(() => {
  cleanup();
  resetSurfaceRegistry();
});

// P5 O6 M2: a session's store key is its id, an address on the page (rows/test-support's `storeWith` keys bare ids, which
// the client refuses to send), so these sessions' stores are keyed by addresses.
let keys = 0;
async function sessionStoreWith(events: SessionEvent[]) {
  const key = at(`local-${++keys}`);
  const source: TranscriptSource = { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
  await useTranscriptStore.getState().attach(key, source);
  return { key, rows: () => useTranscriptStore.getState().rows(key) };
}

function Transcript({ storeKey, presentation }: { storeKey: string; presentation?: 'local' }) {
  const rows = useTranscriptStore((s) => s.entries[storeKey].rows);
  return (
    <TranscriptProvider value={{ storeKey, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'test', sessionDirectory: null, effort: null, presentation }}>
      {rows.map((row) => (
        <RowView key={row.id} row={row} />
      ))}
    </TranscriptProvider>
  );
}

async function attachedSession(text: string) {
  const b = builder();
  b.turn('u');
  b.text('only', 0, text);
  b.end(['u']);
  const store = await sessionStoreWith(b.events);
  const id = store.key as AppSessionId;
  const fake = fakeClient();
  window.maws = fake.client as unknown as PreloadBridge;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  return { store, fake };
}

const assistantAsks = (fake: ReturnType<typeof fakeClient>) => (fake.invoked('session.ui.render') as { component: string }[]).filter((a) => a.component === 'AssistantMessage');

it('forced local: an attached session’s marked answer draws MAWS’s presenter, asking the surface nothing for it', async () => {
  const { store, fake } = await attachedSession('<to-human>Heading enlarged.</to-human>');
  const view = render(<Transcript storeKey={store.key} presentation="local" />);
  expect(view.container.querySelectorAll('.owner-message-ink')).toHaveLength(1);
  expect(view.container.querySelector('[data-owner-report]')).toBeNull();
  expect(screen.getByText('Heading enlarged.')).toBeTruthy();
  expect(view.container.textContent).not.toContain('<to-human>');
  expect(assistantAsks(fake)).toHaveLength(0);
});

it('without the option, the same attached session draws its assistant text through the surface, as today', async () => {
  const { store, fake } = await attachedSession('<to-human>Heading enlarged.</to-human>');
  const view = render(<Transcript storeKey={store.key} />);
  expect(view.container.querySelector('[data-owner-report]')).toBeNull();
  expect(assistantAsks(fake)).toHaveLength(1);
});

it('forced local: a need-input question has no “Resume this session to answer.” line (the card’s Reply is under it)', async () => {
  const { store } = await attachedSession('<need-input>Which size?\n<choice recommended>Larger</choice>\n<choice>Same</choice></need-input>');
  render(<Transcript storeKey={store.key} presentation="local" />);
  expect(screen.getByText(/Which size\?/)).toBeTruthy();
  expect(screen.queryByText('Resume this session to answer.')).toBeNull();
});

it('forced local: a block with a mark reports local ink, which a surface clear keeps; a block without reports none', async () => {
  const b = builder();
  b.turn('u');
  b.text('marked', 0, '<to-human>For you.</to-human>');
  b.end(['u']);
  b.turn('v');
  b.text('plain', 0, 'Just text.');
  b.end(['v']);
  const store = await sessionStoreWith(b.events);
  const id = store.key as AppSessionId;
  window.maws = fakeClient().client as unknown as PreloadBridge;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  render(<Transcript storeKey={store.key} presentation="local" />);
  const texts = store.rows().filter((r) => r.kind === 'assistant_text');
  const marked = texts.find((r) => r.markdown.includes('For you.'))!;
  const plain = texts.find((r) => r.markdown === 'Just text.')!;
  const entry = () => useTranscriptStore.getState().entries[store.key];
  expect(entry().state.ui.assistantInk.has(marked.id)).toBe(true);
  expect(entry().localAssistantInk?.has(marked.id)).toBe(true);
  expect(entry().state.ui.assistantInk.has(plain.id)).toBe(false);
  // after the card closes, a surface view of the same thread still treats the marked block as ink (accepted, D6)
  act(() => useTranscriptStore.getState().clearAssistantInk(store.key, 'surface'));
  expect(entry().state.ui.assistantInk.has(marked.id)).toBe(true);
});
