// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M1; the architect's ruling B; Acceptance 6, and of 3,
// 4 and 7 the model's part): a window of this build reads a person's message once where events enter the reducer, so
// what a host of an older build sends for a joined answer draws as this build's own events will. A host of build G
// sends the joined message whole on both routes; its events are frozen beside the probes' recordings, written before
// this landing changed any source: `<name>.base-events.json` (the journal through the normaliser) and
// `<name>.base-backfill.json` (the engine's file through the chain follower). It lives beside the reader of another
// machine's rows, as arrival-routes.test.ts does: it reads the composer's recall and Edit's prefill, whose graph is the
// renderer's, and the node project typechecks the model's directory.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { askSteerText, parseAskSteer } from '@shared/maws/ask';
import type { AskQuestion } from '@shared/maws/tools';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { PROBE_CONTROLS, PROBE_JOINS, recordedJoin } from '../../../../test/support/recorded-joins';
import { recallEntries, recallText } from '../composer/editor/history';
import { rowPrefill } from '../composer/edit-prefill';
import { journalToEvents } from '../transcript/dev/journal';
import { turnActivity } from '../transcript/model/activity';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState, type TranscriptState } from '../transcript/model/reduce';
import type { Row } from '../transcript/model/rows';
import { builder, uuid } from '../transcript/model/test-events';
import { copiedUserText } from '../transcript/model/user-text';

type UserRow = Extract<Row, { kind: 'user' }>;
type AskRow = Extract<Row, { kind: 'ask' }>;
type Kind = 'events' | 'backfill';

const frozen = (name: string, kind: Kind): SessionEvent[] => JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.base-${kind}.json`), 'utf8')) as SessionEvent[];
const stateOf = (events: SessionEvent[]): TranscriptState => applyEvents(createState(null, null), events);
const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
const users = (rows: Row[]) => rows.filter((row): row is UserRow => row.kind === 'user');
const ENVELOPE_MARKS = ['[MAWS ask', '```json'];
const holdsEnvelope = (text: string) => ENVELOPE_MARKS.some((mark) => text.includes(mark));
// the prompt as its row draws it: its text, and the image beside it where it carried one (probe 3)
const promptText = (prompt: string | ContentBlock[]) => (typeof prompt === 'string' ? prompt : prompt.flatMap((block) => (block.type === 'text' ? [String(block.text)] : [])).join('\n\n'));

const FROZEN: [string, Kind][] = [...PROBE_JOINS.map((name): [string, Kind] => [name, 'events']), ...PROBE_JOINS.map((name): [string, Kind] => [name, 'backfill']), ['u4b-env-end-env-first-1', 'events'], ['u4b-env-two-prompt-first-1', 'events']];

describe('a joined answer from a host of build G, drawn in this build’s window', () => {
  describe.each(FROZEN)('%s, build G’s %s', (name, kind) => {
    const { joined, envelopes, prompt } = recordedJoin(name);
    const state = () => stateOf(frozen(name, kind));

    it('the person’s row: one user row for the joined message, under the last-written uuid, its text exactly the prompt; Copy, Edit’s prefill and the up-arrow’s entry the same', () => {
      const rows = drawn(state());
      const own = users(rows).filter((row) => row.messageUuid === joined.uuid);
      if (prompt === null) {
        expect(own).toEqual([]); // envelopes alone, each answered here: no bubble
        return;
      }
      expect(own).toHaveLength(1);
      const [row] = own;
      expect(row!.text).toBe(promptText(prompt));
      expect(row!.attachments.map((attachment) => attachment.kind)).toEqual(typeof prompt === 'string' ? [] : ['image']);
      expect(copiedUserText(row!)).toBe(promptText(prompt));
      expect(rowPrefill(row!).text).toBe(promptText(prompt));
      // u704-rewind-1's joined message was rewound (probe 2), which takes it out of the recall; the next case still reads it
      if (name !== 'u704-rewind-1') expect(recallEntries(rows, turnActivity(state()), []).map(recallText)).toContain(promptText(prompt));
    });

    it('nothing of an envelope in any user row, copied text, prefill or recall entry of the session', () => {
      const s = state();
      const rows = users(drawn(s));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(holdsEnvelope(row.text), row.text.slice(0, 80)).toBe(false);
        expect(holdsEnvelope(copiedUserText(row))).toBe(false);
        expect(holdsEnvelope(rowPrefill(row).text)).toBe(false);
      }
      for (const text of recallEntries(drawn(s), turnActivity(s), []).map(recallText)) expect(holdsEnvelope(text)).toBe(false);
    });

    if (name.startsWith('u704-')) {
      it('with the recorded call, each ask’s capsule reads answered with its envelope’s answers', () => {
        const asks = drawn(state()).filter((row): row is AskRow => row.kind === 'ask');
        expect(envelopes.length).toBeGreaterThan(0);
        for (const envelope of envelopes) {
          const steer = parseAskSteer(envelope)!;
          expect(asks.find((row) => row.askId === steer.askId)).toMatchObject({ state: 'answered', answers: steer.result.answers });
        }
      });
    }
  });

  it.each(PROBE_CONTROLS)('%s, the control the engine did not join, build G’s events: each member its own row, the envelope answering its ask', (name) => {
    const rows = drawn(stateOf(frozen(name, 'events')));
    const asks = rows.filter((row): row is AskRow => row.kind === 'ask');
    expect(asks).toHaveLength(1);
    expect(asks[0]!.state).toBe('answered');
    expect(users(rows).some((row) => holdsEnvelope(row.text))).toBe(false);
  });
});

