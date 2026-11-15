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
// only on a choice, `name` only on a repository or a design system. P3-D: a design_system answer carries no value but
// one of `designSystemId` (with the system's `name`, optional) and `create` (only when the question allows it).
export function askAnswersProblem(questions: readonly AskQuestion[], answers: readonly AskAnswer[]): string | null {
  const byId = new Map(questions.map((question, index) => [askQuestionId(question, index), question]));
  const seen = new Set<string>();
  for (const answer of answers) {
    const question = byId.get(answer.id);
    if (question === undefined) return `no question ${answer.id} in this ask`;
    if (seen.has(answer.id)) return `question ${answer.id} is answered twice`;
    seen.add(answer.id);
    if (answer.otherText !== undefined && question.modality !== 'choice') return `question ${answer.id} carries otherText, which only a choice answer has`;
    if (answer.name !== undefined && question.modality !== 'repository' && question.modality !== 'design_system') return `question ${answer.id} carries name, which only a repository or design_system answer has`;
    // P3-D start
    for (const field of ['designSystemId', 'create'] as const) {
      if (answer[field] !== undefined && question.modality !== 'design_system') return `question ${answer.id} carries ${field}, which only a design_system answer has`;
    }
    // P3-D end
    if (answer.status !== 'answered') {
      if (answer.value !== undefined || answer.otherText !== undefined || answer.name !== undefined || answer.designSystemId !== undefined || answer.create !== undefined) return `question ${answer.id} is ${answer.status} and carries a value`;
      continue;
    }
    // P3-D start
    if (question.modality === 'design_system') {
      const problem = designSystemAnswerProblem(question, answer);
      if (problem !== null) return problem;
      continue;
    }
    // P3-D end
    if (answer.value === undefined) return `question ${answer.id} is answered with no value`;
    const wantsString = question.modality === 'text' || question.modality === 'repository';
    if (wantsString !== (typeof answer.value === 'string')) return `question ${answer.id} (${question.modality}) needs a ${wantsString ? 'string' : 'list'} value`;
    if (question.modality === 'choice' && question.multi !== true && answer.value.length > 1) return `question ${answer.id} is single-select and has ${answer.value.length} choices`;
  }
  for (const id of byId.keys()) if (!seen.has(id)) return `no answer for question ${id}`;
  return null;
}

// P3-D start: an answered design_system question's fields (the status and the other modalities' fields checked above).
function designSystemAnswerProblem(question: AskQuestion, answer: AskAnswer): string | null {
  if (answer.value !== undefined) return `question ${answer.id} (design_system) carries a value; it is answered with designSystemId or create`;
  if (answer.designSystemId !== undefined && answer.create !== undefined) return `question ${answer.id} is answered with both a designSystemId and create`;
  if (answer.designSystemId === undefined && answer.create === undefined) return `question ${answer.id} is answered with neither a designSystemId nor create`;
  if (answer.create !== undefined && question.allowCreate === false) return `question ${answer.id} does not allow create`;
  if (answer.name !== undefined && answer.designSystemId === undefined) return `question ${answer.id} carries name without a designSystemId`;
  return null;
}
// P3-D end

// One answer as the steer's line reads it: the labels (and what was typed under Other), the text in quotes, the paths
// one per line indented three spaces (so the text starts with a newline), `<name> (<directory>)`, a design system's
// `<name> (<id>)` or the build request (P3-D), or the two non-answers.
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
    case 'design_system': // P3-D
      if (answer.create === true) return 'build a new one with me';
      return answer.name !== undefined ? `${answer.name} (${answer.designSystemId ?? ''})` : (answer.designSystemId ?? '');
  }
}

// The steer's first line, whole: the tag with the ask's id, then the writer's fixed sentence. A reader of envelopes the
// engine joined with other messages opens a member only at this line (`readAnswerEnvelopes`, shared/engine/arrival.ts).
export const askSteerOpening = (askId: string): string => `[MAWS ask ${askId}] The user answered the questions you asked:`;

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
  return [askSteerOpening(askId), ...lines, '```json', JSON.stringify(result, null, 2), '```'].join('\n');
}

/**
 * The envelope's own checks on a whole text, without the answers' schema: the tag at its start, the last `json` fence at
 * its end, a block that parses, of status `answered`, naming the tag's ask. The block is the appended result alone: a
 * question, header, label or answer may carry fences of its own above it, and its body cannot hold its opener, since
 * JSON escapes every newline. It uses nothing outside its own body: the search text's worker runs its source (ticket
 * 704, Interfaces A).
 */
export function answeredBlock(text: string): { askId: string; result: unknown } | null {
  const tag = /^\[MAWS ask ([^\]\s]+)\] /.exec(text);
  const open = '\n```json\n';
  const close = '\n```';
  if (tag === null || !text.endsWith(close)) return null;
  const end = text.length - close.length;
  const start = text.lastIndexOf(open, end);
  if (start === -1) return null;
  let result: unknown;
  try {
    result = JSON.parse(text.slice(start + open.length, end));
  } catch {
    return null;
  }
  const block = typeof result === 'object' && result !== null ? (result as { status?: unknown; askId?: unknown }) : null;
  return block !== null && block.status === 'answered' && block.askId === tag[1] ? { askId: tag[1]!, result } : null;
}

// The steer recognised back from a user message's text: its ask id and answered result, or null for any other text (an
// untagged message, a block that does not parse as an answered AskResult, or one naming another ask): the envelope's own
// checks, then the answers' schema.
export function parseAskSteer(text: string): { askId: string; result: Extract<AskResult, { status: 'answered' }> } | null {
  const block = answeredBlock(text);
  if (block === null) return null;
  const parsed = AskResultSchema.safeParse(block.result);
  if (!parsed.success || parsed.data.status !== 'answered' || parsed.data.askId !== block.askId) return null;
  return { askId: block.askId, result: parsed.data };
}
