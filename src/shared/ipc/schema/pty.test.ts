import { describe, expect, it } from 'vitest';
import { commands, events } from '../schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '../validate';

const spawn = { appSessionId: 'app-1', label: 'terminal-1', cwd: '/tmp', cols: 80, rows: 24 };
const info = {
  ptyId: 'p1',
  appSessionId: 'app-1',
  label: 'terminal-1',
  pid: 4242,
  cwd: '/tmp',
  shell: '/bin/zsh',
  cols: 80,
  rows: 24,
  spawnedAt: '2026-09-28T12:00:00.000Z',
  alive: true,
  paused: false,
  exit: null,
  offset: 1024,
};

describe('pty schema validates and rejects', () => {
  it('names an owner for every pty entry: the host for the terminal commands, main for hostState and openLink', () => {
    const owners = Object.fromEntries(Object.entries(commands).filter(([name]) => name.startsWith('pty.')).map(([name, spec]) => [name, spec.owner]));
    expect(owners).toEqual({
      'pty.hostState': 'main',
      'pty.ping': 'pty-host',
      'pty.spawn': 'pty-host',
      'pty.write': 'pty-host',
      'pty.resize': 'pty-host',
      'pty.kill': 'pty-host',
      'pty.ack': 'pty-host',
      'pty.checkpoint': 'pty-host',
      'pty.attach': 'pty-host',
      'pty.list': 'pty-host',
      'pty.foreground': 'pty-host',
      'pty.openLink': 'main',
    });
    expect(Object.keys(events).filter((name) => name.startsWith('pty.')).sort()).toEqual(['pty.data', 'pty.exit', 'pty.hostState']);
  });

  it('takes a spawn with a session, a label and an optional command, and refuses the removed env key', () => {
    expect(validateCommandInput('pty.spawn', spawn)).toEqual({ ok: true, value: spawn });
    const full = { ...spawn, shell: '/bin/bash', args: ['-l'], command: 'printf hi\n' };
    expect(validateCommandInput('pty.spawn', full)).toEqual({ ok: true, value: full });
    expect(validateCommandInput('pty.spawn', { ...spawn, env: { A: 'b' } }).ok).toBe(false);
    expect(validateCommandInput('pty.spawn', { ...spawn, appSessionId: '' }).ok).toBe(false);
    expect(validateCommandInput('pty.spawn', { ...spawn, label: '' }).ok).toBe(false);
    expect(validateCommandInput('pty.spawn', { ...spawn, cwd: '' }).ok).toBe(false);
    expect(validateCommandInput('pty.spawn', { ...spawn, cols: 0 }).ok).toBe(false);
    expect(validateCommandInput('pty.spawn', { appSessionId: 'app-1', cwd: '/tmp', cols: 80, rows: 24 }).ok).toBe(false);
  });

  it('accepts a pty.data payload with a Uint8Array and an offset, and rejects a string or a negative offset', () => {
    const data = new Uint8Array([104, 105]);
    const accepted = validateEventPayload('pty.data', { ptyId: 'p1', offset: 0, data });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value.data).toBe(data); // validators never transform, and never copy
    const asString = validateEventPayload('pty.data', { ptyId: 'p1', offset: 0, data: 'hi' });
    expect(asString.ok).toBe(false);
    if (!asString.ok) expect(asString.issues).toEqual([expect.objectContaining({ path: ['data'] })]);
    expect(validateEventPayload('pty.data', { ptyId: 'p1', offset: -1, data }).ok).toBe(false);
    expect(validateEventPayload('pty.data', { ptyId: 'p1', data }).ok).toBe(false);
  });

  it('holds ack, checkpoint and foreground to their shapes', () => {
    expect(validateCommandInput('pty.ack', { ptyId: 'p1', offset: 65536 }).ok).toBe(true);
    expect(validateCommandInput('pty.ack', { ptyId: 'p1', offset: 1.5 }).ok).toBe(false);
    expect(validateCommandInput('pty.checkpoint', { ptyId: 'p1', offset: 0, state: '\x1b[?2004h' }).ok).toBe(true);
    expect(validateCommandInput('pty.checkpoint', { ptyId: 'p1', offset: 0 }).ok).toBe(false);
    expect(validateCommandOutput('pty.foreground', { process: 'sleep', busy: true }).ok).toBe(true);
    expect(validateCommandOutput('pty.foreground', { process: null, busy: false }).ok).toBe(true);
  });

  it('answers attach with the info, the checkpoint, the replay bytes and the offsets', () => {
    const reply = { info, checkpoint: { offset: 512, state: 'state' }, replay: new Uint8Array(512), replayFrom: 512, nextOffset: 1024 };
    expect(validateCommandOutput('pty.attach', reply).ok).toBe(true);
    expect(validateCommandOutput('pty.attach', { ...reply, checkpoint: null }).ok).toBe(true);
    expect(validateCommandOutput('pty.attach', { ...reply, replay: 'bytes' }).ok).toBe(false);
    expect(validateCommandOutput('pty.list', { ptys: [info, { ...info, ptyId: 'p2', alive: false, exit: { exitCode: 0, signal: null } }] }).ok).toBe(true);
    expect(validateCommandOutput('pty.list', { ptys: [{ ...info, env: {} }] }).ok).toBe(false);
  });

  it('accepts any URL for pty.openLink, javascript: included (main refuses the scheme), and rejects a non-URL', () => {
    expect(validateCommandInput('pty.openLink', { url: 'https://example.com' }).ok).toBe(true);
    expect(validateCommandInput('pty.openLink', { url: 'javascript:alert(1)' }).ok).toBe(true);
    expect(validateCommandInput('pty.openLink', { url: 'not a url' }).ok).toBe(false);
  });

  it('keeps the exit shape C1 set, nulls meaning the host died', () => {
    const exit = { ptyId: 'p1', exitCode: null, signal: null };
    expect(validateEventPayload('pty.exit', exit)).toEqual({ ok: true, value: exit });
    expect(validateEventPayload('pty.exit', { ptyId: 'p1', exitCode: 0 }).ok).toBe(false);
  });
});
