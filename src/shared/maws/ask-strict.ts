// UX wave U1c, rule R (the architect's ruling of 2026-11-16, on the wave coordinator's proposal): the strict reading of
// this build's answer envelope, as `askSteerText` (./ask.ts) writes it. It decides what of a person's message is MAWS's,
// so that a grant is read only on what is left (`personsLines`, src/shared/engine/arrival.ts). Its line grammar is the
// writer's, line by line: `<n>.` and MAWS's fixed words, a choice's picks by place (`option <k>`) and what was typed
// under Other, a JSON string, `<name> (<directory>)`, the paths and MAWS's words where one was left out, each indented
// three spaces, and the note line; then the json fence, the result block and its close. The seeded corpus of
// ask-strict.test.ts holds writer and reader together. No line of this grammar is a sentence of anyone's: model text
// stands on no line of it, and what the person typed stands inside a JSON string.
import { askSteerOpening, LEFT_OUT } from './ask';
import { AskResultSchema } from './tools';

/** The work a reading did, counted where it is done: each line looked at, and each character of a block it parsed. */
export interface ReadingWork {
  lines: number;
  blockCharacters: number;
}

const TAGGED_ID = /^\[MAWS ask ([^\]\s]+)\] /;
const FENCE_OPEN = '```json';
const FENCE_CLOSE = '```';
const PLACE = /^q[1-9]\d*$/;
const FIXED = ['skipped', 'decide for me', 'build a new one with me'];

/**
 * The lines of a text with every strict envelope of this build's form taken out, in order, in one forward pass; null
 * where an opening line (`askSteerOpening`, whole) does not read strictly, which ends the reading. Each line is looked at
 * once and each block parsed once, so the work is linear in the text.
 */
export function takeOutEnvelopes(lines: readonly string[], work: ReadingWork): string[] | null {
  const left: string[] = [];
  for (let i = 0; i < lines.length; ) {
    work.lines += 1;
    const id = openingId(lines[i]!);
    if (id === null) {
      left.push(lines[i]!);
      i += 1;
      continue;
    }
    const next = envelopeEnd(lines, i, id, work);
    if (next === null) return null;
    i = next;
  }
  return left;
}

/** The ask id of a line that is an envelope's whole opening line, else null. */
function openingId(line: string): string | null {
  const id = TAGGED_ID.exec(line)?.[1];
  return id !== undefined && line === askSteerOpening(id) ? id : null;
}

// The line after a strict envelope opening at `start`, or null: the answer lines (`<n>.` numbered from 1, each followed
// by its indented lines), the fence, the lines up to the first close, and a block that closes it (`closes`)
function envelopeEnd(lines: readonly string[], start: number, id: string, work: ReadingWork): number | null {
  let i = start + 1;
  let number = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i]!;
    work.lines += 1;
    if (number > 0 && line.startsWith('   ') && isIndentedLine(line)) continue;
    if (!isAnswerLine(line, number + 1)) break;
    number += 1;
  }
  if (number === 0 || lines[i] !== FENCE_OPEN) return null;
  const from = i + 1;
  for (i = from; i < lines.length && lines[i] !== FENCE_CLOSE; i += 1) work.lines += 1;
  if (i === lines.length) return null;
  const block = lines.slice(from, i).join('\n');
  work.blockCharacters += block.length;
  return closes(block, id) ? i + 1 : null;
}

// A block closes a strict envelope when it parses as the answered result of the tag's ask, holds at least one answer, and
// every answer names its question by place with its `question` empty: an earlier build's block holds the question's
// words (the tool requires them), and a block with no answers closes nothing
function closes(block: string, id: string): boolean {
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    return false;
  }
  const parsed = AskResultSchema.safeParse(json);
  if (!parsed.success || parsed.data.status !== 'answered' || parsed.data.askId !== id) return false;
  const { answers } = parsed.data;
  return answers.length > 0 && answers.every((answer) => PLACE.test(answer.id) && answer.question === '');
}

// ---- the line grammar (`answerText` and `askSteerText`) -----------------------------------------------------------------
// Each test reads its line once from the left: a part returns the index after it, or -1 where the line does not hold it.

// `<n>.` alone, or `<n>. ` and an answer
function isAnswerLine(line: string, number: number): boolean {
  const head = `${number}.`;
  if (!line.startsWith(head)) return false;
  if (line.length === head.length) return true;
  return line[head.length] === ' ' && isAnswer(line, head.length + 1);
}

// Three spaces and a path, MAWS's words where one was left out, or the note
function isIndentedLine(line: string): boolean {
  const at = 3;
  if (line.startsWith('note: ', at)) return jsonString(line, at + 6) === line.length;
  return item(line, at) === line.length;
}

// The answer after `<n>. `: MAWS's fixed words; a choice's picks and what was typed under Other; a list of strings and
// left-out paths (a text, a repository's directory, a design system's id); or `<string> (<list>)`, a name and its
// directory or its id
function isAnswer(line: string, at: number): boolean {
  if (FIXED.some((words) => line.length === at + words.length && line.startsWith(words, at))) return true;
  if (line.startsWith('Other: ', at)) return jsonString(line, at + 7) === line.length;
  const picks = pickList(line, at);
  if (picks !== -1) return picks === line.length || (line.startsWith('; Other: ', picks) && jsonString(line, picks + 9) === line.length);
  const name = jsonString(line, at);
  if (name !== -1 && line.startsWith(' (', name)) {
    const inside = line[name + 2] === ')' ? name + 2 : itemList(line, name + 2);
    return inside !== -1 && line[inside] === ')' && inside + 1 === line.length;
  }
  return itemList(line, at) === line.length;
}

// `option <k>`, k from 1, separated by ", "
function pickList(line: string, at: number): number {
  let end = pick(line, at);
  while (end !== -1 && line.startsWith(', ', end)) end = pick(line, end + 2);
  return end;
}

function pick(line: string, at: number): number {
  if (!line.startsWith('option ', at)) return -1;
  let i = at + 7;
  if (!(line[i]! >= '1' && line[i]! <= '9')) return -1;
  do i += 1;
  while (line[i]! >= '0' && line[i]! <= '9');
  return i;
}

// A JSON string or MAWS's words for a path left out, separated by ", "
function itemList(line: string, at: number): number {
  let end = item(line, at);
  while (end !== -1 && line.startsWith(', ', end)) end = item(line, end + 2);
  return end;
}

function item(line: string, at: number): number {
  return line.startsWith(LEFT_OUT, at) ? at + LEFT_OUT.length : jsonString(line, at);
}

// A JSON string as JSON's grammar has it (what `JSON.stringify` writes): no raw control character, every escape whole
function jsonString(line: string, at: number): number {
  if (line[at] !== '"') return -1;
  for (let i = at + 1; i < line.length; ) {
    const code = line.charCodeAt(i);
    if (code === 0x22) return i + 1;
    if (code < 0x20) return -1;
    if (code !== 0x5c) {
      i += 1;
      continue;
    }
    const escape = line[i + 1];
    if (escape === 'u') {
      if (!/^[0-9a-fA-F]{4}$/.test(line.slice(i + 2, i + 6))) return -1;
      i += 6;
    } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) i += 2;
    else return -1;
  }
  return -1;
}
