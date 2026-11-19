// UX wave U2b (panel finding 6): a carrier of two notices the engine draws through no UserMessage site (task ends with
// no <summary>) is asked by its first notice as that notice's own line, under its anchored id (`<anchor>~<row>`); the
// carrier's other notice follows the drawing applied under that same id, so a mod that replaces the first hides the
// second too. Every word is invented.
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArrivalEntry } from '@shared/engine/arrival-schema';
import type { CommandInput } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { turnRows } from '../model/derive';
import type { Row } from '../model/rows';
import { builder, uuid } from '../model/test-events';
import { renderRow, storeWith } from '../view/rows/test-support';
import { arrivalInput, noticeFollows } from './adapters';

const holder = vi.hoisted(() => ({ client: null as ReturnType<typeof fakeClient>['client'] | null }));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: Parameters<ReturnType<typeof fakeClient>['client']['invoke']>) => (holder.client!.invoke as unknown as (...a: unknown[]) => unknown)(...args) } }));
let fake: ReturnType<typeof fakeClient>;
const asks = () => (fake.invoked('session.ui.render') as CommandInput<'session.ui.render'>[]).filter((ask) => ask.component === 'UserMessage');
beforeEach(() => { resetSurfaceRegistry(); fake = fakeClient(); holder.client = fake.client; });
afterEach(() => cleanup());

// a task's end as a carrier holds it with no <summary>: the engine's transcript passes it through no UserMessage site
const BARE = (id: string) => `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`;
const end = (id: string, summary: string): ArrivalEntry => ({ class: 'task', taskId: id, toolUseId: `tu-${id}`, runId: `run-${id}`, outcome: 'completed', summary, durationMs: null, outputFile: null, detail: null });

async function bareCarrier() {
  const b = builder();
  b.turn('opening-prompt', 'Count the files and sort the names');
  b.emit('user.message', { messageUuid: uuid('carrier-uuid'), content: `${BARE('bt1')}\n${BARE('bt2')}`, isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [end('bt1', 'Background command "count files" completed'), end('bt2', 'Background command "sort names" completed')] });
  const store = await storeWith(b.events);
  const notices = store.rows().filter((row): row is Extract<Row, { kind: 'notice' }> => row.kind === 'notice');
  return { store, notices };
}

describe('two notices of a carrier the engine draws through no site', () => {
  it('the second follows under the id the first asks with, its own line’s anchored id', async () => {
    const { store, notices } = await bareCarrier();
    expect(notices).toHaveLength(2);
    const state = useTranscriptStore.getState().entries[store.key]!.state;
    const turn = state.turns.get(notices[0]!.turnId!)!;
    const drawn = turnRows(state, turn.id);
    const owner = arrivalInput(notices[0]!, turn, { revealed: undefined, expanded: false, drawn, state });
    expect(owner?.instanceId).toMatch(/~/); // its own line, anchored
    expect(arrivalInput(notices[1]!, turn, { revealed: undefined, expanded: false, drawn, state })).toBeNull();
    expect(noticeFollows(notices[1]!, turn, undefined, drawn, state)).toBe(owner!.instanceId);
  });

  it('a mod that replaces the first hides the second', async () => {
    const { store, notices } = await bareCarrier();
    const id = store.key as AppSessionId;
    useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
    const first = renderRow(notices[0]!, { storeKey: store.key });
    const second = renderRow(notices[1]!, { storeKey: store.key });
    expect(asks()).toHaveLength(1);
    expect(asks()[0]!.instanceId).toMatch(/~/);
    await act(() => fake.reply('session.ui.render', { tree: { type: 'Text', children: ['two tasks, as a mod folds them'] }, props: asks()[0]!.props, rewritten: false, hooked: true }));
    expect(first.container.textContent).toContain('two tasks, as a mod folds them');
    expect(second.container.querySelector('.transcript-notice')).toBeNull();
  });
});
