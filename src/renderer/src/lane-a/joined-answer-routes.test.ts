// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M2; Acceptance 1, 2, 3, 4, 5, 7 and 8): where the
// engine joined MAWS's answer envelope and the person's prompt into one user message, the producers tell it as the
// person's message and, directly after it under the same uuid, one message per envelope, on every route. The probes'
// recordings are drawn as arrival-routes.test.ts draws one: from the engine's file through the chain follower, from the
// same rows through the reader of another machine's rows (`freshSource`), and from the journal through the engine
// host's normaliser. What only the live wire carries (`joined`, `isReplay`) is stated where the events are compared.
// The cases no recording holds are made by hand in the recorded form, and say so. It lives beside the reader of another
// machine's rows: it reads the composer's stack, recall and Edit's prefill, whose graph is the renderer's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { anchoredMessage } from '@shared/anchor/message';
import { splitPersonsMessage } from '@shared/engine/persons-message';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { MessageUuid, SessionId } from '@shared/graph/ids';
import { askSteerText, parseAskSteer } from '@shared/maws/ask';
import type { AskQuestion } from '@shared/maws/tools';
import { TranscriptRecordSchema } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../../engine-host/fs/backfill';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { PROBE_CONTROLS, PROBE_JOINS, U4B_JOINS, recordedJoin, type Content } from '../../../../test/support/recorded-joins';
import { recallEntries, recallText } from '../composer/editor/history';
import { typedFromRowText } from '../composer/editor/recall';
import { rowPrefill } from '../composer/edit-prefill';
import { rowText, stackRows } from '../composer/queue/stack';
import { initiatingPrompt } from '../request-card/initiating-prompt';
import { journalToEvents } from '../transcript/dev/journal';
import { turnActivity } from '../transcript/model/activity';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState, type TranscriptState } from '../transcript/model/reduce';
import type { Row } from '../transcript/model/rows';
import { copiedUserText } from '../transcript/model/user-text';
import { userInput } from '../transcript/surface/adapters';
import { rewindTargets } from '../widgets/RewindWidget';
import { freshSource, subagentLookupOf } from './plane-transcript';
import { Chain } from './test-support/chain-rows';

type UserRow = Extract<Row, { kind: 'user' }>;
type AskRow = Extract<Row, { kind: 'ask' }>;
type UserEvent = Extract<SessionEvent, { kind: 'user.message' }>;

const recorded = (name: string): string => readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.transcript.jsonl`), 'utf8');
const rowsIn = (text: string): JsonObject[] => text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject);
/** The recording's own session id, as M1 froze build G's events under it. */
const sessionOf = (text: string): string => rowsIn(text).map((row) => row.sessionId).find((id): id is string => typeof id === 'string')!;
const frozen = (name: string, kind: 'events' | 'backfill'): SessionEvent[] => JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.base-${kind}.json`), 'utf8')) as SessionEvent[];

/** The file route: the chain follower over the file's bytes, as `session.events` answers for a session nobody holds. */
async function fromFile(text: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), sessionOf(text) as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}
/** The remote route: the same rows, each with its uuid, through the reader of another machine's rows. */
const fromRows = (text: string): Promise<SessionEvent[]> => freshSource(rowsIn(text).filter((row) => typeof row.uuid === 'string'), sessionOf(text), subagentLookupOf([])).snapshot();
/** The live route: the journal through the engine host's normaliser, as a session MAWS runs reaches the window. */
const fromJournal = (name: string): SessionEvent[] => journalToEvents(loadUxwaveJournal(name));

const stateOf = (events: SessionEvent[]): TranscriptState => applyEvents(createState(null, null), events);
const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
const users = (rows: Row[]) => rows.filter((row): row is UserRow => row.kind === 'user');
const asks = (rows: Row[]) => rows.filter((row): row is AskRow => row.kind === 'ask');
const messages = (events: SessionEvent[]) => events.filter((event): event is UserEvent => event.kind === 'user.message');
const textOf = (content: Content) => (typeof content === 'string' ? content : content.flatMap((block) => (block.type === 'text' ? [String(block.text)] : [])).join('\n\n'));
const holdsEnvelope = (text: string) => text.includes('[MAWS ask') || text.includes('```json');
// the prompt as its row draws it: its text, and the image beside it where it carried one (probe 3)
const promptText = (prompt: Content) => textOf(prompt);
const attachmentKinds = (prompt: Content) => (typeof prompt === 'string' ? [] : prompt.flatMap((block) => (block.type === 'text' ? [] : ['image'])));

