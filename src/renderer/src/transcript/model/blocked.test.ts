// UX wave U1c, M2 (the U1c document, Design 1 and 3, Interfaces §A and §B): what a call auto mode blocked reads. The
// classifier's own reason, cut out of the engine's text as Claude Desktop cuts it; the name a grant gives a call, by the
// engine's rule; the rule by which a blocked row reads approved, waits or is blocked again, read from the transcript's
// rows alone; the advisory row a classifier block no longer draws once its call's row says it. Then the recordings, at
// the model's level: probe U1's (Acceptance 1 to 5), probe E's journal beside its transcript file (Acceptance 6) and probe
// B's joined grants (Acceptance 14's blocked rows).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { consentMessage } from '@shared/engine/arrival';
import type { DenialKind } from '@shared/graph/enums';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { describe, expect, it } from 'vitest';
import { ChainFollower } from '../../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../../test/support/memory-reader';
import { journalToEvents } from '../dev/journal';
import { approvalsFor, blockedCallOf, blockedKey, blockedStates, classifierReason, LINE_SUBJECT_MAX, lineNamesWhole, readsApproved, STAND_IN_REASONS, type BlockedState } from './blocked';
import { blockedLabel } from './cells';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Cell, CellId, Row, TurnId } from './rows';
import { builder, type Builder } from './test-events';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;

const OPENING = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: ';
/** The text the engine gives the model for a call its classifier blocked, around a reason (`cli.pretty.js` of 2.1.322). */
const engineText = (reason: string) => `${OPENING}${reason}. If you have other tasks that don't depend on this action, continue working on those.`;
const MARKER = (n: string) => `curl -s -o marker-${n}.txt "https://example.com/?maws-probe-marker-${n}"`;

describe('the classifier’s reason (Design 1)', () => {
  it('each of the four stand-in sentences is no reason', () => {
    expect(STAND_IN_REASONS.size).toBe(4);
    for (const standIn of STAND_IN_REASONS) expect(classifierReason(engineText(standIn)), standIn).toBeNull();
  });

  it('a reason the classifier gave is cut out of the engine’s text whole', () => {
    expect(classifierReason(engineText('Deletes files outside the working folder'))).toBe('Deletes files outside the working folder');
  });

  it('its white space is normalised, and a stand-in written with other white space is still none', () => {
    expect(classifierReason(engineText('Deletes  files\noutside\tthe working folder '))).toBe('Deletes files outside the working folder');
    expect(classifierReason(engineText('The server-side auto mode classifier judged this action\n dangerous (it gave no explanation)'))).toBeNull();
  });

  it('a reason longer than 1,000 characters is cut at a word and ends in an ellipsis', () => {
    const reason = classifierReason(engineText('word '.repeat(300).trim()))!;
    expect(reason.length).toBeLessThanOrEqual(1001);
    expect(reason.endsWith('…')).toBe(true);
    expect(reason.slice(0, -1).split(' ').every((part) => part === 'word')).toBe(true);
    expect(classifierReason(engineText('a'.repeat(1000)))).toBe('a'.repeat(1000));
  });

  it('a text that does not open as the engine’s, or has no end to its reason, gives none', () => {
    expect(classifierReason('Auto mode blocked this command: destructive deletion outside the workspace allowlist.')).toBeNull();
    expect(classifierReason(`Error: ${engineText('Deletes files')}`)).toBeNull();
    expect(classifierReason(`${OPENING}Deletes files, and nothing after it`)).toBeNull();
    expect(classifierReason(engineText(''))).toBeNull();
    expect(classifierReason('')).toBeNull();
  });
});

