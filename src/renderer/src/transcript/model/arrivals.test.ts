// UX wave U3, first landing, M2 (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, Interfaces C and D;
// decisions 4 to 6, 8, 10, 11 and 21): the rows the model makes of what entered a session, from hand-made event lists in
// the shapes Interfaces C defines (today's callers do not emit them yet). Every name, address and word is invented.
import type { SessionEvent } from '@shared/graph/events';
import type { ArrivalEntry, CarriedArrival } from '@shared/engine/arrival-schema';
import { describe, expect, it } from 'vitest';
import { consentMessage } from '@shared/engine/arrival';
import { isPersistentRow, rowsOf, turnRows, withAllExpanded } from './derive';
import { NOTICE } from './copy';
import { rowId, turnId } from './keys';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row } from './rows';
import { builder, task as taskId, tool, uuid, type Builder } from './test-events';

type Task = Extract<CarriedArrival, { class: 'task' }>;
type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;

const reduce = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const expanded = (events: SessionEvent[]) => rowsOf(withAllExpanded(reduce(events)));
const shown = (list: Row[]) => list.filter((row) => row.kind !== 'time');
const kinds = (list: Row[]) => shown(list).map((row) => row.kind);
const of = <K extends Row['kind']>(list: Row[], kind: K) => list.filter((row): row is RowOf<K> => row.kind === kind);

const OK = 'Background command "count files" completed (exit code 0)';
const FAILED = 'Background command "check links" failed with exit code 1';
const STOPPED = 'Task "watch logs" was stopped by the user or by the app connected to this session';
const MONITOR_EVENT = 'Monitor "watch logs" event: a line arrived';
const task = (over: Partial<Task> = {}): Task => ({ class: 'task', taskId: 'bt1', toolUseId: 'tu-bt1', runId: 'run-1', outcome: 'completed', summary: OK, durationMs: null, outputFile: '/tmp/work/bt1.output', detail: null, ...over });

// The events of Interfaces C: a turn the engine opened, and a synthetic message carrying arrivals. `content` is the
// carrier's text, and '' where the engine host made the message itself.
const engineTurn = (b: Builder, at?: string) => b.emit('turn.started', { userMessageUuid: at === undefined ? null : uuid(at), origin: 'engine' });
const carry = (b: Builder, id: string, arrival: ArrivalEntry[], content = '<task-notification>…</task-notification>') =>
  b.emit('user.message', { messageUuid: uuid(id), content, isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival });
const endEngine = (b: Builder, numTurns = 1) => b.end([], { origin: 'task-notification', numTurns });
const B = 'uds:/tmp/socks/9.sock';
const peerTurn = (b: Builder, text = 'hello from the docs session', synthetic = true, content = `<cross-session-message from="${B}" from-name="docs">\n${text}\n</cross-session-message>`) => {
  b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
  b.emit('user.message', { messageUuid: uuid('p1'), content, isReplay: true, isSynthetic: synthetic, origin: 'peer', bash: null });
  b.emit('peer.message', { messageUuid: uuid('p1'), from: B, fromSession: null, fromName: 'docs', fromMode: null, fromPlugin: null, hopChain: [], text, midTurn: false, lineage: 'peer', replyable: true });
};
const divider = (list: Row[], n = 0) => of(list, 'divider')[n]!;

