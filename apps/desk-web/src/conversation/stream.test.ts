// A channel's stream (§4): the group chat shows what is addressed to the human — messages, questions (with their answer
// once given), what humans posted, lifecycle as system lines — with agent-to-agent traffic folded into one row per run;
// a direct channel is one session's exchange with the human, the working record between folded. Pending requests sit
// where they were first seen; an async question's request is its `question` event's.
import { describe, expect, it } from 'vitest';
import type { JsonObject, LogEvent } from 'desk-hub/protocol';
import scopeVectors from '../../test/fixtures/sminos-scope/scope-labels.json' with { type: 'json' };
import { requestKey } from '../project/conversation';
import { broadcastLabel, buildStream, crossProject, placedRequest, scopeLabel, type PlacedRequest, type StreamItem } from './stream';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b'; // maws-45 @mini
const S2 = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a'; // maws-fe @SK.local
const M = '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c';
const MACHINE: Record<string, string> = { [S1]: 'mini', [S2]: 'SK.local' };
/** A request as the stream places it, keyed by its session's machine, its session, and its id. */
const placed = (request: string, session: string, at: number, more: Partial<PlacedRequest> = {}): PlacedRequest => ({ key: requestKey({ machine: MACHINE[session], session, request }), request, session, at, ...more });
let offset = 0;
const ev = (writer: string, kind: string, fields: Record<string, unknown>) => ({
  offset: ++offset,
  event: { ts: '2026-10-15T08:00:00.000Z', writer, seq: offset, kind, mac: { nonce: `n${offset}`, value: 'v' }, ...fields } as LogEvent,
});
const aliases = new Map([
  [S1, 'maws-45'],
  [S2, 'maws-fe'],
]);

function log() {
  offset = 0;
  return [
    ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', seat: '' }), // 1
    ev(`mini/${S1}`, 'message', { from: 'maws-45', to: 'host', text: 'migration merged', src: 'r1#0' }), // 2
    ev(`SK.local/${S2}`, 'say', { from: 'maws-fe', to: [{ session: S1, alias: 'maws-45' }], text: 'you renamed a column' }), // 3
    ev(`mini/${S1}`, 'say', { from: 'maws-45', to: [{ session: S2, alias: 'maws-fe' }], text: 'yes, user_id' }), // 4
    ev(`SK.local/${S2}`, 'say', { from: 'maws-fe', to: '*', text: 'rebasing' }), // 5
    ev(`hub/${M}`, 'human', { from: 'human', member: M, to: [{ session: S1, alias: 'maws-45' }], text: '@maws-45 keep user_id', created: 'x' }), // 6
    ev(`mini/${S1}`, 'question', { from: 'maws-45', to: 'host', text: 'Which column?', choices: ['user_id', 'owner_id'], src: 'toolu_1' }), // 7
    ev(`SK.local/${S2}`, 'say', { from: 'maws-fe', to: [{ session: S1, alias: 'maws-45' }], text: 'done' }), // 8
    ev(`mini/${S1}`, 'answered', { from: 'maws-45', src: 'toolu_1', text: 'user_id' }), // 9
    ev(`mini/${S1}`, 'retired', { session: S1, by: 'human', reason: 'retire' }), // 10
  ];
}

const shape = (items: StreamItem[]) => items.map((i) => (i.kind === 'agents' ? `agents:${i.says.map((s) => s.offset).join(',')}` : i.kind === 'request' ? `request:${i.request}` : `${i.kind}:${i.offset}`));

