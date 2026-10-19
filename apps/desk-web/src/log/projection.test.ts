// The project's sessions as the log says them (smns §3) and the sidebar's grouping (§4: waiting on you / working / idle
// / ended), read from presence while the machine is online and from the last `state` event while it is not.
import { describe, expect, it } from 'vitest';
import type { LogEvent } from 'desk-hub/protocol';
import { groupOf, groupSessions, namesakes, openQuestions, projectSessions, sessionName, type ProjectedSession } from './projection';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const S2 = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
let offset = 0;
const ev = (writer: string, kind: string, fields: Record<string, unknown>, ts = '2026-10-15T08:00:00.000Z') => ({
  offset: ++offset,
  event: { ts, writer, seq: offset, kind, mac: { nonce: 'n', value: 'v' }, ...fields } as LogEvent,
});
const joined = (session: string, alias: string, machine: string) =>
  ev(`${machine}/${session}`, 'joined', { session, alias, name_source: 'user', machine, cwd: '/w/maws', worktree: '', role: '', seat: '', by: '' });

describe('projectSessions', () => {
  it('reads membership, alias, machine, the in-charge line, and the status line', () => {
    const sessions = projectSessions([
      joined(S1, 'maws-45', 'mini'),
      ev(`mini/${S1}`, 'in-charge', { session: S1, text: 'owner artifacts page', source: 'set' }),
      ev(`mini/${S1}`, 'status', { session: S1, text: 'fixture 8/8' }),
      joined(S2, 'cua_repl', 'SK.local'),
      ev(`SK.local/${S2}`, 'renamed', { session: S2, alias: 'cua-bench', name_source: 'user' }),
      ev(`SK.local/${S2}`, 'retired', { session: S2, by: 'human', reason: 'retire' }),
    ]);
    expect(sessions.get(S1)).toMatchObject({ alias: 'maws-45', machine: 'mini', cwd: '/w/maws', member: true, charge: 'owner artifacts page', status: 'fixture 8/8' });
    expect(sessions.get(S2)).toMatchObject({ alias: 'cua-bench', machine: 'SK.local', member: false, ended: { by: 'human', reason: 'retire' } });
  });

  it('reads the seat a joined names: a --bg job sminos spawned, against a terminal session', () => {
    const seat = ev(`mini/${S2}`, 'joined', { session: S2, alias: 'maws-fe', name_source: 'seat', machine: 'mini', cwd: '/w/maws', worktree: '', role: '', seat: 'maws-fe', by: 'maws-45' });
    const sessions = projectSessions([joined(S1, 'maws-45', 'mini'), seat]);
    expect(sessions.get(S1)?.seat).toBe('');
    expect(sessions.get(S2)?.seat).toBe('maws-fe');
  });

  it('takes the later ts when two writers set the in-charge line, and a rejoin ends the retirement', () => {
    const sessions = projectSessions([
      joined(S1, 'maws-45', 'mini'),
      ev(`mini/${S1}`, 'in-charge', { session: S1, text: 'newer', source: 'set' }, '2026-10-15T09:00:00.000Z'),
      ev('SK.local/human', 'in-charge', { session: S1, text: 'older, arrived later', source: 'set' }, '2026-10-15T08:30:00.000Z'),
      ev(`mini/${S1}`, 'retired', { session: S1, by: '', reason: 'ended' }),
      joined(S1, 'maws-45', 'mini'),
    ]);
    expect(sessions.get(S1)).toMatchObject({ charge: 'newer', member: true, ended: null });
  });

  it('names a session by the latest title its machine published, and by its alias while it has none', () => {
    const sessions = projectSessions([
      joined(S1, 'maws-4d', 'macbook'),
      ev(`macbook/${S1}`, 'titled', { session: S1, title: 'Codex native Computer Use internals' }),
      ev(`macbook/${S1}`, 'titled', { session: S1, title: 'cua_repl' }),
      ev(`macbook/${S1}`, 'retired', { session: S1, by: '', reason: 'ended' }),
      joined(S2, 'maws-45', 'mini'),
    ]);
    expect(sessions.get(S1)).toMatchObject({ alias: 'maws-4d', title: 'cua_repl', member: false });
    expect(sessionName(sessions.get(S1)!)).toBe('cua_repl');
    expect(sessions.get(S2)?.title).toBeNull();
    expect(sessionName(sessions.get(S2)!)).toBe('maws-45');
  });

  it("keeps the membership's join time: a relocated joined refreshes the directory and moves neither its time nor its place", () => {
    const sessions = projectSessions([
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', cwd: '/w/maws', worktree: '', seat: '', by: '' }, '2026-10-18T08:00:00.000Z'),
      joined(S2, 'cua_repl', 'mini'),
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', cwd: '/w/maws/.claude/worktrees/x', worktree: '', seat: '', by: '', relocated: true }, '2026-10-18T09:30:00.000Z'),
    ]);
    const s1 = sessions.get(S1)!;
    expect(s1).toMatchObject({ cwd: '/w/maws/.claude/worktrees/x', member: true, joinedTs: '2026-10-18T08:00:00.000Z' });
    expect(s1.joinedAt).toBeLessThan(sessions.get(S2)!.joinedAt); // still listed after the session that joined since
  });

  it('starts a new join time when a retired session joins again', () => {
    const sessions = projectSessions([
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', cwd: '/w/maws' }, '2026-10-18T08:00:00.000Z'),
      ev(`mini/${S1}`, 'retired', { session: S1, by: '', reason: 'moved', project: 'p2' }, '2026-10-18T08:10:00.000Z'),
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', cwd: '/w/maws', by: 'move' }, '2026-10-18T08:20:00.000Z'),
    ]);
    expect(sessions.get(S1)).toMatchObject({ member: true, ended: null, joinedTs: '2026-10-18T08:20:00.000Z' });
  });

  it('reads an empty or malformed title as none', () => {
    const blank = projectSessions([joined(S1, 'maws-4d', 'macbook'), ev(`macbook/${S1}`, 'titled', { session: S1, title: 'x' }), ev(`macbook/${S1}`, 'titled', { session: S1, title: '  ' })]);
    expect(blank.get(S1)?.title).toBeNull();
    const shapeless = projectSessions([joined(S1, 'maws-4d', 'macbook'), ev(`macbook/${S1}`, 'titled', { session: S1, title: 42 })]);
    expect(shapeless.get(S1)?.title).toBeNull();
  });

  it('keeps the last state event with its time, and ignores events that name no session', () => {
    const sessions = projectSessions([
      joined(S1, 'maws-45', 'mini'),
      ev(`mini/${S1}`, 'state', { session: S1, state: 'waiting', machine: 'mini' }, '2026-10-15T08:05:00.000Z'),
      ev(`mini/${S1}`, 'message', { from: 'maws-45', to: 'host', text: 'hi', src: 'x:0' }),
      ev('mini/human', 'say', { from: 'human', to: '*', text: 'hello' }),
    ]);
    expect(sessions.size).toBe(1);
    expect(sessions.get(S1)?.state).toEqual({ word: 'waiting', ts: '2026-10-15T08:05:00.000Z' });
  });
});

