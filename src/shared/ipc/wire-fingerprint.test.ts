import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { commands, events, HOST_EVENTS } from './schema';
import { fingerprintOf, wireFingerprint } from './wire-fingerprint';

type Registry = Parameters<typeof fingerprintOf>[0];
const registry = (): Registry => ({ commands: { ...commands }, events: { ...events } });

describe('HOST_EVENTS', () => {
  it('names exactly the events the engine host emits, each in the registry', () => {
    expect([...HOST_EVENTS].sort()).toEqual(
      [
        'session.eventBatch',
        'session.status',
        'session.queue',
        'session.brokerItems',
        'session.catalogChanged',
        'session.operation',
        'session.forgotten',
        'session.replay.progress',
        'engine.budget',
        'fs.sessionChanged',
        'fs.sessionRemoved',
        'fs.holderChanged',
        'fs.scanProgress',
        'fs.followState',
        'fs.subagentsChanged',
        'fs.workflowChanged',
        'fs.tasksChanged',
        'fs.foreignWrite',
        'plugins.operation',
        'plugins.changed',
        'deliverables.changed',
        'maws.pane.show',
        'maws.artifact.capture',
        'host.supervisorStatus', // E10 M2
        'artifacts.changed', // P3-A M4
        'spaces.changed', // P3-A M4
        // E4c's `maws.browser.request` and `maws.browser.cancel` left with the browser tools (P1 A-54)
      ].sort(),
    );
    for (const name of HOST_EVENTS) expect(events).toHaveProperty([name]);
    expect(HOST_EVENTS).not.toContain('engine.hostState'); // main's own snapshot of the host
    expect(HOST_EVENTS).not.toContain('deliverables.console'); // main's
    expect(HOST_EVENTS).not.toContain('host.status'); // main's composition of the supervisor's status and its own facts
  });
});

describe('wireFingerprint', () => {
  it('is 16 hex characters, stable across calls and equal to a fresh computation', () => {
    const first = wireFingerprint();
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(wireFingerprint()).toBe(first);
    expect(fingerprintOf(registry(), HOST_EVENTS)).toBe(first);
  });

  it('changes when a field is added to an engine-host command’s input or output', () => {
    const base = fingerprintOf(registry(), HOST_EVENTS);
    const input = registry();
    input.commands['engine.policy.set'] = { ...commands['engine.policy.set'], input: z.strictObject({ added: z.string() }) };
    expect(fingerprintOf(input, HOST_EVENTS)).not.toBe(base);
    const output = registry();
    output.commands['engine.ping'] = { ...commands['engine.ping'], output: z.strictObject({ pid: z.number(), added: z.boolean() }) };
    expect(fingerprintOf(output, HOST_EVENTS)).not.toBe(base);
  });

  it('changes when a host-emitted event’s payload changes', () => {
    const base = fingerprintOf(registry(), HOST_EVENTS);
    const changed = registry();
    changed.events['engine.budget'] = z.strictObject({ added: z.number() });
    expect(fingerprintOf(changed, HOST_EVENTS)).not.toBe(base);
  });

  it('ignores what never crosses the socket: main-owned and pty-host commands, main-emitted events', () => {
    const base = fingerprintOf(registry(), HOST_EVENTS);
    const changed = registry();
    changed.commands['settings.get'] = { ...commands['settings.get'], output: z.strictObject({ anything: z.string() }) };
    changed.commands['pty.ping'] = { ...commands['pty.ping'], input: z.strictObject({ anything: z.string() }) };
    changed.events['engine.hostState'] = z.strictObject({ anything: z.string() });
    changed.events['deliverables.console'] = z.strictObject({ anything: z.string() });
    // E10: main's host.status (HostStatus, which gains fields such as waitingLiveSessions) never crosses the socket
    changed.commands['host.status'] = { ...commands['host.status'], output: z.strictObject({ anything: z.string() }) };
    changed.events['host.status'] = z.strictObject({ anything: z.string() });
    expect(fingerprintOf(changed, HOST_EVENTS)).toBe(base);
  });
});