describe('where an arrival’s row sits (decision 5)', () => {
  it('a task’s end that opened the engine’s turn stands above its divider, drawn as soon as the turn opens', () => {
    const b = builder();
    engineTurn(b);
    carry(b, 'n1', [task()]);
    expect(kinds(rowsOf(reduce(b.events)))).toEqual(['notice', 'divider']); // the turn is open: no result yet
    b.text('m1', 0, 'The count is done.');
    endEngine(b);
    const list = rowsOf(reduce(b.events));
    expect(kinds(list)).toEqual(['notice', 'divider', 'assistant_text']);
    expect(of(list, 'notice')[0]).toMatchObject({ id: rowId.notice('run-1', uuid('n1'), 0), class: 'task', outcome: 'completed', text: OK, taskId: 'bt1', toolUseId: 'tu-bt1', outputFile: '/tmp/work/bt1.output', durationMs: null, detail: null });
  });

  it('in a turn the person’s prompt opened, a task’s end delivered with the prompt stands directly above the prompt', () => {
    const b = builder();
    b.turn('u1', 'what next?');
    carry(b, 'n1', [task({ runId: null, outcome: 'stopped', summary: STOPPED })]);
    b.text('m1', 0, 'Noted.');
    b.end(['u1']);
    expect(kinds(rowsOf(reduce(b.events)))).toEqual(['notice', 'user', 'assistant_text']); // no work: no divider
    expect(of(expanded(b.events), 'notice')[0]).toMatchObject({ id: rowId.notice(null, uuid('n1'), 0), outcome: 'stopped', text: STOPPED });
  });

  it('one taken in among the work stands at that point and counts as work for where the answer starts', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 1' });
    b.result('t1', 'ok');
    b.text('m1', 0, 'Waiting on the job.');
    carry(b, 'n1', [task({ outcome: 'failed', summary: FAILED })]);
    b.text('m2', 0, 'It failed; here is why.');
    b.end(['u1']);
    const list = expanded(b.events);
    expect(kinds(list)).toEqual(['user', 'divider', 'cell', 'assistant_text', 'notice', 'assistant_text']);
    expect(of(list, 'assistant_text').map((row) => row.phase)).toEqual(['commentary', 'answer']);
    expect(of(list, 'notice')[0]).toMatchObject({ outcome: 'failed', text: FAILED });
  });

  it('any other arrival at a turn’s head is the first row under the divider, and the divider of a turn the person did not start names it', () => {
    const b = builder();
    engineTurn(b);
    carry(b, 'w1', [{ class: 'wake' }], 'the bridge’s prompt');
    endEngine(b);
    peerTurn(b);
    b.end([], { origin: 'peer' });
    b.turn('u1');
    carry(b, 'n1', [task()]);
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a');
    b.end(['u1']);
    const list = expanded(b.events);
    expect(kinds(list)).toEqual(['divider', 'notice', 'divider', 'agent_message', 'notice', 'user', 'divider', 'cell']);
    expect(divider(list, 0).opener).toEqual({ class: 'wake', line: NOTICE.wake });
    expect(divider(list, 1).opener).toEqual({ class: 'peer', line: 'Message from @docs: hello from the docs session' });
    expect(divider(list, 2).opener).toBeUndefined(); // the person's own turn
  });

  it('names a turn by the first arrival at its head, above the divider or under it, and by none that came after work began', () => {
    const b = builder();
    engineTurn(b);
    carry(b, 'n1', [task()]);
    carry(b, 'w1', [{ class: 'wake' }]);
    endEngine(b);
    engineTurn(b);
    b.text('m1', 0, 'Picking up.');
    carry(b, 'n2', [task({ runId: 'run-2' })]);
    endEngine(b);
    const list = expanded(b.events);
    expect(divider(list, 0).opener).toEqual({ class: 'task', line: OK });
    expect(divider(list, 1).opener).toBeUndefined();
  });
});

