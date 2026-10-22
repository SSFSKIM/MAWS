// The §5 table, as the web reads it to draw what a session cannot do and why — bridged, a `--bg` seat without the
// bridge, a terminal session without it, a machine offline — instead of failing when a button is pressed.
import { describe, expect, it } from 'vitest';
import { capabilities, kindOf, NEEDS, retiredBy, VERBS, type CapabilityInput } from './capabilities';

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
    for (const verb of ['steer', 'interrupt', 'model', 'compact', 'retire', 'resume', 'stop'] as const) expect(c[verb], verb).toEqual({ can: false, reason: 'mini is offline' });
    expect(c.answer).toEqual({ can: false, reason: 'mini is offline: shown, not answerable' });
  });

  it('a machine set read-only: a send is recorded and not delivered, and every RPC is refused, live session and stopped seat alike', () => {
    const readOnly = 'mini is read-only: it runs nothing sent from outside it';
    for (const c of [at({ machineReadOnly: true }), at({ machineReadOnly: true, group: 'ended', seat: 'maws-45', presence: { record: null, bridge: false } })]) {
      expect(c.send).toEqual({ can: true, reason: null, note: 'recorded, not delivered: mini is read-only' });
      for (const verb of ['steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire', 'resume', 'stop'] as const) expect(c[verb], verb).toEqual({ can: false, reason: readOnly });
    }
    // Offline says more than read-only: nothing reaches the machine at all.
    expect(at({ machineReadOnly: true, machineOnline: false }).steer).toEqual({ can: false, reason: 'mini is offline' });
  });

  it('an ended session its machine serves the transcript of: Resume, and a send that is only recorded unless a seat resumes to read it', () => {
    const terminal = at({ group: 'ended', presence: { record: null, bridge: false }, transcript: 'served' });
    expect(terminal.resume).toEqual({ can: true, reason: null });
    expect(terminal.send.note).toBe('recorded, not delivered: a closed terminal session is reopened only by Resume');
    expect(terminal.steer).toEqual({ can: false, reason: 'maws-45 is not running' });
    const seat = at({ group: 'ended', seat: 'maws-45', presence: { record: null, bridge: false }, transcript: 'served' });
    expect(seat.send.note).toBe('resumes the seat to read it');
    // A session whose end sminos recorded (`retired` with reason `ended`) is ended, not retired: Resume stands.
    const recordedEnd = at({ group: 'ended', member: false, presence: null, ended: { by: '', reason: 'ended' }, transcript: 'served' });
    expect(recordedEnd.resume.can).toBe(true);
  });

  it('an ended session its machine serves no transcript of is not offered Resume, which would start it empty; nor is one not known to have one', () => {
    // The owner's desk, 2026-10-19: a transcript-less `--bg` copy, its end recorded as `ended`, under a seat's name.
    const copy = { group: 'ended' as const, member: false, presence: null, ended: { by: '', reason: 'ended' }, alias: 'acc-ask71', machine: 'macbook' };
    const none = at({ ...copy, transcript: 'none' });
    expect(none.resume).toEqual({ can: false, reason: 'macbook serves no transcript of acc-ask71 to resume' });
    expect(none.send).toEqual({ can: true, reason: null, note: 'recorded, not delivered: macbook serves no transcript of it to resume' });
    expect(at({ ...copy, seat: 'acc-ask71', transcript: 'none' }).send.note).toBe('recorded, not delivered: macbook serves no transcript of it to resume');
    for (const transcript of [undefined, null]) expect(at({ ...copy, transcript }).resume).toEqual({ can: false, reason: "offered once macbook serves acc-ask71's transcript" });
    // Retired, offline, running, disconnected: each says its own reason, whatever is known of the transcript.
    expect(at({ ...copy, ended: { by: 'human', reason: 'retire' }, transcript: 'served' }).resume.reason).toBe('retired: a retired session is not resumed');
    expect(at({ ...copy, machineOnline: false, transcript: 'served' }).resume.reason).toBe('macbook is offline');
    expect(at({ transcript: 'none' }).resume.reason).toBe('maws-45 is running');
    expect(capabilities({ ...base, ...copy, transcript: 'served' }, false).resume.reason).toBe('not connected to the hub');
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

  it("stops a job (§5's Stop row, DC10) through the bridge alone, at work or at rest; never without it, nor on a session that is not running", () => {
    expect(at({}).stop).toEqual({ can: true, reason: null });
    expect(at({ group: 'idle', presence: { record: { status: 'idle' }, bridge: true } }).stop).toEqual({ can: true, reason: null });
    const noBridge = { can: false, reason: 'maws-45 runs without the bridge: stop its jobs in its terminal' };
    expect(at({ seat: 'maws-45', presence: { record: { status: 'busy' }, bridge: false } }).stop).toEqual(noBridge);
    expect(at({ presence: { record: { status: 'busy' }, bridge: false } }).stop).toEqual(noBridge);
    expect(at({ group: 'ended', presence: { record: null, bridge: false } }).stop).toEqual({ can: false, reason: 'maws-45 is not running' });
    expect(at({ presence: null }).stop).toEqual({ can: false, reason: "waiting for maws-45's presence" });
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
    for (const verb of ['steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire', 'resume', 'stop'] as const) expect(c[verb], verb).toEqual({ can: false, reason: 'not connected to the hub' });
    expect(c.send).toEqual({ can: true, reason: null, note: 'sent once the desk reconnects' });
  });
});

