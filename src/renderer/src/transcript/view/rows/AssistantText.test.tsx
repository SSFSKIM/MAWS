import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { status } from '../../../../../../test/support/builders';
import { resetSurfaceRegistry } from '../../../engine-surface/registry';
import { useSessions } from '../../../stores/sessions';
import { useTranscriptStore } from '../../../stores/transcript';
import { builder } from '../../model/test-events';
import { Disclosures, NO_ACTIONS, TranscriptProvider } from '../context';
import { RowView } from './Row';
import { storeWith } from './test-support';

afterEach(() => { cleanup(); resetSurfaceRegistry(); });

it('keeps extension presentation when it rewrites the native text to empty', async () => {
  const b = builder(); b.turn('u'); b.text('answer', 0, 'Visible answer.'); b.end(['u']);
  const store = await storeWith(b.events);
  const id = store.key as AppSessionId;
  const fake = fakeClient(); window.maws = fake.client;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  function View() {
    const rows = useTranscriptStore((s) => s.entries[store.key].rows);
    return <TranscriptProvider value={{ storeKey: store.key, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'd1' }}>
      {rows.map((row) => <RowView key={row.id} row={row} />)}
    </TranscriptProvider>;
  }
  const view = render(<View />);
  const asks = fake.invoked('session.ui.render') as { component: string; props: { text?: string } }[];
  expect(asks.filter((ask) => ask.component === 'AssistantMessage').map((ask) => ask.props.text)).toEqual(['Visible answer.']);
  for (const ask of asks) await act(() => fake.reply('session.ui.render', {
    hooked: ask.component === 'AssistantMessage', rewritten: ask.component === 'AssistantMessage', props: ask.component === 'AssistantMessage' ? { ...ask.props, text: '' } : ask.props,
    tree: ask.component === 'AssistantMessage' ? { type: 'Box', children: [{ type: 'Text', children: ['Extension supplied presentation'] }, { type: 'engine', ref: 0 }] } : { type: 'engine', ref: 0 },
  }));
  expect([...view.container.querySelectorAll('[data-kind="assistant_text"]')].map((frame) => frame.textContent)).toEqual(['Extension supplied presentation']);
  expect(view.container.querySelectorAll('.transcript-commentary, .transcript-answer')).toHaveLength(0);
});
