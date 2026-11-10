// Which peers serve the project registry's acts, and which commands need them (panel scalpel-3#2;
// docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §G "Older peers", §L): this Mac's own daemon, of
// another build, is negotiated as another machine is, from what its welcome says (its wire minor), and an act it would
// take for a plain one is refused `not-offered` before it goes, never sent to have its `into` dropped.
import { describe, expect, it } from 'vitest';
import type { ClientRef } from '@shared/ipc/client';
import { PROJECT_ACTS_CAPABILITY } from '@shared/ipc/schema/session';
import type { WirePeer } from '@shared/ipc/wire';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { createLocalLink } from './local-link';
import { createConnectionManager } from './manager';
import { localProjectActs, localProjectActsSource, PROJECT_ACTS_MINOR, refuseUnservedProjectActs } from './project-acts-peer';

const peer = (minor: number): WirePeer => ({ major: 3, minor, build: 'theirs', capabilities: [] });
const client = { id: 'page-1' } as unknown as ClientRef;

describe('this Mac’s machine and the project acts', () => {
  it('serves them embedded, or when its daemon’s wire is the minor that brought them or later; unknown before its welcome', () => {
    expect(localProjectActs(null, { embedded: true })).toEqual([PROJECT_ACTS_CAPABILITY]);
    expect(localProjectActs(peer(PROJECT_ACTS_MINOR), { embedded: false })).toEqual([PROJECT_ACTS_CAPABILITY]);
    expect(localProjectActs(peer(PROJECT_ACTS_MINOR + 2), { embedded: false })).toEqual([PROJECT_ACTS_CAPABILITY]);
    expect(localProjectActs(peer(PROJECT_ACTS_MINOR - 1), { embedded: false })).toEqual([]);
    expect(localProjectActs(null, { embedded: false })).toBeNull();
  });

  it('refuses `not-offered` what a daemon that predates them would do otherwise, and lets a plain act go', async () => {
    let current: WirePeer | null = peer(PROJECT_ACTS_MINOR - 1);
    const hook = refuseUnservedProjectActs(() => current, 'This Mac');
    const refused = { ok: false, error: { code: 'internal', issues: { refusal: 'not-offered' } } };
    expect(await hook('session.projects.addFolder', { directory: '/srv/a', into: 'p' }, client)).toMatchObject(refused);
    expect(await hook('session.projects.addFolder', { directory: '/srv/a', own: true }, client)).toMatchObject(refused);
    expect(await hook('session.projects.link', { id: 'p-1', into: null }, client)).toMatchObject(refused);
    expect(await hook('session.projects.resolve', { directory: '/srv/a' }, client)).toMatchObject(refused);
    expect(await hook('session.projects.addFolder', { directory: '/srv/a' }, client), 'a plain add').toBeUndefined();
    expect(await hook('session.projects.remove', { id: 'p-1' }, client), 'a plain remove').toBeUndefined();
    current = peer(PROJECT_ACTS_MINOR);
    expect(await hook('session.projects.addFolder', { directory: '/srv/a', into: 'p' }, client)).toBeUndefined();
    current = null; // no daemon welcomed: never held for whichever welcomes next
    expect(await hook('session.projects.addFolder', { directory: '/srv/a', into: 'p' }, client)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(await hook('session.projects.addFolder', { directory: '/srv/a' }, client), 'a plain add goes as before').toBeUndefined();
  });

  // CI's e2e:cross-build: on the embedded shape no machine host runs in this process, and the supervisor throws at any
  // read of one; the local state is then this build's own services' and never asks the supervisor
  it('starts the connection manager with no machine host in this process, never asking the supervisor for one', () => {
    const noMachineHost = (): never => {
      throw new Error('no machine host runs in this process');
    };
    const hosts = { peer: noMachineHost, onState: noMachineHost };
    const local = 'LocalMachineRef0000000' as MachineRef;
    const dispatchLocal = async () => ({ ok: true, value: null }) as unknown as CommandResult<CommandName>;
    const make = () =>
      createConnectionManager({
        local,
        localName: 'here',
        localLink: createLocalLink({ ref: local, name: 'here', dispatchLocal }),
        knownMachinesFile: join(mkdtempSync(join(tmpdir(), 'maws-peer-')), 'known.json'),
        configured: [],
        emitFrom: () => true,
        connect: noMachineHost,
        localCapabilities: localProjectActsSource(hosts, { embedded: true }),
        log: () => {},
      });
    expect(make).not.toThrow();
    expect(make().list()[0]).toMatchObject({ ref: local, local: true, capabilities: [PROJECT_ACTS_CAPABILITY] });
  });

  it('reads the attached daemon on the daemon shape, and hears its state', () => {
    let minor: number | null = null;
    const listeners = new Set<() => void>();
    const hosts = { peer: () => (minor === null ? null : peer(minor)), onState: (_owner: 'machine', listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)) };
    const source = localProjectActsSource(hosts, { embedded: false });
    expect(source.read()).toBeNull();
    let told = 0;
    const off = source.onChange(() => void told++);
    minor = PROJECT_ACTS_MINOR - 1;
    for (const listener of listeners) listener();
    expect([told, source.read()]).toEqual([1, []]);
    off();
    expect(listeners.size).toBe(0);
  });
});
