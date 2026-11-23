// Discovery's head/tail summary of a transcript (C4 execution document, M1; SPEC 35.14.2): what the engine's own
// session picker learns from the first and last 64 KiB without parsing the whole file. Which window each fact comes
// from follows the engine's table; the windows are split into lines and parsed as records (the partial line at a
// window's cut edge is dropped), rather than scanned for byte needles, because 64 KiB parses in well under a
// millisecond and a parsed record cannot be fooled by a value inside a torn line.
import { basename } from 'node:path';
import { asTyped } from '@shared/engine/grant';
import type { MessageUuid, SessionId } from '@shared/graph/ids';
import { isMadeUpFinalAnswer, isMessageTool, messageCallText } from '@shared/owner/message-call'; // P4-R7
import { messageLine, previewLine } from '@shared/owner/preview';
import { branchName } from '@shared/sessions/branch';
import { flatPersonsWords, personsWords } from '@shared/engine/persons-message'; // ticket 704
import type { TranscriptSummary } from '@shared/wire/store';
import { isNoContent, TranscriptRecordSchema, type TranscriptRecord } from '@shared/wire/transcript';

export const HEAD_TAIL_BYTES = 64 * 1024;
const TEXT_CAP = 200;
const SESSION_KINDS = ['bg', 'daemon', 'daemon-worker'] as const;

export function summarize(
  head: Buffer,
  tail: Buffer,
  stat: { size: number; mtimeMs: number; birthtimeMs: number }, // E3: `birthtimeMs` is APFS's birth time (0 where the filesystem has none)
  path: string,
  slug: string,
  sidecarTitle: string | null = null, // `custom-title.json`'s `customTitle`, which discovery reads beside the transcript (M2)
  launchCwd: string | null = null, // the first record's folder when it lies past the head window (discovery's scan past it)
): TranscriptSummary {
  const headText = head.toString('utf8');
  const tailText = tail.toString('utf8');
  const headRecords = parseWindow(headText, { dropLast: stat.size > head.length });
  const tailRecords = parseWindow(tailText, { dropFirst: stat.size > tail.length });
  const tailReversed = [...tailRecords].reverse();
  const headReversed = [...headRecords].reverse();

  const firstUuid = headRecords.find(isUuidRecord) ?? tailRecords.find(isUuidRecord) ?? null;
  // E3 (A-16): the conversation's root, which a `--fork-session` copy repeats under its own session id. A parsed head
  // record only: a cut fragment carries no `parentUuid` to tell a root by.
  const root = headRecords.find((r) => isUuidRecord(r) && r.parentUuid === null) ?? null;
  const lastUuid = tailReversed.find(isUuidRecord) ?? headReversed.find(isUuidRecord) ?? null;
  const leaf = tailReversed.find((r) => isUuidRecord(r) && r.type !== 'progress') ?? headReversed.find((r) => isUuidRecord(r) && r.type !== 'progress') ?? null;
  const lastAssistant = lastAssistantLine(tailReversed) ?? lastAssistantLine(headReversed);

  // SPEC 35.14.3: the tail record, else the sidecar, else the head record.
  const customTitle = lastString(tailReversed, 'custom-title', 'customTitle') ?? sidecarTitle ?? lastString(headReversed, 'custom-title', 'customTitle');
  const firstWithParent = headRecords.find((r) => 'parentUuid' in r) ?? tailRecords.find((r) => 'parentUuid' in r);
  const sessionKind = SESSION_KINDS.find((kind) => kind === firstWithParent?.sessionKind) ?? null;

  return {
    sessionId: basename(path, '.jsonl') as SessionId,
    transcriptPath: path,
    slug,
    // The folder the session was launched in: the head's first, else the one discovery found past the head (a transcript
    // whose head is all bookkeeping: file-history snapshots of tens of KiB each). Never a later row's: a shell `cd` does
    // not refile the session (newestCwd follows it). Unknown (null) when neither names one, which the index keeps.
    directory: firstString(headRecords, 'cwd') ?? launchCwd,
    relocatedCwd: lastString(tailReversed, 'relocated', 'relocatedCwd'),
    newestCwd: newestCwd(tailReversed), // UX wave U8c-2 (§A): the tail only; a head's newest folder in a long file is old
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    firstRecordAt: stringField(firstUuid, 'timestamp'),
    lastRecordAt: stringField(lastUuid, 'timestamp'),
    customTitle: customTitle === '' ? null : customTitle, // an empty custom title is the engine's "clear" (SPEC 35.5.1)
    aiTitle: lastString(tailReversed, 'ai-title', 'aiTitle') ?? lastString(headReversed, 'ai-title', 'aiTitle'),
    // The conversation's first prompt (charter §19, the title rule): the engine's `last-prompt` follows the latest one,
    // a relay's steer included, so it stands in only when the first prompt's record is cut by the head window, and
    // then its earliest copy the windows hold (debt wave 4). Ticket 704: the person's words of each, never MAWS's
    // answer envelope's: a copy with none left is passed over.
    // UX wave U1c (the review round's R3): as typed, so a search for a word the title shows finds it
    firstPrompt: nullable(asTyped, firstUserText(headRecords) ?? firstLastPrompt([...headRecords, ...tailRecords])),
    lastAssistantText: lastAssistant,
    // W9 (H2): the latest the windows hold; HEAD (a non-repository or a detached checkout) or empty is no branch
    gitBranch: branchName(firstString(tailReversed, 'gitBranch') ?? firstString(headReversed, 'gitBranch')),
    engineVersion: firstString(tailReversed, 'version') ?? firstString(headReversed, 'version'), // W13: the latest version that wrote the file
    entrypoint: firstString(headRecords, 'entrypoint') ?? firstString(tailReversed, 'entrypoint'),
    sessionKind,
    hasMessages: headText.includes('"parentUuid":') || tailText.includes('"parentUuid":'),
    leafUuid: (leaf?.uuid as MessageUuid | undefined) ?? null,
    rootUuid: (root?.uuid as MessageUuid | undefined) ?? null, // E3
    birthtimeMs: stat.birthtimeMs, // E3
  };
}

