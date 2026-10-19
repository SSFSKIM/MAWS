// The ask mod's answer to an async question where it reached the model (`conversation/ask-answer.ts` reads the three
// routes). The session view draws it as what it is, never as the harness text: a dim line `answered: <header> →
// <answer> · …` (a plugin's line, kept in view when the turn folds and in the report), one per answer, where the answer
// went in — the prompt the plugin submitted while the session was idle, or the context of a tool's result or of the
// human's prompt. The idle prompt is no prompt of the owner's: the turn it opens is drawn as one the session continued
// ("Continued for …"), as the bridge's wake's is (`bridge-wake.ts`), with no bubble. The answers are read with the call's
// own questions when this mapping has seen the call, else from the summary's pairs; the question's row carries the same
// answers, joined by the call's id (`conversation/asked.ts`). The held row stays verbatim.
import type { SessionEvent } from '@shared/graph/events';
import type { JsonObject } from 'desk-hub/protocol';
import { eventBase, type BackfillContext } from '../../../../../src/engine-host/fs/backfill';
import { isAskModTool } from '../../../../../src/renderer/src/transcript/model/classify';
import { answeredWords, askAnswers, isAnswerPrompt } from '../../conversation/ask-answer';

/** What the line names, before the answers. */
export const ANSWERED = 'answered';

type Questions = Array<{ question: string; header: string }>;

/** Per mapping context: the ask tool's calls seen so far, by tool-use id, with their questions. */
const seen = new WeakMap<BackfillContext, Map<string, Questions>>();

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

function noteCalls(row: JsonObject, calls: Map<string, Questions>): void {
  const content = row.type === 'assistant' ? object(row.message)?.content : null;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    const use = object(block);
    if (use?.type !== 'tool_use' || typeof use.name !== 'string' || !isAskModTool(use.name) || typeof use.id !== 'string') continue;
    const questions = object(use.input)?.questions;
    calls.set(
      use.id,
      (Array.isArray(questions) ? questions : []).flatMap((q) => {
        const one = object(q);
        return one && typeof one.question === 'string' ? [{ question: one.question, header: typeof one.header === 'string' ? one.header : '' }] : [];
      }),
    );
  }
}

/** A row's events with its answers drawn as lines, and the idle answer prompt's turn as one the session continued. Called on every row a context maps, in order. */
export function withAnswerLines(row: JsonObject, events: SessionEvent[], ctx: BackfillContext): SessionEvent[] {
  let calls = seen.get(ctx);
  if (calls === undefined) seen.set(ctx, (calls = new Map()));
  noteCalls(row, calls);
  const answers = typeof row.uuid === 'string' ? askAnswers(row) : [];
  if (answers.length === 0) return events;
  const drawn = isAnswerPrompt(row)
    ? events.map((event) => (event.kind === 'turn.started' || event.kind === 'user.message' ? ({ ...event, origin: 'task-notification' } as SessionEvent) : event))
    : events;
  const lines = answers.map(
    ({ call, text }, i): SessionEvent => ({ ...eventBase(ctx, `${row.uuid as string}#ask-answer-${i}`), kind: 'plugin.log', plugin: ANSWERED, text: answeredWords(text, calls.get(call) ?? null) }) as SessionEvent,
  );
  return [...drawn, ...lines];
}
