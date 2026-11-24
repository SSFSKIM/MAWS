// UX wave U1b (the U1b document, Interfaces §A; decisions 4, 5 and 15): a session's waiting requests, oldest first, the
// calls a transcript marks as waiting rows, and each request's place in one transcript. The selector alone: what a
// producer sends (an agent id, a call id) is proved on its route, not here. Every id and word is invented.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '../graph/attention';
import type { AgentId, AppSessionId, AttentionId, RequestId, ToolUseId } from '../graph/ids';
import { FORM_KINDS, placeWaiting, waitingForms, waitingRequests } from './waiting';

const at = (minute: number) => `2026-11-15T10:${String(minute).padStart(2, '0')}:00.000Z`;
function entry(id: string, kind: AttentionItem['kind'], minute: number, over: { call?: string | null; agent?: string | null; requestId?: string | null; state?: AttentionItem['state'] } = {}): AttentionItem {
  const { call = null, agent = null, requestId = `req-${id}`, state = 'pending' } = over;
  return {
    id: id as AttentionId, appSessionId: 'app-1' as AppSessionId, sessionId: null, kind,
    request: { requestId: requestId as RequestId | null, toolUseId: call as ToolUseId | null, taskId: null, agentId: agent as AgentId | null },
    summary: `${kind} ${id}`, createdAt: at(minute), state, stateChangedAt: at(minute), expiresAt: null,
  };
}
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
const calls = (set: ReadonlySet<ToolUseId>) => [...set].sort();

// One of every kind, out of order, beside what is not in the list: an answered request, a notice, and an item of the
// to-human view that names no request.
const prompt = entry('prompt', 'permission', 5, { call: 'toolu_bash' });
const question = entry('question', 'question', 2, { call: 'toolu_q' });
const plan = entry('plan', 'plan', 3, { call: 'toolu_plan' });
const asked = entry('asked', 'async_input', 4, { call: 'toolu_async' });
const dialog = entry('dialog', 'dialog', 1);
const form = entry('form', 'elicitation', 6);
const childPrompt = entry('child-prompt', 'permission', 7, { call: 'toolu_child_bash', agent: 'agent-a' });
const childQuestion = entry('child-question', 'question', 8, { call: 'toolu_child_q', agent: 'agent-a' });
const otherAgent = entry('other-agent', 'question', 9, { call: 'toolu_other_q', agent: 'agent-b' });
const noCall = entry('no-call', 'question', 10);
const answered = entry('answered', 'question', 0, { call: 'toolu_done', state: 'delivered' });
const notice = entry('notice', 'error', 0, { requestId: null });
const leftThere = entry('left-there', 'async_input', 0, { requestId: null }); // a question left in the to-human view
const ALL = [prompt, question, plan, asked, dialog, form, childPrompt, childQuestion, otherAgent, noCall, answered, notice, leftThere];

// The question sheet's C3 M4 (§H, S10): a sheet question's item, bare as the spine holds it and lifted as a window holds
// it; each names its question's call and, for a subagent's question, its agent.
const SHEET_SESSION = '5eed0000-0000-4000-8000-000000000042';
const sheetBare = entry(`sheet:${SHEET_SESSION}:q1`, 'async_input', 11, { call: 'toolu_sheet', requestId: 'q1' });
const sheetLifted = entry(`machine-ref-0000000001/sheet:${SHEET_SESSION}:q2`, 'async_input', 12, { call: 'toolu_sheet', agent: 'agent-a', requestId: 'q2' });
const WITH_SHEET = [...ALL, sheetBare, sheetLifted];

describe('waitingRequests', () => {
  it('is the items for which waitsOnAnswer holds, oldest first: no answered request, no notice, nothing that names no request', () => {
    expect(ids(waitingRequests(ALL))).toEqual(['dialog', 'question', 'plan', 'asked', 'prompt', 'form', 'child-prompt', 'child-question', 'other-agent', 'no-call']);
  });

  it('orders two of one time by id', () => {
    expect(ids(waitingRequests([entry('b', 'permission', 1), entry('a', 'permission', 1)]))).toEqual(['a', 'b']);
  });
});

describe('a sheet question', () => {
  it('is listed among the waiting requests, bare and lifted', () => {
    expect(ids(waitingRequests(WITH_SHEET)).slice(-2)).toEqual([sheetBare.id, sheetLifted.id]);
  });

  it('marks no call as a waiting row', () => {
    expect(calls(waitingForms(WITH_SHEET))).toEqual(calls(waitingForms(ALL)));
  });

  it('is placed nowhere in a transcript: not at its row, not at the end, in the session’s and in its agent’s transcript', () => {
    const placedIds = (agent: string | null) => placeWaiting(WITH_SHEET, new Set(['toolu_sheet'] as ToolUseId[]), agent).map(({ item }) => item.id);
    expect(placedIds(null)).not.toContain(sheetBare.id);
    expect(placedIds(null)).not.toContain(sheetLifted.id);
    expect(placedIds('agent-a')).toEqual(['child-prompt', 'child-question']);
  });
});

describe('waitingForms', () => {
  it('is the call of each question, plan and asynchronous question of the list; a prompt, a dialog, a form and a request with no call mark no row', () => {
    expect([...FORM_KINDS].sort()).toEqual(['async_input', 'plan', 'question']);
    expect(calls(waitingForms(ALL))).toEqual(['toolu_async', 'toolu_child_q', 'toolu_other_q', 'toolu_plan', 'toolu_q']);
  });
});

describe('placeWaiting', () => {
  const placed = (drawn: string[], agent: string | null) => placeWaiting(ALL, new Set(drawn as ToolUseId[]), agent).map(({ item, place }) => `${item.id}:${place}`);

  it('in the session’s own transcript lists every request, the agents’ among them; a form is at its row when the row is drawn, else at the end', () => {
    expect(placed(['toolu_q', 'toolu_async', 'toolu_bash'], null)).toEqual([
      'dialog:end', 'question:row', 'plan:end' /* its row is not drawn here */, 'asked:row', 'prompt:end' /* a prompt is always at the end */,
      'form:end', 'child-prompt:end', 'child-question:end', 'other-agent:end', 'no-call:end',
    ]);
  });

  it('in an agent’s transcript lists only the requests that carry its id', () => {
    expect(placed(['toolu_child_q'], 'agent-a')).toEqual(['child-prompt:end', 'child-question:row']);
    expect(placed([], 'agent-b')).toEqual(['other-agent:end']);
    expect(placed([], 'agent-none')).toEqual([]);
  });

  it('moves a request to its row when the row is drawn', () => {
    expect(placed([], null)).toContain('question:end');
    expect(placed(['toolu_q'], null)).toContain('question:row');
  });
});
