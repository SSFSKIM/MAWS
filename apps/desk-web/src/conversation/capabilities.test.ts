// The §5 table, as the web reads it to draw what a session cannot do and why — bridged, a `--bg` seat without the
// bridge, a terminal session without it, a machine offline — instead of failing when a button is pressed.
import { describe, expect, it } from 'vitest';
import { capabilities, kindOf, retiredBy, type CapabilityInput } from './capabilities';

const base: CapabilityInput = { alias: 'maws-45', machine: 'mini', member: true, group: 'working', seat: '', machineOnline: true, presence: { record: { status: 'busy' }, bridge: true } };
const at = (over: Partial<CapabilityInput>) => capabilities({ ...base, ...over });

describe('kindOf', () => {
  it('reads the kind from presence and the seat', () => {
    expect(kindOf(base)).toBe('bridged');
    expect(kindOf({ ...base, seat: 'maws-45', presence: { record: { status: 'busy' }, bridge: false } })).toBe('seat');
    expect(kindOf({ ...base, presence: { record: { status: 'busy' }, bridge: false } })).toBe('terminal');
    expect(kindOf({ ...base, presence: { record: null, bridge: false } })).toBe('not-running');
    expect(kindOf({ ...base, presence: null })).toBe('unknown');
    expect(kindOf({ ...base, machineOnline: false })).toBe('offline');
  });
});

