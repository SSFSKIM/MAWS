// DC9 (the desk's session view, 2026-10-17; desk composite §9.1, §9.5): the ask mod's tool (doperpowers
// `hooks/mods/ask.tsx`, `sminos/hooks/mods/ask.tsx` once it moved to the sminos plugin), `mcp__sminos__AskUserQuestion`
// or, before the move, `mcp__doperpowers__AskUserQuestion`, is a question as the built-in AskUserQuestion is
// (`ASK_MOD_TOOLS`, classify.ts). Its input is the built-in's plus `async`, which the question row reads as it stands.
// Its result is not: a plugin tool stores no structured answers (its `toolUseResult` is its text), so the answers are
// read back from the text the call returned, which for a blocking ask is the engine's own AskUserQuestion summary
// (`"<question>"="<answer>"` per answered question, joined `, `; 2.1.300 `mapToolResultToToolResultBlockParam`).
import type { ContentBlock } from '@shared/graph/events';
import { engineRefusalOf, resultText } from './cells';

// What an async ask returns at once; its answer reaches the model later, in a message of its own.
const ASYNC_RESULT = 'Your questions are waiting for the human; this call does not wait for them. Their answer will reach you in a later message that quotes each question. Go on with work that does not depend on it.';
// The opening of the engine's refusal when the human declines the dialog, Esc and "Chat about this" alike; the ask mod
// returns it as its deny, which the engine stores inside `<tool_use_error>`.
const DECLINED = "The user doesn't want to proceed with this tool use.";
// The sentences that close the engine's summary, and how it writes a question answered with notes alone.
const SUMMARY_ENDS = ['. You can now continue with these answers in mind.', '. Read the answers carefully'];
const NO_OPTION = '(no option selected)';
const NOTES = ' notes: ';

// The answers a call's result gives, keyed by question text: an empty map for an ask the human declined whole or left
// unanswered (the row reads it Skipped, as a declined built-in question); null while nothing is answered yet (an
// async ask's return) and for a refusal before the ask reached the human, which the row shows as its error instead.
export function askModAnswers(questions: readonly { question: string }[], result: { content: string | ContentBlock[]; isError: boolean }): Record<string, string> | null {
  const text = resultText(result.content);
  if (result.isError) return (engineRefusalOf(text) ?? text.trim()).startsWith(DECLINED) ? {} : null;
  if (text.trim() === ASYNC_RESULT) return null;
  return summaryAnswers(questions, text);
}

// The summary is read by the call's own question texts, in order, so a quote or a `, ` inside an answer cannot end it:
// each answer runs from its question's key to the next found key, or to the summary's closing sentence.
function summaryAnswers(questions: readonly { question: string }[], text: string): Record<string, string> {
  const ends = SUMMARY_ENDS.map((end) => text.lastIndexOf(end)).filter((at) => at >= 0);
  const end = ends.length > 0 ? Math.min(...ends) : text.length;
  const found: { question: string; at: number; from: number }[] = [];
  let cursor = 0;
  for (const { question } of questions) {
    const key = `"${question}"=`;
    const at = text.indexOf(key, cursor);
    if (at < 0 || at >= end) continue;
    found.push({ question, at, from: at + key.length });
    cursor = at + key.length;
  }
  const answers: Record<string, string> = Object.create(null);
  found.forEach(({ question, from }, i) => {
    const next = found[i + 1];
    const segment = text.slice(from, next === undefined ? end : next.at - ', '.length);
    if (segment.startsWith(NO_OPTION)) {
      const notes = segment.indexOf(NOTES);
      answers[question] = notes < 0 ? NO_OPTION : segment.slice(notes + NOTES.length);
      return;
    }
    // `"<answer>"`, then a selected preview or notes when the human gave them
    const close = [segment.indexOf('" selected preview:\n'), segment.indexOf(`"${NOTES}`)].find((at) => at > 0) ?? segment.lastIndexOf('"');
    answers[question] = segment.slice(1, close > 0 ? close : undefined);
  });
  return answers;
}
