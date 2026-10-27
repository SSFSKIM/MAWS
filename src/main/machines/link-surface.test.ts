// The link surface (P5 O6 M3, "The link surface"): what one machine's services answer for another app, the same for the
// stand-in, O3's mawsd and O7's channels.
import { describe, expect, it } from 'vitest';
import { gradeOf } from '@shared/ipc/grades';
import { REGISTRY } from '@shared/ipc/registry';
import { routeOf } from '@shared/ipc/routes';
import type { CommandName } from '@shared/ipc/schema';
import { CLIENT_EVENTS, LINK_EVENTS, LINK_REGISTRY, onLink } from './link-surface';

describe('the link surface', () => {
  it('keeps LINK_EVENTS and CLIENT_EVENTS a partition of the registry’s events', () => {
    const events = Object.keys(REGISTRY.events).sort();
    const link: string[] = [...LINK_EVENTS].sort();
    const client: string[] = [...CLIENT_EVENTS].sort();
    expect(link.filter((name) => client.includes(name)), 'an event on both sides').toEqual([]);
    expect(events.filter((name) => !link.includes(name) && !client.includes(name)), 'an event on neither side: say whether its payload is a machine’s').toEqual([]);
    expect([...link, ...client].sort()).toEqual(events);
  });

  it('carries the events that name a session, a pty or a checkout’s path, or report the machine’s hosts, and none of the app’s own', () => {
    for (const name of ['session.eventBatch', 'session.changed', 'session.projects.changed', 'attention.changed', 'engine.hostState', 'pty.hostState', 'pty.data', 'pty.exit', 'fs.sessionChanged', 'git.changed', 'files.changed', 'scm.remote.output', 'ownerChannel.changed']) {
      expect(LINK_EVENTS, name).toContain(name);
    }
    for (const name of ['layout.saveAll', 'voice.event', 'browser.tabs.changed', 'attention.navigate', 'attention.notified', 'maws.pane.show', 'settings.changed', 'settings.usageChanged', 'engine.budget', 'host.status', 'host.supervisorStatus', 'machines.changed']) {
      expect(CLIENT_EVENTS, name).toContain(name);
    }
  });

  it('presents every command that is neither client nor internal, as owner machine, with its own schemas', () => {
    const expected = Object.keys(REGISTRY.commands).filter((name) => routeOf(name as CommandName) !== 'client' && gradeOf(name) !== 'internal' && !REGISTRY.mainOnly.has(name)).sort();
    expect(Object.keys(LINK_REGISTRY.commands).sort()).toEqual(expected);
    expect(expected).toEqual(expect.arrayContaining(['session.list', 'session.drafts.get', 'machine.identity', 'engine.sessions', 'pty.spawn', 'git.status']));
    for (const name of ['machines.list', 'browser.tabs.list', 'attention.viewing', 'engine.configure', 'host.configure']) expect(onLink(name), name).toBe(false);
    for (const [name, spec] of Object.entries(LINK_REGISTRY.commands)) {
      const own = REGISTRY.commands[name as CommandName];
      expect(spec.owner, name).toBe('machine');
      expect(spec.input, name).toBe(own.input);
      expect(spec.output, name).toBe(own.output);
    }
    expect(Object.keys(LINK_REGISTRY.events).sort()).toEqual([...LINK_EVENTS].sort());
    expect(LINK_REGISTRY.hostEvents).toEqual([]);
    expect(LINK_REGISTRY.mainOnly.size).toBe(0);
  });
});
