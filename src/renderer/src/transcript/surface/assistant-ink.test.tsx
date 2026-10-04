import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { connectEngineSurface } from '../../engine-surface/site';
import { invalidateSession, resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { expandedTurnRows, turnDerivations } from '../model/derive';
import { api, builder } from '../model/test-events';
import { Disclosures, TranscriptProvider, NO_ACTIONS } from '../view/context';
import { RowView } from '../view/rows/Row';
import { storeWith } from '../view/rows/test-support';

afterEach(() => { cleanup(); resetSurfaceRegistry(); });

function Transcript({ storeKey, hideCommentary = false }: { storeKey: string; hideCommentary?: boolean }) {
  const rows = useTranscriptStore((s) => s.entries[storeKey].rows);
  return <TranscriptProvider value={{ storeKey, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'test', sessionDirectory: null, effort: null }}>{rows.filter((row) => !hideCommentary || row.kind !== 'assistant_text' || row.phase !== 'commentary').map((row) => <RowView key={row.id} row={row} />)}</TranscriptProvider>;
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

it.each([{ hooked: false, expanded: false }, { hooked: true, expanded: false }, { hooked: false, expanded: true }, { hooked: true, expanded: true }])('holds a promoted button until click with hooked=$hooked, expanded=$expanded', async ({ hooked, expanded }) => {
  const b = builder(); b.turn('u'); b.text('first', 0, 'Update');
  b.toolUse('t', 'Bash', { command: 'pwd' }); b.result('t', '/tmp');
  b.text('last', 0, 'Answer'); b.end(['u']);
  const store = await storeWith(b.events); const id = store.key as AppSessionId;
  if (expanded) useTranscriptStore.getState().expandAll(store.key);
  const fake = fakeClient({ 'session.ui.press': { handled: true } }); window.maws = fake.client;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  render(<Transcript storeKey={store.key} />);
  const asks = fake.invoked('session.ui.render') as { component: string; props: { text?: string } }[];
  for (const ask of asks) await act(() => fake.reply('session.ui.render', {
    hooked: ask.component === 'AssistantMessage', rewritten: false, props: ask.props,
    tree: ask.props.text === 'Update' ? { type: 'Box', children: [{ type: 'Button', props: { key: 'accept', label: 'Accept' }, press: { plugin: 'test-mod', handle: 7 } }, { type: 'engine', ref: 0 }] } : { type: 'engine', ref: 0 },
  }));
  const button = screen.getByRole('button', { name: 'Accept' });
  fireEvent.pointerDown(button, { button: 0, buttons: 1 });
  act(() => invalidateSession(id));
  while (fake.pending('session.ui.render')) await act(() => fake.reply('session.ui.render', { hooked, rewritten: false, props: {}, tree: { type: 'Box' } }));
  expect(screen.getByRole('button', { name: 'Accept' })).toBe(button);
  expect(screen.getByText('Update').closest('.transcript-commentary')).toBeNull();
  expect(store.rows().find((r) => r.kind === 'assistant_text' && r.markdown === 'Update')).toMatchObject({ forHuman: true });
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.click(button);
  expect(fake.invoked('session.ui.press')).toEqual([{ appSessionId: id, plugin: 'test-mod', handle: 7, key: 'accept' }]);
  await act(() => new Promise((resolve) => setTimeout(resolve, 1)));
  expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  expect(store.rows().filter((r) => r.kind === 'assistant_text')).toHaveLength(expanded ? 2 : 1);
  if (expanded) expect(screen.getByText('Update').closest('.transcript-commentary')).not.toBeNull();
  expect((fake.invoked('session.ui.render') as { component: string }[]).filter((a) => a.component === 'AssistantMessage')).toHaveLength(4);
});

it('hands presentation back to the folded probe when a pressed row virtualizes away, and releases every ask when the divider leaves', async () => {
  const b = builder(); b.turn('u'); b.text('first', 0, 'Update');
  b.toolUse('t', 'Bash', { command: 'pwd' }); b.result('t', '/tmp');
  b.text('last', 0, 'Answer'); b.end(['u']);
  const store = await storeWith(b.events); const id = store.key as AppSessionId;
  const fake = fakeClient(); window.maws = fake.client;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  const view = render(<Transcript storeKey={store.key} />);
  const asks = fake.invoked('session.ui.render') as { component: string; props: { text?: string } }[];
  for (const ask of asks) await act(() => fake.reply('session.ui.render', {
    hooked: ask.component === 'AssistantMessage', rewritten: false, props: ask.props,
    tree: ask.props.text === 'Update' ? { type: 'Button', props: { key: 'accept', label: 'Accept' }, press: { plugin: 'test-mod', handle: 7 } } : { type: 'engine', ref: 0 },
  }));
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Accept' }), { button: 0, buttons: 1 });
  act(() => invalidateSession(id));
  const pending = fake.pending('session.ui.render');
  for (let i = 0; i < pending; i++) await act(() => fake.reply('session.ui.render', { hooked: true, rewritten: false, props: {}, tree: { type: 'engine', ref: 0 } }));
  expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
  // The virtualizer can remove a promoted row independently of its still-mounted divider.
  view.rerender(<Transcript storeKey={store.key} hideCommentary />);
  expect(store.rows().filter((r) => r.kind === 'assistant_text')).toHaveLength(1);
  expect(useTranscriptStore.getState().entries[store.key].state.ui.assistantInk.size).toBe(0);
  const count = fake.invoked('session.ui.render').length;
  expect(count).toBe(asks.length * 2);
  view.unmount();
  act(() => invalidateSession(id));
  expect(fake.invoked('session.ui.render')).toHaveLength(count);
  expect(fake.pending('session.ui.render')).toBe(0);
  // A later divider mount can promote the row again; stale ownership must not suppress its probe.
  render(<Transcript storeKey={store.key} />);
  const remounted = fake.invoked('session.ui.render').slice(count) as typeof asks;
  expect(remounted).toHaveLength(asks.length);
  for (const ask of remounted) await act(() => fake.reply('session.ui.render', {
    hooked: ask.component === 'AssistantMessage', rewritten: false, props: ask.props,
    tree: ask.props.text === 'Update' ? { type: 'Text', children: ['returned drawing'] } : { type: 'engine', ref: 0 },
  }));
  expect(screen.getByText('returned drawing')).toBeTruthy();
  expect(fake.invoked('session.ui.render')).toHaveLength(count + asks.length);
});

it.each([false, true])('does not derive large folded history during live token batches (attached=%s)', async (attached) => {
  const b = builder();
  for (let turn = 0; turn < 6; turn++) {
    b.turn(`old-${turn}`);
    for (let n = 0; n < 100; n++) {
      b.text(`text-${turn}-${n}`, 0, `Commentary ${n}`);
      b.toolUse(`tool-${turn}-${n}`, 'Bash', { command: 'pwd' });
      b.result(`tool-${turn}-${n}`, '/tmp');
    }
    b.text(`answer-${turn}`, 0, 'Answer'); b.end([`old-${turn}`]);
  }
  b.turn('live');
  b.emit('assistant.block.delta', { apiMessageId: api('live'), blockIndex: 0, blockType: 'text', textDelta: 'start', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
  const store = await storeWith(b.events.slice()); const id = store.key as AppSessionId;
  const fake = fakeClient(); window.maws = fake.client;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: attached ? { clientId: 'maws-main' } : undefined }]]) });
  const view = render(<Transcript storeKey={store.key} />);
  const before = turnDerivations.count;
  const start = performance.now();
  for (let n = 0; n < 40; n++) {
    const event = b.emit('assistant.block.delta', { apiMessageId: api('live'), blockIndex: 0, blockType: 'text', textDelta: ' next', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    act(() => store.push([event]));
  }
  const derivations = turnDerivations.count - before;
  expect(screen.getByText('start' + ' next'.repeat(40))).toBeTruthy();
  console.info(`FX3 folded benchmark attached=${attached}: 6 turns x 100 tool calls, 40 batches, ${derivations} derivations, ${(performance.now() - start).toFixed(1)} ms`);
  view.unmount();
  expect(derivations).toBe(0);
});
