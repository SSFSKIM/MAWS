// Question sheet records for tests (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §E): a fixture of
// the pinned set seeded under a scratch sminos home, and a fixture's outcome staged for the stand-in door
// (test/support/fake-sminos-cli.mjs) to replay. The fixtures are read in place and never edited.
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, renameSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHEET_FIXTURES = join(__dirname, '../fixtures/sheet/set/fixtures');
export const FAKE_SMINOS = join(__dirname, 'fake-sminos-cli.mjs');

export const fixtureCases = (): string[] => readdirSync(SHEET_FIXTURES).sort();
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
export const fixtureSession = (name: string): string => (readJson(join(SHEET_FIXTURES, name, 'case.json')) as { session: string }).session;

/**
 * A seeded record: a fixture's `before` record under `<home>/sheet/`, its inbox cut to the offset its `state.json`
 * records. A fixture's `before` holds the inbox lines its step is about to apply; copied whole, those answers would
 * already stand queued. `as` seeds it as another session's record (its directory and its `state.json`'s `session`), so
 * one fixture can stand for two sessions of a launch. Answers the record's session.
 */
export function seedRecord(home: string, name: string, side: 'before' | 'after' = 'before', as?: string): string {
  const fixture = fixtureSession(name);
  const session = as ?? fixture;
  const from = join(SHEET_FIXTURES, name, side, 'sheet', fixture);
  const record = join(home, 'sheet', session);
  mkdirSync(join(home, 'sheet'), { recursive: true });
  cpSync(from, record, { recursive: true });
  const state = readJson(join(record, 'state.json')) as { inbox: { offset: number }; session: string };
  if (as !== undefined) writeFileSync(join(record, 'state.json'), JSON.stringify({ ...state, session }));
  const { inbox } = state;
  try {
    truncateSync(join(record, 'inbox.jsonl'), inbox.offset);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return session;
}

/** A fixture's `after` staged for the stand-in door: its `state.json`, and its own keys in inbox order (`keys.json`). */
export function stageOutcome(home: string, name: string, keys: readonly string[]): void {
  const session = fixtureSession(name);
  const next = join(home, 'sheet', `${session}.next`);
  mkdirSync(next, { recursive: true });
  copyFileSync(join(SHEET_FIXTURES, name, 'after', 'sheet', session, 'state.json'), join(next, 'state.json'));
  writeFileSync(join(next, 'keys.json'), JSON.stringify(keys));
}

type StoredState = { seq: number; nextId: number; questions: Record<string, unknown>[]; closed: Record<string, unknown> } & Record<string, unknown>;

/**
 * A step of the tool's own, done to a seeded record by a test: `edit` gives the record's next `state.json` (its `seq`
 * moved on here), which replaces the old one by a rename as the tool writes it, so no reader sees half of it. No fixture
 * of the pinned set has a question open on one side and added or withdrawn on the other; a test that needs one derives
 * it from a seeded record with these steps (`asked`, `withdrawn`), in the record's own shapes.
 */
export function rewriteState(home: string, session: string, edit: (state: StoredState) => StoredState): void {
  const file = join(home, 'sheet', session, 'state.json');
  const state = readJson(file) as StoredState;
  const temporary = join(home, 'sheet', session, '.state.rewrite.json');
  writeFileSync(temporary, JSON.stringify({ ...edit(state), seq: state.seq + 1 }));
  renameSync(temporary, file);
}

/** A question asked by a later call: the last question's shape, under the record's next id. */
export const asked = (question: string, at: string, callId: string) => (state: StoredState): StoredState => ({
  ...state,
  nextId: state.nextId + 1,
  questions: [...state.questions, { ...state.questions.at(-1), id: `q${state.nextId}`, revision: 1, question, askedAt: at, callId, references: [] }],
});

/** An open question withdrawn: out of `questions`, into `closed` as `withdrawn`. */
export const withdrawn = (id: string, at: string) => (state: StoredState): StoredState => {
  const { asker, header, question, revision } = state.questions.find((q) => q.id === id) as { asker: unknown; header?: string; question: string; revision: number };
  return { ...state, questions: state.questions.filter((q) => q.id !== id), closed: { ...state.closed, [id]: { asker, at, ...(header !== undefined && { header }), how: 'withdrawn', question, revision } } };
};

type Asker = 'main' | { agentId: string; name: string };
type Stored = { id: string; asker: Asker; header?: string; question: string; revision: number; options: { label: string }[] };
const take = (state: StoredState, id: string) => state.questions.find((q) => q.id === id) as unknown as Stored;
const closing = (state: StoredState, id: string, entry: Record<string, unknown>): StoredState => {
  const { asker, header, question, revision } = take(state, id);
  return { ...state, questions: state.questions.filter((q) => q.id !== id), closed: { ...state.closed, [id]: { asker, ...(header !== undefined && { header }), question, revision, ...entry } } };
};

/** Every open question made the main conversation's, asked by the one call `callId` (a call that asked them together). */
export const oneCall = (callId: string) => (state: StoredState): StoredState => ({ ...state, questions: state.questions.map((q) => ({ ...q, callId, asker: 'main' })) });

/** An open question rewritten by its asker: its next revision, in new words. */
export const revised = (id: string, question: string) => (state: StoredState): StoredState => ({
  ...state,
  questions: state.questions.map((q) => (q.id === id ? { ...q, question, revision: (q.revision as number) + 1 } : q)),
});

/** An open question answered with `picks` (its labels) and delivered: out of `questions`, into `closed` with its receipt. */
export const closedAnswered = (id: string, picks: string[], key: string, at: string) => (state: StoredState): StoredState => {
  const { options } = take(state, id);
  const places = picks.map((pick) => options.findIndex((option) => option.label === pick) + 1);
  return closing(state, id, { how: 'answered', at, key, places, receipt: picks.join(', ') });
};

/** An open question dismissed by the person and delivered: into `closed` as `dismissed`. */
export const closedDismissed = (id: string, key: string, at: string) => (state: StoredState): StoredState => closing(state, id, { how: 'dismissed', at, key });