describe('groupOf', () => {
  const base: ProjectedSession = { session: S1, alias: 'a', machine: 'mini', cwd: null, worktree: null, seat: '', title: null, member: true, ended: null, charge: null, status: null, state: null, joinedAt: 1, joinedTs: '' };

  it('puts a retired session under ended, whatever its presence says', () => {
    expect(groupOf({ ...base, member: false, ended: { by: '', reason: 'ended' } }, { presence: { record: { status: 'busy' }, bridge: true }, machineOnline: true, pending: 0, questions: 0 })).toBe('ended');
  });

  it('reads presence on an online machine: waiting, idle, busy or shell, and no live process', () => {
    const on = (status: string | null) => groupOf(base, { presence: { record: status === null ? null : { status }, bridge: true }, machineOnline: true, pending: 0, questions: 0 });
    expect(on('waiting')).toBe('waiting');
    expect(on('idle')).toBe('idle');
    expect(on('busy')).toBe('working');
    expect(on('shell')).toBe('working');
    expect(on(null)).toBe('ended');
  });

  it('counts a pending request as waiting on you', () => {
    expect(groupOf(base, { presence: { record: { status: 'busy' }, bridge: true }, machineOnline: true, pending: 1, questions: 0 })).toBe('waiting');
  });

  // 2026-10-18 (owner): an open async question waits on you as a pending request does, its presence still busy.
  it('counts an open async question as waiting on you, as a pending request, and only where presence is read', () => {
    const busy = { presence: { record: { status: 'busy' }, bridge: true }, machineOnline: true, pending: 0, questions: 1 };
    expect(groupOf(base, busy)).toBe('waiting');
    expect(groupOf(base, { ...busy, presence: { record: { status: 'idle' }, bridge: false } })).toBe('waiting');
    expect(groupOf({ ...base, member: false, ended: { by: '', reason: 'retire' } }, busy)).toBe('ended');
    // An offline machine's session reads its last state, a pending request's alike.
    expect(groupOf({ ...base, state: { word: 'busy', ts: 't' } }, { ...busy, machineOnline: false })).toBe('working');
    expect(groupOf({ ...base, state: { word: 'busy', ts: 't' } }, { ...busy, machineOnline: false, pending: 1 })).toBe('working');
  });

  // A stopped seat never retires, so its log question stays open: it counts only while the session's process lives, as
  // a bridge's ask is withdrawn when its process ends. A pending request is read as before.
  it('leaves a session whose presence says no process is under ended, its open question uncounted; a pending request still waits', () => {
    const stopped = { presence: { record: null, bridge: false }, machineOnline: true, pending: 0, questions: 1 };
    expect(groupOf(base, stopped)).toBe('ended');
    expect(groupOf(base, { ...stopped, pending: 1 })).toBe('waiting');
    // Resumed: it counts again.
    expect(groupOf(base, { ...stopped, presence: { record: { status: 'busy' }, bridge: true } })).toBe('waiting');
  });

  it('reads the last state event while the machine is offline or presence is not known yet', () => {
    const at = (word: string | null, machineOnline: boolean | undefined) =>
      groupOf({ ...base, state: word ? { word, ts: 't' } : null }, { presence: { record: { status: 'idle' }, bridge: true }, machineOnline, pending: 0, questions: 0 });
    expect(at('busy', false)).toBe('working');
    expect(at('waiting', false)).toBe('waiting');
    expect(at('stopped', false)).toBe('ended');
    expect(at('gone', false)).toBe('ended');
    expect(at(null, false)).toBe('idle');
    expect(groupOf({ ...base, state: { word: 'busy', ts: 't' } }, { machineOnline: true, pending: 0, questions: 0 })).toBe('working');
  });
});