describe('what stays through a fold (Interfaces D)', () => {
  it('a task’s end with an outcome and a scheduled fire stay; a notice with no outcome, an answer, the wake and every message fold', () => {
    const b = builder();
    engineTurn(b);
    carry(b, 'n1', [task()]);
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a');
    carry(b, 'n2', [task({ runId: 'run-2', outcome: 'failed', summary: FAILED })]);
    carry(b, 'n3', [task({ runId: null, outcome: null, summary: MONITOR_EVENT })]);
    carry(b, 'n4', [{ class: 'schedule', prompt: 'tidy the notes folder' }]);
    carry(b, 'a1', [{ class: 'answer', tool: 'sminos', call: 'tu-ask', summary: 'The user answered: "Pick one?"="the first"', answers: null, dismissed: false }]);
    carry(b, 'w1', [{ class: 'wake' }]);
    b.emit('peer.message', { messageUuid: uuid('p1'), from: B, fromSession: null, fromName: 'docs', fromMode: null, fromPlugin: null, hopChain: [], text: 'one more thing', midTurn: true, lineage: 'peer', replyable: true });
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a1' as never, toAgentId: null, text: '[Subagent hand-back] Framed. The report follows:\n  all done' });
    b.text('m1', 0, 'Done.');
    endEngine(b);
    const folded = shown(rowsOf(reduce(b.events)));
    expect(folded.map((row) => (row.kind === 'notice' ? `notice:${row.class}:${row.outcome}` : row.kind))).toEqual(['notice:task:completed', 'divider', 'notice:task:failed', 'notice:schedule:null', 'assistant_text']);
    const all = shown(expanded(b.events));
    expect(all.filter((row) => !isPersistentRow(row)).map((row) => (row.kind === 'notice' ? `notice:${row.class}` : row.kind))).toEqual(['divider', 'cell', 'notice:task', 'notice:answer', 'notice:wake', 'agent_message', 'agent_message']);
  });

  it('leaves a subagent’s started and finished rows as they were (l2-transcript-14)', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('ag1', 'Agent', { description: 'Survey notes', subagent_type: 'general-purpose', prompt: 'go' });
    b.emit('subagent.started', { taskId: taskId('a1'), toolUseId: tool('ag1'), description: 'Survey notes', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: 'go' });
    b.result('ag1', 'Async agent launched', { structured: { status: 'async_launched', agentId: 'a1' } });
    b.emit('subagent.finished', { taskId: taskId('a1'), status: 'completed', summary: null, outputFile: null, reason: null });
    b.end(['u1']);
    expect(of(expanded(b.events), 'subagent').map((row) => [row.sentence, row.status])).toEqual([['Survey notes finished', 'finished']]);
  });
});

describe('one arrival per uuid (decision 8)', () => {
  // Each step derives the rows, so a turn whose rows the memo kept from before the step would show here.
  it('a withdrawal takes the line out of its turn, and a later message under the uuid places it on the later turn', () => {
    const b = builder();
    engineTurn(b);
    const first = turnId.ofEvent(b.events[0]!.id);
    carry(b, 'n1', [task()], '');
    let state: TranscriptState = reduce(b.events);
    expect(of(turnRows(state, first)!, 'notice')).toHaveLength(1);
    expect(of(rowsOf(state), 'notice')).toHaveLength(1);
    const step = (emit: () => void) => {
      const from = b.events.length;
      emit();
      state = applyEvents(state, b.events.slice(from));
    };
    step(() => carry(b, 'n1', [], '')); // withdrawn
    expect(of(turnRows(state, first)!, 'notice')).toEqual([]);
    expect(of(rowsOf(state), 'notice')).toEqual([]);
    step(() => {
      b.text('m1', 0, 'Not this one.');
      endEngine(b);
      engineTurn(b);
    });
    const second = state.order.at(-1)!;
    step(() => carry(b, 'n1', [task()], '')); // placed again, on the later turn
    expect(of(turnRows(state, first)!, 'notice')).toEqual([]);
    expect(of(turnRows(state, second)!, 'notice').map((row) => row.id)).toEqual([rowId.notice('run-1', uuid('n1'), 0)]);
    expect(shown(rowsOf(state)).map((row) => `${row.kind}:${row.turnId === first ? 1 : 2}`)).toEqual(['divider:1', 'assistant_text:1', 'notice:2', 'divider:2']);
    step(() => carry(b, 'n1', [task()], '')); // and again on the same turn: still one line
    expect(of(rowsOf(state), 'notice')).toHaveLength(1);
  });

  it('a withdrawal under a uuid that placed no line changes nothing', () => {
    const b = builder();
    engineTurn(b);
    carry(b, 'n1', [task()], '');
    const state = reduce(b.events);
    const before = rowsOf(state);
    const after = applyEvents(state, [{ ...b.events[1]!, id: 'withdraw-other' as never, messageUuid: uuid('n9'), arrival: [] } as SessionEvent]);
    expect(rowsOf(after)).toBe(before);
  });

  it('a list that holds only entries of classes this build does not know draws nothing and withdraws nothing (decision 20)', () => {
    const b = builder();
    engineTurn(b);
    carry(b, 'n1', [task()], '');
    carry(b, 'n1', [{ class: 'command', run: { command: 'cost', args: '' } }], '');
    carry(b, 'n2', [{ class: 'command', run: null }, task({ runId: null, summary: FAILED, outcome: 'failed' })]);
    expect(of(rowsOf(reduce(b.events)), 'notice').map((row) => [row.id, row.text])).toEqual([
      [rowId.notice('run-1', uuid('n1'), 0), OK],
      [rowId.notice(null, uuid('n2'), 1), FAILED], // its place in the carrier counts the unknown entry
    ]);
  });
});