describe('what a grant names (Design 3, the engine’s rule)', () => {
  const command = (subject: string) => ({ kind: 'command', subject });

  it('a plain shell command is named by the command, whole and unchanged', () => {
    expect(blockedCallOf('Bash', { command: 'make build' })).toEqual(command('make build'));
    expect(blockedCallOf('PowerShell', { command: 'Get-ChildItem' })).toEqual(command('Get-ChildItem'));
    expect(blockedCallOf('Bash', { command: '  make\nbuild ' })).toEqual(command('  make\nbuild '));
  });

  it('with a description and a timeout, and with run_in_background or dangerouslyDisableSandbox set false', () => {
    expect(blockedCallOf('Bash', { command: 'make build', description: 'Build it', timeout: 120000 })).toEqual(command('make build'));
    expect(blockedCallOf('Bash', { command: 'make build', run_in_background: false })).toEqual(command('make build'));
    expect(blockedCallOf('Bash', { command: 'make build', dangerouslyDisableSandbox: false, run_in_background: false, description: 'Build it' })).toEqual(command('make build'));
  });

  it('no name for a shell call with an execution flag set or another key, an empty command, an MCP tool’s call or a file write', () => {
    expect(blockedCallOf('Bash', { command: 'make build', run_in_background: true })).toBeNull();
    expect(blockedCallOf('Bash', { command: 'make build', dangerouslyDisableSandbox: true })).toBeNull();
    expect(blockedCallOf('Bash', { command: 'make build', cwd: '/tmp' })).toBeNull();
    expect(blockedCallOf('Bash', { command: '' })).toBeNull();
    expect(blockedCallOf('Bash', { command: 3 })).toBeNull();
    expect(blockedCallOf('Bash', null)).toBeNull();
    expect(blockedCallOf('mcp__files__run', { command: 'make build' })).toBeNull();
    expect(blockedCallOf('Write', { file_path: '/tmp/out.txt', content: 'hello' })).toBeNull();
  });

  it('a command and a call of the same subject have different keys', () => {
    expect(blockedKey({ kind: 'command', subject: 'x' })).not.toBe(blockedKey({ kind: 'call', subject: 'x' }));
  });
});

