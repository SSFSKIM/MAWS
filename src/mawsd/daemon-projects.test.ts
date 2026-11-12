// The project registry's M12 (Interfaces §K): `projects.registry` on a real daemon's machine.sock, served cold, and on a
// daemon with no enrolled endpoint the read of an unenrolled machine, named as machine.identity names it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostname } from 'node:os';
import { machineName } from '@shared/machine/identity';
import { MawsdScene } from '../../test/support/mawsd-scene';
import type { EndpointModule } from './endpoint-seam';

let scene: MawsdScene;
beforeEach(() => {
  scene = new MawsdScene('maws-pr-');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

class ReadingEndpoint implements EndpointModule {
  read = { enrolled: true, machine: { ref: '', name: 'mini' }, machines: [] as unknown[], contested: [] as string[], projects: [] as unknown[] };
  readonly registryRead = { read: async () => this.read as never };
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  status(): unknown {
    return { enrolled: true };
  }
  enrollment() {
    return { name: 'mini', org: 'o' };
  }
  async cli(): Promise<{ code: number; out: string }> {
    return { code: 0, out: '' };
  }
}

describe('projects.registry on machine.sock', () => {
  it('answers an unenrolled machine with no projects, by the name machine.identity gives it', async () => {
    const daemon = await scene.start();
    const terminal = await scene.app('machine', { capabilities: [] });
    expect(await terminal.request('projects.registry')).toMatchObject({ ok: true, value: { enrolled: false, machine: { ref: daemon.ref, name: machineName({ MAWS_USER_DATA: scene.root }, hostname()) }, machines: [], contested: [], projects: [] } });
  });

  it('answers the enrolled endpoint’s read', async () => {
    const endpoint = new ReadingEndpoint();
    const daemon = await scene.start({ endpoint });
    const location = { pid: 'p1', id: 'proj-1', key: 'folder:x:/srv/scrape', name: 'scrape', path: '/srv/scrape', source: 'folder', stated: 'minted', machine: daemon.ref };
    endpoint.read = { enrolled: true, machine: { ref: daemon.ref, name: 'mini' }, machines: [{ ref: daemon.ref, name: 'mini' }], contested: [], projects: [{ id: 'proj-1', name: 'scrape', hub: true, renamable: true, locations: [location], known: [] }] };
    const terminal = await scene.app('machine', { capabilities: [] });
    expect(await terminal.request('projects.registry')).toMatchObject({ ok: true, value: endpoint.read });
  });
});