describe('a provisional line needs its turn’s end (decision 21)', () => {
  const provisional = (b: Builder) => {
    engineTurn(b);
    carry(b, 'h1', [task({ runId: 'run-h', summary: 'Monitor "watch logs" stream ended', outcome: 'completed' })], ''); // the host made it
    carry(b, 'f1', [task({ runId: 'run-f', summary: OK })]); // a frame carried it
  };
  const lines = (list: Row[]) => of(list, 'notice').map((row) => row.id);

  it('a turn the process’s exit closes loses a task line the host placed at its head, and keeps one a frame made', () => {
    const b = builder();
    provisional(b);
    expect(lines(rowsOf(reduce(b.events)))).toEqual([rowId.notice('run-h', uuid('h1'), 0), rowId.notice('run-f', uuid('f1'), 0)]);
    b.emit('process.exited', { code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null });
    expect(lines(rowsOf(reduce(b.events)))).toEqual([rowId.notice('run-f', uuid('f1'), 0)]);
  });

  it('so does a turn a later turn’s start closes', () => {
    const b = builder();
    provisional(b);
    b.turn('u1');
    const list = rowsOf(reduce(b.events));
    expect(lines(list)).toEqual([rowId.notice('run-f', uuid('f1'), 0)]);
    expect(of(list, 'divider').map((row) => row.state)).toEqual(['completed', 'working']);
  });

  it('a turn whose only line was provisional and that a later start closes is no turn at all', () => {
    const b = builder();
    engineTurn(b);
    carry(b, 'h1', [task()], '');
    b.turn('u1');
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    expect(lines(rowsOf(state))).toEqual([]);
  });

  it('a turn the interrupt marker closed keeps both: its result still comes', () => {
    const b = builder();
    provisional(b);
    b.emit('user.message', { messageUuid: uuid('int'), content: '[Request interrupted by user]', isReplay: false, isSynthetic: false, origin: 'interrupt-marker', bash: null });
    expect(lines(rowsOf(reduce(b.events)))).toEqual([rowId.notice('run-h', uuid('h1'), 0), rowId.notice('run-f', uuid('f1'), 0)]);
  });
});

describe('an engine turn that held nothing is no turn (decision 6)', () => {
  it('one whose end says it ran nothing and that holds nothing is not among the turns; one that holds a row is', () => {
    const b = builder();
    b.turn('u1');
    b.end(['u1']);
    engineTurn(b);
    endEngine(b, 0);
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    expect(kinds(rowsOf(state))).toEqual(['user']);
    expect(state.current).toBeNull();
    const kept = builder();
    engineTurn(kept);
    carry(kept, 'w1', [{ class: 'wake' }]);
    endEngine(kept, 0);
    expect(kinds(rowsOf(reduce(kept.events)))).toEqual(['divider']);
    expect(reduce(kept.events).order).toHaveLength(1);
  });

  it('a turn’s start over an empty engine turn replaces it: the owner’s own send is the person’s turn alone', () => {
    const b = builder();
    engineTurn(b); // system/init opened the engine's turn before any frame said what it is for
    b.turn('own1', 'please also check the index'); // the owner's send: turn.started of origin human, then its message
    b.text('m1', 0, 'Checking.');
    b.end(['own1']);
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('own1'))]);
    expect(state.turns.get(state.order[0]!)).toMatchObject({ origin: 'human', state: 'closed' });
    expect(kinds(rowsOf(state))).toEqual(['user', 'assistant_text']);
  });

  it('a pending prompt’s start over an empty engine turn opens the prompt’s turn, not a fold into the empty one', () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('u1'), content: 'go on', isReplay: false, isSynthetic: false, origin: 'human', bash: null }); // written, pending
    engineTurn(b);
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.text('m1', 0, 'Going.');
    b.end(['u1']);
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    expect(of(rowsOf(state), 'user').map((row) => row.steer)).toEqual([false]);
  });

  it('over an engine turn with rows, it closes that turn as today', () => {
    const b = builder();
    engineTurn(b);
    b.text('m1', 0, 'Continuing on my own.');
    b.turn('u2');
    const state = reduce(b.events);
    expect(state.order).toHaveLength(2);
    expect(of(rowsOf(state), 'divider').map((row) => [row.origin, row.state])).toEqual([['engine', 'completed'], ['human', 'working']]);
  });
});

