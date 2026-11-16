// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Proof 3 and the architect's
// ruling A2): the transcript harness's questions. `synthetic/questions` is the seeded synthetic transcript with three
// question calls put in it (invented content). Two are a terminal session's asynchronous questions, a hundred turns
// apart: the sminos ask mod's call (`mcp__sminos__AskUserQuestion`) and its immediate result, the fixed sentence that says
// the questions wait for the human while the agent goes on, after which the turn ends and later turns run, as they do in
// the product; no answer is delivered, so each stays open. The last turn is the engine's own AskUserQuestion, which the
// person dismissed (the engine's `question.answered` with no answers, as C3 reports a decline), its first header
// fourteen characters long. `raiseQuestion` makes an asynchronous call a waiting request of the transcript's session as
// the bridge raises it: the lane A record read by the shared `laneAEntryOf` (an `async_input` item named by the call, and
// the request view the card reads), its view put in the attention store's request cache and its item in the session's
// list (`applyChanged`), the order lane A's own mirror writes them in, so the real card draws its form in the call's row;
// `lowerQuestion` takes it out of the list again, as main's feed does once a request no longer waits.
import type { Question, SessionEvent } from '@shared/graph/events';
import type { ApiMessageId, AppSessionId, AttentionId, EventId, MessageUuid, RequestId, SessionId, ToolUseId } from '@shared/graph/ids';
import { laneAEntryOf } from '@shared/lane-a/attention-entry';
import { addressOf } from '@shared/machine/address';
import { synthesise } from '../../../../test/support/synth-transcript';
import { ipc } from '../ipc/client';
import { useAttention } from '../stores/attention';
import type { LoadedFixture } from './fixtures';

export const QUESTIONS_FIXTURE = 'synthetic/questions';
const TURNS = 240;
const SESSION = 'synth-session' as SessionId;
const MODEL = 'claude-opus-5-5';
const USAGE = { inputTokens: 1200, outputTokens: 800, cacheReadInputTokens: 30_000, cacheCreationInputTokens: 0, thinkingTokens: null };

const options = (...labels: string[]) => labels.map((label) => ({ label, description: null, preview: null }));
// The ask mod's asynchronous call, and the result it returns at once (sminos 1.47.0; `transcript/model/ask-mod.ts` reads
// it as no answer yet).
export const ASK_MOD_TOOL = 'mcp__sminos__AskUserQuestion';
const ASYNC_RESULT = 'Your questions are waiting for the human; this call does not wait for them. Their answer will reach you in a later message that quotes each question. Go on with work that does not depend on it.';
interface Asked {
  call: string;
  after: number; // the synthetic turn this one follows
  prompt: string;
  questions: Question[];
  how: 'async' | 'dismissed'; // a terminal session's asynchronous question left open, or the engine's own, dismissed whole
}
const ASKED: Asked[] = [
  {
    call: 'toolu_question_far_1', after: 80, prompt: 'Plan the garden shed release with me.', how: 'async',
    questions: [
      { question: 'Which day should the shed plans go out?', header: 'Release day', options: options('Tuesday', 'Thursday'), multiSelect: false },
      { question: 'Where should the plans be announced?', header: 'Channel', options: options('Notice board', 'Newsletter'), multiSelect: false },
    ],
  },
  {
    call: 'toolu_question_far_2', after: 160, prompt: 'Pick the paint for the shed door.', how: 'async',
    questions: [
      { question: 'Which colour should the door be?', header: 'Door colour', options: options('Sage', 'Ochre'), multiSelect: false },
      { question: 'Which finish should it have?', header: 'Finish', options: options('Matte', 'Gloss'), multiSelect: false },
    ],
  },
  {
    call: 'toolu_question_dismissed', after: TURNS, prompt: 'Ask me about the release window.', how: 'dismissed',
    questions: [
      { question: 'Which week should the release window open?', header: 'Release window', options: options('First week', 'Second week'), multiSelect: false },
      { question: 'Who signs the release off?', header: 'Sign-off', options: options('The editor', 'The owner'), multiSelect: false },
    ],
  },
];

type Draft = { kind: SessionEvent['kind'] } & Record<string, unknown>;

