// The words of an answer to a question asked without waiting for it, as its line says them (UX wave U3, UC-2's `answer`
// class; the U3a document, decision 9): the model words the `answer` notice from the arrival's `summary` and the
// questions of the call it finds in the transcript. Moved here from the remote reader (`lane-a/conversation/ask-answer.ts`,
// which re-exports it), where the line was first drawn.
import { askModAnswers } from './ask-mod';
import { QUESTION } from './copy';

/** The opening and closing sentences of the engine's summary (2.1.300; `answerText` in the ask mod). */
const LEAD = /^(?:Your questions have been answered|The user answered): /;
const CLOSE = /\. (?:You can now continue with these answers in mind\.|Read the answers carefully[\s\S]*)$/;
const PAIR = /"([^"]*)"="([^"]*)"/g;
/** The engine's refusal when the human declines the dialog, and what follows it for "Chat about this" (2.1.300). */
const DECLINED = "The user doesn't want to proceed with this tool use.";
const SAID = 'the user said:\n';
const CLARIFY = 'The user wants to clarify these questions.';
export const CLARIFYING = 'wants to clarify the questions';

/**
 * The answers as the line says them: `<header> → <answer>` for each question answered, read with the call's own
 * questions when the transcript holds the call, else from the summary's `"<question>"="<answer>"` pairs as written. A
 * declined dialog says so: Skipped (with the human's words when they gave some), or, for "Chat about this", that they
 * want to clarify the questions.
 */
export function answeredWords(text: string, questions: ReadonlyArray<{ question: string; header?: string }> | null): string {
  if (text.startsWith(DECLINED)) {
    const at = text.indexOf(SAID);
    const said = at < 0 ? '' : text.slice(at + SAID.length).trim();
    if (said.startsWith(CLARIFY)) return CLARIFYING;
    return said === '' ? QUESTION.skipped : `${QUESTION.skipped}: ${said.split('\n', 1)[0]}`;
  }
  if (questions !== null) {
    const answers = askModAnswers(questions, { content: text, isError: false });
    if (answers !== null) {
      const said = questions.flatMap((q) => (q.question in answers ? [`${q.header || q.question} → ${answers[q.question]}`] : []));
      return said.length > 0 ? said.join(' · ') : QUESTION.notAnswered;
    }
  }
  if (!LEAD.test(text)) return QUESTION.notAnswered;
  const pairs = text.replace(LEAD, '').replace(CLOSE, '');
  const read = [...pairs.matchAll(PAIR)];
  return read.length > 0 && read.map((m) => m[0]).join(', ') === pairs ? read.map((m) => `${m[1]} → ${m[2]}`).join(' · ') : pairs;
}
