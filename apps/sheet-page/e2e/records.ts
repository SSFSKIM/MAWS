// Records under the rig's scratch sminos home (§Q; C3's §E): a fixture of the pin seeded as C3 seeds one, a fixture's
// outcome staged for the stand-in door, and records a spec builds from a fixture's own in the scratch home (the pin's
// copy is never edited): one under another session's name, one whose questions the spec writes. A record's state is
// replaced as the door replaces it, whole, so a reader never sees half of it.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureSession, SHEET_FIXTURES } from '../../../test/support/sheet-records';

export { fixtureSession, seedRecord, stageOutcome } from '../../../test/support/sheet-records';

export const REFERENCES = '5eed0000-0000-4000-8000-000000000019'; // the pin's `references`: two questions, one with three files

export interface State {
  session: string;
  seq: number;
  inbox: { offset: number };
  questions: Question[];
  closed: Record<string, unknown>;
  [rest: string]: unknown;
}
export interface Question {
  id: string;
  revision: number;
  question: string;
  header?: string;
  options: { label: string; description?: string; recommended?: boolean; preview?: string }[];
  multiSelect: boolean;
  context?: string;
  references: unknown[];
  asker: unknown;
  askedAt: string;
  callId: string;
  [rest: string]: unknown;
}

const recordOf = (home: string, session: string) => join(home, 'sheet', session);
export const stateOf = (home: string, session: string): State => JSON.parse(readFileSync(join(recordOf(home, session), 'state.json'), 'utf8')) as State;

/** The record's state replaced whole, its `seq` moved on, as the door replaces it. */
export function writeState(home: string, session: string, state: State): void {
  const file = join(recordOf(home, session), 'state.json');
  writeFileSync(`${file}.next`, JSON.stringify({ ...state, seq: state.seq + 1 }));
  renameSync(`${file}.next`, file);
}

/** A fixture's record (its `before` unless told) under another session's name, its inbox empty. */
export function copyRecord(home: string, fixture: string, session: string, side: 'before' | 'after' = 'before'): string {
  const record = recordOf(home, session);
  cpSync(join(SHEET_FIXTURES, fixture, side, 'sheet', fixtureSession(fixture)), record, { recursive: true });
  writeFileSync(join(record, 'inbox.jsonl'), '');
  const state = JSON.parse(readFileSync(join(record, 'state.json'), 'utf8')) as State;
  writeFileSync(join(record, 'state.json'), JSON.stringify({ ...state, session, inbox: { ...state.inbox, offset: 0 }, verdicts: {}, pending: [] }));
  return session;
}

/** A record whose open questions are these, built on a fixture's (`references`, whose captured files it keeps). */
export function questionRecord(home: string, session: string, questions: Question[], fixture = 'references'): string {
  copyRecord(home, fixture, session);
  const state = stateOf(home, session);
  writeFileSync(join(recordOf(home, session), 'state.json'), JSON.stringify({ ...state, questions, closed: {}, nextId: questions.length + 1 }));
  return session;
}

/** A question of the pin's form, `n` its number */
export function question(n: number, rest: Partial<Question> = {}): Question {
  return {
    id: `q${n}`,
    revision: 1,
    asker: 'main',
    askedAt: `2026-11-24T09:${String(n).padStart(2, '0')}:00.000Z`,
    callId: `toolu_01Page${String(n).padStart(4, '0')}`,
    header: `Header ${n}`,
    question: `Which way should part ${n} go?`,
    options: [{ label: `Way ${n}a`, recommended: true }, { label: `Way ${n}b` }],
    multiSelect: false,
    references: [],
    ...rest,
  };
}

export const inboxOf = (home: string, session: string): Record<string, unknown>[] => {
  const file = join(recordOf(home, session), 'inbox.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};
export const inboxBytes = (home: string, session: string): string => {
  const file = join(recordOf(home, session), 'inbox.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};
export const uploadsOf = (home: string, session: string): string[] => {
  const dir = join(recordOf(home, session), 'uploads');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
export const removeRecord = (home: string, session: string): void => rmSync(recordOf(home, session), { recursive: true, force: true });
export const ensureSheetDir = (home: string): void => void mkdirSync(join(home, 'sheet'), { recursive: true });