// The rule over hand-made rows: only the fields the rule reads are written.
describe('the rule: whether a blocked row is approved, waits, or is blocked again (Design 3)', () => {
  let n = 0;
  const AT = '2026-11-15T10:00:00.000Z';
  const block = (turn: string, subject: string | null, kind: DenialKind = 'automode-blocked'): Row => ({
    kind: 'cell', id: `cell:t${(n += 1)}`, turnId: turn, at: AT, status: 'denied', toolName: 'Bash',
    classification: { denial: { kind, disposition: 'auto_denied', interruption: false, reason: null } }, ...(subject !== null && { blocked: { kind: 'command', subject } }),
  }) as unknown as Row;
  const person = (turn: string, text: string, extra: Partial<RowOf<'user'>> = {}): Row => ({
    kind: 'user', id: `user:m${(n += 1)}`, turnId: turn, at: AT, messageUuid: null, text, attachments: [], placeholders: [], lines: 1, editable: false, steer: false, dropped: false, ...extra,
  }) as unknown as Row;
  const approval = (turn: string, subject: string, extra: Partial<RowOf<'user'>> = {}) => person(turn, consentMessage('command', subject), { consent: { kind: 'command', subject }, ...extra });
  const read = (rows: Row[], hidden: readonly TurnId[] = []) => rows.flatMap((row) => {
    const state = blockedStates(rows, hidden).get(row.id as Cell['id']);
    return state === undefined ? [] : [`${row.id} ${state.call.subject}${state.again ? ' again' : ''} ${state.grant}${readsApproved(state) ? ' approved' : ''}`];
  });
  const T1 = 'turn:t1' as TurnId;
  const T2 = 'turn:t2' as TurnId;
  const T3 = 'turn:t3' as TurnId;

  it('a block and nothing after it: no grant, not again', () => {
    const rows = [block(T1, 'make build')];
    expect(read(rows)).toEqual([`${rows[0].id} make build none`]);
  });

  it('an approval after it that carries no waiting mark: the grant was read, and the row reads approved', () => {
    const rows = [block(T1, 'make build'), approval(T2, 'make build')];
    expect(read(rows)).toEqual([`${rows[0].id} make build read approved`]);
  });

  it('a waiting approval (at the next step, held, unread): it waits, and the row does not read approved', () => {
    for (const mark of [{ pending: 'next' }, { pending: 'held' }, { unread: true }] as const) {
      const rows = [block(T1, 'make build'), approval(T2, 'make build', mark)];
      expect(read(rows), JSON.stringify(mark)).toEqual([`${rows[0].id} make build waiting`]);
    }
  });

  it('a dropped approval is no grant (the button returns), and makes no later block “again”', () => {
    const rows = [block(T1, 'make build'), approval(T2, 'make build', { dropped: true }), block(T2, 'make build')];
    expect(read(rows)).toEqual([`${rows[0].id} make build none`, `${rows[2].id} make build none`]);
  });

  it('an approval read after one that waits: read', () => {
    const rows = [block(T1, 'make build'), approval(T2, 'make build', { pending: 'next' }), approval(T3, 'make build')];
    expect(read(rows)).toEqual([`${rows[0].id} make build read approved`]);
  });

  it('a hidden branch’s rows prove nothing: its approval is not counted, and its blocked row has no state', () => {
    const rows = [block(T1, 'make build'), approval(T2, 'make build'), block(T3, 'make build')];
    expect(read(rows, [T2])).toEqual([`${rows[0].id} make build none`, `${rows[2].id} make build none`]);
    expect(read(rows, [T1])).toEqual([`${rows[2].id} make build again none`]);
  });

  it('two blocked rows of one key before one approval: a grant after them approves each', () => {
    const rows = [block(T1, 'make build'), block(T1, 'make build'), approval(T2, 'make build')];
    expect(read(rows)).toEqual([`${rows[0].id} make build read approved`, `${rows[1].id} make build read approved`]);
  });

  it('a block, an approval and a block inside one turn: the first approved, the second again with no grant', () => {
    const rows = [block(T1, 'make build'), approval(T1, 'make build', { steer: true }), block(T1, 'make build')];
    expect(read(rows)).toEqual([`${rows[0].id} make build read approved`, `${rows[2].id} make build again none`]);
  });

  it('an approval for another command approves nothing', () => {
    const rows = [block(T1, 'make build'), approval(T2, 'make check')];
    expect(read(rows)).toEqual([`${rows[0].id} make build none`]);
  });

  it('a row that reads approved from a press alone: a `user` row without `consent` whose text is the grant is no approval row', () => {
    const grant = consentMessage('command', 'make build');
    const rows = [person(T1, grant), block(T1, 'make build'), person(T2, grant)];
    expect(read(rows)).toEqual([`${rows[1].id} make build none`]);
  });

  it('a blocked call with no name and a call the classifier could not judge have no state', () => {
    const rows = [block(T1, null), block(T1, 'make build', 'automode-parsing-error'), approval(T2, 'make build')];
    expect(read(rows)).toEqual([]);
  });

  it('the approval rows for a key after the pressed row count every one, read, waiting and dropped, outside a hidden branch', () => {
    const rows = [block(T1, 'make build'), approval(T1, 'make build', { dropped: true }), approval(T2, 'make build', { pending: 'next' }), approval(T2, 'make build'), approval(T2, 'make check'), approval(T3, 'make build')];
    const key = blockedKey({ kind: 'command', subject: 'make build' });
    const pressed = rows[0].id as CellId;
    expect(approvalsFor(rows, [], key, pressed)).toBe(4);
    expect(approvalsFor(rows, [T3], key, pressed)).toBe(3);
    expect(approvalsFor(rows, [], blockedKey({ kind: 'call', subject: 'make build' }), pressed)).toBe(0);
  });

  it('the command blocked twice: the approval between the two rows counts for the earlier row’s press and not for the later’s (finding 1)', () => {
    const rows = [block(T1, 'make build'), approval(T1, 'make build'), block(T2, 'make build'), approval(T2, 'make build', { pending: 'next' })];
    const key = blockedKey({ kind: 'command', subject: 'make build' });
    expect(approvalsFor(rows, [], key, rows[0].id as CellId)).toBe(2);
    expect(approvalsFor(rows, [], key, rows[2].id as CellId)).toBe(1);
  });

  it('the pressed cell drawn as a member of a run of calls on one line, the run opened or folded: the count starts at the run (finding 1)', () => {
    const pressed = block(T2, 'make build') as Cell;
    const before = approval(T1, 'make build');
    for (const expanded of [true, false]) {
      const run = { kind: 'group', id: `group:${pressed.id}`, turnId: T2, at: AT, state: 'completed', cells: [block(T2, 'make check') as Cell, pressed], summary: '', counts: { added: 0, removed: 0 }, icon: 'commands', expanded } as unknown as Row;
      const rows = [before, run, approval(T3, 'make build')];
      expect(approvalsFor(rows, [], blockedKey({ kind: 'command', subject: 'make build' }), pressed.id), `the run ${expanded ? 'opened' : 'folded'}`).toBe(1);
    }
  });

  it('rows that do not hold the pressed row lie wholly after it: every approval of the key there counts, as many as stand after the row or fewer, never more', () => {
    const history = [block(T1, 'make build'), approval(T1, 'make build'), block(T2, 'make build'), approval(T2, 'make build')];
    const key = blockedKey({ kind: 'command', subject: 'make build' });
    const pressed = history[2].id as CellId;
    const newer = history.slice(3); // the store let the history up to the pressed row go
    expect(approvalsFor(newer, [], key, pressed)).toBe(1);
    expect(approvalsFor(newer, [], key, pressed)).toBeLessThanOrEqual(approvalsFor(history, [], key, pressed));
    expect(approvalsFor([], [], key, pressed), 'no rows loaded').toBe(0);
  });

  it('is memoised on the rows and the hidden turns', () => {
    const rows = [block(T1, 'make build'), approval(T2, 'make build')];
    const hidden: readonly TurnId[] = [];
    expect(blockedStates(rows, hidden)).toBe(blockedStates(rows, hidden));
    expect(blockedStates(rows, [T2])).not.toBe(blockedStates(rows, hidden));
    expect(blockedStates([...rows], hidden)).not.toBe(blockedStates(rows, hidden));
  });
});