describe('the group chat', () => {
  it('draws messages, humans, questions with their answer, and system lines, folding each run of agent traffic', () => {
    const items = buildStream({ kind: 'group' }, log(), aliases, []);
    expect(shape(items)).toEqual(['system:1', 'message:2', 'agents:3,4,5', 'human:6', 'question:7', 'agents:8', 'system:10']);
    const question = items.find((i) => i.kind === 'question');
    expect(question).toMatchObject({ kind: 'question', session: S1, request: 'toolu_1', answered: { text: 'user_id' } });
    expect(items.find((i) => i.kind === 'system' && i.offset === 10)).toMatchObject({ text: 'maws-45 retired by human' });
  });

  it('carries each line as its subject and its words, a question its list of questions, a request its session', () => {
    const items = buildStream({ kind: 'group' }, log(), aliases, [placed('toolu_9', S2, 2)]);
    expect(items.find((i) => i.kind === 'system' && i.offset === 1)).toMatchObject({ session: S1, subject: 'maws-45', rest: 'joined on mini', text: 'maws-45 joined on mini' });
    expect(items.find((i) => i.kind === 'question')).toMatchObject({ questions: ['Which column?'], text: 'Which column?' });
    expect(items.find((i) => i.kind === 'request')).toMatchObject({ session: S2 });
  });

  it('names a rename by the alias the session had before, and says nothing of a rename to the name it already has', () => {
    offset = 0;
    const entries = [
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', seat: '' }), // 1
      ev(`mini/${S1}`, 'renamed', { session: S1, alias: 'maws-45' }), // 2: the same name
      ev(`mini/${S1}`, 'renamed', { session: S1, alias: 'grid-7c' }), // 3
      ev(`mini/${S1}`, 'in-charge', { session: S1, text: 'the grid' }), // 4
    ];
    const items = buildStream({ kind: 'group' }, entries, new Map([[S1, 'grid-7c']]), []);
    expect(shape(items)).toEqual(['system:1', 'system:3', 'system:4']);
    expect(items[1]).toMatchObject({ subject: 'maws-45', rest: 'is now grid-7c', text: 'maws-45 is now grid-7c' });
    expect(items[2]).toMatchObject({ subject: 'grid-7c', text: 'grid-7c is in charge of: the grid' }); // the sidebar's name for it now
  });

  it('names who retired a session: you, another member of the org by its id, or what sminos recorded', () => {
    const OTHER = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
    const retired = (by: string) => [...log().slice(0, 1), ev(`mini/${S1}`, 'retired', { session: S1, by, reason: 'retire' })];
    const line = (by: string) => buildStream({ kind: 'group' }, retired(by), aliases, [], { member: M }).find((i) => i.kind === 'system' && i.event.kind === 'retired');
    expect(line(M)).toMatchObject({ text: 'maws-45 retired by you' });
    expect(line(OTHER)).toMatchObject({ text: 'maws-45 retired by another member (0f1e2d3c)' });
    expect(line('maws-fe')).toMatchObject({ text: 'maws-45 retired by maws-fe' });
    expect(line('')).toMatchObject({ text: 'maws-45 retired' });
  });

  it('places a pending request after the log it was first seen behind, and joins an async question to its event', () => {
    const items = buildStream({ kind: 'group' }, log(), aliases, [
      placed('toolu_9', S2, 2),
      placed('toolu_1', S1, 7),
      placed('toolu_late', S1, 99),
    ]);
    expect(shape(items)).toEqual(['system:1', 'message:2', 'request:toolu_9', 'agents:3,4,5', 'human:6', 'question:7', 'agents:8', 'system:10', 'request:toolu_late']);
  });

  it("dates a placed request by the last entry it was first seen behind, among every entry and not only the channel's", () => {
    offset = 0;
    const entries = [
      ev(`mini/${S1}`, 'joined', { ts: '2026-10-15T08:00:00.000Z', session: S1, alias: 'maws-45', machine: 'mini', seat: '' }), // 1
      ev(`mini/${S1}`, 'message', { ts: '2026-10-15T08:01:00.000Z', from: 'maws-45', to: 'host', text: 'hi', src: 'r1#0' }), // 2
      ev(`SK.local/${S2}`, 'state', { ts: '2026-10-15T08:07:00.000Z', session: S2, state: 'busy', machine: 'SK.local' }), // 3: not in S1's channel
    ];
    const items = buildStream({ kind: 'session', session: S1 }, entries, aliases, [placed('toolu_a', S1, 3), placed('toolu_b', S1, 1), placed('toolu_0', S1, 0)]);
    expect(items.flatMap((i) => (i.kind === 'request' ? [[i.request, i.ts]] : []))).toEqual([
      ['toolu_0', null], // seen before any entry
      ['toolu_b', '2026-10-15T08:00:00.000Z'],
      ['toolu_a', '2026-10-15T08:07:00.000Z'],
    ]);
  });

  it("joins a question event only to its own session's request: another session's request under the same id stays its own card", () => {
    const items = buildStream({ kind: 'group' }, log(), aliases, [placed('toolu_1', S1, 2), placed('toolu_1', S2, 2)]);
    expect(shape(items)).toEqual(['system:1', 'message:2', 'request:toolu_1', 'agents:3,4,5', 'human:6', 'question:7', 'agents:8', 'system:10']);
    expect(items.find((i) => i.kind === 'request')).toMatchObject({ ref: requestKey({ machine: 'SK.local', session: S2, request: 'toolu_1' }) });
    expect(items.find((i) => i.kind === 'question')).toMatchObject({ ref: requestKey({ machine: 'mini', session: S1, request: 'toolu_1' }) });
  });

  it("joins an answer only to its own session's question when two sessions asked under the same id", () => {
    offset = 0;
    const entries = [
      ev(`mini/${S1}`, 'question', { from: 'maws-45', to: 'host', text: 'A asks', choices: [], src: 'request-1' }), // 1
      ev(`SK.local/${S2}`, 'question', { from: 'maws-fe', to: 'host', text: 'B asks', choices: [], src: 'request-1' }), // 2
      ev(`SK.local/${S2}`, 'answered', { from: 'maws-fe', src: 'request-1', text: 'Answer to B' }), // 3
    ];
    const questions = buildStream({ kind: 'group' }, entries, aliases, []).filter((i) => i.kind === 'question');
    expect(questions.map((q) => [q.text, q.answered?.text ?? null])).toEqual([
      ['A asks', null],
      ['B asks', 'Answer to B'],
    ]);
  });

  it('draws the text of a question as sminos records it, a list of the questions asked, each its own paragraph', () => {
    offset = 0;
    const entries = [
      ev(`mini/${S1}`, 'question', { from: 'maws-45', to: 'host', text: ['Which shape?'], choices: ['circle', 'square'], src: 'toolu_1' }), // 1
      ev(`mini/${S1}`, 'question', { from: 'maws-45', to: 'host', text: ['Which colour?', 'How many?'], choices: ['red', 'blue', 'one', 'two'], src: 'toolu_2' }), // 2
      ev(`mini/${S1}`, 'answered', { from: 'maws-45', src: 'toolu_1', text: 'square' }), // 3
    ];
    const questions = buildStream({ kind: 'group' }, entries, aliases, []).filter((i) => i.kind === 'question');
    expect(questions.map((q) => [q.text, q.answered?.text ?? null])).toEqual([
      ['Which shape?', 'square'],
      ['Which colour?\n\nHow many?', null],
    ]);
  });
});

