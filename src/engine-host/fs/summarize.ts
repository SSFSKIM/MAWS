// Discovery's head/tail summary of a transcript (C4 execution document, M1; SPEC 35.14.2): what the engine's own
// session picker learns from the first and last 64 KiB without parsing the whole file. Which window each fact comes
// from follows the engine's table; the windows are split into lines and parsed as records (the partial line at a
// window's cut edge is dropped), rather than scanned for byte needles, because 64 KiB parses in well under a
// millisecond and a parsed record cannot be fooled by a value inside a torn line.
import { basename } from 'node:path';
import type { MessageUuid, SessionId } from '@shared/graph/ids';
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

  const customTitle = lastString(tailReversed, 'custom-title', 'customTitle') ?? lastString(headReversed, 'custom-title', 'customTitle');
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
    firstPrompt: lastString(tailReversed, 'last-prompt', 'lastPrompt') ?? firstUserText(headRecords),
    lastAssistantText: lastAssistant,
    gitBranch: firstString(tailReversed, 'gitBranch') ?? firstString(headReversed, 'gitBranch'),
    engineVersion: firstString(headRecords, 'version') ?? firstString(tailReversed, 'version'),
    entrypoint: firstString(headRecords, 'entrypoint') ?? firstString(tailReversed, 'entrypoint'),
    sessionKind,
    hasMessages: headText.includes('"parentUuid":') || tailText.includes('"parentUuid":'),
    leafUuid: (leaf?.uuid as MessageUuid | undefined) ?? null,
  };
}

function parseWindow(text: string, edges: { dropFirst?: boolean; dropLast?: boolean }): TranscriptRecord[] {
  const lines = text.split('\n');
  if (edges.dropFirst) lines.shift();
  // The window ends either on a complete line followed by '\n' (an empty last element) or inside a line.
  if (edges.dropLast || lines.at(-1) === '') lines.pop();
  const records: TranscriptRecord[] = [];
  for (const raw of lines) {
    const line = raw.replace(/^\0+/, '');
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const result = TranscriptRecordSchema.safeParse(parsed);
    if (result.success) records.push(result.data);
  }
  return records;
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

// `records` is given newest first; the first match is the last record of that type in the window.
function lastString(reversed: TranscriptRecord[], type: string, field: string): string | null {
  for (const record of reversed) {
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
