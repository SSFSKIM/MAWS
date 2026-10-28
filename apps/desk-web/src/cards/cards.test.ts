// The cards a `cards` subscription draws (P5 O13 M4, §D): each drawn from what the snapshot carries and nothing else,
// its digest computed by the phone from what it draws, and the lane B digest byte-equal to the engine host's own
// (`requestDigestOf`, which hashes with node:crypto and so cannot run in the browser) over every kind of request, a
// normalized question included. A card the phone cannot answer says why.
import { describe, expect, it } from 'vitest';
import { inputSha256 } from 'desk-hub/protocol';
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from '@shared/host/request-digest';
import { cardId, cardKind, laneACards, laneBCards, laneBDigest, unanswerable, type Card } from './cards';

const APP = 'app-1';
const base = { id: `${APP}:launch-1:3:0`, sessionId: 'eng-1', at: '2026-10-28T09:00:00.000Z', seq: 3, agentId: null, parentToolUseId: null };
const event = (fields: Record<string, unknown>) => ({ ...base, ...fields }) as unknown as SessionEvent;

const PERMISSION = event({ kind: 'permission.requested', requestId: 'rq-p', toolUseId: 'tu-p', toolName: 'Bash', displayName: null, input: { command: 'pnpm test', timeout: 120 }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null });
// A question as the engine host's normalizer leaves it: every field present, an absent one null.
const QUESTION = event({
  kind: 'question.requested',
  requestId: 'rq-q',
  toolUseId: 'tu-q',
  questions: [{ question: 'Which way?', header: '', options: [{ label: 'left', description: null, preview: null }, { label: 'right', description: 'the long way', preview: null }], multiSelect: false }],
});
const PLAN = event({ kind: 'plan.requested', requestId: 'rq-plan', toolUseId: 'tu-plan', plan: '1. do it', input: { plan: '1. do it', allowedPrompts: [] } });
const DIALOG = event({ kind: 'dialog.requested', requestId: 'rq-d', dialogKind: 'confirm', payload: { title: 'Restart?', choices: ['yes', 'no'] }, toolUseId: null });
const ELICITATION = event({ kind: 'elicitation.requested', requestId: 'rq-e', mcpServerName: 'docs', elicitationId: null, mode: 'form', payload: { fields: [{ name: 'q', ü: '✓' }] } });

const item = (requestId: string | null, kind = 'permission') => ({
  id: `att-${requestId}`,
  appSessionId: APP,
  sessionId: 'eng-1',
  kind,
  request: { requestId, toolUseId: null, taskId: null, agentId: null },
  summary: kind,
  createdAt: base.at,
  state: 'pending',
  stateChangedAt: base.at,
  expiresAt: null,
});

describe("lane B's digest", () => {
  it('is byte-equal to the engine host’s requestDigestOf for a permission, a normalized question, a plan, a dialog and an elicitation', async () => {
    for (const request of [PERMISSION, QUESTION, PLAN, DIALOG, ELICITATION]) {
      expect(await laneBDigest(APP, request), request.kind).toEqual(requestDigestOf(APP, request));
    }
  });

  it('is lane A’s shape over what the event asks: the tool’s name and input, AskUserQuestion over {questions}', async () => {
    expect(await laneBDigest(APP, PERMISSION)).toEqual({ session: APP, request: 'rq-p', tool: 'Bash', input_sha256: await inputSha256({ command: 'pnpm test', timeout: 120 }) });
    expect((await laneBDigest(APP, QUESTION))?.tool).toBe('AskUserQuestion');
    expect((await laneBDigest(APP, PLAN))?.tool).toBe('ExitPlanMode');
    expect((await laneBDigest(APP, DIALOG))?.tool).toBe('dialog.requested');
  });

  it('is null where the engine host’s is: an event that is no request, or one with no request id', async () => {
    const answered = event({ kind: 'question.answered', requestId: 'rq-q', toolUseId: 'tu-q', answers: {} });
    const anonymous = event({ kind: 'permission.requested', toolName: 'Bash', input: {} });
    for (const request of [answered, anonymous]) {
      expect(await laneBDigest(APP, request)).toBeNull();
      expect(requestDigestOf(APP, request)).toBeNull();
    }
  });
});