describe('status and state', () => {
  function lifecycle() {
    offset = 0;
    return [
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', seat: '' }), // 1
      ev(`mini/${S1}`, 'state', { session: S1, state: 'busy', machine: 'mini' }), // 2: running, as joined said
      ev(`mini/${S1}`, 'status', { session: S1, text: 'fixture 8/8' }), // 3
      ev(`mini/${S1}`, 'state', { session: S1, state: 'idle', machine: 'mini' }), // 4: still running
      ev(`mini/${S1}`, 'state', { session: S1, state: 'stopped', machine: 'mini' }), // 5: stopped
      ev(`mini/${S1}`, 'state', { session: S1, state: 'gone', machine: 'mini' }), // 6: still not running
      ev(`SK.local/${S2}`, 'state', { session: S2, state: 'stopped', machine: 'SK.local' }), // 7: another session
      ev(`mini/${S1}`, 'state', { session: S1, state: 'busy', machine: 'mini' }), // 8: running again
      ev(`mini/${S1}`, 'status', { session: S1, text: '' }), // 9
    ];
  }

  it('draws a status line, and a state only where the session starts or stops running, in the group chat', () => {
    const items = buildStream({ kind: 'group' }, lifecycle(), aliases, []);
    expect(shape(items)).toEqual(['system:1', 'system:3', 'system:5', 'system:7', 'system:8', 'system:9']);
    const text = (o: number) => (items.find((i) => i.kind === 'system' && i.offset === o) as { text: string }).text;
    expect(text(3)).toBe('maws-45 status: fixture 8/8');
    expect(text(5)).toBe('maws-45 stopped on mini');
    expect(text(7)).toBe('maws-fe stopped on SK.local');
    expect(text(8)).toBe('maws-45 is running again on mini');
    expect(text(9)).toBe('maws-45 cleared its status');
  });

  it("draws the same lines for the session's own channel, and none of another's", () => {
    expect(shape(buildStream({ kind: 'session', session: S1 }, lifecycle(), aliases, []))).toEqual(['system:1', 'system:3', 'system:5', 'system:8', 'system:9']);
  });
});