/** Every row drawn with every turn and cell open. */
const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
const stateOf = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const isBlockedRow = (row: Row): row is RowOf<'cell'> => row.kind === 'cell' && row.classification.denial?.kind === 'automode-blocked';
/** Each blocked row as its line reads it, with the state the rule gives it. */
function readings(state: TranscriptState): string[] {
  const rows = drawn(state);
  const states = blockedStates(rows, state.hidden?.turns ?? []);
  return rows.filter(isBlockedRow).map((cell) => {
    const blocked: BlockedState | undefined = states.get(cell.id);
    return blocked === undefined ? `${cell.label} (no name)` : `${blockedLabel(cell, blocked)} (${blocked.grant})`;
  });
}
/** What a person reads on every row that says something of a refusal: a cell's label and error, a notice's text. */
const rowTexts = (rows: Row[]): string[] => rows.flatMap((row) => (row.kind === 'cell' ? [row.label, row.error ?? ''] : row.kind === 'group' ? row.cells.flatMap((cell) => [cell.label, cell.error ?? '']) : row.kind === 'error' ? [row.text] : []));
const advisoryRows = (rows: Row[]) => rows.filter((row) => row.kind === 'error' && row.text.startsWith(OPENING));
/** The events of a journal, grouped by the journal row each came from (`replay:journal:<seq>:<n>`), in order. */
function bySeq(rows: JournalRow[]): [number, SessionEvent[]][] {
  const groups = new Map<number, SessionEvent[]>();
  for (const event of journalToEvents(rows)) {
    const seq = Number((event.id as string).split(':')[2]);
    groups.set(seq, [...(groups.get(seq) ?? []), event]);
  }
  return [...groups];
}
const frameOf = (row: JournalRow) => row.frame as { type?: string; subtype?: string; message?: { content?: unknown } };
const grantSeqOf = (rows: JournalRow[]) => rows.find((row) => row.direction === 'out' && frameOf(row).type === 'user' && typeof frameOf(row).message?.content === 'string' && (frameOf(row).message!.content as string).startsWith('Permission granted'))!.seq;