// The desk control surface's verbs (its spec, 2026-10-22, §4): read from both presences — the bridge's capabilities in
// the session's, the daemon's `desk` in the machine's — with three fallbacks told apart so the reason sends the owner
// to the right place: a stale session, an older machine, and a session without a bridge at all.
describe('the desk control surface (M0): command and status', () => {
  const caps = { sminos: '1.7.0', protocol: 2, engine: '2.1.307', ops: ['ping', 'read', 'command'], reads: ['status'], routes: { measured: '2.1.307' } };
  const desk = { sminos: '1.7.0', rpcs: ['steer', 'command'], reads: [] };
  const bridged = (over: Partial<CapabilityInput> = {}) => capabilities({ ...base, presence: { record: { status: 'idle' }, bridge: true, capabilities: caps }, machineDesk: desk, ...over });

  it('a bridge and a daemon at M0: both offered; a command mid-turn waits for the turn', () => {
    expect(bridged().command).toEqual({ can: true, reason: null });
    expect(bridged().status).toEqual({ can: true, reason: null });
    expect(bridged({ presence: { record: { status: 'busy' }, bridge: true, capabilities: caps } }).command).toEqual({ can: true, reason: null, note: 'queued until maws-45 is idle' });
    // A newer plugin than the control needs offers it too.
    expect(bridged({ presence: { record: { status: 'idle' }, bridge: true, capabilities: { ...caps, sminos: '1.10.0' } }, machineDesk: { ...desk, sminos: '1.10.0' } }).command.can).toBe(true);
  });

  it('a stale session — the machine updated, the mod loaded before it — is told to reload, not to update the machine', () => {
    const stale = bridged({ presence: { record: { status: 'idle' }, bridge: true } });
    const reason = "this session's plugin loaded before the update: run /reload-plugins in it, or restart it";
    expect(stale.command).toEqual({ can: false, reason });
    expect(stale.status).toEqual({ can: false, reason });
  });

  it("an older machine names itself and its plugin's version when its daemon says it, and asks for the update", () => {
    const older = bridged({ presence: { record: { status: 'idle' }, bridge: true }, machineDesk: null });
    expect(older.command).toEqual({ can: false, reason: "mini's plugin is older than the desk's controls: update sminos on mini" });
    expect(older.status.reason).toBe("mini's plugin is older than the desk's controls: update sminos on mini");
    const known = bridged({ presence: { record: { status: 'idle' }, bridge: true }, machineDesk: { sminos: '1.6.9', rpcs: [], reads: [] } });
    expect(known.command.reason).toBe("mini's plugin (1.6.9) is older than the desk's controls: update sminos on mini");
    // A bridge at M0 on a daemon that is not (the daemon not restarted since): the command needs both.
    expect(bridged({ machineDesk: undefined }).command.reason).toBe("mini's plugin is older than the desk's controls: update sminos on mini");
    expect(bridged({ machineDesk: undefined }).status).toEqual({ can: true, reason: null });
  });

  it("a bridge whose capabilities lack the op or the read is not offered it, by the capability's own version", () => {
    const old = { ...caps, sminos: '1.6.3', ops: ['ping'], reads: [] };
    expect(bridged({ presence: { record: { status: 'idle' }, bridge: true, capabilities: old } }).command.reason).toBe("this session's plugin loaded before the update: run /reload-plugins in it, or restart it");
    expect(bridged({ presence: { record: { status: 'idle' }, bridge: true, capabilities: { ...caps, reads: [] } } }).status.can).toBe(false);
  });

  it("without a bridge, offline, not running, read-only or disconnected: each kind's own reason", () => {
    expect(bridged({ seat: 'maws-45', presence: { record: { status: 'idle' }, bridge: false } }).command).toEqual({ can: false, reason: 'maws-45 runs without the bridge' });
    expect(bridged({ presence: { record: { status: 'idle' }, bridge: false } }).status).toEqual({ can: false, reason: 'maws-45 runs without the bridge' });
    expect(bridged({ machineOnline: false }).command).toEqual({ can: false, reason: 'mini is offline' });
    expect(bridged({ presence: { record: null, bridge: false } }).status).toEqual({ can: false, reason: 'maws-45 is not running' });
    expect(bridged({ presence: null }).command).toEqual({ can: false, reason: "waiting for maws-45's presence" });
    // A command is X class: a read-only machine refuses it; a read changes nothing, and is still offered.
    expect(bridged({ machineReadOnly: true }).command).toEqual({ can: false, reason: 'mini is read-only: it runs nothing sent from outside it' });
    expect(bridged({ machineReadOnly: true }).status).toEqual({ can: true, reason: null });
    const off = capabilities({ ...base, presence: { record: { status: 'idle' }, bridge: true, capabilities: caps }, machineDesk: desk }, false);
    expect(off.command).toEqual({ can: false, reason: 'not connected to the hub' });
    expect(off.status).toEqual({ can: false, reason: 'not connected to the hub' });
  });

  it('names the version each verb needs', () => {
    expect(NEEDS.command).toEqual({ op: 'command', rpc: 'command', sminos: '1.7.0' });
    expect(NEEDS.status).toEqual({ read: 'status', sminos: '1.7.0' });
    expect(VERBS).toEqual(expect.arrayContaining(['command', 'status']));
  });
});