describe('capabilities', () => {
  it('a bridged session at work: every verb, Send queued until idle, no Resume', () => {
    const c = at({});
    for (const verb of ['send', 'steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire'] as const) expect(c[verb].can, verb).toBe(true);
    expect(c.send.note).toBe('queued until maws-45 is idle');
    expect(c.resume).toEqual({ can: false, reason: 'maws-45 is running' });
  });

  it('a bridged session at rest: Send starts a turn; Steer and Interrupt are not offered', () => {
    const c = at({ group: 'idle', presence: { record: { status: 'idle' }, bridge: true } });
    expect(c.send).toEqual({ can: true, reason: null, note: 'starts a turn' });
    expect(c.steer).toEqual({ can: false, reason: 'maws-45 is idle: Send starts a turn' });
    expect(c.interrupt).toEqual({ can: false, reason: 'nothing to interrupt: maws-45 is idle' });
    expect(c.model.can && c.compact.can).toBe(true);
  });

  it('a --bg seat without the bridge: send and steer through the supervisor; the rest is the terminal\'s', () => {
    const c = at({ seat: 'maws-45', presence: { record: { status: 'busy' }, bridge: false } });
    expect(c.send.can && c.steer.can).toBe(true);
    expect(c.steer.note).toBe('read at its next step');
    expect(c.interrupt).toEqual({ can: false, reason: 'maws-45 runs without the bridge: interrupt it in its terminal' });
    expect(c.answer).toEqual({ can: false, reason: 'terminal only: maws-45 runs without the bridge' });
    expect(c.decide.can || c.model.can || c.compact.can).toBe(false);
    expect(c.retire.can).toBe(true);
  });

  it('a terminal session without the bridge: Steer falls back to a send, read at its next tool round', () => {
    const c = at({ presence: { record: { status: 'busy' }, bridge: false } });
    expect(c.send).toEqual({ can: true, reason: null, note: 'read at its next tool round' });
    expect(c.steer).toEqual({ can: true, reason: null, note: 'sent as a message: it arrives at its next tool round', path: 'send' });
    const resting = at({ group: 'idle', presence: { record: { status: 'idle' }, bridge: false } });
    expect(resting.steer).toEqual({ can: false, reason: 'maws-45 is idle: Send starts a turn' });
    expect(c.retire.note).toBe('records it retired; the process stays yours to close');
  });

  it('a machine offline: send goes to the log, everything else fails at once', () => {
    const c = at({ machineOnline: false });
    expect(c.send).toEqual({ can: true, reason: null, note: 'kept in the log; delivered when mini reconnects' });
    for (const verb of ['steer', 'interrupt', 'model', 'compact', 'retire', 'resume'] as const) expect(c[verb], verb).toEqual({ can: false, reason: 'mini is offline' });
    expect(c.answer).toEqual({ can: false, reason: 'mini is offline: shown, not answerable' });
  });

  it('a machine set read-only: a send is recorded and not delivered, and every RPC is refused, live session and stopped seat alike', () => {
    const readOnly = 'mini is read-only: it runs nothing sent from outside it';
    for (const c of [at({ machineReadOnly: true }), at({ machineReadOnly: true, group: 'ended', seat: 'maws-45', presence: { record: null, bridge: false } })]) {
      expect(c.send).toEqual({ can: true, reason: null, note: 'recorded, not delivered: mini is read-only' });
      for (const verb of ['steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire', 'resume'] as const) expect(c[verb], verb).toEqual({ can: false, reason: readOnly });
    }
    // Offline says more than read-only: nothing reaches the machine at all.
    expect(at({ machineReadOnly: true, machineOnline: false }).steer).toEqual({ can: false, reason: 'mini is offline' });
  });

  it('an ended session: Resume, and a send that is only recorded unless a seat resumes to read it', () => {
    const terminal = at({ group: 'ended', presence: { record: null, bridge: false } });
    expect(terminal.resume).toEqual({ can: true, reason: null });
    expect(terminal.send.note).toBe('recorded, not delivered: a closed terminal session is reopened only by Resume');
    expect(terminal.steer).toEqual({ can: false, reason: 'maws-45 is not running' });
    const seat = at({ group: 'ended', seat: 'maws-45', presence: { record: null, bridge: false } });
    expect(seat.send.note).toBe('resumes the seat to read it');
    // A session whose end sminos recorded (`retired` with reason `ended`) is ended, not retired: Resume stands.
    const recordedEnd = at({ group: 'ended', member: false, presence: null, ended: { by: '', reason: 'ended' } });
    expect(recordedEnd.resume.can).toBe(true);
  });

  it('a retired session: its history stays, and Resume is not offered (the machine refuses it), retired by whom it says', () => {
    const retired = at({ group: 'ended', member: false, presence: null, ended: { by: 'human', reason: 'retire' } });
    expect(retired.retire).toEqual({ can: false, reason: 'maws-45 is retired' });
    expect(retired.resume).toEqual({ can: false, reason: 'retired: a retired session is not resumed' });
    expect(retiredBy({ ...base, member: false, ended: { by: 'human', reason: 'retire' } })).toBe('human');
    expect(retiredBy({ ...base, member: false, ended: { by: '', reason: 'ended' } })).toBeNull();
    expect(retiredBy(base)).toBeNull();
    const offline = at({ group: 'ended', member: false, machineOnline: false, ended: { by: 'human', reason: 'retire' } });
    expect(offline.resume.can).toBe(false);
    expect(offline.send.note).toBe('recorded, not delivered: it is retired');
    // A terminal session retired from the project can still be running: the send is still only recorded.
    const live = at({ member: false, presence: { record: { status: 'busy' }, bridge: false }, ended: { by: 'human', reason: 'retire' } });
    expect(live.send).toEqual({ can: true, reason: null, note: 'recorded, not delivered: it is retired' });
  });

  it('presence not known yet: the log plane only', () => {
    const c = at({ presence: null });
    expect(c.send.can).toBe(true);
    expect(c.steer).toEqual({ can: false, reason: "waiting for maws-45's presence" });
    expect(c.retire.can).toBe(true);
  });
});

describe('while the project socket is not connected', () => {
  it('offers no RPC, whatever presence last said: the hub queues nothing for an absent party; a send waits for the reconnect', () => {
    const c = capabilities(base, false);
    for (const verb of ['steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire', 'resume'] as const) expect(c[verb], verb).toEqual({ can: false, reason: 'not connected to the hub' });
    expect(c.send).toEqual({ can: true, reason: null, note: 'sent once the desk reconnects' });
  });
});