describe('probe U1’s recordings (Acceptance 1 to 5, at the model’s level)', () => {
  it('Acceptance 1: approve, and the retry runs (u1-soft-seeded-1 to -5): from the grant’s frame on, at every prefix, the row never reads ungranted; once read it ends “· approved”', () => {
    for (const n of ['1', '2', '3', '4', '5']) {
      const name = `u1-soft-seeded-${n}`;
      const journal = loadUxwaveJournal(name);
      const grantSeq = grantSeqOf(journal);
      let state = createState(null, null);
      let firstBlockSeq: number | null = null;
      for (const [seq, events] of bySeq(journal)) {
        state = applyEvents(state, events);
        const now = readings(state);
        if (now.length > 0) firstBlockSeq ??= seq;
        if (seq < grantSeq) expect(now.every((line) => line === `Auto mode blocked: \`${MARKER(n)}\` (none)`), `${name} at ${seq}: ${now.join('; ')}`).toBe(true);
        else expect(now.length === 1 && !now[0].endsWith('(none)'), `${name} at ${seq}: ${now.join('; ')}`).toBe(true);
      }
      expect(firstBlockSeq, `${name}: the block is drawn before the grant`).not.toBeNull();
      expect(firstBlockSeq!).toBeLessThan(grantSeq);
      expect(readings(state), `${name} at rest`).toEqual([`Auto mode blocked: \`${MARKER(n)}\` · approved (read)`]);
      const rows = drawn(state);
      const approvals = rows.filter((row): row is RowOf<'user'> => row.kind === 'user' && row.consent !== undefined);
      expect(approvals.map((row) => row.consent!.subject), `${name}: the line “You approved …”`).toEqual([MARKER(n)]);
      const calls = rows.filter((row): row is RowOf<'cell'> => row.kind === 'cell' && row.toolName === 'Bash');
      expect(calls.map((cell) => cell.status), `${name}: the block, then the retry that ran`).toEqual(['denied', 'done']);
    }
  });

  it('Acceptance 2: blocked again (u1-hard-seeded-1 to -3): the first row approved, the retry’s row “again”, with no grant', () => {
    for (const n of ['1', '2', '3']) {
      const name = `u1-hard-seeded-${n}`;
      expect(readings(stateOf(journalToEvents(loadUxwaveJournal(name)))), name).toEqual([`Auto mode blocked: \`${MARKER(n)}\` · approved (read)`, `Auto mode blocked again: \`${MARKER(n)}\` (none)`]);
    }
  });

  it('Acceptance 3: two blocks in a row, then the engine asks (u1-streak-seeded-1, -2): two blocked rows, neither again; the third and fourth calls ran', () => {
    for (const n of ['1', '2']) {
      const name = `u1-streak-seeded-${n}`;
      const state = stateOf(journalToEvents(loadUxwaveJournal(name)));
      expect(readings(state), name).toEqual([`Auto mode blocked: \`${MARKER(`${n}a`)}\` (none)`, `Auto mode blocked: \`${MARKER(`${n}b`)}\` (none)`]);
      const others = drawn(state).flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' && !isBlockedRow(row) ? [row] : [])).filter((cell) => cell.toolName === 'Bash');
      expect(others.map((cell) => [cell.detail.kind === 'shell' && cell.detail.command, cell.status, cell.classification.denial]), name).toEqual([[MARKER(`${n}c`), 'done', null], [MARKER(`${n}d`), 'done', null]]);
    }
  });

  it('Acceptance 4: no block, no row (u1-norule-seeded-1, -2): no blocked row, and the grant the probe sent still draws as the approval’s line', () => {
    for (const name of ['u1-norule-seeded-1', 'u1-norule-seeded-2']) {
      const rows = drawn(stateOf(journalToEvents(loadUxwaveJournal(name))));
      expect(rows.filter(isBlockedRow), name).toEqual([]);
      expect(rows.filter((row) => row.kind === 'user' && row.consent !== undefined).length, name).toBe(1);
    }
  });

  it('Acceptance 5: over every recorded block no row’s text holds the stand-in; the advisory is drawn from its frame until its call’s result, and not from the result on', () => {
    let blocks = 0;
    for (const name of ['u1-soft-seeded-1', 'u1-soft-seeded-2', 'u1-soft-seeded-3', 'u1-soft-seeded-4', 'u1-soft-seeded-5', 'u1-hard-seeded-1', 'u1-hard-seeded-2', 'u1-hard-seeded-3', 'u1-streak-seeded-1', 'u1-streak-seeded-2']) {
      const journal = loadUxwaveJournal(name);
      const advised = journal.filter((row) => frameOf(row).type === 'system' && frameOf(row).subtype === 'permission_denied').map((row) => row.seq);
      let state = createState(null, null);
      let drawnBetween = 0;
      for (const [seq, events] of bySeq(journal)) {
        state = applyEvents(state, events);
        const rows = drawn(state);
        // between an advisory's frame and its call's result (the next journal row that is a tool result) the advisory is drawn
        const open = advised.filter((at) => at <= seq && !journal.some((row) => row.seq > at && row.seq <= seq && frameOf(row).type === 'user' && Array.isArray(frameOf(row).message?.content)));
        expect(advisoryRows(rows).length, `${name} at ${seq}`).toBe(open.length);
        drawnBetween += open.length > 0 ? 1 : 0;
      }
      const rows = drawn(state);
      blocks += rows.filter(isBlockedRow).length;
      expect(advised.length, `${name}: one advisory per block`).toBe(rows.filter(isBlockedRow).length);
      expect(drawnBetween, `${name}: some prefix holds an advisory and not yet its result`).toBeGreaterThan(0);
      expect(rowTexts(rows).filter((text) => text.includes('it gave no explanation')), name).toEqual([]);
    }
    expect(blocks).toBe(15);
  });
});