/** What the producers tell a joined message as, in order: the person's part, then each envelope. */
const toldAs = (name: string): Content[] => {
  const { prompt, envelopes } = recordedJoin(name);
  return prompt === null ? envelopes : [prompt, ...envelopes];
};
/** The events from `at` on, as many as the joined message is told as. */
const runFrom = (events: SessionEvent[], at: number, name: string) => events.slice(at, at + toldAs(name).length) as UserEvent[];

// ---------------------------------------------------------------------------------------------------------------------
// The events, live (Acceptance 1)

describe('the live wire: a joined message is the person’s message, then each envelope under the same uuid (Acceptance 1)', () => {
  describe.each([...PROBE_JOINS, ...U4B_JOINS])('%s', (name) => {
    const { joined, members, envelopes } = recordedJoin(name);
    const events = fromJournal(name);

    it('the replay’s first event holds the person’s part and `joined` naming the other members; each envelope follows it, whole, and nothing else does', () => {
      const at = events.findIndex((event) => event.kind === 'user.message' && event.joined !== undefined);
      expect(at).toBeGreaterThanOrEqual(0);
      const run = runFrom(events, at, name);
      expect(run.map((event) => [event.kind, event.messageUuid, event.content])).toEqual(toldAs(name).map((content) => ['user.message', joined.uuid, content]));
      expect(run[0]!.joined).toEqual(members.slice(0, -1).map((member) => member.uuid));
      // what only the live wire carries: the replay's mark on each, `joined` on the first alone
      expect(run.map((event) => [event.isReplay, event.origin, event.isSynthetic, 'joined' in event])).toEqual(run.map((_, i) => [true, 'human', false, i === 0]));
      for (const envelope of envelopes) expect(parseAskSteer(envelope)).not.toBeNull();
    });

    it('no user message holds text of both: every one that holds an envelope is that envelope alone', () => {
      for (const message of messages(events)) if (holdsEnvelope(textOf(message.content))) expect(envelopes).toContainEqual(message.content);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The events, from the file and from another machine's rows (Acceptance 2)

describe('the file and another machine’s rows: the same pair for the joined line, with the file’s ids and no `joined` (Acceptance 2)', () => {
  describe.each(PROBE_JOINS)('%s', (name) => {
    const { joined } = recordedJoin(name);
    const text = recorded(name);
    const before = frozen(name, 'backfill');
    // the joined line's message as build G's backfill made it: the joined text whole
    const whole = before.find((event): event is UserEvent => event.kind === 'user.message' && event.messageUuid === joined.uuid && holdsEnvelope(textOf(event.content)))!;
    // the row's events before this landing: the ordinals the envelopes come after
    const ordinals = before.filter((event) => event.id === joined.uuid || event.id.startsWith(`${joined.uuid}#`)).length;

    it('from the file: the person’s part under the line’s id, then each envelope under the row’s next ordinals; every other event as build G made it', async () => {
      const events = await fromFile(text);
      const at = events.findIndex((event) => event.id === whole.id);
      const run = runFrom(events, at, name);
      expect(run.map((event) => [event.kind, event.messageUuid, event.content])).toEqual(toldAs(name).map((content) => ['user.message', joined.uuid, content]));
      expect(run.map((event) => event.id)).toEqual([whole.id, ...run.slice(1).map((_, k) => `${joined.uuid}#${ordinals + k}`)]);
      // what the file does not carry: no `joined`, no replay
      expect(run.map((event) => ['joined' in event, event.isReplay, event.origin])).toEqual(run.map(() => [false, false, 'human']));
      // no existing id moves: the split taken back, the events are build G's
      expect([...events.slice(0, at), { ...run[0]!, content: whole.content }, ...events.slice(at + run.length)]).toEqual(before);
    });

    it('from the same rows, as another machine sends them: the same pair as the file', async () => {
      const file = await fromFile(text);
      const rows = await fromRows(text);
      const fileAt = file.findIndex((event) => event.id === whole.id);
      const rowsAt = rows.findIndex((event) => event.id === whole.id);
      expect(runFrom(rows, rowsAt, name)).toEqual(runFrom(file, fileAt, name));
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The person's row and the capsule on each road (Acceptance 3 and 4)

const ROADS = ['journal', 'file', 'rows'] as const;
type Road = (typeof ROADS)[number];
async function eventsOn(name: string, road: Road): Promise<SessionEvent[]> {
  if (road === 'journal') return fromJournal(name);
  return road === 'file' ? fromFile(recorded(name)) : fromRows(recorded(name));
}
const summary = (rows: Row[]) => ({
  users: users(rows).map((row) => [row.messageUuid, row.text, row.attachments.map((attachment) => attachment.kind)]),
  asks: asks(rows).map((row) => [row.askId, row.state, row.answers]),
});

describe('the person’s row and the capsule, drawn from each road (Acceptance 3 and 4)', () => {
  const CASES: [string, Road][] = [...PROBE_JOINS.flatMap((name) => ROADS.map((road): [string, Road] => [name, road])), ...U4B_JOINS.map((name): [string, Road] => [name, 'journal'])];

  describe.each(CASES)('%s, from the %s', (name, road) => {
    const { joined, envelopes, prompt } = recordedJoin(name);

    it('one user row for the joined message, under the last-written uuid, its text exactly the prompt; Copy, Edit’s prefill and the up-arrow’s entry the same', async () => {
      const state = stateOf(await eventsOn(name, road));
      const own = users(drawn(state)).filter((row) => row.messageUuid === joined.uuid);
      if (prompt === null) {
        expect(own).toEqual([]); // envelopes alone, each answered here: no bubble
        return;
      }
      expect(own).toHaveLength(1);
      const [row] = own;
      expect(row!.text).toBe(promptText(prompt));
      expect(row!.attachments.map((attachment) => attachment.kind)).toEqual(attachmentKinds(prompt));
      expect(copiedUserText(row!)).toBe(promptText(prompt));
      expect(rowPrefill(row!).text).toBe(promptText(prompt));
      // u704-rewind-1's joined message was rewound (probe 2): its turn is not among the turn activity's, so the recall
      // passes it over (M1's discovery); the next case reads every entry for an envelope
      if (name !== 'u704-rewind-1') expect(recallEntries(drawn(state), turnActivity(state), []).map(recallText)).toContain(promptText(prompt));
    });

    it('nothing of an envelope in any user row, copied text, prefill or recall entry of the session', async () => {
      const state = stateOf(await eventsOn(name, road));
      const rows = users(drawn(state));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(holdsEnvelope(row.text), row.text.slice(0, 80)).toBe(false);
        expect(holdsEnvelope(copiedUserText(row))).toBe(false);
        expect(holdsEnvelope(rowPrefill(row).text)).toBe(false);
      }
      for (const entry of recallEntries(drawn(state), turnActivity(state), []).map(recallText)) expect(holdsEnvelope(entry)).toBe(false);
    });

    if (name.startsWith('u704-')) {
      it('with the recorded call, each ask’s capsule reads answered with its envelope’s answers', async () => {
        const drawnAsks = asks(drawn(stateOf(await eventsOn(name, road))));
        for (const envelope of envelopes) {
          const steer = parseAskSteer(envelope)!;
          expect(drawnAsks.find((row) => row.askId === steer.askId)).toMatchObject({ state: 'answered', answers: steer.result.answers });
        }
      });
    }
  });

  it.each(PROBE_JOINS)('%s: the three roads draw the same user rows and capsules', async (name) => {
    const [journal, file, rows] = await Promise.all(ROADS.map(async (road) => summary(drawn(stateOf(await eventsOn(name, road))))));
    expect(rows).toEqual(file);
    expect(journal).toEqual(file);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The control, and what this build's producers make (Acceptance 5 and 7)

describe('the recordings the engine did not join: the producers’ events are the files frozen at M1’s start, ids included (Acceptance 5)', () => {
  // the control (both members written once the running call was a task) and the pasted envelope (a prompt that is an
  // envelope alone, for an id no ask has, which the split returns as it is)
  const UNJOINED = [...PROBE_CONTROLS, 'u704-pasted-1', 'u704-pasted-2'];

  it.each(UNJOINED)('%s: the journal through the normaliser', (name) => {
    expect(fromJournal(name)).toEqual(frozen(name, 'events'));
  });

  it.each(UNJOINED)('%s: the file through the chain follower', async (name) => {
    expect(await fromFile(recorded(name))).toEqual(frozen(name, 'backfill'));
  });
});

describe('what this build’s producers make of every recording (Acceptance 7)', () => {
  const U704 = [...PROBE_JOINS, ...PROBE_CONTROLS, 'u704-pasted-1', 'u704-pasted-2'];
  const CASES: [string, Road][] = [...U704.flatMap((name) => ROADS.map((road): [string, Road] => [name, road])), ...U4B_JOINS.map((name): [string, Road] => [name, 'journal'])];

  it.each(CASES)('%s, from the %s: the split returns each user message as it is, the same object; every event parses under X1', async (name, road) => {
    const events = await eventsOn(name, road);
    for (const message of messages(events)) {
      const parts = splitPersonsMessage(message);
      expect(parts).toHaveLength(1);
      expect(parts[0]).toBe(message);
    }
    for (const event of events) expect(SessionEventSchema.safeParse(event).success, `${event.id} ${event.kind}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The surfaces the ticket lists (Acceptance 8)

describe('the surfaces the ticket lists, for a recorded join, through the model from the recorded journal (Acceptance 8)', () => {
  // the joins that hold a prompt; u704-rewind-1's joined message was rewound, so no surface offers it (its rewind is below)
  const WITH_PROMPT = PROBE_JOINS.filter((name) => recordedJoin(name).prompt !== null && name !== 'u704-rewind-1');

  describe.each(WITH_PROMPT)('%s', (name) => {
    const { joined, prompt } = recordedJoin(name);
    const state = stateOf(fromJournal(name));
    const rows = drawn(state);
    const row = users(rows).find((candidate) => candidate.messageUuid === joined.uuid)!;
    const words = promptText(prompt!);

    it('the UserMessage site’s text is the prompt', () => {
      expect(userInput(row, state.turns.get(row.turnId!))?.props.text).toBe(words);
    });

    it('the hook-refusal Edit prompt, in the joined message’s turn, prefills the prompt', () => {
      const prompted = initiatingPrompt(rows.slice(0, rows.indexOf(row) + 1), turnActivity(state));
      expect(prompted?.messageUuid).toBe(joined.uuid);
      expect(rowPrefill(prompted!).text).toBe(words);
    });

    it('the rewind picker’s line is the prompt’s first line', () => {
      const target = rewindTargets(rows).find((candidate) => candidate.messageUuid === joined.uuid)!;
      expect(typedFromRowText(target.text).split('\n')[0]).toBe(words.split('\n')[0]);
    });

    it('a “handed” row reads the prompt', () => {
      const queue = { entries: [], paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true };
      const read = { unread: [{ messageUuid: joined.uuid as MessageUuid, text: row.text, at: row.at }], started: () => false, questions: () => null };
      const handed = stackRows(queue, new Set(), read);
      expect(handed.map((stacked) => [stacked.kind, rowText(stacked)])).toEqual([['handed', words]]);
    });
  });
});

describe('a rewind to the joined message (u704-rewind-1, probe 2): the prefill is the person’s words and the tooltip holds no envelope (Acceptance 8)', () => {
  const { prompt } = recordedJoin('u704-rewind-1');
  const boundaries = (rows: Row[]) => rows.filter((row): row is Extract<Row, { kind: 'boundary' }> => row.kind === 'boundary' && row.boundaryKind === 'rewind');

  it('live: the boundary’s prefill, from the engine’s answer (seq 771), is the prompt, and so is its tooltip', () => {
    const events = fromJournal('u704-rewind-1');
    expect(events.filter((event) => event.kind === 'boundary.rewind').map((event) => event.prefillText)).toEqual([prompt]);
    expect(boundaries(drawn(stateOf(events))).map((row) => row.detail)).toEqual([prompt]);
  });

  it('from the file: the anchor’s one-line text (L54, cut inside the opening sentence) gives the prompt’s words', async () => {
    const events = await fromFile(recorded('u704-rewind-1'));
    const words = (prompt as string).replace(/\n/g, ' ');
    expect(events.filter((event) => event.kind === 'boundary.rewind').map((event) => event.prefillText)).toEqual([words]);
    expect(boundaries(drawn(stateOf(events))).map((row) => row.detail)).toEqual([words]);
  });

  it('made by hand from the recording: an anchor whose one-line text holds an envelope’s head alone has no prefill and no tooltip', async () => {
    const lines = recorded('u704-rewind-1').split('\n');
    const anchor = JSON.parse(lines[53]!) as { lastPrompt: string };
    lines[53] = JSON.stringify({ ...anchor, lastPrompt: anchor.lastPrompt.slice(anchor.lastPrompt.indexOf('[MAWS ask')) });
    const events = await fromFile(lines.join('\n'));
    expect(events.filter((event) => event.kind === 'boundary.rewind').map((event) => event.prefillText)).toEqual([null]);
    expect(boundaries(drawn(stateOf(events))).map((row) => row.detail)).toEqual([null]);
  });
});

describe('made by hand in the recorded form: an anchored comment joined with an envelope (Acceptance 8)', () => {
  const ANCHOR: Anchor = { kind: 'file-line', locator: '/work/src/grid.ts#L12', label: 'grid.ts:12', path: '/work/src/grid.ts', line: 12 };

  it('u704-end-prompt-first-1 with its prompt member written by the anchor’s own writer: the row keeps its anchor and its frame, and the envelope answers its ask', async () => {
    const { joined, envelopes } = recordedJoin('u704-end-prompt-first-1');
    const comment = anchoredMessage({ anchor: ANCHOR, text: 'Why is this column so wide?', destination: 'main', screenshot: false });
    // the engine's one line for the join, prompt first, its content the members with one newline between
    const lines = recorded('u704-end-prompt-first-1')
      .split('\n')
      .map((line) => {
        if (line.trim() === '') return line;
        const row = JSON.parse(line) as JsonObject & { message?: { content?: unknown } };
        return row.uuid === joined.uuid && row.type === 'user' ? JSON.stringify({ ...row, message: { ...row.message, content: `${comment}\n${envelopes[0]!}` } }) : line;
      });
    const rows = drawn(stateOf(await fromFile(lines.join('\n'))));
    const own = users(rows).filter((row) => row.messageUuid === joined.uuid);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ text: 'Why is this column so wide?', anchor: ANCHOR, anchorFrame: { destination: 'main', screenshot: false } });
    const steer = parseAskSteer(envelopes[0]!)!;
    expect(asks(rows).find((row) => row.askId === steer.askId)).toMatchObject({ state: 'answered', answers: steer.result.answers });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A literal envelope in a prompt of human origin, wherever it was typed (decision 5): made by hand

const LAYOUT: AskQuestion = { id: 'q1', question: 'Which layout should the page use?', header: 'Layout', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] };
const ASK_ID = 'toolu_01HandMadeAskForTicket704';
const ENVELOPE = askSteerText(ASK_ID, [LAYOUT], [{ id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] }]);
const WORDS = 'Use the grid, and keep the header.';

/** A turn of a prompt typed at a terminal, staging (by hand) MAWS's non-blocking ask's call and its result where `ask`. */
function typedTurn(c: Chain, ask: boolean): void {
  c.row('user', { origin: { kind: 'human' }, promptSource: 'typed', entrypoint: 'cli', promptId: 'p1', message: { role: 'user', content: 'Ask me which layout to use, then wait twelve seconds.' } });
  if (!ask) return;
  const call = c.assistant([{ type: 'tool_use', id: ASK_ID, name: 'mcp__maws__ask', input: { blocking: false, questions: [LAYOUT] } }]);
  const result = JSON.stringify({ status: 'asked', askId: ASK_ID });
  c.row('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: ASK_ID, content: [{ type: 'text', text: result }] }] }, sourceToolAssistantUUID: call.uuid, toolUseResult: [{ type: 'text', text: result }] }, call);
}

function outcomes(rows: Row[], ask: boolean) {
  expect(users(rows).some((row) => holdsEnvelope(row.text))).toBe(false);
  if (ask) expect(asks(rows).map((row) => [row.askId, row.state, row.answers])).toEqual([[ASK_ID, 'answered', parseAskSteer(ENVELOPE)!.result.answers]]);
  else expect(asks(rows)).toEqual([]);
}

describe('made by hand: a terminal’s queued prompt that holds a literal envelope (decision 5; Acceptance 8)', () => {
  // the recorded shape of w1-terminal-queued.jsonl line 26 (a `queued_command` attachment, origin human, `entrypoint: "cli"`)
  const QUEUED = '5e7c0de0-0000-4000-8000-000000000704';
  function session(ask: boolean): SessionEvent[] {
    const c = new Chain('d7040001');
    typedTurn(c, ask);
    const call = c.call('toolu_01HandMadeWait');
    c.row('attachment', { attachment: { type: 'queued_command', prompt: `${WORDS}\n${ENVELOPE}`, source_uuid: QUEUED, commandMode: 'prompt', origin: { kind: 'human' }, timestamp: '2026-10-18T10:00:05.000Z', humanTurn: true }, userType: 'external', entrypoint: 'cli' });
    c.result('toolu_01HandMadeWait', call);
    c.answer('The grid it is.');
    c.end();
    const ctx = createBackfillContext({ sessionId: 'sess-chain' as SessionId, agent: null });
    return c.rows.flatMap((row) => recordToEvents(TranscriptRecordSchema.parse(row), ctx));
  }

  it.each([true, false])('through recordToEvents and the model, with the ask’s call in the session (staged by hand): %s. The person’s row holds the words alone; the envelope answers its ask where the session holds it, and nothing of it is drawn where it does not', (ask) => {
    const events = session(ask);
    expect(messages(events).filter((event) => event.messageUuid === QUEUED).map((event) => event.content)).toEqual([WORDS, ENVELOPE]);
    const rows = drawn(stateOf(events));
    expect(users(rows).filter((row) => row.messageUuid === QUEUED).map((row) => row.text)).toEqual([WORDS]);
    outcomes(rows, ask);
  });
});

describe('made by hand: an undone input that holds a literal envelope, through the reader of another machine’s rows (decision 5; Acceptance 8)', () => {
  async function session(ask: boolean) {
    const c = new Chain('d7040002');
    typedTurn(c, ask);
    c.answer('Asked.');
    c.end();
    // the machine marks it off the chain, and the session never read it
    const lost = c.prompt(`${WORDS}\n${ENVELOPE}`);
    const events = await freshSource(c.rows, 'sess-chain', subagentLookupOf([]), null, new Set([lost.uuid as string])).snapshot();
    return { events, lost: lost.uuid as string };
  }

  it.each([true, false])('with the ask’s call in the session (staged by hand): %s. The row drawn “Not read” holds the words alone, and the envelope is read to the same two outcomes', async (ask) => {
    const { events, lost } = await session(ask);
    const own = events.filter((event) => event.id === lost || event.id.startsWith(`${lost}#`));
    expect(own.map((event) => [event.kind, event.kind === 'user.message' ? event.content : event.kind === 'command.lifecycle' ? event.state : null])).toEqual([
      ['user.message', WORDS],
      ['user.message', ENVELOPE],
      ['command.lifecycle', 'discarded'],
    ]);
    const rows = drawn(stateOf(events));
    expect(users(rows).filter((row) => row.messageUuid === lost).map((row) => [row.text, row.dropped])).toEqual([[WORDS, true]]);
    outcomes(rows, ask);
  });
});