// The producers at M1's head are build G's for a person's message: their events for the recordings are still the frozen
// ones (M2 changes the producers and removes this case)
describe('the producers at this head still give the frozen events', () => {
  const NAMES = [...PROBE_JOINS, ...PROBE_CONTROLS, 'u704-pasted-1', 'u704-pasted-2'];
  async function fromFile(name: string): Promise<SessionEvent[]> {
    const text = readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.transcript.jsonl`), 'utf8');
    const sessionId = text.split('\n').map((line) => (line.trim() === '' ? null : (JSON.parse(line) as { sessionId?: unknown }).sessionId)).find((id): id is string => typeof id === 'string')!;
    const events: SessionEvent[] = [];
    const follower = new ChainFollower(new MemoryFileReader(text), sessionId as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
    await follower.start();
    follower.stop();
    return events;
  }

  it.each([...NAMES, 'u4b-env-end-env-first-1', 'u4b-env-two-prompt-first-1'])('%s: the journal through the normaliser', (name) => {
    expect(journalToEvents(loadUxwaveJournal(name))).toEqual(frozen(name, 'events'));
  });

  it.each(NAMES)('%s: the file through the chain follower', async (name) => {
    expect(await fromFile(name)).toEqual(frozen(name, 'backfill'));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The reducer's contract (decision 3; Acceptance 7) and ruling B's exception (Acceptance 6), made by hand

const LAYOUT: AskQuestion = { id: 'q1', question: 'Which layout should the page use?', header: 'Layout', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] };
const THEME: AskQuestion = { id: 'q2', question: 'Which theme?', header: 'Theme', modality: 'choice', options: [{ label: 'Light' }, { label: 'Dark' }] };
const OUTER = askSteerText('toolu_ask_outer', [LAYOUT], [{ id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] }]);
const INNER = askSteerText('toolu_ask_inner', [THEME], [{ id: 'q2', question: THEME.question, status: 'answered', value: ['Dark'] }]);

function asked(asks: [string, AskQuestion][]) {
  const b = builder();
  b.turn('u0');
  for (const [askId, question] of asks) b.toolUse(askId, 'mcp__maws__ask', { blocking: false, questions: [question] });
  for (const [askId] of asks) b.result(askId, [{ type: 'text', text: JSON.stringify({ status: 'asked', askId }) }]);
  b.end(['u0']);
  return b;
}
const asksOf = (rows: Row[]) => rows.filter((row): row is AskRow => row.kind === 'ask').map((row) => [row.askId, row.state]);

describe('the reducer: a message under a uuid already placed', () => {
  it('records an envelope’s answers and places nothing (the order decision 3 rests on)', () => {
    const b = asked([['toolu_ask_outer', LAYOUT]]);
    b.turn('u1', 'Also fix the footer.');
    const before = drawn(stateOf(b.events));
    b.emit('user.message', { messageUuid: uuid('u1'), content: OUTER, isReplay: true, isSynthetic: false, origin: 'human', bash: null });
    b.end(['u1']);
    const after = drawn(stateOf(b.events));
    expect(asksOf(before)).toEqual([['toolu_ask_outer', 'asked']]);
    expect(asksOf(after)).toEqual([['toolu_ask_outer', 'answered']]);
    expect(users(after).map((row) => [row.messageUuid, row.text])).toEqual(users(before).map((row) => [row.messageUuid, row.text]));
  });
});

describe('made by hand: one envelope’s lines standing around another whole envelope, and a line of words (ruling B’s exception)', () => {
  const lines = OUTER.split('\n');
  const text = `Keep these notes.\n${lines.slice(0, 2).join('\n')}\n${INNER}\n${lines.slice(2).join('\n')}`;
  const message = { messageUuid: uuid('u1'), isReplay: true, isSynthetic: false, origin: 'human', bash: null } as const;
  const raw = () => {
    const b = asked([['toolu_ask_outer', LAYOUT], ['toolu_ask_inner', THEME]]);
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { ...message, content: text }); // as a host of an older build sends it
    b.end(['u1']);
    return b.events;
  };
  const split = () => {
    const b = asked([['toolu_ask_outer', LAYOUT], ['toolu_ask_inner', THEME]]);
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    for (const content of ['Keep these notes.', INNER, OUTER]) b.emit('user.message', { ...message, content }); // as a host of this build will
    b.end(['u1']);
    return b.events;
  };

  it('the raw message: the words alone in the bubble, both asks answered', () => {
    const rows = drawn(stateOf(raw()));
    expect(users(rows).find((row) => row.messageUuid === 'u1')?.text).toBe('Keep these notes.');
    expect(asksOf(rows)).toEqual([['toolu_ask_outer', 'answered'], ['toolu_ask_inner', 'answered']]);
  });

  it('the window’s rows and recorded answers are the same whether it was given the raw message or the parts', () => {
    expect(drawn(stateOf(raw()))).toEqual(drawn(stateOf(split())));
  });
});