describe('groupSessions', () => {
  it('orders each group newest member first', () => {
    const sessions = projectSessions([joined(S1, 'older', 'mini'), joined(S2, 'newer', 'mini')]);
    const groups = groupSessions(sessions, () => ({ presence: { record: { status: 'idle' }, bridge: true }, machineOnline: true, pending: 0, questions: 0 }));
    expect(groups.idle.map((s) => s.alias)).toEqual(['newer', 'older']);
    expect(groups.waiting).toEqual([]);
  });

  it("puts a busy session holding an open log question under waiting, as a bridge's raised ask puts it", () => {
    const entries = [joined(S1, 'asker', 'mini'), joined(S2, 'raiser', 'mini'), ev(`mini/${S1}`, 'question', asked('ask-1'))];
    const asking = openQuestions(entries);
    const groups = groupSessions(projectSessions(entries), (s) => ({
      presence: { record: { status: 'busy' }, bridge: true },
      machineOnline: true,
      pending: s.session === S2 ? 1 : 0,
      questions: asking.get(s.session)?.length ?? 0,
    }));
    expect(groups.waiting.map((s) => s.alias)).toEqual(['raiser', 'asker']);
    expect(groups.working).toEqual([]);
  });
});

describe('namesakes', () => {
  const S3 = 'a5b99a8b-0ebe-4f5f-b6c0-b8bc32c64e0b';
  it("finds the sessions another session of the project goes by the same name as: the name shown, or the alias it is addressed by", () => {
    // The owner's desk, 2026-10-19: a titled seat, and a `--bg` copy the daemon renamed to its alias, retired as ended.
    const seat = ev(`macbook/${S1}`, 'joined', { session: S1, alias: 'acc-ask71', name_source: 'seat', machine: 'macbook', cwd: '/w', worktree: '', role: '', seat: S1, by: '' });
    const sessions = projectSessions([
      seat,
      ev(`macbook/${S1}`, 'titled', { session: S1, title: 'acc-ask71' }),
      joined(S2, 'a5b99a8b', 'macbook'),
      ev(`macbook/${S2}`, 'renamed', { session: S2, alias: 'acc-ask71', name_source: 'user' }),
      ev(`macbook/${S2}`, 'retired', { session: S2, by: '', reason: 'ended' }),
      joined(S3, 'maws-45', 'mini'),
    ]);
    expect(namesakes(sessions.values())).toEqual(new Set([S1, S2]));
    // A title one session shows that is another's alias.
    expect(namesakes([{ session: S1, title: 'maws-45', alias: 'acc-ask71' }, { session: S3, title: null, alias: 'maws-45' }])).toEqual(new Set([S1, S3]));
    // A session whose title is its own alias is no namesake of itself.
    expect(namesakes([{ session: S1, title: 'acc-ask71', alias: 'acc-ask71' }, { session: S3, title: null, alias: 'maws-45' }])).toEqual(new Set());
  });
});

