// A slash command's output as a row (UX wave U3b, M1; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md,
// decisions 3 and 4, Interfaces B): the whole output as today, and four marks that say what the event and its turn say.
// `error` when all of it came in `<local-command-stderr>`; `run` and `plain` from the event's `command` entry; `lone`
// when its turn holds no bubble of a command, or it has no turn. Its copy is the line: `⎿`, then the output. Events are
// written by hand, with invented text, in the shapes the probes recorded (u3-commands-r1).
import type { SessionEvent } from '@shared/graph/events';
import { commandEntry } from '@shared/engine/arrival';
import { describe, expect, it } from 'vitest';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { serializeRows } from './serialize';
import { builder, uuid, type Builder } from './test-events';

const rows = (events: SessionEvent[]) => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const outputs = (events: SessionEvent[]) => rows(events).filter((row): row is Extract<Row, { kind: 'local_command' }> => row.kind === 'local_command');
const output = (b: Builder, id: string, content: string, arrival?: ReturnType<typeof commandEntry>) =>
  b.emit('user.message', { messageUuid: uuid(id), content, isReplay: false, isSynthetic: false, origin: 'local-command', bash: null, ...(arrival !== undefined && arrival.length > 0 && { arrival }) });
const USAGE = { command: 'usage', args: '' };

