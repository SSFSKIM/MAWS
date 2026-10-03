import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { connectEngineSurface } from '../../engine-surface/site';
import { invalidateSession, resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { expandedTurnRows } from '../model/derive';
import { builder } from '../model/test-events';
import { Disclosures, TranscriptProvider, NO_ACTIONS } from '../view/context';
import { RowView } from '../view/rows/Row';
import { storeWith } from '../view/rows/test-support';

afterEach(() => { cleanup(); resetSurfaceRegistry(); });

function Transcript({ storeKey }: { storeKey: string }) {
  const rows = useTranscriptStore((s) => s.entries[storeKey].rows);
  return <TranscriptProvider value={{ storeKey, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'test', sessionDirectory: null, effort: null }}>{rows.map((row) => <RowView key={row.id} row={row} />)}</TranscriptProvider>;
}

it('keeps the first expanded commentary drawing mounted when ink promotes it to full contrast', async () => {
  const b = builder(); b.turn('u'); b.text('first', 0, 'Update');
  b.toolUse('t', 'Bash', { command: 'pwd' }); b.result('t', '/tmp');
  b.text('last', 0, 'Answer'); b.end(['u']);
  const store = await storeWith(b.events); const id = store.key as AppSessionId;
  useTranscriptStore.getState().expandAll(store.key);
  const fake = fakeClient(); window.maws = fake.client;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  render(<Transcript storeKey={store.key} />);
  expect(screen.getByText('Update').closest('.transcript-commentary')).not.toBeNull();
  const asks = fake.invoked('session.ui.render') as { component: string; props: { text?: string } }[];
  for (const ask of asks) await act(() => fake.reply('session.ui.render', {
    hooked: ask.component === 'AssistantMessage', rewritten: false, props: ask.props,
    tree: ask.props.text === 'Update' ? { type: 'Box', children: [{ type: 'Text', children: ['accepted drawing'] }, { type: 'engine', ref: 0 }] } : { type: 'engine', ref: 0 },
  }));
  expect(fake.invoked('session.ui.render')).toHaveLength(asks.length);
  expect(screen.getByText('accepted drawing')).toBeTruthy();
  expect(screen.getByText('Update').closest('.transcript-commentary')).toBeNull();
  expect(store.rows().find((r) => r.kind === 'assistant_text' && r.markdown === 'Update')).toMatchObject({ forHuman: true });
});

it.each([false, true])('probes folded assistant text, preserves ink in order at full contrast, and restores T2 on inkless/unhooked (%s) or detach', async (hooked) => {
  const b = builder(); b.turn('u'); b.text('first', 0, '<to-human>Update</to-human>');
  b.toolUse('t', 'Bash', { command: 'pwd' }); b.result('t', '/tmp');
  b.text('last', 0, 'Answer'); b.end(['u']);
  const store = await storeWith(b.events); const id = store.key as AppSessionId;
  const fake = fakeClient(); window.maws = fake.client;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  const off = connectEngineSurface(fake.client);
  render(<Transcript storeKey={store.key} />);
  const asks = fake.invoked('session.ui.render') as { component: string; props: { text?: string } }[];
  expect(asks.filter((a) => a.component === 'AssistantMessage').map((a) => a.props.text)).toEqual(['<to-human>Update</to-human>', 'Answer']);
  expect(asks.some((a) => a.component === 'ToolUse')).toBe(false);
  // User, folded commentary probe, answer: respond to all outstanding sites in their request order.
  for (const ask of asks) await act(() => fake.reply('session.ui.render', {
    hooked: ask.component === 'AssistantMessage', rewritten: false, props: ask.props,
    tree: ask.component === 'AssistantMessage' ? { type: 'Box', children: [{ type: 'Text', children: ['label'] }, { type: 'engine', ref: 0 }] } : { type: 'engine', ref: 0 },
  }));
  expect(store.rows().filter((r) => r.kind === 'assistant_text').map((r) => r.markdown)).toEqual(['<to-human>Update</to-human>', 'Answer']);
  expect(screen.getByText('<to-human>Update</to-human>').closest('.transcript-commentary')).toBeNull();
  expect((fake.invoked('session.ui.render') as { component: string }[]).filter((a) => a.component === 'AssistantMessage')).toHaveLength(2);
  act(() => invalidateSession(id));
  while (fake.pending('session.ui.render')) await act(() => fake.reply('session.ui.render', { hooked, rewritten: false, props: {}, tree: { type: 'Box' } }));
  expect(store.rows().filter((r) => r.kind === 'assistant_text')).toHaveLength(1);
  // Detach clears any session-scoped presentation, including rows outside the mounted range.
  const state = useTranscriptStore.getState().entries[store.key].state;
  const first = expandedTurnRows(state, state.order[0]).find((r) => r.kind === 'assistant_text')!;
  act(() => useTranscriptStore.getState().setAssistantInk(store.key, first.id, first.turnId!, true));
  act(() => fake.event('session.status', { appSessionId: id, status: { ...status(id), process: 'exited' } }));
  expect(useTranscriptStore.getState().entries[store.key].state.ui.assistantInk.size).toBe(0);
  off();
});