describe('a peer’s message is one turn (decision 4)', () => {
  it('a peer’s turn, its synthetic message and its peer.message give one turn, a peer’s, with the line and no bubble', () => {
    const b = builder();
    peerTurn(b, 'hello', true, '[sminos chat hp 6d0000ff:1 from docs → @notes]\nhello');
    const state = reduce(b.events);
    expect(state.order).toHaveLength(1);
    expect(state.turns.get(state.order[0]!)!.origin).toBe('peer');
    expect(kinds(rowsOf(withAllExpanded(state)))).toEqual(['divider', 'agent_message']);
  });

  it('the same message not marked synthetic opens a second, pending turn of the person’s and draws a bubble: the defect a caller avoids by marking it', () => {
    const b = builder();
    peerTurn(b, 'hello', false, '[sminos chat hp 6d0000ff:1 from docs → @notes]\nhello');
    const state = reduce(b.events);
    expect(state.order).toHaveLength(2);
    expect(state.turns.get(state.order[1]!)).toMatchObject({ origin: 'human', accepted: false });
    expect(kinds(rowsOf(withAllExpanded(state)))).toEqual(['divider', 'agent_message', 'user']);
  });
});

describe('a peer’s delivery with no envelope (the bubble branch)', () => {
  it('draws no bubble when its peer.message is in the turn, and reads the owners from the frame line that opens its text', () => {
    const b = builder();
    peerTurn(b, 'the index is stale', true, '[sminos chat hp 6d0000ff:1 from docs, owned by ana@example.com → @notes]\nthe index is stale');
    b.emit('user.message', { messageUuid: uuid('p2'), content: 'a peer text no reader claims', isReplay: true, isSynthetic: false, origin: 'peer', bash: null });
    b.end([], { origin: 'peer' });
    const list = expanded(b.events);
    expect(of(list, 'user').map((row) => row.text)).toEqual(['a peer text no reader claims']);
    expect(of(list, 'agent_message')[0]!.peer?.sender?.owners).toEqual(['ana@example.com']);
  });
});

