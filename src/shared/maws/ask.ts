// The `ask` tool's shared shapes beside the X9 schemas (E1 execution document, Interfaces "X9", residues 12 and 13): an
// ask as the host holds it until answered (`PendingAsk`, which `maws.asks.list` answers), and the steer an async ask's
// answers travel in. The steer is a `priority: 'next'` user message whose text opens with `[MAWS ask <askId>]` and
// carries the AskResult in a fenced JSON block, so a session read from the engine's transcript (no host journal) still
// finds the answers (`parseAskSteer`).
import * as z from 'zod';
import { RequestIdSchema, ToolUseIdSchema } from '../graph/ids';
import { askQuestionId, AskQuestionSchema, AskResultSchema, type AskAnswer, type AskQuestion, type AskResult } from './tools';

export const PendingAskSchema = z.strictObject({
  askId: z.string(),
  toolUseId: ToolUseIdSchema.nullable(),
  requestId: RequestIdSchema,
  blocking: z.boolean(),
  title: z.string().nullable(),
  context: z.string().nullable(),
  questions: z.array(AskQuestionSchema),
  openedAt: z.string(),
});
export type PendingAsk = z.infer<typeof PendingAskSchema>;

// Why an ask was cancelled (`maws.ask.cancelled.reason`): the process ended (`exit`), or the engine withdrew its call
// (`withdrawn`: its control request cancelled, or the call abandoned by MCP's `notifications/cancelled`, as when the
// user interrupts the turn while a blocking ask waits).
export const AskCancelReasonSchema = z.enum(['exit', 'withdrawn']);
export type AskCancelReason = z.infer<typeof AskCancelReasonSchema>;

// The questions as an ask holds them: each with its id, `q<n>` by position where the model gave none, so the host's
// table, the `maws.ask.opened` event and the answers all name a question the same way.
export function withQuestionIds(questions: readonly AskQuestion[]): AskQuestion[] {
  return questions.map((question, index) => ({ ...question, id: askQuestionId(question, index) }));
}

// Why `answers` cannot answer an ask holding `questions` (ids filled), or null when they can: one answer per question;
// a skipped or delegated answer carries no value; an answered one carries the value its modality names (a string for
// text and repository, a list for choice, file and folder; at most one label for a single-select choice); `otherText`
// only on a choice, `name` only on a repository.
export function askAnswersProblem(questions: readonly AskQuestion[], answers: readonly AskAnswer[]): string | null {
  const byId = new Map(questions.map((question, index) => [askQuestionId(question, index), question]));
  const seen = new Set<string>();
  for (const answer of answers) {
    const question = byId.get(answer.id);
    if (question === undefined) return `no question ${answer.id} in this ask`;
    if (seen.has(answer.id)) return `question ${answer.id} is answered twice`;
    seen.add(answer.id);
    if (answer.otherText !== undefined && question.modality !== 'choice') return `question ${answer.id} carries otherText, which only a choice answer has`;
    if (answer.name !== undefined && question.modality !== 'repository') return `question ${answer.id} carries name, which only a repository answer has`;
    if (answer.status !== 'answered') {
      if (answer.value !== undefined || answer.otherText !== undefined || answer.name !== undefined) return `question ${answer.id} is ${answer.status} and carries a value`;
      continue;
    }
    if (answer.value === undefined) return `question ${answer.id} is answered with no value`;
    const wantsString = question.modality === 'text' || question.modality === 'repository';
    if (wantsString !== (typeof answer.value === 'string')) return `question ${answer.id} (${question.modality}) needs a ${wantsString ? 'string' : 'list'} value`;
    if (question.modality === 'choice' && question.multi !== true && answer.value.length > 1) return `question ${answer.id} is single-select and has ${answer.value.length} choices`;
  }
  for (const id of byId.keys()) if (!seen.has(id)) return `no answer for question ${id}`;
  return null;
}

const STEER_TAG = /^\[MAWS ask ([^\]\s]+)\] /;
const BLOCK_OPEN = '\n```json\n';
const BLOCK_CLOSE = '\n```';

// The appended result block alone: the last `json` fence, which must end the text. A question, header, label or answer
// may carry fences of its own above it; the block's body cannot hold its opener, since JSON escapes every newline.
function resultBlock(text: string): string | null {
  if (!text.endsWith(BLOCK_CLOSE)) return null;
  const end = text.length - BLOCK_CLOSE.length;
  const start = text.lastIndexOf(BLOCK_OPEN, end);
  return start === -1 ? null : text.slice(start + BLOCK_OPEN.length, end);
}

// One answer as the steer's line reads it: the labels (and what was typed under Other), the text in quotes, the paths
// one per line indented three spaces (so the text starts with a newline), `<name> (<directory>)`, or the two non-answers.
function answerText(question: AskQuestion, answer: AskAnswer | undefined): string {
  if (answer === undefined || answer.status === 'skipped') return 'skipped';
  if (answer.status === 'decide_for_me') return 'decide for me';
  const values = answer.value === undefined ? [] : Array.isArray(answer.value) ? answer.value : [answer.value];
  switch (question.modality) {
    case 'choice':
      return [values.join(', '), answer.otherText !== undefined ? `Other: ${JSON.stringify(answer.otherText)}` : ''].filter((part) => part !== '').join('; ');
    case 'text':
      return JSON.stringify(values.join('\n'));
    case 'file':
    case 'folder':
      return values.map((path) => `\n   ${path}`).join('');
    case 'repository':
      return answer.name !== undefined ? `${answer.name} (${values.join(', ')})` : values.join(', ');
  }
}

// The text of the steer that delivers an async ask's answers: one line per question in the asked order, `<header, else
// the question> — <answer>`, and under it, indented as a path is, `note: "<the note>"` when the user wrote one (P2-C3),
// then the AskResult of status `answered` as a fenced JSON block.
export function askSteerText(askId: string, questions: readonly AskQuestion[], answers: readonly AskAnswer[]): string {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const lines = questions.map((question, index) => {
    const answer = byId.get(askQuestionId(question, index));
    const text = answerText(question, answer);
    const note = answer?.note !== undefined ? `\n   note: ${JSON.stringify(answer.note)}` : '';
    return `${index + 1}. ${question.header ?? question.question} —${text.startsWith('\n') ? '' : ' '}${text}${note}`;
  });
  const result: AskResult = { status: 'answered', askId, answers: [...answers] };
  return [`[MAWS ask ${askId}] The user answered the questions you asked:`, ...lines, '```json', JSON.stringify(result, null, 2), '```'].join('\n');
}

// The steer recognised back from a user message's text: its ask id and answered result, or null for any other text (an
// untagged message, a block that does not parse as an answered AskResult, or one naming another ask).
export function parseAskSteer(text: string): { askId: string; result: Extract<AskResult, { status: 'answered' }> } | null {
  const tag = STEER_TAG.exec(text);
  const block = resultBlock(text);
  if (!tag || block === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    return null;
  }
  const parsed = AskResultSchema.safeParse(json);
  if (!parsed.success || parsed.data.status !== 'answered' || parsed.data.askId !== tag[1]) return null;
  return { askId: tag[1]!, result: parsed.data };
}
