// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Proof 3 and the architect's
// ruling A2): the transcript harness's questions. `synthetic/questions` is the seeded synthetic transcript with three
// turns of the engine's AskUserQuestion put in it (invented content): two that ask two questions each and are never
// answered, one a hundred turns above the other, and as the last turn one whose two questions the person dismissed (the
// engine's `question.answered` with no answers, as C3 reports a decline), its first header fourteen characters long.
// `raiseQuestion` makes one of them a waiting request of the transcript's session in the attention store, with the
// request event the card would read over IPC, so the real card draws its form in the row of the call; `lowerQuestion`
// takes it out of the list again, as main's feed does once a request no longer waits.
import type { AttentionItem } from '@shared/graph/attention';
import type { Question, SessionEvent } from '@shared/graph/events';
import type { ApiMessageId, AppSessionId, AttentionId, EventId, MessageUuid, RequestId, SessionId, ToolUseId } from '@shared/graph/ids';
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
interface Asked {
  call: string;
  after: number; // the synthetic turn this one follows
  prompt: string;
  questions: Question[];
  dismissed: boolean;
}
const ASKED: Asked[] = [
  {
    call: 'toolu_question_far_1', after: 80, prompt: 'Plan the garden shed release with me.', dismissed: false,
    questions: [
      { question: 'Which day should the shed plans go out?', header: 'Release day', options: options('Tuesday', 'Thursday'), multiSelect: false },
      { question: 'Where should the plans be announced?', header: 'Channel', options: options('Notice board', 'Newsletter'), multiSelect: false },
    ],
  },
  {
    call: 'toolu_question_far_2', after: 160, prompt: 'Pick the paint for the shed door.', dismissed: false,
    questions: [
      { question: 'Which colour should the door be?', header: 'Door colour', options: options('Sage', 'Ochre'), multiSelect: false },
      { question: 'Which finish should it have?', header: 'Finish', options: options('Matte', 'Gloss'), multiSelect: false },
    ],
  },
  {
    call: 'toolu_question_dismissed', after: TURNS, prompt: 'Ask me about the release window.', dismissed: true,
    questions: [
      { question: 'Which week should the release window open?', header: 'Release window', options: options('First week', 'Second week'), multiSelect: false },
      { question: 'Who signs the release off?', header: 'Sign-off', options: options('The editor', 'The owner'), multiSelect: false },
    ],
  },
];

type Draft = { kind: SessionEvent['kind'] } & Record<string, unknown>;

// One question turn, at `at`: the prompt, the call, its request, and for a dismissed one the reply with no answers.
function questionTurn(asked: Asked, at: string): Draft[] {
  const user = `user-${asked.call}` as MessageUuid;
  const api = `msg-${asked.call}` as ApiMessageId;
  const message = `${api}-u0` as MessageUuid;
  const toolUseId = asked.call as ToolUseId;
  const requestId = `req-${asked.call}` as RequestId;
  const input = { questions: asked.questions.map((q) => ({ question: q.question, header: q.header, multiSelect: q.multiSelect, options: q.options.map((o) => ({ label: o.label })) })) };
  const turn: Draft[] = [
    { kind: 'turn.started', userMessageUuid: user, origin: 'human' },
    { kind: 'user.message', messageUuid: user, content: asked.prompt, isReplay: false, isSynthetic: false, origin: 'human', bash: null },
    { kind: 'assistant.block.complete', messageUuid: message, apiMessageId: api, blockIndex: 0, model: MODEL, supersedes: [], aborted: false, userMessageUuids: [], block: { type: 'tool_use', id: toolUseId, name: 'AskUserQuestion', input } },
    { kind: 'tool.use', toolUseId, toolName: 'AskUserQuestion', input, apiMessageId: api, messageUuid: message },
    { kind: 'question.requested', requestId, toolUseId, questions: asked.questions },
  ];
  if (asked.dismissed) turn.push({ kind: 'question.answered', requestId, toolUseId, answers: {} });
  turn.push({
    kind: 'turn.ended', result: 'success', isError: false, terminalReason: 'completed', resultText: null, durationMs: 4000, numTurns: 1,
    costUsd: 0.02, usage: USAGE, permissionDenials: [], errors: [], userMessageUuids: [user], origin: 'human', resultIndex: null, isEchoReceipt: false,
  });
  return turn.map((event) => ({ ...event, at }));
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
 * A waiting request of `appSessionId` for the call that `request` asks by, written to the attention store as main's
 * feed would write it, with its request event as the card's read would keep it. Answers the item's id.
 */
export function raiseQuestion(appSessionId: AppSessionId, request: Extract<SessionEvent, { kind: 'question.requested' }>): AttentionId {
  const store = useAttention.getState();
  const id = addressOf(ipc.localMachine, `harness-question-${request.toolUseId}` as AttentionId);
  const now = new Date().toISOString();
  const item: AttentionItem = {
    id, appSessionId, sessionId: request.sessionId, kind: 'question',
    request: { requestId: request.requestId, toolUseId: request.toolUseId, taskId: null, agentId: null },
    summary: request.questions[0]?.question ?? 'Question', createdAt: now, state: 'pending', stateChangedAt: now, expiresAt: null,
  };
  useAttention.setState({ requests: new Map(store.requests).set(id, request) });
  store.applyChanged({ appSessionId, items: [...(store.bySession.get(appSessionId) ?? []), item] }, ipc.localMachine);
  return id;
}

/** The item `id` no longer waits: it leaves `appSessionId`'s list, as main's feed would say. */
export function lowerQuestion(appSessionId: AppSessionId, id: AttentionId): void {
  const store = useAttention.getState();
  store.applyChanged({ appSessionId, items: (store.bySession.get(appSessionId) ?? []).filter((item) => item.id !== id) }, ipc.localMachine);
}
