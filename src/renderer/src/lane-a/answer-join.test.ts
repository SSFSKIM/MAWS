// UX wave U1b (the U1b document, Interfaces §B "The answer's join"; Acceptance 5, O-21): a terminal session's
// asynchronous question carries its delivered answer on its own row, "header → answer" or dismissed, whatever turn the
// delivery reached the agent in and whatever order the pages load in, on the file route (the chain follower over the
// file's bytes, as `session.events` answers for a session nobody holds) and from another machine's rows (`freshSource`).
// The rows are in the shapes the recorded ones have (lane-a/test-support/chain-rows.ts: the plugin's prompt while idle, a
// hook's context on a running turn's tool result); their questions and words are invented. It lives beside the reader of
// another machine's rows, as `arrival-routes.test.ts` does, for the same reason (the node project typechecks the model).
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { DISMISSED } from '@shared/engine/ask-delivery';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState, type TranscriptState } from '../transcript/model/reduce';
import { freshSource, subagentLookupOf } from './plane-transcript';
import { Chain, SESSION } from './test-support/chain-rows';

const COLOUR = [{ question: 'Which colour do you prefer?', header: 'Colour', options: [{ label: 'Blue' }, { label: 'Red' }] }];
const SEASON = [{ question: 'Which season do you prefer?', header: 'Season', options: [{ label: 'Summer' }, { label: 'Winter' }] }];
const BLUE = 'Your questions have been answered: "Which colour do you prefer?"="Blue". You can now continue with these answers in mind.';
const delivered = (call: string, summary: string) => `The human responded to your async AskUserQuestion (call ${call}): ${summary}`;

const text = (rows: readonly JsonObject[]) => rows.map((row) => JSON.stringify(row)).join('\n');

/** The file route: the chain follower over the rows' bytes. */
async function fromFile(rows: readonly JsonObject[]): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text(rows)), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}
/** Another machine's rows, through the reader of that machine's rows. */
const fromRows = (rows: readonly JsonObject[]): Promise<SessionEvent[]> => freshSource(rows, SESSION, subagentLookupOf([])).snapshot();
const ROUTES = [['the file', fromFile], ['another machine’s rows', fromRows]] as const;

/** Each question row, by its call: what it says of its answer. */
type Said = Record<string, { answers: Record<string, string> | null; dismissed: boolean }>;
function questions(state: TranscriptState): Said {
  const rows = rowsOf(withAllExpanded(state));
  return Object.fromEntries(rows.flatMap((row) => (row.kind === 'question' ? [[row.toolUseId, { answers: row.answers, dismissed: row.dismissed === true }]] : [])));
}

/** A question asked without waiting, the turn it was asked in ended; then the given delivery. */
function asked(deliver: (c: Chain) => void): { rows: JsonObject[]; answerAt: number } {
  const c = new Chain('c4a1b000', 'sminos');
  c.prompt('Pick my colour and season, then write the palette.');
  c.asyncAsk('toolu_colour', COLOUR);
  c.asyncAsk('toolu_season', SEASON);
  c.answer('Asked; going on.');
  c.end();
  const answerAt = c.rows.length;
  deliver(c);
  return { rows: c.rows, answerAt };
}

const SHAPES: [string, () => { rows: JsonObject[]; answerAt: number }, Said][] = [
  [
    'a plugin’s prompt that answers one call',
    () => asked((c) => {
      c.answerPrompt(delivered('toolu_colour', BLUE));
      c.answer('Blue it is.');
      c.end();
    }),
    { toolu_colour: { answers: { 'Which colour do you prefer?': 'Blue' }, dismissed: false }, toolu_season: { answers: null, dismissed: false } },
  ],
  [
    'a hook’s context on a running turn’s tool result that answers one',
    () => asked((c) => {
      c.prompt('Now check the build.');
      const call = c.call('toolu_sleep');
      c.result('toolu_sleep', call);
      c.answerContext(delivered('toolu_colour', BLUE), 'tool.call');
      c.answer('The build is fine, and blue it is.');
      c.end();
    }),
    { toolu_colour: { answers: { 'Which colour do you prefer?': 'Blue' }, dismissed: false }, toolu_season: { answers: null, dismissed: false } },
  ],
  [
    'a prompt that carries an answer and a dismissal for two calls',
    () => asked((c) => {
      c.answerPrompt(`${delivered('toolu_colour', BLUE)}\n\n${delivered('toolu_season', DISMISSED)}`);
      c.answer('Blue; no season then.');
      c.end();
    }),
    { toolu_colour: { answers: { 'Which colour do you prefer?': 'Blue' }, dismissed: false }, toolu_season: { answers: null, dismissed: true } },
  ],
];

describe('an asynchronous question’s answer joins its own row (Interfaces §B)', () => {
  for (const [route, read] of ROUTES) {
    for (const [shape, build, expected] of SHAPES) {
      it(`${shape}, from ${route}: the whole history in order`, async () => {
        const { rows } = build();
        expect(questions(applyEvents(createState(null, null), await read(rows)))).toEqual(expected);
      });

      it(`${shape}, from ${route}: the answer applied after its call’s rows were drawn derives the call’s turn again`, async () => {
        const { rows, answerAt } = build();
        const [calls, answer] = [await read(rows.slice(0, answerAt)), await read(rows.slice(answerAt))];
        const first = applyEvents(createState(null, null), calls);
        expect(Object.values(questions(first)).every((q) => q.answers === null && !q.dismissed)).toBe(true); // drawn, not answered
        expect(questions(applyEvents(first, answer))).toEqual(expected);
      });

      it(`${shape}, from ${route}: the answer applied before the page that holds its call`, async () => {
        const { rows, answerAt } = build();
        const [calls, answer] = [await read(rows.slice(0, answerAt)), await read(rows.slice(answerAt))];
        const first = applyEvents(createState(null, null), answer);
        expect(questions(first)).toEqual({});
        expect(questions(applyEvents(first, calls))).toEqual(expected);
      });
    }
  }

  it('a later delivery for a call replaces an earlier one', async () => {
    const { rows } = asked((c) => {
      c.answerPrompt(delivered('toolu_colour', DISMISSED));
      c.answer('No colour then.');
      c.end();
      c.answerPrompt(delivered('toolu_colour', BLUE));
      c.answer('Blue after all.');
      c.end();
    });
    expect(questions(applyEvents(createState(null, null), await fromFile(rows))).toolu_colour).toEqual({ answers: { 'Which colour do you prefer?': 'Blue' }, dismissed: false });
  });
});