describe('lane A’s cards', () => {
  const RAISED = { request: 'toolu_1', session: 'la-1', tool: 'Bash', input: { command: 'ls -la' } };
  const ASKED = { request: 'toolu_2', session: 'la-1', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [{ label: 'A' }] }] } };

  it('are drawn from the snapshot’s raised requests with its launch, each digest over the input it draws', async () => {
    const { cards, launch } = await laneACards({ raised: [RAISED, ASKED], launch: 'L1' });
    expect(launch).toBe('L1');
    expect(cards).toEqual([
      { lane: 'A', raised: RAISED, launch: 'L1', digest: { session: 'la-1', request: 'toolu_1', tool: 'Bash', input_sha256: await inputSha256(RAISED.input) } },
      { lane: 'A', raised: ASKED, launch: 'L1', digest: { session: 'la-1', request: 'toolu_2', tool: 'AskUserQuestion', input_sha256: await inputSha256(ASKED.input) } },
    ]);
    expect(cards.map(cardKind)).toEqual(['permission', 'question']);
    expect(cards.map(cardId)).toEqual(['toolu_1', 'toolu_2']);
  });

  it('leave out a raised entry that is not one, and read a body with no launch as a session with no bridge', async () => {
    const { cards, launch } = await laneACards({ raised: [RAISED, { request: 'x' }, null, { ...RAISED, input: 'text' }] });
    expect(cards.map(cardId)).toEqual(['toolu_1']);
    expect(launch).toBeNull();
    expect(unanswerable(cards[0])).toMatchObject({ why: 'no-bridge' });
  });

  it('read a question by the tool names desk-web reads one by: the ask mod’s async question and the older spelling too', async () => {
    const tools = ['AskUserQuestion', 'mcp__sminos__AskUserQuestion', 'mcp__doperpowers__AskUserQuestion', 'Bash', 'AskUserQuestionLater'];
    const { cards } = await laneACards({ raised: tools.map((tool, i) => ({ ...ASKED, request: `toolu_${i}`, tool })), launch: 'L1' });
    expect(cards.map(cardKind)).toEqual(['question', 'question', 'question', 'permission', 'permission']);
  });

  it('are answerable with a launch', async () => {
    const { cards } = await laneACards({ raised: [RAISED], launch: 'L1' });
    expect(unanswerable(cards[0])).toBeNull();
  });
});

describe('lane B’s cards', () => {
  const card = async (request: SessionEvent, overrides: Record<string, unknown> = {}) => {
    const requestId = (request as unknown as { requestId?: string }).requestId ?? null;
    const [drawn] = await laneBCards(APP, { pendingItems: [{ item: item(requestId), request, context: { launchId: 'launch-1', engineSessionId: 'eng-1' }, requestDigest: requestDigestOf(APP, request), ...overrides }] });
    return drawn as Extract<Card, { lane: 'B' }>;
  };

  it('are drawn from the hydrated request and its item, the phone’s digest beside the endpoint’s', async () => {
    const drawn = await card(PERMISSION);
    expect(drawn).toEqual({ lane: 'B', item: item('rq-p'), request: PERMISSION, context: { launchId: 'launch-1', engineSessionId: 'eng-1' }, digest: requestDigestOf(APP, PERMISSION), endpointDigest: requestDigestOf(APP, PERMISSION) });
    expect(cardKind(drawn)).toBe('permission');
    expect(cardKind(await card(QUESTION))).toBe('question');
    expect(cardId(drawn)).toBe('rq-p');
    expect(unanswerable(drawn)).toBeNull();
  });

  it('are not answerable when the endpoint’s digest is not the one the phone draws: the request changed', async () => {
    const drawn = await card(PERMISSION, { requestDigest: { ...requestDigestOf(APP, PERMISSION)!, input_sha256: 'f'.repeat(64) } });
    expect(unanswerable(drawn)).toEqual({ why: 'request-changed', text: 'the request changed' });
  });

  it('are not answerable on a session not yet prompted locally, nor with no request id, nor of a kind the phone does not answer', async () => {
    expect(unanswerable(await card(PERMISSION, { context: { launchId: 'launch-1', engineSessionId: null } }))).toEqual({ why: 'not-prompted', text: "this session hasn't been prompted locally yet" });
    const [anonymous] = await laneBCards(APP, { pendingItems: [{ item: item(null), request: PERMISSION, context: { launchId: 'launch-1', engineSessionId: 'eng-1' }, requestDigest: requestDigestOf(APP, PERMISSION) }] });
    expect(unanswerable(anonymous)).toMatchObject({ why: 'no-request' });
    for (const request of [PLAN, DIALOG, ELICITATION]) expect(unanswerable(await card(request)), request.kind).toMatchObject({ why: 'not-here' });
  });

  it('leave out an entry that is not one', async () => {
    const cards = await laneBCards(APP, { pendingItems: [null, { item: item('rq-p') }, { item: item('rq-p'), request: PERMISSION, context: { launchId: 'launch-1' } }] });
    expect(cards).toEqual([]);
    expect(await laneBCards(APP, { pendingItems: 'nothing' })).toEqual([]);
  });
});
