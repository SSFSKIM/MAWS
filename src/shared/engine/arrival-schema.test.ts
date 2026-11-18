// The `command` entry of `user.message.arrival` and its one reader (UX wave U3b, M1; docs/doperpowers/plans/
// 2026-11-15-ux-wave-U3b-transcript-rows-find.md, decision 2 and Interfaces A). The entry is not a member of the carried
// union: it travels through the member that takes a class outside the closed set, and `commandOf` holds it to a strict
// schema of its own, so an entry that does not fit reads as nothing and never fails the event.
import { describe, expect, it } from 'vitest';
import { SessionEventSchema } from '../graph/events';
import { carriedOf, commandEntry, commandOf, type ArrivalEntry } from './arrival-schema';

const RUN = { command: 'usage', args: '' };
const NOTHING = { run: null, plain: false };

describe('commandEntry', () => {
  it('says only what there is to say: a run, a plain mark, both, or no entry at all', () => {
    expect(commandEntry({ run: RUN, plain: false })).toEqual([{ class: 'command', run: RUN }]);
    expect(commandEntry({ run: null, plain: true })).toEqual([{ class: 'command', plain: true }]);
    expect(commandEntry({ run: RUN, plain: true })).toEqual([{ class: 'command', run: RUN, plain: true }]);
    expect(commandEntry(NOTHING)).toEqual([]);
  });

  it('reads back as it was written, through the event’s own schema', () => {
    for (const facts of [{ run: RUN, plain: false }, { run: null, plain: true }, { run: { command: 'rename', args: 'demo name' }, plain: true }]) {
      const event = SessionEventSchema.parse({
        id: 'e1', sessionId: 's1', at: '2026-11-15T10:00:00.000Z', seq: 1, agentId: null, parentToolUseId: null,
        kind: 'user.message', messageUuid: 'm-1', content: '<local-command-stdout>ok</local-command-stdout>', isReplay: false, isSynthetic: false, origin: 'local-command', bash: null,
        arrival: commandEntry(facts),
      });
      expect(event.kind === 'user.message' && commandOf(event.arrival)).toEqual(facts);
    }
  });
});

describe('commandOf', () => {
  it('reads nothing from no field, an empty one, or one with no entry of its class', () => {
    expect(commandOf(undefined)).toEqual(NOTHING);
    expect(commandOf([])).toEqual(NOTHING);
    expect(commandOf([{ class: 'wake' }])).toEqual(NOTHING);
  });

  it('ignores an entry that does not fit, and the event still reads', () => {
    const misfits: ArrivalEntry[] = [
      { class: 'command', run: { command: 'usage' } }, // no args
      { class: 'command', run: { command: 7, args: '' } },
      { class: 'command', plain: false }, // only `true` is said
      { class: 'command', run: RUN, extra: 1 }, // strict
      { class: 'command', run: { ...RUN, extra: 1 } },
      { class: 'command', run: null },
    ];
    for (const entry of misfits) {
      expect(commandOf([entry]), JSON.stringify(entry)).toEqual(NOTHING);
      const read = SessionEventSchema.safeParse({
        id: 'e1', sessionId: 's1', at: '2026-11-15T10:00:00.000Z', seq: 1, agentId: null, parentToolUseId: null,
        kind: 'user.message', messageUuid: 'm-1', content: 'x', isReplay: false, isSynthetic: false, origin: 'local-command', bash: null, arrival: [entry],
      });
      expect(read.success, JSON.stringify(entry)).toBe(true);
    }
  });

  it('reads the first entry of its class, beside entries of others', () => {
    expect(commandOf([{ class: 'wake' }, { class: 'command', run: RUN }, { class: 'command', plain: true }])).toEqual({ run: RUN, plain: false });
  });

  it('is never what carriedOf returns', () => {
    expect(carriedOf(commandEntry({ run: RUN, plain: true }))).toEqual([]);
    expect(carriedOf([{ class: 'wake' }, ...commandEntry({ run: RUN, plain: false })])).toEqual([{ class: 'wake' }]);
  });
});
