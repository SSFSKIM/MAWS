// UX wave U3, first landing (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, M5): the notices of one carrier
// follow the drawing its asking notice applied, not the raw answer. Where that notice draws MAWS's own line after all,
// because the hook's rewritten props are refused or its drawing fails, every notice of the carrier is drawn. The cases
// a mod's answer replaces or keeps are in arrivals.test.tsx. Every word is invented.
import { act, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArrivalEntry } from '@shared/engine/arrival-schema';
import type { CommandInput } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import type { Row } from '../model/rows';
import { builder, uuid } from '../model/test-events';
import { renderRow, storeWith } from '../view/rows/test-support';

const holder = vi.hoisted(() => ({ client: null as ReturnType<typeof fakeClient>['client'] | null }));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: Parameters<ReturnType<typeof fakeClient>['client']['invoke']>) => (holder.client!.invoke as unknown as (...a: unknown[]) => unknown)(...args) } }));
// A fault downstream of the tree's parser, as a mod's drawing can fail: the transcript's markdown throws on "fault".
vi.mock('../index', async (original) => {
  const actual = await original<typeof import('../index')>();
  const Markdown = actual.Markdown;
  return { ...actual, Markdown: (props: ComponentProps<typeof Markdown>) => {
    if (props.markdown === 'fault') throw new Error('drawing failed');
    return <Markdown {...props} />;
  } };
});
let fake: ReturnType<typeof fakeClient>;
const asks = () => (fake.invoked('session.ui.render') as CommandInput<'session.ui.render'>[]).filter((ask) => ask.component === 'UserMessage');
beforeEach(() => {
  resetSurfaceRegistry(); fake = fakeClient(); holder.client = fake.client;
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // the surface warns once of a refused tree or a failed drawing
  vi.spyOn(console, 'error').mockImplementation(() => {}); // React reports the error its boundary caught
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const TASK = (id: string, summary: string) => `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>tu-${id}</tool-use-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`;
const end = (id: string, summary: string): ArrivalEntry => ({ class: 'task', taskId: id, toolUseId: `tu-${id}`, runId: `run-${id}`, outcome: 'completed', summary, durationMs: null, outputFile: null, detail: null });
const line = (container: HTMLElement) => container.querySelector('.transcript-line-text')?.textContent;
const hidden = (container: HTMLElement) => container.querySelector('.transcript-notice')?.closest('[inert]') !== null;

async function both() {
  const b = builder();
  b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
  b.emit('user.message', { messageUuid: uuid('n1'), content: `${TASK('bt1', 'Background command "count files" completed')}\n${TASK('bt2', 'Background command "sort names" completed')}`, isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [end('bt1', 'Background command "count files" completed'), end('bt2', 'Background command "sort names" completed')] });
  const store = await storeWith(b.events);
  const id = store.key as AppSessionId;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  const [first, second] = store.rows().filter((row): row is Extract<Row, { kind: 'notice' }> => row.kind === 'notice');
  return { first: renderRow(first!, { storeKey: store.key }), second: renderRow(second!, { storeKey: store.key }) };
}

describe('two notices from one carrier, where the asking notice draws MAWS’s line after all', () => {
  it.each([
    ['the hook’s rewritten props are refused', (props: Record<string, unknown>) => ({ tree: { type: 'Text', children: ['two tasks, as a mod folds them'] }, props: { ...props, text: 42 }, rewritten: true, hooked: true })],
    ['the mod’s drawing fails', (props: Record<string, unknown>) => ({ tree: { type: 'Markdown', props: { text: 'fault' } }, props, rewritten: false, hooked: true })],
  ])('when %s, both notices are drawn', async (_, reply) => {
    const { first, second } = await both();
    expect(asks()).toHaveLength(1);
    await act(() => fake.reply('session.ui.render', reply(asks()[0]!.props as Record<string, unknown>)));
    expect(document.querySelectorAll('[data-plugin-drawn]')).toHaveLength(0);
    expect(line(first.container)).toBe('Background command "count files" completed');
    expect(hidden(first.container)).toBe(false);
    expect(line(second.container)).toBe('Background command "sort names" completed');
  });
});
