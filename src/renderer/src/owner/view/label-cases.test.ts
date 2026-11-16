// The shared table of which run a record line reads (UX wave U2b; the execution document, Interfaces §M, "Which run a
// line reads", and §I's item 13; decision 31; acceptance A15's words): `fold-label-cases.json` is a byte-for-byte copy
// of the to-human mod's `to-human/tests/mods/fold-label-cases.json`, taken from the mod's branch at e511aad9 and never
// edited here. The mod's own script (`fold-label-cases.ts`) runs every case through its `labelOf`; this one runs every
// case through MAWS's `labelsOf`, over rows built from the case, and both pin the same digest, so a copy that differs
// fails here and in the mod's suite.
//
// How a case becomes MAWS's rows: a row of class `user` is a prompt; `marked` a text whose words are all one message; a
// `record` row with a call is a single call (`Bash`, its description the case's line, its result in when `done`); a
// `record` row with no call is a thought (`t…`), a notice the host made (an id asked under its anchor, `…~…`), or a note
// (a text with no message). A row "drawn without a place" is a row MAWS holds under another id than the one the file
// names, which is how a row can have no place for MAWS: every row MAWS holds has one. The file holds what the tracker
// keeps of an open run (`stored`, folds.tsx 442): its summary bounded by the last row it covered, and nothing while it
// has none; MAWS never reads the open run itself (§M, clause 2), and reads the turn running as the case says.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { StoredRun } from '@shared/owner/folds';
import type { TurnState } from '../../transcript/model/reduce';
import type { Row, TurnId } from '../../transcript/model/rows';
import { labelsOf } from './label';
import { stretchesOf } from './mirror';

/** The digest the mod's branch pins (to-human/tests/mods/fold-label-cases.ts at e511aad9). */
const FOLD_LABEL_CASES_SHA256 = 'c65988f084c0978b3f79eab220ae02f3ef7175f2717ea225ff421557f9c0fa94';

type CaseRow = { id: string; class: 'user' | 'marked' | 'mixed' | 'record'; placed: boolean; call?: { line: string; done: boolean } };
interface Case {
  name: string;
  rows: CaseRow[];
  closed: StoredRun[];
  open: { first: string; summary?: string; covered?: string } | null;
  running: boolean;
  labels: Record<string, string | null>;
}

const bytes = readFileSync(join(__dirname, 'fold-label-cases.json'));
const { cases } = JSON.parse(bytes.toString('utf8')) as { cases: Case[] };

const T = 'turn:cases' as TurnId;
const AT = '2026-11-16T10:00:00.000Z';
const base = (id: string) => ({ id, turnId: T, at: AT });

// One case's rows as MAWS holds them, each with the case's id it stands for, and the turn's events behind its calls.
function built(c: Case): { rows: Row[]; ids: Map<Row, string>; turn: TurnState } {
  const events: SessionEvent[] = [];
  const ids = new Map<Row, string>();
  const rows = c.rows.map((at, i): Row => {
    const kept = at.placed ? at.id : `${at.id}-drawn-elsewhere`;
    let row: Row;
    if (at.class === 'user') row = { ...base(`user:${i}`), kind: 'user', messageUuid: kept, text: 'Go on.', attachments: [], placeholders: [], lines: 1, editable: false, steer: false, dropped: false } as unknown as Row;
    else if (at.class === 'marked') row = { ...base(`text:a${i}:0`), kind: 'assistant_text', messageUuid: kept, blockIndex: 0, markdown: '<message>Noted.</message>', live: false, phase: 'answer', model: null } as unknown as Row;
    else if (at.call !== undefined) {
      events.push({ id: `use${i}`, kind: 'tool.use', toolUseId: kept, toolName: 'Bash', input: { command: 'true', description: at.call.line }, apiMessageId: null, messageUuid: null } as unknown as SessionEvent);
      if (at.call.done) events.push({ id: `result${i}`, kind: 'tool.result', toolUseId: kept, content: 'ok', isError: false } as unknown as SessionEvent);
      row = { ...base(`cell:${kept}`), kind: 'cell', toolUseId: kept, toolName: 'Bash', status: at.call.done ? 'done' : 'running', background: false } as unknown as Row;
    } else if (at.id.includes('~')) row = { ...base(`notice:${i}`), kind: 'notice', class: 'schedule', outcome: null, text: 'The nightly report is due.', durationMs: null, detail: null, taskId: null, toolUseId: null, outputFile: null } as unknown as Row;
    else if (at.id.startsWith('t')) row = { ...base(`think:${i}`), kind: 'thinking', messageUuid: kept, text: 'Weighing the options.', live: false, durationMs: null, recordedMs: null } as unknown as Row;
    else row = { ...base(`text:n${i}:0`), kind: 'assistant_text', messageUuid: kept, blockIndex: 0, markdown: 'Looking at the files.', live: false, phase: 'commentary', model: null } as unknown as Row;
    ids.set(row, at.id);
    return row;
  });
  const turn = { id: T, events, live: new Map() } as unknown as TurnState;
  return { rows, ids, turn };
}

// What the file holds of the case's runs: the closed ones, then the open one's summary bounded by what it covered.
const storedOf = (c: Case): StoredRun[] => [...c.closed, ...(c.open?.summary !== undefined ? [{ first: c.open.first, last: c.open.covered ?? c.open.first, summary: c.open.summary }] : [])];

describe('the shared table of cases: which run a record line reads, as the to-human mod reads it', () => {
  it('is the mod’s copy, byte for byte: its sha256 is the one the mod’s branch pins', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(FOLD_LABEL_CASES_SHA256);
    expect(cases.length).toBeGreaterThanOrEqual(17);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { rows, ids, turn } = built(c);
    const stretches = stretchesOf(rows);
    // the stretches begin where the case says, as the mod's script checks first
    expect(stretches.map((stretch) => ids.get(stretch.head ?? stretch.rows[0]!))).toEqual(Object.keys(c.labels));
    const label = labelsOf(rows, { stored: storedOf(c), running: c.running, turns: new Map([[T, turn]]) })!;
    const read = Object.fromEntries(stretches.map((stretch, i) => [ids.get(stretch.head ?? stretch.rows[0]!), label(stretch, i === stretches.length - 1) ?? null]));
    expect(read).toEqual(c.labels);
  });
});