describe('a command output’s row', () => {
  it('names the run its event carries and says a terminal’s text is plain; an event with no entry has neither', () => {
    const b = builder();
    b.turn('u1', '/cost');
    output(b, 'o1', '<local-command-stdout>Total cost: $0.01</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    b.end(['u1']);
    b.turn('u2', '/context');
    output(b, 'o2', '<local-command-stdout>Context Usage\n⛁ ⛁ ⛶</local-command-stdout>', commandEntry({ run: { command: 'context', args: '' }, plain: true }));
    b.end(['u2']);
    b.turn('u3', '/rename demo');
    output(b, 'o3', '<local-command-stdout>Session renamed to: demo</local-command-stdout>'); // an older host's: no entry
    b.end(['u3']);
    const [cost, grid, renamed] = outputs(b.events);
    expect(cost).toMatchObject({ text: 'Total cost: $0.01', run: USAGE });
    expect(cost!.plain).toBeUndefined();
    expect(grid).toMatchObject({ run: { command: 'context', args: '' }, plain: true });
    expect(renamed!.run).toBeUndefined();
    expect(renamed!.plain).toBeUndefined();
    expect([cost, grid, renamed].map((row) => row!.lone)).toEqual([undefined, undefined, undefined]); // each under its bubble
  });

  it('is an error only when all of its output came in the error tag', () => {
    const b = builder();
    b.turn('u1', '/compact');
    output(b, 'o1', '<local-command-stderr>Error: Nothing to compact</local-command-stderr>');
    b.end(['u1']);
    b.turn('u2', '/model demo-model');
    output(b, 'o2', '<local-command-stdout>API error: 400 demo-model is not a model</local-command-stdout>'); // the engine's error as ordinary output
    b.end(['u2']);
    b.turn('u3', '/demo');
    output(b, 'o3', '<local-command-stdout>half done</local-command-stdout>\n<local-command-stderr>then it failed</local-command-stderr>'); // mixed: muted (decision 3)
    b.end(['u3']);
    expect(outputs(b.events).map((row) => [row.text, row.error])).toEqual([
      ['Error: Nothing to compact', true],
      ['API error: 400 demo-model is not a model', undefined],
      ['half done\nthen it failed', undefined],
    ]);
  });

  it('stands alone where its turn holds no bubble of a command, and loose', () => {
    const b = builder();
    output(b, 'o0', '<local-command-stdout>Before any turn</local-command-stdout>', commandEntry({ run: USAGE, plain: false })); // loose
    b.turn('u1', 'Summarise the notes.'); // a prompt, not a command
    output(b, 'o1', '<local-command-stdout>Total cost: $0.02</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    b.text('m1', 0, 'Done.');
    b.end(['u1']);
    b.turn('u2', '/usage');
    output(b, 'o2', '<local-command-stdout>Total cost: $0.03</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    b.end(['u2']);
    expect(outputs(b.events).map((row) => [row.text, row.turnId === null ? 'loose' : 'turn', row.lone])).toEqual([
      ['Before any turn', 'loose', true],
      ['Total cost: $0.02', 'turn', true],
      ['Total cost: $0.03', 'turn', undefined],
    ]);
  });

  // The architect's ruling on M1's report: `lone` means no bubble of its command is drawn directly above it, on every
  // route, decided on the drawn order. The file's routes place an output as a loose event after its command's turn
  // (written here as the backfill writes it: the command's turn ends, then the output arrives with no turn open).
  it('is not alone when it is placed directly after its command’s turn, as the file’s routes place it', () => {
    const b = builder();
    b.turn('u1', '/usage');
    b.end(['u1']);
    output(b, 'o1', '<local-command-stdout>Total cost: $0.03</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    const [row] = outputs(b.events);
    expect(row!.turnId).toBeNull();
    expect(row!.lone).toBeUndefined();
  });

  it('two commands in a row: each output reads its own command’s bubble, never the one before', () => {
    const b = builder();
    b.turn('u1', '/cost');
    b.end(['u1']);
    output(b, 'o1', '<local-command-stdout>Total cost: $0.03</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    b.turn('u2', '/rename demo');
    b.end(['u2']);
    output(b, 'o2', '<local-command-stdout>Session renamed to: demo</local-command-stdout>', commandEntry({ run: { command: 'rename', args: 'demo' }, plain: false }));
    const drawn = rows(b.events).filter((row) => row.kind !== 'time');
    expect(drawn.map((row) => (row.kind === 'user' ? `bubble ${row.text}` : row.kind === 'local_command' ? `output ${row.text}${row.lone ? ' lone' : ''}` : row.kind))).toEqual([
      'bubble /cost', 'output Total cost: $0.03', 'bubble /rename demo', 'output Session renamed to: demo',
    ]);
  });

  it('is alone when it is placed after a turn a prompt opened, or before any turn', () => {
    const b = builder();
    output(b, 'o0', '<local-command-stdout>Before any turn</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    b.turn('u1', 'Summarise the notes.');
    b.text('m1', 0, 'Done.');
    b.end(['u1']);
    output(b, 'o1', '<local-command-stdout>Total cost: $0.04</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    expect(outputs(b.events).map((row) => [row.text, row.turnId, row.lone])).toEqual([['Before any turn', null, true], ['Total cost: $0.04', null, true]]);
  });
  // The re-review's finding on M1's fix wave: whether a loose output stands under its command is asked only for a loose
  // output, never per turn on every re-flatten. Counted in reads of the turns' events, not in time.
  it('a re-flatten with no loose output after a turn reads none of that turn’s events', () => {
    const b = builder();
    b.turn('u1', 'Summarise the notes.');
    b.text('m1', 0, 'Done.');
    b.end(['u1']);
    b.turn('u2', '/usage');
    output(b, 'o2', '<local-command-stdout>Total cost: $0.03</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    b.end(['u2']);
    const state = withAllExpanded(applyEvents(createState(null, null), b.events));
    rowsOf(state); // every turn derived and kept
    let reads = 0;
    for (const turn of state.turns.values()) {
      turn.events = new Proxy(turn.events, { get: (target, key, receiver) => { reads += 1; return Reflect.get(target, key, receiver); } });
    }
    const again = rowsOf({ ...state, loose: [...state.loose] }); // the list flattened again, no turn changed
    expect(again.some((row) => row.kind === 'local_command')).toBe(true);
    expect(reads).toBe(0);
  });

  // A loose row of another kind between a command's turn and its output: no recording holds one (the probes' files place
  // each output directly after its command's turn), so no order is written here for it. By the rule, its output would
  // then have no bubble directly above it and stand alone.

  it('copies as its line: the mark, then the output, the name first when it stands alone with a run, and no heading', () => {
    const b = builder();
    output(b, 'o0', '<local-command-stdout>## Context Usage\n\n**Tokens:** 1k</local-command-stdout>', commandEntry({ run: { command: 'context', args: '' }, plain: false }));
    output(b, 'o1', '<local-command-stdout>No run is known</local-command-stdout>');
    b.turn('u1', '/usage');
    output(b, 'o2', '<local-command-stdout>Total cost: $0.03</local-command-stdout>', commandEntry({ run: USAGE, plain: false }));
    b.end(['u1']);
    expect(outputs(b.events).map((row) => serializeRows([row]))).toEqual([
      '⎿ /context · ## Context Usage\n\n**Tokens:** 1k',
      '⎿ No run is known',
      '⎿ Total cost: $0.03',
    ]);
    expect(serializeRows(rows(b.events))).not.toContain('Command output');
  });

  it('draws nothing for an empty output or a setting change’s confirmation, as before', () => {
    const b = builder();
    b.turn('u1', '/effort low');
    output(b, 'o1', '<local-command-stdout>Set effort level to low (this session only): Quick, straightforward implementation with minimal overhead</local-command-stdout>', commandEntry({ run: { command: 'effort', args: 'low' }, plain: false }));
    b.end(['u1']);
    b.turn('u2', '/reload-plugins');
    output(b, 'o2', '<local-command-stdout></local-command-stdout>', commandEntry({ run: { command: 'reload-plugins', args: '' }, plain: false }));
    b.end(['u2']);
    expect(outputs(b.events)).toEqual([]);
  });
});