describe('the words of the lines (Interfaces D)', () => {
  it('a peer’s message: Message from @name, its preview without a leading @address token, which the body keeps', () => {
    const b = builder();
    peerTurn(b, '@notes-main can you rerun the build?\nthanks');
    const [row] = of(expanded(b.events), 'agent_message');
    expect(row!.text).toBe('Message from @docs: can you rerun the build?');
    expect(row!.peer).toMatchObject({ preview: 'can you rerun the build?', body: '@notes-main can you rerun the build?\nthanks' });
  });

  it('a hand-back: Report from the agent and the report’s first line; sends: Sent to @peer, Sent to the agent', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('ag1', 'Agent', { description: 'Survey notes', subagent_type: 'general-purpose', prompt: 'go' });
    b.emit('subagent.started', { taskId: taskId('a1'), toolUseId: tool('ag1'), description: 'Survey notes', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: 'go' });
    b.result('ag1', 'Async agent launched', { structured: { status: 'async_launched', agentId: 'a1' } });
    b.toolUse('s1', 'SendMessage', { to: 'a1', message: 'look at the index first\nthen the notes' });
    b.toolUse('s2', 'SendMessage', { to: 'docs', message: 'done here' });
    b.end(['u1']);
    engineTurn(b);
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a1' as never, toAgentId: null, text: '[Subagent hand-back] Framed. The report follows:\n  Found three notes.\n  Two are stale.' });
    endEngine(b);
    expect(of(expanded(b.events), 'agent_message').map((row) => [row.text, row.body ?? row.report ?? null])).toEqual([
      ['Sent to Survey notes: look at the index first', 'look at the index first\nthen the notes'],
      ['Sent to @docs: done here', null],
      ['Report from Survey notes: Found three notes.', 'Found three notes.\nTwo are stale.'],
    ]);
  });

  it('a notice: the task’s sentence verbatim, a scheduled fire with its prompt’s first line, an answer worded with its call’s questions, a dismissal, the wake', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('tu-ask', 'AskUserQuestion', { questions: [{ question: 'Which branch?', header: 'Branch', options: [{ label: 'main' }, { label: 'notes' }] }] });
    b.end(['u1']);
    engineTurn(b);
    carry(b, 'n1', [task({ summary: 'Agent "Survey notes" finished', durationMs: 65_000, detail: 'Found three notes.' })]);
    carry(b, 's1', [{ class: 'schedule', prompt: 'tidy the notes folder\nand report' }]);
    carry(b, 's2', [{ class: 'schedule', prompt: null }]);
    carry(b, 'a1', [
      { class: 'answer', tool: 'sminos', call: 'tu-ask', summary: 'Your questions have been answered: "Which branch?"="main". You can now continue with these answers in mind.', answers: null, dismissed: false },
      { class: 'answer', tool: 'sminos', call: 'tu-ask', summary: 'The human dismissed these questions without answering them; no answer will come. Do not wait for one.', answers: null, dismissed: true },
    ]);
    carry(b, 'w1', [{ class: 'wake' }]);
    endEngine(b);
    expect(of(expanded(b.events), 'notice').map((row) => [row.class, row.text, row.durationMs, row.detail])).toEqual([
      ['task', 'Agent "Survey notes" finished', 65_000, 'Found three notes.'],
      ['schedule', 'Running scheduled task · tidy the notes folder', null, 'tidy the notes folder\nand report'],
      ['schedule', 'Running scheduled task', null, null],
      ['answer', 'answered: Branch → main', null, null],
      ['answer', 'answered: dismissed', null, null],
      ['wake', NOTICE.wake, null, null],
    ]);
  });

  it('keys a task’s line by its run, so the same end from two carriers is one row', () => {
    const b = builder();
    engineTurn(b);
    carry(b, 'live-frame', [task()], '');
    endEngine(b);
    engineTurn(b, 'file-row');
    carry(b, 'file-row', [task()]);
    endEngine(b);
    expect(of(rowsOf(reduce(b.events)), 'notice').map((row) => row.id)).toEqual([rowId.notice('run-1', uuid('live-frame'), 0)]);
  });
});

describe('the consent line (decision 10)', () => {
  it('is the person’s prompt row with `consent`, in its own turn, in view through a fold', () => {
    const b = builder();
    const text = consentMessage('command', 'git push origin notes');
    b.emit('turn.started', { userMessageUuid: uuid('c1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('c1'), content: text, isReplay: false, isSynthetic: false, origin: 'human', bash: null, arrival: [{ class: 'consent', kind: 'command', subject: 'git push origin notes' }] });
    b.toolUse('t1', 'Bash', { command: 'git push origin notes' });
    b.result('t1', 'ok');
    b.end(['c1']);
    const folded = rowsOf(reduce(b.events));
    const [user] = of(folded, 'user');
    expect(user).toMatchObject({ messageUuid: 'c1', consent: { kind: 'command', subject: 'git push origin notes' } });
    expect(isPersistentRow(user!)).toBe(true);
    expect(kinds(folded)).toEqual(['user', 'divider']);
  });
});
