// The question sheet's envelope on the carriers of a main conversation (the C3 plan's §I; the composite's §5.2 and §5.3),
// the ones today's asynchronous answer comes by (`./ask-delivery`): a prompt the sminos plugin submits while the session
// is idle, and a hook's added context on a tool's result or on the person's next prompt. An envelope is told by its head
// line (`[sheet v1] `) and the block on the line that ends it (`<sheet-delivery>…</sheet-delivery>`), and a reader
// reads the block and nothing above it (C2's I7): the prose is the model's, and its labels can be cut where the
// block's places never are. Never read from text a person typed: no carrier here is the person's. Pure.
import { parseSheetDeliveries, type SheetDelivery } from '../sheet/delivery';
import { answerSpan } from './ask-delivery';

type Json = Record<string, unknown>;

const HEAD = '[sheet v1] ';
// The block is one line, its `<`, `>` and `&` escaped (§5.3), and every string of the prose above it is a JSON string,
// so no line of the prose can stand as a block.
const BLOCK_LINE = /^<sheet-delivery>[^<]*<\/sheet-delivery>$/;
// The same, anywhere in a text: whether there is anything to split it for.
const HEAD_LINE = /^\[sheet v1\] /m;
const BLOCK_LINES = /^<sheet-delivery>[^<\n]*<\/sheet-delivery>$/m;
/** The engine's framing of a prompt the plugin submits, around the plugin's own text (as `./ask-delivery` reads it). */
const PLUGIN_PROMPT = /^The sminos plugin sent a message:\n/;
const PLUGIN_PROMPT_END = /\n\nThis is how Claude Code surfaces a prompt a plugin submits[^\n]*$/;
/** A hook's context as a conversation may hold it: the engine's own prefix (C0's P5), in a reminder or bare. */
const CONTEXT = /^(?:<system-reminder>\n)?[A-Za-z][A-Za-z.]* hook additional context: /;

const object = (value: unknown): Json | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null);

/**
 * The blocks of the envelopes a carrier's text holds, in order, each under its head on the line that ends it, and the
 * text outside them: an envelope's lines, its head to its block, are the sheet's. A head inside one of today's answers is
 * that answer's (`answerSpan`): the answer carries a person's text verbatim, and a person may paste an envelope there. A
 * head whose envelope never ends, or whose block does not parse, claims nothing: it stays text, and the lines under it
 * are read again as they would have been without it, so an answer of today's among them keeps what it holds. A text
 * with no head line or no block line is not split.
 */
function envelopesIn(text: string): { deliveries: SheetDelivery[]; rest: string } {
  const own = text.replace(CONTEXT, '');
  if (!HEAD_LINE.test(own) || !BLOCK_LINES.test(own)) return { deliveries: [], rest: text };
  const lines = own.split('\n');
  const deliveries: SheetDelivery[] = [];
  const rest: string[] = [];
  let head: number | null = null; // the head of the envelope being read
  let answer = -1; // the last line of the answer of today's being read
  let at = 0;
  // a head that claims nothing: it stays text, and the lines under it are read again
  const reject = () => {
    rest.push(lines[head!]!);
    at = head! + 1;
    head = null;
  };
  for (;;) {
    if (at === lines.length) {
      if (head === null) break;
      reject();
      continue;
    }
    const line = lines[at]!;
    if (head === null) {
      if (at > answer && line.startsWith(HEAD)) head = at;
      else {
        rest.push(line);
        if (at > answer) answer = answerSpan(lines, at) ?? answer;
      }
      at++;
    } else if (line.startsWith(HEAD)) reject();
    else if (BLOCK_LINE.test(line)) {
      const read = parseSheetDeliveries(line);
      if (read.length === 0) reject();
      else {
        for (const delivery of read) deliveries.push(delivery);
        head = null;
        at++;
      }
    } else at++;
  }
  return { deliveries, rest: rest.join('\n') };
}

/** The plugin's own text of a prompt the sminos plugin submitted, else null. */
function promptText(row: Json): string | null {
  const origin = object(row.origin);
  if (row.type !== 'user' || origin?.kind !== 'plugin' || origin.name !== 'sminos' || origin.asUser === true || row.isMeta === true) return null;
  const content = object(row.message)?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 && object(content[0])?.type === 'text' ? object(content[0])!.text : null;
  return typeof text === 'string' ? text.replace(PLUGIN_PROMPT, '').replace(PLUGIN_PROMPT_END, '') : null;
}

/** The deliveries a held row or a frame carries, by the plugin's prompt or a hook's context; none for any other. */
export function sheetCarried(row: Json): SheetDelivery[] {
  const prompt = promptText(row);
  if (prompt !== null) return envelopesIn(prompt).deliveries;
  const attachment = object(row.attachment);
  if (row.type !== 'attachment' || attachment?.type !== 'hook_additional_context') return [];
  const content = attachment.content;
  return (Array.isArray(content) ? content : [content]).flatMap((entry) => (typeof entry === 'string' ? envelopesIn(entry).deliveries : []));
}

/**
 * The row as today's answer reader is to read it: the same row with each carrier text that holds an envelope rewritten
 * to the text outside its envelopes, so an answer the envelope quotes is not read as today's, and a separate answer of
 * today's beside it still is. Every other row, and a carrier that holds no envelope, is the row itself.
 */
export function withoutSheetEnvelopes(row: Json): Json {
  const outside = (text: string): string => {
    const read = envelopesIn(text);
    return read.deliveries.length === 0 ? text : read.rest;
  };
  if (promptText(row) !== null) {
    const message = object(row.message)!;
    const content = message.content;
    if (typeof content === 'string') return { ...row, message: { ...message, content: outside(content) } };
    const block = object((content as unknown[])[0])!;
    return { ...row, message: { ...message, content: [{ ...block, text: outside(block.text as string) }] } };
  }
  const attachment = object(row.attachment);
  if (row.type !== 'attachment' || attachment?.type !== 'hook_additional_context') return row;
  const content = attachment.content;
  const rewritten = Array.isArray(content) ? content.map((entry) => (typeof entry === 'string' ? outside(entry) : entry)) : typeof content === 'string' ? outside(content) : content;
  return { ...row, attachment: { ...attachment, content: rewritten } };
}
