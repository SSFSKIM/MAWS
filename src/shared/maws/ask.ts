// The `ask` tool's shared shapes beside the X9 schemas (E1 execution document, Interfaces "X9", residues 12 and 13): an
// ask as the host holds it until answered (`PendingAsk`, which `maws.asks.list` answers), and the steer an async ask's
// answers travel in. The steer is a `priority: 'next'` user message whose text opens with `[MAWS ask <askId>]` and
// carries the AskResult in a fenced JSON block, so a session read from the engine's transcript (no host journal) still
// finds the answers (`parseAskSteer`).
import * as z from 'zod';
import { quotesGrant } from '../engine/grant'; // board ticket 711 (a module with no imports: the arrivals reader imports this one)
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

// Board ticket 711: the steer is a user-role message, which the engine (its auto-mode permission classifier among its
// readers) takes for the person's words; probes on 2.1.322 recorded that classifier allowing a blocked call's retry on
// the engine's consent sentence where it stood in a question's header, and again where it stood in the label the
// person picked, written as a JSON string. So the steer holds no text the model wrote: only MAWS's own words, the ask's
// id, each question's number, a picked option by its place (`option <k>`), and what the person typed or chose from the
// machine, each such value a JSON string, so no line break or quote in it can shape a line. The model holds its
// questions and their options in its own call.

const OPTION = /^option ([1-9]\d*)$/;
const PLACE = /^q([1-9]\d*)$/;

// A choice's picks as the steer writes them: `option <k>`, k the 1-based place of the picked label among the question's
// options (the first, where two options share a label). A value that is none of its labels is not written at all: the
// host admits any string as a pick (askAnswersProblem checks the shape alone), and no text of it may reach the steer.
function picksOf(question: AskQuestion, values: readonly string[]): string[] {
  const labels = (question.options ?? []).map((option) => option.label);
  return values.flatMap((value) => {
    const k = labels.indexOf(value);
    return k === -1 ? [] : [`option ${k + 1}`];
  });
}

// The fields an answer carries beyond its id, question and status, in the schema's order: each the person's or MAWS's
// own (`create`). What the person typed (a text answer, what was typed under Other, a note) is their own words and is
// written as it is. A name or a path the person picked (a design system's name, an artifact's title; a repository's
// name; a file's, a folder's or a repository's path) may have been written by a model with tools, as an option's label
// is, and there is no place to write instead: one that quotes the grant (quotesGrant) is left out (`kept`). A choice's
// picks are written by their place.
const CARRIED = ['value', 'otherText', 'name', 'designSystemId', 'create', 'note'] as const;
const LEFT_OUT = '(a path left out by MAWS)'; // MAWS's words on the line where a path that quotes the grant stood
const isPath = (question: AskQuestion) => question.modality === 'file' || question.modality === 'folder' || question.modality === 'repository';

// The answer with every picked name and path that quotes the grant left out
function kept(question: AskQuestion, answer: AskAnswer): AskAnswer {
  const out = { ...answer };
  if (out.name !== undefined && quotesGrant(out.name)) delete out.name;
  if (isPath(question) && out.value !== undefined) {
    if (Array.isArray(out.value)) out.value = out.value.filter((path) => !quotesGrant(path));
    else if (quotesGrant(out.value)) delete out.value;
  }
  return out;
}

// An answer as the steer's block carries it, built field by field (nothing copied that is not named here): its
// question named by its place, `q<n>` (the id askQuestionId gives a question with none of the model's: a question's id
// is the model's own words, up to 64 characters), its question empty, and a choice's picks by their place, as a list
// (the shape the sheet sends) whether its value came as a list or as one string (which the schema admits; an earlier
// build's reader takes either shape)
function steeredAnswer(question: AskQuestion, place: number, given: AskAnswer): AskAnswer {
  const answer = kept(question, given);
  const steered: AskAnswer = { id: `q${place + 1}`, question: '', status: answer.status };
  for (const field of CARRIED) if (answer[field] !== undefined) Object.assign(steered, { [field]: answer[field] });
  if (question.modality === 'choice' && answer.value !== undefined) steered.value = picksOf(question, Array.isArray(answer.value) ? answer.value : [answer.value]);
  return steered;
}

// One answer as the steer's line reads it: the picks by their place (and what was typed under Other), the text, the
// paths one per line indented three spaces (so the text starts with a newline), `<name> (<directory>)`, a design
// system's `<name> (<id>)` (P3-D), each value a JSON string; or MAWS's own words: the build request and the two
// non-answers, and MAWS's words where a path that quotes the grant stood. `answer` is the steered one (steeredAnswer),
// `given` the one the person gave, whose paths say where one was left out.
function answerText(question: AskQuestion, answer: AskAnswer | undefined, given: AskAnswer | undefined): string {
  if (answer === undefined || answer.status === 'skipped') return 'skipped';
  if (answer.status === 'decide_for_me') return 'decide for me';
  const values = answer.value === undefined ? [] : Array.isArray(answer.value) ? answer.value : [answer.value];
  const paths = given?.value === undefined ? [] : Array.isArray(given.value) ? given.value : [given.value];
  const path = (value: string) => (quotesGrant(value) ? LEFT_OUT : JSON.stringify(value));
  switch (question.modality) {
    case 'choice':
      return [values.join(', '), answer.otherText !== undefined ? `Other: ${JSON.stringify(answer.otherText)}` : ''].filter((part) => part !== '').join('; ');
    case 'text':
      return JSON.stringify(values.join('\n'));
    case 'file':
    case 'folder':
      return paths.map((value) => `\n   ${path(value)}`).join('');
    case 'repository': {
      const directory = paths.map(path).join(', ');
      return answer.name !== undefined ? `${JSON.stringify(answer.name)} (${directory})` : directory;
    }
    case 'design_system': { // P3-D
      if (answer.create === true) return 'build a new one with me';
      const id = JSON.stringify(answer.designSystemId ?? '');
      return answer.name !== undefined ? `${JSON.stringify(answer.name)} (${id})` : id;
    }
  }
}