// UX wave U8c-2 (§A): where the agent is, the folder of the newest main-loop row among `records` (given newest first):
// a sidechain row's is an agent's, and bookkeeping rows carry none. A shell `cd` moves no transcript and writes no
// `relocated` row, so the rows' own `cwd` is the one signal of it (spikes/protocol-probe/findings-uxwave-U8-working-folder.txt).
function newestCwd(records: TranscriptRecord[]): string | null {
  for (const record of records) if (record.isSidechain !== true && typeof record.cwd === 'string') return record.cwd;
  return null;
}

// The folder the head window's first record names (what `summarize` files the session under), or null.
export function headCwd(head: Buffer, size: number): string | null {
  return firstString(parseWindow(head.toString('utf8'), { dropLast: size > head.length }), 'cwd');
}

// The top-level `cwd` of the record whose line begins with `start` (a line's first bytes, cut anywhere), or null: the
// fragment scan below reads depth-1 keys only, so a `cwd` inside a tool input is never the record's. A line without the
// key's bytes costs a byte search.
export function lineCwd(start: Buffer): string | null {
  if (start.indexOf('"cwd":"') === -1) return null;
  const cwd = scanRecordStart(start.toString('utf8'))?.cwd;
  return typeof cwd === 'string' ? cwd : null;
}

// Whole lines in the window parse as records. A line cut by the window's edge that begins at a record's start (the
// head window's last line when the file goes on past it; a torn last line of the tail window) still yields its
// top-level string fields by a bounded, structure-aware scan: it walks the fragment tracking JSON string state and
// nesting depth and captures `"<key>":"…"` pairs at depth 1 only, so a long first prompt does not lose the session's
// directory while a `uuid` or `gitBranch` inside a tool input never masquerades as the record's. A fragment that
// begins mid-record (the tail window's cut-off first line) has no establishable depth and contributes nothing. Of the
// non-string values, `"isSidechain": true` at depth 1 is kept too (U8c-2), so a torn agent's row lends no folder.
const FRAGMENT_KEYS: ReadonlySet<string> = new Set(['type', 'uuid', 'cwd', 'version', 'gitBranch', 'entrypoint', 'timestamp', 'sessionId']);