describe('a direct channel', () => {
  it("holds the session's exchange with the human and its own lifecycle, the working record folded before each of its messages", () => {
    const items = buildStream({ kind: 'session', session: S1 }, log(), aliases, [placed('toolu_2', S1, 9), placed('toolu_x', S2, 9)]);
    expect(shape(items)).toEqual(['system:1', 'work:2', 'message:2', 'agents:3,4', 'human:6', 'work:7', 'question:7', 'agents:8', 'request:toolu_2', 'system:10']);
    expect(items.find((i) => i.kind === 'question')).toMatchObject({ answered: { text: 'user_id' } });
  });

  it('folds the working record after its last exchange item, open-ended, while the session is live', () => {
    const items = buildStream({ kind: 'session', session: S1 }, log().slice(0, 9), aliases, [], { live: true });
    expect(items.at(-1)).toMatchObject({ kind: 'work', key: 'work:live' });
    expect(buildStream({ kind: 'session', session: S1 }, log().slice(0, 9), aliases, []).at(-1)?.kind).not.toBe('work');
  });

  it('folds the working record before a native question, which is a request with no question event', () => {
    const items = buildStream({ kind: 'session', session: S1 }, log().slice(0, 2), aliases, [placed('toolu_native', S1, 2, { question: true })], { live: true });
    expect(shape(items)).toEqual(['system:1', 'work:2', 'message:2', 'work:2', 'request:toolu_native', 'work:9007199254740991']);
  });

  it('places a raised question with its request id, which decisions and answers go to', () => {
    const raised = { request: 'toolu_plugin_q', session: S1, tool: 'AskUserQuestion', input: {}, mac: { nonce: 'n', value: 'v' }, toolUseId: 'toolu_01outer' };
    expect(placedRequest({ key: 'k', request: 'toolu_plugin_q', raised, at: 2 })).toEqual({ key: 'k', request: 'toolu_plugin_q', session: S1, at: 2, question: true });
  });

  it('folds once before a question that is pending and in the log, and never before a permission prompt', () => {
    const items = buildStream({ kind: 'session', session: S1 }, log(), aliases, [
      placed('toolu_1', S1, 2, { question: true }), // also the `question` event at 7
      placed('toolu_perm', S1, 7, { question: false }),
    ]);
    expect(shape(items).filter((k) => k.startsWith('work'))).toEqual(['work:2', 'work:7']);
    expect(shape(items).filter((k) => k.startsWith('request'))).toEqual(['request:toolu_perm']);
  });

  it("draws a human event addressed elsewhere nowhere in this channel, and an untagged one only in the group", () => {
    offset = 0;
    const entries = [ev(`hub/${M}`, 'human', { from: 'human', member: M, to: '*', text: 'status', created: 'x' })];
    expect(buildStream({ kind: 'session', session: S1 }, entries, aliases, [])).toEqual([]);
    expect(shape(buildStream({ kind: 'group' }, entries, aliases, []))).toEqual(['human:1']);
  });
});

