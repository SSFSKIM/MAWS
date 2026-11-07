import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { commands, events, HOST_EVENTS } from './schema';
import { fingerprintOf, wireFingerprint } from './wire-fingerprint';

const FINGERPRINT_PATH = fileURLToPath(new URL('./wire-fingerprint.json', import.meta.url));
// `pnpm wire:manifest` runs this file beside wire.test.ts; under either of its modes the fingerprint is rewritten
const WRITE = process.env.MAWS_WIRE_MANIFEST_WRITE !== undefined && process.env.MAWS_WIRE_MANIFEST_WRITE !== '';

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
        'maws.pane.show',
        'maws.artifact.capture',
        'maws.artifact.export', // P3-A M7
        'maws.artifact.datasetRefresh', // E3: an agent's refresh request, its id alone
        'host.supervisorStatus', // E10 M2
        'artifacts.changed', // P3-A M4
        'spaces.changed', // P3-A M4
        'connectors.operation', // P3-H H3b: an operation's end, its id alone
        'connectors.grantChanged', // P3-H H3b: a committed grant change, the tool and the change alone
        'connectors.directOperation', // P3-HD M2: a direct operation's end, its id alone
        'host.browserIdle', // P5 O17 M3: to mawsd's permanent link alone
        // E4c's `maws.browser.request` and `maws.browser.cancel` left with the browser tools (P1 A-54)
      ].sort(),
    );
    for (const name of HOST_EVENTS) expect(events).toHaveProperty([name]);
    expect(HOST_EVENTS).not.toContain('engine.hostState'); // main's own snapshot of the host
    expect(HOST_EVENTS).not.toContain('artifacts.console'); // main's
    expect(HOST_EVENTS).not.toContain('host.status'); // main's composition of the supervisor's status and its own facts
    expect(HOST_EVENTS).not.toContain('connectors.watchUpdate'); // P3-H H3b: main's, to one window
  });
});

// The production check: what every process reads (wire-fingerprint.json, the build's constant) is the fingerprint of
// the live schemas, the value they computed at their start before the O17 footprint fix, so a peer of another build
// sees no change. An authorized write comes first; the assertion after it is against the file as it then stands.
describe('the committed wire fingerprint', () => {
  it('is fingerprintOf over the live registry, 16 hex characters', () => {
    const live = fingerprintOf(registry(), HOST_EVENTS);
    if (WRITE) writeFileSync(FINGERPRINT_PATH, `${JSON.stringify({ fingerprint: live })}\n`);
    const file = (JSON.parse(readFileSync(FINGERPRINT_PATH, 'utf8')) as { fingerprint: unknown }).fingerprint;
    const read = WRITE ? file : wireFingerprint(); // a write is read back from the file; the import holds what was there
    if (read !== live) throw new Error(`wire-fingerprint.json holds ${String(read)}, but the live schemas give ${live}: rewrite it with pnpm wire:manifest (a changed host shape also answers to wire.test.ts's rule; a rendering-only change, such as a zod upgrade, with MAWS_WIRE_MANIFEST_WRITE=rebase pnpm wire:manifest)`);
    expect(live).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('wireFingerprint', () => {

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
    changed.events['artifacts.console'] = z.strictObject({ anything: z.string() });
    // E10: main's host.status (HostStatus, which gains fields such as waitingLiveSessions) never crosses the socket
    changed.commands['host.status'] = { ...commands['host.status'], output: z.strictObject({ anything: z.string() }) };
    changed.events['host.status'] = z.strictObject({ anything: z.string() });
    expect(fingerprintOf(changed, HOST_EVENTS)).toBe(base);
  });
});