function scanRecordStart(fragment: string): TranscriptRecord | null {
  const text = fragment.replace(/^\0+/, '');
  if (!text.startsWith('{')) return null;
  const fields: Record<string, string> = {};
  let sidechain = false;
  let depth = 0;
  let key: string | null = null; // a depth-1 key whose value is next
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const end = closingQuote(text, i);
      if (end === -1) break; // the cut fell inside a string: nothing further is trustworthy
      const raw = text.slice(i + 1, end);
      i = end + 1;
      if (depth !== 1) continue;
      if (key === null) {
        let j = i;
        while (j < text.length && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r' || text[j] === '\n')) j++;
        if (text[j] === ':') {
          key = raw;
          i = j + 1;
        }
      } else {
        if (FRAGMENT_KEYS.has(key)) {
          try {
            fields[key] = JSON.parse(`"${raw}"`) as string;
          } catch {
            // an invalid escape: leave the field unset
          }
        }
        key = null;
      }
      continue;
    }
    if (c === '{' || c === '[') {
      depth += 1;
      key = null; // a nested value: its keys are not the record's
    } else if (c === '}' || c === ']') {
      depth -= 1;
    } else if (c === ',' && depth === 1) {
      key = null; // a non-string value ended
    } else if (key === 'isSidechain' && depth === 1 && text.startsWith('true', i)) {
      sidechain = true;
    }
    i += 1;
  }
  if (Object.keys(fields).length === 0) return null;
  return { ...fields, type: fields.type ?? 'fragment', ...(sidechain && { isSidechain: true }) };
}

// The index of the quote closing the string that opens at `start`, honouring backslash escapes; -1 when unterminated.
function closingQuote(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '"') return i;
  }
  return -1;
}

function parseWindow(text: string, edges: { dropFirst?: boolean; dropLast?: boolean }): TranscriptRecord[] {
  const lines = text.split('\n');
  if (edges.dropFirst) lines.shift(); // begins mid-record: contributes nothing
  // The window ends on a complete line followed by '\n' (an empty last element), inside a line cut by the window's
  // end, or on a torn last line of the file; the last two begin at a record start.
  let trailing: string | null = null;
  if (edges.dropLast) trailing = lines.pop() ?? null;
  else if (lines.at(-1) === '') lines.pop();
  else trailing = lines.pop() ?? null;
  const records: TranscriptRecord[] = [];
  for (const raw of lines) {
    const record = parseRecord(raw);
    if (record !== null) records.push(record);
  }
  if (trailing !== null) {
    const record = parseRecord(trailing) ?? scanRecordStart(trailing);
    if (record !== null) records.push(record);
  }
  return records;
}

