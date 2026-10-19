// The ask mod's answer to an async question, as the transcript holds it (doperpowers `hooks/mods/ask.tsx`, in the
// sminos plugin from sminos 1.0.0; its design, `docs/doperpowers/specs/2026-10-13-ask-async-design.md`). An async ask
// returns at once; the human's answer reaches the model later as `The human responded to your async AskUserQuestion
// (call <tool_use_id>): <the engine's summary>` (the text the blocking call would have returned), by one of three
// routes, each stored differently (local transcripts, 2.1.296–2.1.302):
// - the session idle: a prompt the plugin submits (`$.prompt.submit({text})`, not as the user), a user row of origin
//   `{kind: "plugin", name: "<plugin>"}` that opens a turn, its text the engine's framing around the plugin's: `The
//   <plugin> plugin sent a message:\n`, the answers (several joined by a blank line when more waited), then `\n\nThis
//   is how Claude Code surfaces a prompt a plugin submits between turns — …`. The plugin is doperpowers until the ask
//   moved to the sminos plugin (doperpowers' sminos plugin design, §11), sminos after; transcripts keep either, and a
//   session resumed across the move holds both, so both are read, for good;
// - a turn running: context on the result of the model's next call (`hook_additional_context`, hook `tool.call`);
// - after a stop: context on the human's next prompt (`hook_additional_context`, hook `prompt.submit`).
// MAWS's backfill draws the first as the owner's bubble, harness text and all, and the two attachments as nothing. Each
// is the answer to a question whose call the delivery names, so the desk reads them alike: the answers on the question's
// row (`asked.ts`), and the compact line `answered: …` where the answer reached the model (`depth/source/ask-answer.ts`).
// The held row stays verbatim.
import type { JsonObject } from 'desk-hub/protocol';
import { askModAnswers } from '../../../../src/renderer/src/transcript/model/ask-mod';
import { QUESTION } from '../../../../src/renderer/src/transcript/model/copy';

/** One answer a row delivers: the async call it answers, and the engine's summary of the answers. */
export type AskAnswer = { call: string; text: string };

const DELIVERY = /The human responded to your async AskUserQuestion \(call ([^)\s]+)\): /g;
/** The plugins the ask mod has run in: sminos from sminos 1.0.0, doperpowers before it. */
const PLUGINS: readonly unknown[] = ['sminos', 'doperpowers'];
/** The engine's framing of a prompt a plugin submits (2.1.302), around the plugin's own text. */
const PLUGIN_PROMPT = /^The (?:sminos|doperpowers) plugin sent a message:\n/;
const PLUGIN_PROMPT_END = /\n\nThis is how Claude Code surfaces a prompt a plugin submits[^\n]*$/;

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

/** The answers a delivery's text holds: each call id with the summary after its head, up to the next head. */
function answersIn(text: string): AskAnswer[] {
  const heads = [...text.matchAll(DELIVERY)];
  return heads.map((head, i) => ({ call: head[1]!, text: text.slice(head.index! + head[0].length, heads[i + 1]?.index ?? text.length).trim() }));
}

/** The plugin's own text of a prompt it submitted that opens with an answer, else null. */
function promptText(row: JsonObject): string | null {
  const origin = object(row.origin);
  if (row.type !== 'user' || origin?.kind !== 'plugin' || !PLUGINS.includes(origin.name) || origin.asUser === true || row.isMeta === true) return null;
  const content = object(row.message)?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 && object(content[0])?.type === 'text' ? (object(content[0])!.text as string) : null;
  if (typeof text !== 'string') return null;
  const own = text.replace(PLUGIN_PROMPT, '').replace(PLUGIN_PROMPT_END, '');
  return own.startsWith('The human responded to your async AskUserQuestion (call ') ? own : null;
}

/** Whether the row is the plugin's prompt delivering answers while the session was idle (it opens a turn). */
export const isAnswerPrompt = (row: JsonObject): boolean => promptText(row) !== null;

/** The answers a held row delivers, by any of the three routes; none for any other row. */
export function askAnswers(row: JsonObject): AskAnswer[] {
  const prompt = promptText(row);
  if (prompt !== null) return answersIn(prompt);
  const attachment = object(row.attachment);
  if (row.type !== 'attachment' || attachment?.type !== 'hook_additional_context') return [];
  const content = attachment.content;
  return (Array.isArray(content) ? content : [content]).flatMap((entry) => (typeof entry === 'string' ? answersIn(entry) : []));
}

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
 * The answers as the desk's line says them: `<header> → <answer>` for each question answered, read with the call's own
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