describe('a classifier block’s advisory row, and every other advisory (Design 1, ruling F6)', () => {
  const advisory = (b: Builder, call: string) => b.emit('notice.posted', { level: 'info', text: engineText('Deletes files outside the working folder'), key: `permission_denied:${call}` });
  const notices = (b: Builder) => drawn(stateOf(b.events)).filter((row) => row.kind === 'error').map((row) => (row as RowOf<'error'>).text);

  it('is not drawn once its call’s result says auto mode blocked it; drawn before the result arrives', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'rm -rf /tmp/out' });
    advisory(b, 't1');
    expect(notices(b), 'before the result').toHaveLength(1);
    b.result('t1', engineText('Deletes files outside the working folder'), { isError: true, denial: 'automode-blocked' });
    expect(notices(b), 'from the result on').toEqual([]);
    b.end(['u1']);
    expect(notices(b), 'once the turn ends').toEqual([]);
  });

  it('a reason that is not a stand-in is shown on the row', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'rm -rf /tmp/out' });
    b.result('t1', engineText('Deletes files outside the working folder'), { isError: true, denial: 'automode-blocked' });
    b.end(['u1']);
    expect(readings(stateOf(b.events))).toEqual(['Auto mode blocked: `rm -rf /tmp/out` · Deletes files outside the working folder (none)']);
  });

  it('an advisory dropped for a call that is not a classifier block must stay drawn: a permission rule’s, a review that could not judge, a call with no result, another call’s block, another key, one outside any turn', () => {
    const cases: [string, (b: Builder) => void][] = [
      ['a permission rule’s refusal', (b) => b.result('t1', 'Denied by a rule', { isError: true, denial: 'permission-rule' })],
      ['a review that could not judge (automode-parsing-error)', (b) => b.result('t1', 'unreadable', { isError: true, denial: 'automode-parsing-error' })],
      ['a call that never gets a result', () => {}],
      ['a call that failed without a refusal', (b) => b.result('t1', 'exit 1', { isError: true })],
      ['a block of another call', (b) => { b.toolUse('t2', 'Bash', { command: 'make build' }); b.result('t2', engineText('Builds'), { isError: true, denial: 'automode-blocked' }); }],
    ];
    for (const [name, then] of cases) {
      const b = builder();
      b.turn('u1');
      b.toolUse('t1', 'Bash', { command: 'rm -rf /tmp/out' });
      advisory(b, 't1');
      then(b);
      b.end(['u1']);
      expect(notices(b), name).toHaveLength(1);
    }
    const other = builder();
    other.turn('u1');
    other.toolUse('t1', 'Bash', { command: 'rm -rf /tmp/out' });
    other.emit('notice.posted', { level: 'info', text: 'Something else', key: 'permission_denied_t1' });
    other.result('t1', engineText('Deletes files'), { isError: true, denial: 'automode-blocked' });
    other.end(['u1']);
    expect(notices(other), 'a notice of another key').toEqual(['Something else']);
    const loose = builder();
    advisory(loose, 't1');
    loose.turn('u1');
    loose.toolUse('t1', 'Bash', { command: 'rm -rf /tmp/out' });
    loose.result('t1', engineText('Deletes files'), { isError: true, denial: 'automode-blocked' });
    loose.end(['u1']);
    expect(notices(loose), 'one outside any turn').toHaveLength(1);
  });
});