// The steer's first line, whole: the tag with the ask's id, then the writer's fixed sentence. A reader of envelopes the
// engine joined with other messages opens a member only at this line (`readAnswerEnvelopes`, shared/engine/arrival.ts).
export const askSteerOpening = (askId: string): string => `[MAWS ask ${askId}] The user answered the questions you asked:`;

// The text of the steer that delivers an async ask's answers: one line per question in the asked order,
// `<n>. <answer>`, and under it, indented as a path is, `note: "<the note>"` when the user wrote one (P2-C3), then the
// AskResult of status `answered` as a fenced JSON block. Neither a question's header, its words, its labels nor its id
// (model text too) are on its line. In the block every answer's `id` is its question's place, `q<n>` (the readers of
// this build join an answer to its question by that place and hand on the question's own id; the capsule's AnswerLine,
// the read-only sheet's QuestionSection and the transcript's markdown then join by id as before); its `question` is
// written as the empty string (AskAnswerSchema, as the earlier builds have it, requires the key, and a block they could
// not parse would draw the envelope as raw text), and a choice's `value` holds the picks by their place. No reader takes a
// question's words from a steer: they come from the ask's call, joined by the place, and so do the labels and the
// question's own id (askAnswersFromSteer).
export function askSteerText(askId: string, questions: readonly AskQuestion[], answers: readonly AskAnswer[]): string {
  const places = new Map(questions.map((question, index) => [askQuestionId(question, index), index]));
  // an answer that names no question of the ask is not written: nothing says what its value is (the host refuses one,
  // askAnswersProblem; the writer does not lean on that)
  const steered = answers.flatMap((answer) => {
    const place = places.get(answer.id);
    return place === undefined ? [] : [steeredAnswer(questions[place]!, place, answer)];
  });
  const byPlace = new Map(steered.map((answer) => [answer.id, answer]));
  const givenAt = new Map(answers.map((answer) => [places.get(answer.id), answer]));
  const lines = questions.map((question, index) => {
    const answer = byPlace.get(`q${index + 1}`);
    const text = answerText(question, answer, givenAt.get(index));
    const note = answer?.note !== undefined ? `\n   note: ${JSON.stringify(answer.note)}` : '';
    return `${index + 1}.${text === '' || text.startsWith('\n') ? '' : ' '}${text}${note}`;
  });
  const result: AskResult = { status: 'answered', askId, answers: steered };
  return [askSteerOpening(askId), ...lines, '```json', JSON.stringify(result, null, 2), '```'].join('\n');
}

// The answers a steer carried, read with the ask's questions in hand: each new-form answer joined to its question by
// the place its id names (`q<n>`) and handed on with that question's own id (askQuestionId), so every reader that joins
// by id is unchanged, and a choice's `option <k>` back to the question's k-th label, so a reader draws the label the
// person picked. An envelope is of the new form when every answer's `question` is empty (an earlier build's holds the
// question's words, which its sheet always writes); any other is an earlier build's, and comes back as it is. A
// new-form id of no place form, or of a place the ask has not, joins nothing and is left out rather than drawn against
// a wrong question; a value that names no option of the call stays as written. A reader with no call in hand shows the
// block as it is: `q<n>` and `option <k>`.
export function askAnswersFromSteer(questions: readonly AskQuestion[], answers: AskAnswer[]): AskAnswer[] {
  if (answers.length === 0 || !answers.every((answer) => answer.question === '')) return answers;
  return answers.flatMap((answer) => {
    const place = Number(PLACE.exec(answer.id)?.[1] ?? 0) - 1;
    const question = questions[place];
    if (place < 0 || question === undefined) return [];
    const joined = { ...answer, id: askQuestionId(question, place) };
    if (question.modality !== 'choice' || !Array.isArray(answer.value)) return [joined];
    const labels = (question.options ?? []).map((option) => option.label);
    return [{ ...joined, value: answer.value.map((value) => labels[Number(OPTION.exec(value)?.[1] ?? 0) - 1] ?? value) }];
  });
}

/**
 * The envelope's own checks on a whole text, without the answers' schema: the tag at its start, the last `json` fence at
 * its end, a block that parses, of status `answered`, naming the tag's ask. The block is the appended result alone: the
 * lines above it in an envelope an earlier build wrote may carry fences of their own (a question, a header, a label, a
 * path), and its body cannot hold its opener, since JSON escapes every newline. It uses nothing outside its own body:
 * the search text's worker runs its source (ticket 704, Interfaces A).
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