/** A `question` event's own fields: an async ask the session exported, `src` its id. */
function asked(src: string): Record<string, unknown> {
  return { from: 'maws-45', to: 'host', text: ['Ship it?'], choices: ['Yes', 'No'], src };
}

describe('openQuestions', () => {
  it('opens an ask with its question and closes it with the same session’s answered of the same id', () => {
    const open = openQuestions([
      joined(S1, 'maws-45', 'mini'),
      ev(`mini/${S1}`, 'question', asked('toolu_1')),
      ev(`mini/${S1}`, 'question', asked('toolu_2')),
      ev(`mini/${S1}`, 'answered', { from: 'maws-45', src: 'toolu_1', text: 'Yes' }),
      // Another session's answer of the same id is not this ask's.
      ev(`mini/${S2}`, 'answered', { from: 'other', src: 'toolu_2', text: 'No' }),
    ]);
    expect(open.get(S1)).toEqual([{ machine: 'mini', ask: 'toolu_2' }]);
    expect(open.has(S2)).toBe(false);
  });

  it("closes every ask of a session at its retired, and opens a question asked after it rejoined anew", () => {
    const open = openQuestions([
      joined(S1, 'maws-45', 'mini'),
      ev(`mini/${S1}`, 'question', asked('toolu_1')),
      ev(`mini/${S1}`, 'question', asked('toolu_2')),
      ev(`mini/${S1}`, 'retired', { session: S1, by: '', reason: 'ended' }),
      joined(S1, 'maws-45', 'mini'),
      ev(`mini/${S1}`, 'question', asked('toolu_3')),
    ]);
    expect(open.get(S1)).toEqual([{ machine: 'mini', ask: 'toolu_3' }]);
    expect(openQuestions([ev(`mini/${S1}`, 'question', asked('toolu_1')), ev(`mini/${S1}`, 'retired', { session: S1, by: '', reason: 'retire' })]).size).toBe(0);
  });

  it('reads only session feeds, and a retired only from the session’s own feed', () => {
    const open = openQuestions([
      ev(`mini/${S1}`, 'question', asked('toolu_1')),
      ev('mini/human', 'question', asked('toolu_human')),
      ev('hub/0123456789abcdef0123456789abcdef', 'question', asked('toolu_hub')),
      ev(`mini/${S2}`, 'retired', { session: S1, by: '', reason: 'ended' }),
      ev(`mini/${S1}`, 'question', { from: 'maws-45', text: ['No id'] }),
    ]);
    expect([...open.keys()]).toEqual([S1]);
    expect(open.get(S1)).toEqual([{ machine: 'mini', ask: 'toolu_1' }]);
  });
});
