// Discovery's head/tail summary of a transcript (C4 execution document, M1; SPEC 35.14.2): what the engine's own
// session picker learns from the first and last 64 KiB without parsing the whole file. Which window each fact comes
// from follows the engine's table; the windows are split into lines and parsed as records (the partial line at a
// window's cut edge is dropped), rather than scanned for byte needles, because 64 KiB parses in well under a
// millisecond and a parsed record cannot be fooled by a value inside a torn line.
import { basename } from 'node:path';
import type { MessageUuid, SessionId } from '@shared/graph/ids';
import { branchName } from '@shared/sessions/branch';
import type { TranscriptSummary } from '@shared/wire/store';
import { TranscriptRecordSchema, type TranscriptRecord } from '@shared/wire/transcript';

export const HEAD_TAIL_BYTES = 64 * 1024;
const TEXT_CAP = 200;
const SESSION_KINDS = ['bg', 'daemon', 'daemon-worker'] as const;

export function summarize(
  head: Buffer,
  tail: Buffer,
  stat: { size: number; mtimeMs: number },
  path: string,
  slug: string,
  sidecarTitle: string | null = null, // `custom-title.json`'s `customTitle`, which discovery reads beside the transcript (M2)
): TranscriptSummary {
  const headText = head.toString('utf8');
  const tailText = tail.toString('utf8');
  const headRecords = parseWindow(headText, { dropLast: stat.size > head.length });
  const tailRecords = parseWindow(tailText, { dropFirst: stat.size > tail.length });
  const tailReversed = [...tailRecords].reverse();
  const headReversed = [...headRecords].reverse();

  const firstUuid = headRecords.find(isUuidRecord) ?? tailRecords.find(isUuidRecord) ?? null;
  const lastUuid = tailReversed.find(isUuidRecord) ?? headReversed.find(isUuidRecord) ?? null;
  const leaf = tailReversed.find((r) => isUuidRecord(r) && r.type !== 'progress') ?? headReversed.find((r) => isUuidRecord(r) && r.type !== 'progress') ?? null;
  const lastAssistant = tailReversed.map(assistantText).find((text) => text !== null) ?? headReversed.map(assistantText).find((text) => text !== null) ?? null;

  // SPEC 35.14.3: the tail record, else the sidecar, else the head record.
  const customTitle = lastString(tailReversed, 'custom-title', 'customTitle') ?? sidecarTitle ?? lastString(headReversed, 'custom-title', 'customTitle');
  const firstWithParent = headRecords.find((r) => 'parentUuid' in r) ?? tailRecords.find((r) => 'parentUuid' in r);
  const sessionKind = SESSION_KINDS.find((kind) => kind === firstWithParent?.sessionKind) ?? null;

  return {
    sessionId: basename(path, '.jsonl') as SessionId,
    transcriptPath: path,
    slug,
    directory: firstString(headRecords, 'cwd'),
    relocatedCwd: lastString(tailReversed, 'relocated', 'relocatedCwd'),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    firstRecordAt: stringField(firstUuid, 'timestamp'),
    lastRecordAt: stringField(lastUuid, 'timestamp'),
    customTitle: customTitle === '' ? null : customTitle, // an empty custom title is the engine's "clear" (SPEC 35.5.1)
    aiTitle: lastString(tailReversed, 'ai-title', 'aiTitle') ?? lastString(headReversed, 'ai-title', 'aiTitle'),
    // The conversation's first prompt (charter §19, the title rule): the engine's `last-prompt` follows the latest one,
    // a relay's steer included, so it stands in only when the first prompt's record is cut by the head window, and
    // then its earliest copy the windows hold (debt wave 4).
    firstPrompt: firstUserText(headRecords) ?? firstOfType([...headRecords, ...tailRecords], 'last-prompt', 'lastPrompt'),
    lastAssistantText: lastAssistant,
    // W9 (H2): the latest the windows hold; HEAD (a non-repository or a detached checkout) or empty is no branch
    gitBranch: branchName(firstString(tailReversed, 'gitBranch') ?? firstString(headReversed, 'gitBranch')),
    engineVersion: firstString(headRecords, 'version') ?? firstString(tailReversed, 'version'),
    entrypoint: firstString(headRecords, 'entrypoint') ?? firstString(tailReversed, 'entrypoint'),
    sessionKind,
    hasMessages: headText.includes('"parentUuid":') || tailText.includes('"parentUuid":'),
    leafUuid: (leaf?.uuid as MessageUuid | undefined) ?? null,
  };
}

// Whole lines in the window parse as records. A line cut by the window's edge that begins at a record's start (the
// head window's last line when the file goes on past it; a torn last line of the tail window) still yields its
// top-level string fields by a bounded, structure-aware scan: it walks the fragment tracking JSON string state and
// nesting depth and captures `"<key>":"…"` pairs at depth 1 only, so a long first prompt does not lose the session's
// directory while a `uuid` or `gitBranch` inside a tool input never masquerades as the record's. A fragment that
// begins mid-record (the tail window's cut-off first line) has no establishable depth and contributes nothing.
const FRAGMENT_KEYS: ReadonlySet<string> = new Set(['type', 'uuid', 'cwd', 'version', 'gitBranch', 'entrypoint', 'timestamp', 'sessionId']);

function scanRecordStart(fragment: string): TranscriptRecord | null {
  const text = fragment.replace(/^\0+/, '');
  if (!text.startsWith('{')) return null;
  const fields: Record<string, string> = {};
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
    }
    i += 1;
  }
  if (Object.keys(fields).length === 0) return null;
  return { ...fields, type: fields.type ?? 'fragment' };
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

// The field of the first record of that type in `records`' order: given newest first, the last such record in the
// window (`lastString`); given in file order, the earliest (`firstOfType`).
const firstOfType = (records: TranscriptRecord[], type: string, field: string): string | null => lastString(records, type, field);
function lastString(records: TranscriptRecord[], type: string, field: string): string | null {
  for (const record of records) {
    if (record.type !== type) continue;
    const value = record[field];
    if (typeof value === 'string') return value;
  }
  return null;
}

// The engine's head-scanning first-prompt extractor, reduced: skip tool results and meta records, cap at 200 characters.
function firstUserText(records: TranscriptRecord[]): string | null {
  for (const record of records) {
    if (record.type !== 'user' || record.isMeta === true) continue;
    const content = (record.message as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string') {
      // A bash-mode prompt stores its command in tags; it titles as the terminal shows it, `! <command>` (debt wave 4)
      const bash = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(content);
      if (bash) return `! ${bash[1]}`.slice(0, TEXT_CAP);
      if (content.length > 0) return content.slice(0, TEXT_CAP);
      continue;
    }
    if (Array.isArray(content)) {
      const text = content.find((block): block is { type: 'text'; text: string } => isBlock(block) && block.type === 'text' && typeof block.text === 'string');
      if (text) return text.text.slice(0, TEXT_CAP);
    }
  }
  return null;
}

function assistantText(record: TranscriptRecord): string | null {
  if (record.type !== 'assistant') return null;
  const content = (record.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  const text = content.find((block): block is { type: 'text'; text: string } => isBlock(block) && block.type === 'text' && typeof block.text === 'string');
  return text ? text.text.slice(0, TEXT_CAP) : null;
}

const isBlock = (value: unknown): value is { type: string; text?: unknown } =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
