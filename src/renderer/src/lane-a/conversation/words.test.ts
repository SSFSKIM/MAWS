// The words for what came back: a settlement by who decided (a late decision's `by` may come without its side), and a
// steer's result, whose row is null when the session had no bridge to append one.
import { describe, expect, it } from 'vitest';
import { commandFailureText, commandOutcomeText, resultText, settledText, STOPPED_AT_TERMINAL } from './words';

const ME = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

describe('settledText', () => {
  it('names the side and, from the web, whether it was you', () => {
    expect(settledText('terminal', 'deny', 'terminal', ME)).toBe('Denied in the terminal');
    expect(settledText('web', 'allow', ME, ME)).toBe('Allowed from the web by you');
    expect(settledText('web', 'answered', OTHER, ME)).toBe('Answered from the web');
    expect(settledText('other', 'answered', 'cli', ME)).toBe('Answered from the command line');
  });

  it('reads who decided from `by` when the side is not given', () => {
    expect(settledText(null, null, 'terminal', ME)).toBe('Settled in the terminal');
    expect(settledText(null, null, ME, ME)).toBe('Settled from the web by you');
    expect(settledText(null, null, OTHER, ME)).toBe('Settled from the web');
    expect(settledText(null, null, 'cli', ME)).toBe('Settled from the command line');
  });
});

describe('resultText for a steer', () => {
  it('points at the appended row when there is one, and says it was sent without one when the row is null', () => {
    expect(resultText('steer', { row: 'u1' })).toEqual({ text: 'steered: read at the next model request', warning: false });
    expect(resultText('steer', { row: null })).toEqual({ text: 'sent: the session has no bridge, so there is no row to point at', warning: false });
  });
});

// A command's words (the desk control surface's M0): the bridge's refusal by its reason, the Esc refusal as what it is,
// and an op's end by how its readback was confirmed — never a resolved promise as success.
describe('a command', () => {
  it("says a bridge's refusal by its reason, whichever separator follows the code, and the Esc refusal as the terminal's", () => {
    expect(commandFailureText({ code: 'failed', message: "panel: opens a panel in the terminal; it would hold the session's queue" }, 'mini')).toBe("opens a panel in the terminal; it would hold the session's queue");
    expect(commandFailureText({ code: 'failed', message: 'routed use Model instead: /model saves a default for new sessions' }, 'mini')).toBe('use Model instead: /model saves a default for new sessions');
    expect(commandFailureText({ code: 'failed', message: 'unknown-builtin: not a command this session knows' }, 'mini')).toBe('not a command this session knows');
    expect(commandFailureText({ code: 'failed', message: 'stopped: the session was stopped and nobody has sent input since' }, 'mini')).toBe('stopped at the terminal: commands resume after input is typed there');
    // A failure that is not the bridge's keeps the RPC's words.
    expect(commandFailureText({ code: 'failed', message: 'the bridge did not answer' }, 'mini')).toBe('it failed: the bridge did not answer');
    expect(commandFailureText({ code: 'read-only', message: '' }, 'mini')).toBe('mini is read-only: it runs nothing sent from outside it');
  });

  it("says an op's end by its readback: the row, the text, the effect, or unconfirmed; a failed run by the engine's error", () => {
    const end = (body: Record<string, unknown>) => commandOutcomeText({ rpc: 'n', op: 'command', phase: 'end', id: 'c1', name: 'rename', args: 'x', ...body } as never);
    expect(end({ settled: { ok: true }, readback: { how: 'row', text: 'Session renamed to: x', uuid: 'u' } })).toEqual({ state: 'ran', text: 'Session renamed to: x', mark: 'confirmed by its row' });
    expect(end({ settled: { ok: true, text: 'Reloaded skills: 3 skills' }, readback: { how: 'text', text: 'Reloaded skills: 3 skills' } })).toEqual({ state: 'ran', text: 'Reloaded skills: 3 skills', mark: 'confirmed by text' });
    expect(end({ name: 'reload-plugins', readback: { how: 'effect' } })).toEqual({ state: 'ran', text: 'ran: the plugins reloaded', mark: 'confirmed by effect' });
    expect(end({ settled: { ok: true }, readback: { how: 'none' } })).toEqual({ state: 'unconfirmed', text: 'ran, unconfirmed', mark: null });
    expect(end({ settled: { ok: false, error: 'the bridge did not come back within 60 s' } })).toEqual({ state: 'failed', text: 'failed: the bridge did not come back within 60 s', mark: null });
  });

  it("says a queued run the engine refused after an Esc (settled code stopped) as the terminal's, as the RPC's refusal says it", () => {
    const end = (body: Record<string, unknown>) => commandOutcomeText({ rpc: 'n', op: 'command', phase: 'end', id: 'c1', name: 'reload-plugins', args: '', ...body } as never);
    expect(end({ settled: { ok: false, error: 'commands are disabled until the user types', code: 'stopped' } })).toEqual({ state: 'failed', text: STOPPED_AT_TERMINAL, mark: null });
  });

  it('marks a prompt command as a started turn, never a readback success, and preserves refusal', () => {
    const body = { rpc: 'n', op: 'command', phase: 'end', id: 'c', route: 'run-prompt', settled: { ok: true }, readback: { how: 'none' } } as const;
    expect(commandOutcomeText(body)).toEqual({ state: 'ran', text: 'started a turn', mark: null });
    expect(commandOutcomeText({ ...body, settled: { ok: false, code: 'stopped' } }).state).toBe('failed');
  });

  it("says a command's RPC result as queued", () => {
    expect(resultText('command', { queued: true, route: 'run', id: 'c1' })).toEqual({ text: 'queued', warning: false });
  });
});