// One question turn, at `at`: the prompt and the call. An asynchronous one: the ask mod's call, its immediate result,
// the agent going on, the turn's end (no answer is delivered, so it stays open). A dismissed one: the engine's own
// AskUserQuestion, its request and the reply with no answers.
function questionTurn(asked: Asked, at: string): Draft[] {
  const user = `user-${asked.call}` as MessageUuid;
  const api = `msg-${asked.call}` as ApiMessageId;
  const message = `${api}-u0` as MessageUuid;
  const toolUseId = asked.call as ToolUseId;
  const toolName = asked.how === 'async' ? ASK_MOD_TOOL : 'AskUserQuestion';
  const input = { questions: asked.questions.map((q) => ({ question: q.question, header: q.header, multiSelect: q.multiSelect, options: q.options.map((o) => ({ label: o.label })) })) };
  const turn: Draft[] = [
    { kind: 'turn.started', userMessageUuid: user, origin: 'human' },
    { kind: 'user.message', messageUuid: user, content: asked.prompt, isReplay: false, isSynthetic: false, origin: 'human', bash: null },
    { kind: 'assistant.block.complete', messageUuid: message, apiMessageId: api, blockIndex: 0, model: MODEL, supersedes: [], aborted: false, userMessageUuids: [], block: { type: 'tool_use', id: toolUseId, name: toolName, input } },
    { kind: 'tool.use', toolUseId, toolName, input, apiMessageId: api, messageUuid: message },
  ];
  if (asked.how === 'async') {
    const reply = `${api}-reply` as ApiMessageId;
    turn.push(
      { kind: 'tool.result', toolUseId, content: ASYNC_RESULT, isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: `${asked.call}-result` as MessageUuid },
      { kind: 'assistant.block.complete', messageUuid: `${reply}-u0` as MessageUuid, apiMessageId: reply, blockIndex: 0, model: MODEL, supersedes: [], aborted: false, userMessageUuids: [], block: { type: 'text', text: 'The questions are with you; I will carry on with the parts that do not depend on them.' } },
    );
  } else {
    const requestId = `req-${asked.call}` as RequestId;
    turn.push({ kind: 'question.requested', requestId, toolUseId, questions: asked.questions }, { kind: 'question.answered', requestId, toolUseId, answers: {} });
  }
  turn.push({
    kind: 'turn.ended', result: 'success', isError: false, terminalReason: 'completed', resultText: null, durationMs: 4000, numTurns: 1,
    costUsd: 0.02, usage: USAGE, permissionDenials: [], errors: [], userMessageUuids: [user], origin: 'human', resultIndex: null, isEchoReceipt: false,
  });
  return turn.map((event) => ({ ...event, at }));
}

/** The fixture's question calls in reading order: the call, its questions, and how it was asked. */
export function questionCalls(events: readonly SessionEvent[]): { call: ToolUseId; questions: Question[]; how: Asked['how'] }[] {
  return events.flatMap((event) => {
    if (event.kind !== 'tool.use') return [];
    const asked = ASKED.find((entry) => entry.call === event.toolUseId);
    return asked ? [{ call: event.toolUseId, questions: asked.questions, how: asked.how }] : [];
  });
}

/** `synthetic/questions`: the seeded transcript with the question turns after the turns `ASKED` names, numbered again. */
export function questionsFixture(): LoadedFixture {
  const base = synthesise({ turns: TURNS, seed: 1 });
  const drafts: Draft[] = [];
  let ended = 0;
  const askAfter = (turn: number, at: string) => {
    for (const asked of ASKED) if (asked.after === turn) drafts.push(...questionTurn(asked, at));
  };
  for (const event of base) {
    drafts.push(event as unknown as Draft);
    if (event.kind === 'turn.ended') askAfter(++ended, event.at);
  }
  const events = drafts.map((event, seq) => ({ sessionId: SESSION, agentId: null, parentToolUseId: null, ...event, id: `e${seq}` as EventId, seq }) as unknown as SessionEvent);
  return { events, streamFrom: null };
}

/**
 * The asynchronous question `call` (its `questions`) as a waiting request of `appSessionId`, as the bridge raises it (the
 * ask's request id is its call's id, U1b C17): the item and request view `laneAEntryOf` reads from that record, the item
 * addressed to this machine as the IPC boundary lifts main's, the view put in the request cache first and then the item in
 * the session's list, as lane A's mirror writes them. Answers the item's id.
 */
export function raiseQuestion(appSessionId: AppSessionId, call: ToolUseId, questions: readonly Question[]): AttentionId {
  const raised = { request: call, session: SESSION, tool: ASK_MOD_TOOL, input: { questions: questions.map((q) => ({ question: q.question, header: q.header, multiSelect: q.multiSelect, options: q.options.map((o) => ({ label: o.label })) })) }, async: true as const, toolUseId: call };
  const entry = laneAEntryOf(appSessionId, raised, new Date().toISOString());
  const item = { ...entry.item, id: addressOf(ipc.localMachine, entry.item.id) };
  useAttention.setState((s) => ({ requests: new Map(s.requests).set(item.id, entry.request) }));
  const store = useAttention.getState();
  store.applyChanged({ appSessionId, items: [...(store.bySession.get(appSessionId) ?? []), item] }, ipc.localMachine);
  return item.id;
}

/** The item `id` no longer waits: it leaves `appSessionId`'s list, as main's feed would say. */
export function lowerQuestion(appSessionId: AppSessionId, id: AttentionId): void {
  const store = useAttention.getState();
  store.applyChanged({ appSessionId, items: (store.bySession.get(appSessionId) ?? []).filter((item) => item.id !== id) }, ipc.localMachine);
}