describe('probe E: one block, its grant and its retry, as journal and as transcript file (Acceptance 6)', () => {
  const SESSION = '0f0e0d0c-0000-4000-8000-00000000c0de' as SessionId;
  const fromFile = async (name: string): Promise<SessionEvent[]> => {
    const events: SessionEvent[] = [];
    const follower = new ChainFollower(new MemoryFileReader(readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.transcript.jsonl`))), SESSION, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
    await follower.start();
    follower.stop();
    return events;
  };
  const isGrant = (event: SessionEvent) => event.kind === 'user.message' && typeof event.content === 'string' && event.content.startsWith('Permission granted');
  const BLOCKED = `Auto mode blocked: \`${MARKER('1')}\``;

  it('u1c-e-1: the same row states from both, applied whole, in two batches split at the grant, and in a fresh state', async () => {
    const routes = { live: journalToEvents(loadUxwaveJournal('u1c-e-1')), file: await fromFile('u1c-e-1') };
    for (const [route, events] of Object.entries(routes)) {
      const at = events.findIndex(isGrant);
      expect(at, `${route}: the grant`).toBeGreaterThan(0);
      const before = applyEvents(createState(null, null), events.slice(0, at));
      expect(readings(before), `${route}, before the grant`).toEqual([`${BLOCKED} (none)`]);
      expect(readings(applyEvents(before, events.slice(at))), `${route}, in two batches`).toEqual([`${BLOCKED} · approved (read)`]);
      expect(readings(stateOf(events)), `${route}, whole`).toEqual([`${BLOCKED} · approved (read)`]);
      expect(readings(stateOf(events)), `${route}, in a fresh state`).toEqual([`${BLOCKED} · approved (read)`]);
      const rows = drawn(stateOf(events));
      expect(advisoryRows(rows), `${route}: no advisory row`).toEqual([]);
      expect(rows.filter((row) => row.kind === 'cell' && row.toolName === 'Bash').map((row) => (row as RowOf<'cell'>).status), route).toEqual(['denied', 'done']);
    }
  });

  it('u1c-e-1: the blocked row has one cell id live and from the file, so a press remembers the same row on either route; the grant is the one approval after it', async () => {
    const routes = { live: journalToEvents(loadUxwaveJournal('u1c-e-1')), file: await fromFile('u1c-e-1') };
    const key = blockedKey({ kind: 'command', subject: MARKER('1') });
    const ids = Object.entries(routes).map(([route, events]) => {
      const at = events.findIndex(isGrant);
      const [id] = [...blockedStates(drawn(stateOf(events.slice(0, at))), []).keys()];
      expect(id, route).toBeDefined();
      expect(approvalsFor(drawn(stateOf(events.slice(0, at))), [], key, id!), `${route}, before the grant`).toBe(0);
      expect(approvalsFor(drawn(stateOf(events)), [], key, id!), `${route}, whole`).toBe(1);
      expect([...blockedStates(drawn(stateOf(events)), []).keys()], `${route}, whole`).toEqual([id]);
      return id;
    });
    expect(ids[0]).toBe(ids[1]);
  });
});

describe('probe B’s joined grants: each blocked row before them reads approved, live and from the file (Acceptance 14’s blocked rows)', () => {
  const SESSION = '0f0e0d0c-0000-4000-8000-00000000c0de' as SessionId;
  const fromFile = async (name: string): Promise<SessionEvent[]> => {
    const events: SessionEvent[] = [];
    const follower = new ChainFollower(new MemoryFileReader(readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.transcript.jsonl`))), SESSION, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
    await follower.start();
    follower.stop();
    return events;
  };
  const cases: [string, string[]][] = [
    ['u1c-b-join-grant-first-1', ['1']],
    ['u1c-b-join-other-first-1', ['1']],
    ['u1c-b-two-1', ['1a', '1b']],
    ['u1c-b-joinend-grant-first-1', ['1']],
    ['u1c-b-joinend-other-first-1', ['1']],
    ['u1c-b-twoend-1', ['1a', '1b']],
  ];
  for (const [name, markers] of cases) {
    it(`${name}: ${markers.map((marker) => `marker-${marker}`).join(', ')} approved`, async () => {
      const expected = markers.map((marker) => `Auto mode blocked: \`${MARKER(marker)}\` · approved (read)`);
      expect(readings(stateOf(journalToEvents(loadUxwaveJournal(name)))), `${name}, live`).toEqual(expected);
      expect(readings(stateOf(await fromFile(name))), `${name}, from the file`).toEqual(expected);
    });
  }
});

// M3 (Design 6; Interfaces §E; Decision Log 8): where the row's line names the grant's subject whole, a rule of strings.
describe('whether the line names the subject whole (lineNamesWhole)', () => {
  const shell = (command: string): Cell => ({ toolName: 'Bash', detail: { kind: 'shell', command } }) as unknown as Cell;
  const command = (subject: string) => ({ kind: 'command' as const, subject });

  it('a one-line command drawn as that same string, up to LINE_SUBJECT_MAX (200) units; 201 is not', () => {
    expect(LINE_SUBJECT_MAX).toBe(200);
    const at200 = `echo ${'a'.repeat(195)}`;
    const at201 = `${at200}a`;
    expect([at200.length, at201.length]).toEqual([200, 201]);
    expect(lineNamesWhole(shell(at200), command(at200))).toBe(true);
    expect(lineNamesWhole(shell(at201), command(at201))).toBe(false);
    expect(lineNamesWhole(shell('make build'), command('make build'))).toBe(true);
  });

  it('not for a line break, a carriage return or a backtick, a drawn command that differs from the grant’s, a call, or a drawing that is no shell’s', () => {
    for (const subject of ['make build\nmake test', 'make build\r', 'echo `date`']) expect(lineNamesWhole(shell(subject), command(subject)), JSON.stringify(subject)).toBe(false);
    expect(lineNamesWhole(shell('rm -rf build '), command('rm -rf build\u00a0')), 'a mod’s rewrite').toBe(false);
    expect(lineNamesWhole(shell('make build'), { kind: 'call', subject: 'make build' })).toBe(false);
    expect(lineNamesWhole({ toolName: 'Write', detail: { kind: 'edit', filePath: '/tmp/x' } } as unknown as Cell, command('/tmp/x'))).toBe(false);
  });
});
