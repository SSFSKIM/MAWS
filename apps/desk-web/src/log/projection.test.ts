// The project's sessions as the log says them (smns §3) and the sidebar's grouping (§4: waiting on you / working / idle
// / ended), read from presence while the machine is online and from the last `state` event while it is not.
import { describe, expect, it } from 'vitest';
import type { LogEvent } from 'desk-hub/protocol';
import { groupOf, groupSessions, projectSessions, type ProjectedSession } from './projection';

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
  const base: ProjectedSession = { session: S1, alias: 'a', machine: 'mini', cwd: null, worktree: null, seat: '', member: true, ended: null, charge: null, status: null, state: null, joinedAt: 1 };

  it('puts a retired session under ended, whatever its presence says', () => {
    expect(groupOf({ ...base, member: false, ended: { by: '', reason: 'ended' } }, { presence: { record: { status: 'busy' }, bridge: true }, machineOnline: true, pending: 0 })).toBe('ended');
  });

  it('reads presence on an online machine: waiting, idle, busy or shell, and no live process', () => {
    const on = (status: string | null) => groupOf(base, { presence: { record: status === null ? null : { status }, bridge: true }, machineOnline: true, pending: 0 });
    expect(on('waiting')).toBe('waiting');
    expect(on('idle')).toBe('idle');
    expect(on('busy')).toBe('working');
    expect(on('shell')).toBe('working');
    expect(on(null)).toBe('ended');
  });

  it('counts a pending request as waiting on you', () => {
    expect(groupOf(base, { presence: { record: { status: 'busy' }, bridge: true }, machineOnline: true, pending: 1 })).toBe('waiting');
  });

  it('reads the last state event while the machine is offline or presence is not known yet', () => {
    const at = (word: string | null, machineOnline: boolean | undefined) =>
      groupOf({ ...base, state: word ? { word, ts: 't' } : null }, { presence: { record: { status: 'idle' }, bridge: true }, machineOnline, pending: 0 });
    expect(at('busy', false)).toBe('working');
    expect(at('waiting', false)).toBe('waiting');
    expect(at('stopped', false)).toBe('ended');
    expect(at('gone', false)).toBe('ended');
    expect(at(null, false)).toBe('idle');
    expect(groupOf({ ...base, state: { word: 'busy', ts: 't' } }, { machineOnline: true, pending: 0 })).toBe('working');
  });
});

describe('groupSessions', () => {
  it('orders each group newest member first', () => {
    const sessions = projectSessions([joined(S1, 'older', 'mini'), joined(S2, 'newer', 'mini')]);
    const groups = groupSessions(sessions, () => ({ presence: { record: { status: 'idle' }, bridge: true }, machineOnline: true, pending: 0 }));
    expect(groups.idle.map((s) => s.alias)).toEqual(['newer', 'older']);
    expect(groups.waiting).toEqual([]);
  });
});
