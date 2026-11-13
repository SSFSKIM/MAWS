// UX wave U3, first landing (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, Interfaces F, as the controller
// ruled on M5): in a session whose mods surface is attached, the target of the tab's last jump asks no site of any kind
// and is drawn by MAWS, while the row beside it asks as before. The arrival rows' case is in arrivals.test.tsx. Every
// word is invented.
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { rowsOf, withAllExpanded } from '../model/derive';
import type { Row } from '../model/rows';
import { BASH_RESULT, builder, uuid } from '../model/test-events';
import { renderRow, storeWith } from '../view/rows/test-support';

const holder = vi.hoisted(() => ({ client: null as ReturnType<typeof fakeClient>['client'] | null }));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: Parameters<ReturnType<typeof fakeClient>['client']['invoke']>) => (holder.client!.invoke as unknown as (...a: unknown[]) => unknown)(...args) } }));
let fake: ReturnType<typeof fakeClient>;
const asks = () => fake.invoked('session.ui.render') as CommandInput<'session.ui.render'>[];
beforeEach(() => { resetSurfaceRegistry(); fake = fakeClient(); holder.client = fake.client; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Kind = 'user' | 'assistant_text' | 'cell' | 'local_command' | 'question';
const question = (word: string) => [{ question: `Which ${word}?`, header: 'Pick', options: [{ label: `${word} one`, description: 'first' }, { label: `${word} two`, description: 'second' }], multiSelect: false }];
const echo = (b: ReturnType<typeof builder>, u: string, word: string) => {
  b.turn(u, `/model ${word}`);
  b.emit('user.message', { messageUuid: uuid(`out-${u}`), content: `Set model to ${word}`, isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
  b.end([u]);
};
const call = (b: ReturnType<typeof builder>, u: string, word: string) => {
  b.turn(u);
  b.toolUse(`t-${word}`, 'Bash', { command: `echo ${word}` });
  b.result(`t-${word}`, word, { structured: BASH_RESULT(word) });
  b.end([u]);
};
// Each case: a transcript holding two rows of the kind, the first worded `alpha` and the second `beta`; the site the
// kind asks; and how MAWS's own drawing of the first shows.
const cases: [string, Kind, string, () => ReturnType<typeof builder>, (container: HTMLElement) => boolean][] = [
  ['a prompt', 'user', 'UserMessage', () => { const b = builder(); b.turn('u1', 'alpha prompt'); b.end(['u1']); b.turn('u2', 'beta prompt'); return b; }, (c) => c.textContent!.includes('alpha prompt')],
  ['an answer', 'assistant_text', 'AssistantMessage', () => { const b = builder(); b.turn('u'); b.text('m1', 0, 'alpha part'); b.text('m2', 0, 'beta part'); return b; }, (c) => c.textContent!.includes('alpha part')],
  ['a call', 'cell', 'ToolUse', () => { const b = builder(); call(b, 'u1', 'alpha'); call(b, 'u2', 'beta'); return b; }, (c) => c.querySelector('.transcript-cell-label') !== null],
  ['a command’s output', 'local_command', 'CommandOutput', () => { const b = builder(); echo(b, 'u1', 'alpha'); echo(b, 'u2', 'beta'); return b; }, (c) => c.textContent!.includes('Set model to alpha')],
  ['a question', 'question', 'AskUserQuestion', () => {
    const b = builder(); b.turn('u');
    b.toolUse('q-alpha', 'AskUserQuestion', { questions: question('alpha') }); b.result('q-alpha', 'answered');
    b.toolUse('q-beta', 'AskUserQuestion', { questions: question('beta') }); b.result('q-beta', 'answered');
    return b;
  }, (c) => c.querySelector('.transcript-question-line')?.getAttribute('title') === 'Which alpha?'],
];

describe('a jump’s revealed target with a mods surface attached', () => {
  it.each(cases)('%s it names asks no site and is drawn by MAWS; the one beside it asks', async (_, kind, component, transcript, drawn) => {
    const store = await storeWith(transcript().events);
    const key = store.key as AppSessionId;
    useSessions.setState({ engine: new Map([[key, { ...status(key), uiSurface: { clientId: 'maws-main' } }]]) });
    const rows = () => rowsOf(withAllExpanded(useTranscriptStore.getState().entries[store.key]!.state)).filter((row) => row.kind === kind) as Row[];
    expect(rows()).toHaveLength(2);
    const target = rows()[0]!.id;
    act(() => useTranscriptStore.getState().jumpTo(store.key, target));
    expect(useTranscriptStore.getState().entries[store.key]!.state.ui.revealed).toBe(target);
    const [revealed, beside] = rows();

    const view = renderRow(revealed!, { storeKey: store.key });
    expect(asks()).toEqual([]);
    expect(drawn(view.container)).toBe(true);

    renderRow(beside!, { storeKey: store.key });
    const asked = asks().filter((ask) => ask.component === component);
    expect(asked).toHaveLength(1);
    expect(JSON.stringify(asked[0]!.props)).toContain('beta');
    expect(JSON.stringify(asked[0]!.props)).not.toContain('alpha');
  });
});