// The org directory (smns org directory §6, M5): a cross-project message is written twice — the delivering event in the
// destination's log, carrying `from_project`, and a copy in the sender's own log, marked `copy` with the delivering
// event's position. A session's move between projects is a `retired` with reason `moved` and the new project's id.
describe('across projects', () => {
  const HERE = '0d6c1f2e-6a43-4f43-9b1a-6f1d6a5b2c11';
  const THERE = 'a5c3c1de-7a5e-5d2b-9f3a-2c6b7e1d4f20';
  const at = (fields: Record<string, unknown>) => ({ ts: 't', writer: `mini/${S1}`, seq: 1, kind: 'say', mac: { nonce: 'n', value: 'v' }, from: 'maws-45', text: 'hi', ...fields }) as LogEvent;

  it("tells the sender's copy by its `copy` key, its destination the delivering event's project", () => {
    expect(crossProject(at({ to: [{ session: S2, alias: 'mini-7c', project: THERE }], copy: `${THERE}:mini/${S2}:4` }), HERE)).toEqual({ to: [THERE] });
    // A copy whose position does not parse still names its recipients' project.
    expect(crossProject(at({ to: [{ session: S2, alias: 'mini-7c', project: THERE }], copy: 'x' }), HERE)).toEqual({ to: [THERE] });
  });

  it("names every destination of a broadcast's copy, whose `copy` lists the delivering events (sminos 1.2.0)", () => {
    const YONDER = 'c2a8e5f1-3b47-5d9e-a6c0-91f2e4d8b733';
    const to = [
      { session: S2, alias: 'mini-7c', project: THERE },
      { session: S1, alias: 'maws-45', project: YONDER },
    ];
    expect(crossProject(at({ to, wake: true, scope: {}, copy: [`${THERE}:mini/${S2}:4`, `${YONDER}:mini/${S2}:2`] }), HERE)).toEqual({ to: [THERE, YONDER] });
    // Entries that are no position are passed over; with none left, the recipients' projects stand, each once.
    expect(crossProject(at({ to, copy: [`${THERE}:mini/${S2}:4`, 7, 'x'] }), HERE)).toEqual({ to: [THERE] });
    expect(crossProject(at({ to: [...to, { session: 'x', alias: 'x', project: THERE }], copy: ['x', null] }), HERE)).toEqual({ to: [THERE, YONDER] });
    // A copy that names no project at all is drawn as an event of this project.
    expect(crossProject(at({ to: [{ session: S2, alias: 'mini-7c' }], copy: [] }), HERE)).toBeNull();
  });

  it('tells a delivering event from another project by its origin, and an event of this project as neither', () => {
    expect(crossProject(at({ to: [{ session: S2, alias: 'maws-fe' }], from_project: THERE }), HERE)).toEqual({ from: THERE });
    expect(crossProject(at({ to: [{ session: S2, alias: 'maws-fe' }], from_project: HERE }), HERE)).toBeNull();
    expect(crossProject(at({ to: [{ session: S2, alias: 'maws-fe' }] }), HERE)).toBeNull();
    expect(crossProject(at({ to: '*', from_project: 42 }), HERE)).toBeNull();
  });

  it('draws a move as the project the session moved to, by name', () => {
    offset = 0;
    const entries = [
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', seat: '' }),
      ev(`mini/${S1}`, 'retired', { session: S1, by: '', reason: 'moved', project: THERE }),
    ];
    const names = (id: string) => (id === THERE ? 'doperpowers' : id.slice(0, 8));
    expect(buildStream({ kind: 'group' }, entries, aliases, [], { projectName: names }).at(-1)).toMatchObject({ kind: 'system', text: 'maws-45 moved to doperpowers' });
  });

  it('draws no line for a relocated joined, which only refreshes where a member works', () => {
    offset = 0;
    const entries = [
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', seat: '' }),
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', seat: '', cwd: '/w/x', relocated: true }),
    ];
    expect(shape(buildStream({ kind: 'group' }, entries, aliases, []))).toEqual(['system:1']);
  });
});

// sminos 1.2.0's scoped broadcast (the org directory's §5a): each project's event carries its selector as `scope`, which
// the desk names as sminos does. The vectors are sminos's own output (test/fixtures/sminos-scope/generate.py runs its
// `scope_label`, `target_label` and `chat_line`), the first six scopes the ones its test-broadcast.sh asserts.
describe("a broadcast's scope, as sminos names it", () => {
  const names = (id: string) => (scopeVectors.projects as Record<string, string>)[id] ?? id;

  it.each(scopeVectors.labels)('$why: $label', ({ scope, label }) => {
    expect(scopeLabel(scope as unknown as JsonObject, names)).toBe(label);
  });

  it.each(scopeVectors.events)('$why: → $target', ({ event, target, destinations }) => {
    const e = event as unknown as LogEvent;
    // sminos's target_label of a broadcast; a tagged say's names its recipients, which the desk draws by alias.
    if (e.wake === true) expect(broadcastLabel(e.scope, names)).toBe(target);
    const other = crossProject(e, 'somewhere-else');
    expect(other !== null && 'to' in other ? other.to.map(names).join(', ') : null).toBe(destinations);
  });
});
