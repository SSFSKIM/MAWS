// @vitest-environment happy-dom
// The ask mod's async question row as the session view overlays it (`QuestionOverlay.tsx`): its card waiting below
// while its request is pending, the log's answer once there is one, and — when the request was settled with no answer
// used (DX4 `settled {outcome: "withdrawn"}`: the turn aborted, the session ended) — withdrawn, never left reading as
// open.
import { act, cleanup, render } from '@testing-library/react';
import type { Raised, Settled } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { AskedQuestion } from '../../../conversation/asked';
import type { RequestRecord } from '../../../project/conversation';
import { questionOverlayFacts, QuestionOverlays } from './QuestionOverlay';

afterEach(cleanup);

const CALL = 'toolu_01ask';
const QUESTIONS = [{ question: 'Keep the server running?', header: 'Server' }];
const asked = (answeredText: string | null = null): Map<string, AskedQuestion> => new Map([[CALL, { questions: QUESTIONS, answers: answeredText === null ? null : { 'Keep the server running?': answeredText }, answeredText }]]);
const mac = { nonce: 'n', value: 'v' };
const record = (pending: boolean, settled: Settled | null): RequestRecord => ({
  key: `["fake","s1","toolu_plugin_1"]`,
  request: 'toolu_plugin_1',
  machine: 'fake',
  raised: { request: 'toolu_plugin_1', session: 's1', tool: 'mcp__doperpowers__AskUserQuestion', input: { questions: QUESTIONS }, toolUseId: CALL, mac } as Raised,
  at: 0,
  pending,
  terminalOnly: false,
  settled,
});
const withdrawn: Settled = { request: 'toolu_plugin_1', winner: 'other', outcome: 'withdrawn', by: 'bridge', mac };

describe('the overlay of an async question', () => {
  it('waits below while its request is pending, and is open with no request at all', () => {
    expect(questionOverlayFacts(asked(), [record(true, null)]).get(CALL)).toMatchObject({ waiting: 'below', withdrawn: null });
    expect(questionOverlayFacts(asked(), []).get(CALL)).toMatchObject({ waiting: 'open', withdrawn: null });
  });

  it('reads as withdrawn, not waiting, once its request was settled withdrawn', () => {
    expect(questionOverlayFacts(asked(), [record(false, withdrawn)]).get(CALL)).toMatchObject({ waiting: null, withdrawn: 'Withdrawn: the session moved on without an answer' });
  });

  it("carries the log's answer over any settlement", () => {
    expect(questionOverlayFacts(asked('Stop it'), [record(false, withdrawn)]).get(CALL)).toMatchObject({ waiting: null, withdrawn: null, answeredText: 'Stop it' });
  });

  it('draws a withdrawn question as withdrawn, with no waiting foot', async () => {
    const root = document.createElement('div');
    root.innerHTML = `<div data-row-id="question:${CALL}"><div class="transcript-question"></div></div>`;
    document.body.append(root);
    render(<QuestionOverlays root={root} facts={questionOverlayFacts(asked(), [record(false, withdrawn)])} />);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const host = root.querySelector('[data-desk-question]')!;
    expect(host.textContent).toContain('Withdrawn: the session moved on without an answer');
    expect(host.textContent).not.toContain('Waiting');
    expect(host.querySelector('[data-waiting]')).toBeNull();
    root.remove();
  });
});