function parseRecord(raw: string): TranscriptRecord | null {
  const line = raw.replace(/^\0+/, '');
  if (line.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const result = TranscriptRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

const isUuidRecord = (record: TranscriptRecord): boolean => typeof record.uuid === 'string';

function stringField(record: TranscriptRecord | null, field: string): string | null {
  const value = record?.[field];
  return typeof value === 'string' ? value : null;
}

function firstString(records: TranscriptRecord[], field: string): string | null {
  for (const record of records) {
    const value = record[field];
    if (typeof value === 'string') return value;
  }
  return null;
}

// The earliest `last-prompt` whose one-line text holds words of the person's (ticket 704): what stands before an answer
// envelope's opening sentence, the rest of the line being the envelope cut near 200 characters (`flatPersonsWords`).
function firstLastPrompt(records: TranscriptRecord[]): string | null {
  for (const record of records) {
    if (record.type !== 'last-prompt' || typeof record.lastPrompt !== 'string') continue;
    const words = flatPersonsWords(record.lastPrompt);
    if (words !== null) return words;
  }
  return null;
}

// The field of the first record of that type in `records`' order: given newest first, the last such record in the
// window.
function lastString(records: TranscriptRecord[], type: string, field: string): string | null {
  for (const record of records) {
    if (record.type !== type) continue;
    const value = record[field];
    if (typeof value === 'string') return value;
  }
  return null;
}

const nullable = (f: (text: string) => string, text: string | null): string | null => (text === null ? null : f(text));

// The engine's head-scanning first-prompt extractor, reduced: skip tool results and meta records, cap at 200 characters.
// Ticket 704: a person's row (no origin, or the person's: the row's form of the split's gate) titles with its words,
// MAWS's answer envelopes read out (`personsWords`); a text of answers alone holds none, and the next text is read.
function firstUserText(records: TranscriptRecord[]): string | null {
  for (const record of records) {
    if (record.type !== 'user' || record.isMeta === true) continue;
    const content = (record.message as { content?: unknown } | undefined)?.content;
    if (isNoContent(content)) continue; // P5 O9: the engine's word for a message with none titles nothing
    const words = isPersonsRow(record) ? personsWords : (text: string) => text;
    if (typeof content === 'string') {
      // A bash-mode prompt stores its command in tags; it titles as the terminal shows it, `! <command>` (debt wave 4)
      const bash = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(content);
      if (bash) return `! ${bash[1]}`.slice(0, TEXT_CAP);
      const text = content.length > 0 ? words(content) : null;
      if (text !== null) return text.slice(0, TEXT_CAP);
      continue;
    }
    if (Array.isArray(content)) {
      // W11 (I1): an empty text block (beside an image, say) is no prompt; the record's first block with words is
      for (const block of content) {
        if (!isBlock(block) || block.type !== 'text' || typeof block.text !== 'string' || block.text.trim() === '') continue;
        const text = words(block.text);
        if (text !== null) return text.slice(0, TEXT_CAP);
      }
    }
  }
  return null;
}

const isPersonsRow = (record: TranscriptRecord): boolean => {
  const origin = record.origin as { kind?: unknown } | null | undefined;
  return origin === null || origin === undefined || typeof origin !== 'object' || origin.kind === 'human';
};

function assistantText(record: TranscriptRecord): string | null {
  if (record.type !== 'assistant') return null;
  const content = (record.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  const text = content.find((block): block is { type: 'text'; text: string } => isBlock(block) && block.type === 'text' && typeof block.text === 'string');
  return text ? previewLine(text.text, TEXT_CAP) : null; // E11 F2b: the owner-aware preview, chosen before the cap
}

// The newest assistant line among `records` (given newest first): an assistant text's preview, or (P4-R7) an accepted
// message tool call's message (`@shared/owner/message-call`), whichever is later. A call's result is written after
// it, so walking newest first meets the result before the call; a call whose result the window does not hold is not
// taken. The to-human plugin's made-up answer after a final message said nothing, so the line is older than it.
function lastAssistantLine(records: TranscriptRecord[]): string | null {
  const refused = new Map<string, boolean>(); // tool-use id → whether its result is an error
  for (const record of records) {
    if (isMadeUpFinalAnswer(record)) continue;
    const content = (record.message as { content?: unknown } | undefined)?.content;
    const blocks = (Array.isArray(content) ? content.filter(isBlock) : []) as CallBlock[];
    if (record.type === 'user') {
      for (const block of blocks) if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') refused.set(block.tool_use_id, block.is_error === true);
      continue;
    }
    const call = record.type === 'assistant' ? blocks.findLast((block) => block.type === 'tool_use' && isMessageTool(block.name)) : undefined;
    const message = call !== undefined && typeof call.id === 'string' && refused.get(call.id) === false ? messageCallText(call.input) : null;
    const line = (message === null ? null : messageLine(message, TEXT_CAP)) ?? assistantText(record);
    if (line !== null) return line;
  }
  return null;
}
type CallBlock = { type: string; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; is_error?: unknown };

const isBlock = (value: unknown): value is { type: string; text?: unknown } =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
