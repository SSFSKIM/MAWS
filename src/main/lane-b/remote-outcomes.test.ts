// A remote lane B act's outcome as the command's result, and the link and session as the pane's controls see them (P5
// O7 M2, "Outcomes as results", "The capability list"; Interfaces §F, §K).
import { describe, expect, it } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { CONTROL_KEYS } from '@shared/ipc/schema/remote';
import { record } from '../../../test/support/builders';
import { controlsOverlay, outcomeAsResult, pendingResult, REMOTE_GAPS, remoteLinkView, sessionReason } from './remote-outcomes';
import type { RemoteSessionState } from './remote-session';

const MINI = 'MiniMachineRef00000000' as MachineRef;
const up = { state: 'up' as const, carrier: 'direct' as const, refusal: null, member: 'm-a', rights: [] };
const state = (over: Partial<RemoteSessionState> = {}): RemoteSessionState => ({ machine: MINI, app: 'app-1', status: null, record: record('app-1'), stream: 'live', launch: 'L1', sends: 0, ended: null, ...over });

describe('outcomeAsResult', () => {
  it('answers `done` with the command’s output, checked, and a malformed one `internal`', () => {
    expect(outcomeAsResult('session.send', 'mini', { state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q1' } })).toEqual({ ok: true, value: { messageUuid: null, disposition: 'sent', queueId: 'q1' } });
    expect(outcomeAsResult('session.setEffort', 'mini', { state: 'done', result: undefined })).toEqual({ ok: true, value: undefined });
    expect(outcomeAsResult('session.send', 'mini', { state: 'done', result: { what: 1 } })).toMatchObject({ ok: false, error: { code: 'invalid_output' } });
  });

  it('passes a failure’s IPC code and words through, and any other code as `internal` with its refusal', () => {
    expect(outcomeAsResult('session.setModel', 'mini', { state: 'failed', error: { code: 'invalid_input', message: 'too long' } })).toEqual({ ok: false, error: { code: 'invalid_input', message: 'too long' } });
    // U9 (UC-7.5): an act with words says "Not <done>: <the machine's own sentence>"
    expect(outcomeAsResult('session.send', 'mini', { state: 'failed', error: { code: 'invalid_input', message: 'too long' } })).toEqual({ ok: false, error: { code: 'invalid_input', message: 'Not sent: too long' } });
    expect(outcomeAsResult('session.send', 'mini', { state: 'failed', error: { code: 'refused-delivery', message: 'the turn ended' } })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'refused-delivery' } } });
  });

  it('words A4’s offline, the image bound, not-sent and a lost answer; maps every other refusal by §F', () => {
    // U9 (UC-7.5): the code rides in `issues.refusal`, offline's and not-sent's too
    expect(outcomeAsResult('session.send', 'mini', { state: 'refused', reason: 'offline' })).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini is offline', issues: { refusal: 'offline' } } });
    expect(outcomeAsResult('session.setModel', 'mini', { state: 'refused', reason: 'offline' })).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini is offline' } });
    expect(outcomeAsResult('session.send', 'mini', { state: 'refused', reason: 'too-large' })).toEqual({ ok: false, error: { code: 'invalid_input', message: 'an image larger than 2.5 MiB goes to a session on another machine as a file' } });
    expect(outcomeAsResult('session.send', 'mini', { state: 'not-sent' })).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini is offline', issues: { refusal: 'not-sent' } } });
    expect(outcomeAsResult('session.setModel', 'mini', { state: 'not-sent' })).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini never received it' } });
    expect(outcomeAsResult('session.send', 'mini', { state: 'unknown', reason: 'expired' })).toEqual({ ok: false, error: { code: 'timeout', message: 'mini took the message but its answer was lost; check the transcript' } });
    expect(outcomeAsResult('session.setModel', 'mini', { state: 'unknown', reason: 'closed' })).toMatchObject({ ok: false, error: { code: 'timeout', message: 'mini took the request but its answer was lost' } });
    expect(outcomeAsResult('session.send', 'mini', { state: 'refused', reason: 'unavailable' })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(outcomeAsResult('session.setModel', 'mini', { state: 'refused', reason: 'grade' })).toEqual({ ok: false, error: { code: 'internal', message: 'session.setModel: refused grade by machine mini', issues: { refusal: 'grade' } } });
    expect(outcomeAsResult('session.send', 'mini', { state: 'refused', reason: 'grade' })).toEqual({ ok: false, error: { code: 'internal', message: 'Not sent: you can read this session but not act on it', issues: { refusal: 'grade' } } });
    expect(outcomeAsResult('session.interrupt', 'mini', { state: 'refused', reason: 'unavailable' })).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not stopped: mini is busy; try again in a moment', issues: { refusal: 'unavailable' } } });
    expect(outcomeAsResult('session.send', 'mini', { state: 'refused', reason: 'step-up-cancelled' })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'step-up-cancelled' } } });
  });

  it('words the pending bound', () => {
    expect(pendingResult('session.send', 'mini')).toEqual({ ok: false, error: { code: 'timeout', message: 'mini took the message but hasn’t confirmed it; check the transcript' } });
    expect(pendingResult('session.interrupt', 'mini')).toMatchObject({ ok: false, error: { code: 'timeout', message: 'mini took the request but hasn’t confirmed it' } });
  });
});

