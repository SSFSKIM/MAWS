// The ask mod's async questions the log knows for a session (the composite's §9.1, "An async question"): sminos records
// the questions an async ask put (`question`) and the answer it got (`answered`), each with the call's tool-use id as
// its `src`. Joined here to the call the session's transcript holds — whose input carries the questions and their
// headers as MAWS's question receipt reads them — and to the answer, read back from the log's text with MAWS's own
// reader of the engine's summary (`askModAnswers`). The session view overlays its question rows with what this gives.
// The transcript holds the answer too, wherever it reached the model (`ask-answer.ts`), naming its call: a question it
// answers is overlaid as well, the log's question or not, and a log with no answer for it takes the transcript's.
import type { JsonObject, LogEvent } from 'desk-hub/protocol';
import { askModAnswers } from '../../../../src/renderer/src/transcript/model/ask-mod';
import { askAnswers } from './ask-answer';
import { writerSession } from './stream';

export type AskedQuestion = {
  questions: Array<{ question: string; header: string }>;
  /** The answers by question, read from the log's answer; null before it, or when its text reads as none. */
  answers: Record<string, string> | null;
  /** The log's answer as written, once there is one. */
  answeredText: string | null;
};

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

/** The questions of each tool call among the rows, by its tool-use id. */
function calls(rows: readonly JsonObject[], wanted: ReadonlySet<string>): Map<string, AskedQuestion['questions']> {
  const found = new Map<string, AskedQuestion['questions']>();
  for (const row of rows) {
    if (row.type !== 'assistant') continue;
    const content = object(row.message)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const use = object(block);
      if (use?.type !== 'tool_use' || typeof use.id !== 'string' || !wanted.has(use.id)) continue;
      const questions = object(use.input)?.questions;
      found.set(
        use.id,
        (Array.isArray(questions) ? questions : []).flatMap((q) => {
          const one = object(q);
          return one && typeof one.question === 'string' ? [{ question: one.question, header: typeof one.header === 'string' ? one.header : '' }] : [];
        }),
      );
    }
  }
  return found;
}

export function askedQuestions(session: string, entries: readonly { event: LogEvent }[], rows: readonly JsonObject[]): Map<string, AskedQuestion> {
  const asked = new Set<string>();
  const answers = new Map<string, string>();
  for (const { event } of entries) {
    if (writerSession(event.writer) !== session || typeof event.src !== 'string') continue;
    if (event.kind === 'question') asked.add(event.src);
    else if (event.kind === 'answered') answers.set(event.src, typeof event.text === 'string' ? event.text : '');
  }
  for (const row of rows) {
    for (const { call, text } of askAnswers(row)) {
      asked.add(call);
      if (!answers.has(call)) answers.set(call, text);
    }
  }
  const out = new Map<string, AskedQuestion>();
  if (asked.size === 0) return out;
  for (const [src, questions] of calls(rows, asked)) {
    const text = answers.get(src) ?? null;
    const read = text === null ? null : askModAnswers(questions, { content: text, isError: false });
    out.set(src, { questions, answers: read !== null && Object.keys(read).length > 0 ? read : null, answeredText: text });
  }
  return out;
}
