// The ask mod's answer to an async question, as the transcript holds it (doperpowers `hooks/mods/ask.tsx`, in the
// sminos plugin from sminos 1.0.0; its design, `docs/doperpowers/specs/2026-10-13-ask-async-design.md`; moved here from
// `renderer/src/lane-a/conversation/ask-answer.ts` for the arrivals reader, UX wave U3, UC-2). An async ask returns at
// once; the human's answer reaches the model later as `The human responded to your async AskUserQuestion (call
// <tool_use_id>): <the engine's summary>` (the text the blocking call would have returned), by one of three routes, each
// stored differently (local transcripts, 2.1.296–2.1.302):
// - the session idle: a prompt the plugin submits (`$.prompt.submit({text})`, not as the user), a user row of origin
//   `{kind: "plugin", name: "<plugin>"}` that opens a turn, its text the engine's framing around the plugin's: `The
//   <plugin> plugin sent a message:\n`, the answers (several joined by a blank line when more waited), then `\n\nThis
//   is how Claude Code surfaces a prompt a plugin submits between turns — …`. The plugin is doperpowers until the ask
//   moved to the sminos plugin (doperpowers' sminos plugin design, §11), sminos after; transcripts keep either, and a
//   session resumed across the move holds both, so both are read, for good;
// - a turn running: context on the result of the model's next call (`hook_additional_context`, hook `tool.call`);
// - after a stop: context on the human's next prompt (`hook_additional_context`, hook `prompt.submit`).
// A question the person dismissed comes by the same routes (sminos 1.47.0): the same head, then `DISMISSED`. Pure.

type Json = Record<string, unknown>;

/** One answer a row delivers: the async call it answers, and the engine's summary of the answers. */
export type AskAnswer = { call: string; text: string };

const DELIVERY = /The human responded to your async AskUserQuestion \(call ([^)\s]+)\): /g;
/** The plugins the ask mod has run in: sminos from sminos 1.0.0, doperpowers before it. */
const PLUGINS: readonly unknown[] = ['sminos', 'doperpowers'];
/** The engine's framing of a prompt a plugin submits (2.1.302), around the plugin's own text. */
const PLUGIN_PROMPT = /^The (?:sminos|doperpowers) plugin sent a message:\n/;
const PLUGIN_PROMPT_END = /\n\nThis is how Claude Code surfaces a prompt a plugin submits[^\n]*$/;

/**
 * What the bridge delivers, after the head every answer has, for a question the person dismissed without answering
 * (doperpowers pull request #497, sminos 1.47.0): the summary whole is this sentence.
 */
export const DISMISSED = 'The human dismissed these questions without answering them; no answer will come. Do not wait for one.';

const object = (value: unknown): Json | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null);

/** The answers a delivery's text holds: each call id with the summary after its head, up to the next head. */
function answersIn(text: string): AskAnswer[] {
  const heads = [...text.matchAll(DELIVERY)];
  return heads.map((head, i) => ({ call: head[1]!, text: text.slice(head.index! + head[0].length, heads[i + 1]?.index ?? text.length).trim() }));
}

/** The plugin's own text of a prompt it submitted that opens with an answer, else null. */
function promptText(row: Json): string | null {
  const origin = object(row.origin);
  if (row.type !== 'user' || origin?.kind !== 'plugin' || !PLUGINS.includes(origin.name) || origin.asUser === true || row.isMeta === true) return null;
  const content = object(row.message)?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 && object(content[0])?.type === 'text' ? (object(content[0])!.text as string) : null;
  if (typeof text !== 'string') return null;
  const own = text.replace(PLUGIN_PROMPT, '').replace(PLUGIN_PROMPT_END, '');
  return own.startsWith('The human responded to your async AskUserQuestion (call ') ? own : null;
}

/** Whether the row is the plugin's prompt delivering answers while the session was idle (it opens a turn). */
export const isAnswerPrompt = (row: Json): boolean => promptText(row) !== null;

/** The answers a held row delivers, by any of the three routes; none for any other row. */
export function askAnswers(row: Json): AskAnswer[] {
  const prompt = promptText(row);
  if (prompt !== null) return answersIn(prompt);
  const attachment = object(row.attachment);
  if (row.type !== 'attachment' || attachment?.type !== 'hook_additional_context') return [];
  const content = attachment.content;
  return (Array.isArray(content) ? content : [content]).flatMap((entry) => (typeof entry === 'string' ? answersIn(entry) : []));
}