describe('the link and the overlay', () => {
  it('reads the link: its state, carrier, refusal, this member and its machine rights', () => {
    const link = { state: () => 'up' as const, carrier: () => 'relay' as const, refusal: () => null, caps: () => ({ member: 'm-a', device: 'd', clientClass: 'native-mac', machine: { grades: ['spawn', 'other'] }, stateVersion: 3 }) };
    expect(remoteLinkView(link as never)).toEqual({ state: 'up', carrier: 'relay', refusal: null, member: 'm-a', rights: ['spawn'] });
    expect(remoteLinkView({ state: () => 'connecting', carrier: () => null, refusal: () => null, caps: () => null } as never)).toEqual({ state: 'connecting', carrier: null, refusal: null, member: null, rights: [] });
  });

  it('closes every control while a reason stands: the device refused, the link closed, the session not placed', () => {
    expect(sessionReason(state(), up, 'mini')).toBeNull();
    expect(sessionReason(state(), { ...up, state: 'down', refusal: 'removed' }, 'mini')).toBe('This Mac is no longer allowed on mini');
    expect(sessionReason(state(), { ...up, refusal: 'class' }, 'mini')).toBe('mini refused this device (class)');
    expect(sessionReason(state({ stream: 'ended', ended: 'closed' }), up, 'mini')).toBe('the link to mini closed');
    expect(sessionReason(state({ record: null, stream: 'opening' }), up, 'mini')).toBe('Opening on mini…');
    expect(sessionReason(state({ record: null, stream: 'ended', ended: 'unplaced' }), up, 'mini')).toBe('mini can’t place this session');
    const closed = controlsOverlay(state({ record: null, stream: 'opening' }), up, 'mini');
    expect(Object.keys(closed).sort()).toEqual([...CONTROL_KEYS].sort());
    for (const key of CONTROL_KEYS) expect(closed[key]).toEqual({ available: false, reason: 'Opening on mini…' });
  });

  it('keeps sends open on a record with no status, and while the link is down; closes only the remote gaps', () => {
    for (const link of [up, { ...up, state: 'down' as const, carrier: null }, { ...up, state: 'connecting' as const, carrier: null, member: null }]) {
      const overlay = controlsOverlay(state({ status: null, stream: 'idle', launch: null }), link, 'mini');
      for (const key of ['send', 'interrupt', 'answer', 'decide', 'model', 'mode', 'queue', 'btw'] as const) expect(overlay[key], key).toEqual({ available: true });
      for (const key of ['take-over', 'reopen'] as const) expect(overlay[key], key).toEqual({ available: false, reason: REMOTE_GAPS[key] });
      // P5 O7 M4: files go up as uploads and the files panel follows the checkout, so media and the rewinds are open
      for (const key of ['media', 'rewind', 'rewind-files'] as const) expect(overlay[key], key).toEqual({ available: true });
      // the remote drill-in (2026-11-06): a subagent's rows cross the link, so the drill-in shows them
      expect(overlay['subagent-rows']).toEqual({ available: true });
    }
  });
});
