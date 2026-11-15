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
