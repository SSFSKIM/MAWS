// The question sheet's envelope on the carriers of a main conversation (the C3 plan's §I; the composite's §5.2 and §5.3),
// the ones today's asynchronous answer comes by (`./ask-delivery`): a prompt the sminos plugin submits while the session
// is idle, and a hook's added context on a tool's result or on the person's next prompt. An envelope is told by its head
// line (`[sheet v1] `) and the block on the line that ends it (`<sheet-delivery>…</sheet-delivery>`), and a reader
// reads the block and nothing above it (C2's I7): the prose is the model's, and its labels can be cut where the
// block's places never are. Never read from text a person typed: no carrier here is the person's. Pure.
import { parseSheetDeliveries, type SheetDelivery } from '../sheet/delivery';

type Json = Record<string, unknown>;

const HEAD = '[sheet v1] ';
// The block is one line, its `<`, `>` and `&` escaped (§5.3), and every string of the prose above it is a JSON string,
// so no line of the prose can stand as a block.
const BLOCK_LINE = /^<sheet-delivery>[^<]*<\/sheet-delivery>$/;
/** The engine's framing of a prompt the plugin submits, around the plugin's own text (as `./ask-delivery` reads it). */
const PLUGIN_PROMPT = /^The sminos plugin sent a message:\n/;
const PLUGIN_PROMPT_END = /\n\nThis is how Claude Code surfaces a prompt a plugin submits[^\n]*$/;
/** A hook's context as a conversation may hold it: the engine's own prefix (C0's P5), in a reminder or bare. */
const CONTEXT = /^(?:<system-reminder>\n)?[A-Za-z][A-Za-z.]* hook additional context: /;

const object = (value: unknown): Json | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null);

/** The blocks of the envelopes a carrier's text holds, in order: each under its head, on the line that ends it. */
function envelopesIn(text: string): SheetDelivery[] {
  const out: SheetDelivery[] = [];
  let open = false;
  for (const line of text.replace(CONTEXT, '').split('\n')) {
    if (line.startsWith(HEAD)) open = true;
    else if (open && BLOCK_LINE.test(line)) {
      out.push(...parseSheetDeliveries(line));
      open = false;
    }
  }
  return out;
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
  if (prompt !== null) return envelopesIn(prompt);
  const attachment = object(row.attachment);
  if (row.type !== 'attachment' || attachment?.type !== 'hook_additional_context') return [];
  const content = attachment.content;
  return (Array.isArray(content) ? content : [content]).flatMap((entry) => (typeof entry === 'string' ? envelopesIn(entry) : []));
}
