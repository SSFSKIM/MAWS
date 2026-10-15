// The Worker as the suites load it: the deployed Worker, with seams the deployed one does not have, each reached
// through an object's own fetch at a `/__test/…` path, which only Miniflare reaches (`LocalHub`), never the Worker:
//   - a `Machine` armed to throw on its next send of one frame kind, as a failed RPC from a `Project` would;
//   - a `Machine` whose heartbeat and lease are shortened, so a lease can lapse within a test;
//   - a `Machine` the suite terminates (`ctx.abort()`), as a crash or a runtime's reset would: no `closed` reaches its
//     projects, only the lease's lapse;
//   - a `Project` that says which instance answers (a woken object is a new one), and takes a lease's renewal or close
//     for any generation, as a late one from an older stream would arrive;
//   - a `Project` that holds a `hello` at its registration, so a close can arrive while the Registry answers;
//   - a `Registry` that takes a member, so a suite has a member who is not an admin, and projects by the thousand.
import { Machine as DeployedMachine, type Timing } from '../../src/objects/machine';
import { Project as DeployedProject } from '../../src/objects/project';
import { Registry as DeployedRegistry } from '../../src/objects/registry';
import type { DownFrame } from '../../src/protocol/machine';
import type { ProjectRecord } from '../../src/protocol/identity';
import { ABORT_REASON, MACHINE_ABORT_PATH, MEMBER_PATH, PROJECT_HOLD_PATH, PROJECT_LEASE_PATH, PROJECT_LIFE_PATH, PROJECTS_PATH, SEND_FAULT_PATH, TIMING_PATH } from './send-fault';

export { default } from '../../src/worker';

/** The org's registry, which can also take a member (the hub has no endpoint for that before the org phase). */
export class Registry extends DeployedRegistry {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === PROJECTS_PATH) {
      const { count, prefix } = (await request.json()) as { count: number; prefix: string };
      const created = new Date().toISOString();
      this.ctx.storage.transactionSync(() => {
        for (let i = 0; i < count; i++) {
          const id = `${prefix}-${String(i).padStart(12, '0')}`;
          this.ctx.storage.sql.exec('INSERT OR IGNORE INTO projects (id, name, registered_by, created, archive_machine) VALUES (?, ?, ?, ?, NULL)', id, `${id} ${'n'.repeat(160)}`, 'suite', created);
        }
      });
      return new Response('added');
    }
    if (url.pathname !== MEMBER_PATH) return super.fetch(request);
    const { email, role } = (await request.json()) as { email: string; role: 'admin' | 'member' };
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO members (id, email, role, created) VALUES (?, ?, ?, ?)', id, email.toLowerCase(), role, new Date().toISOString());
    return new Response('added');
  }
}

export class Machine extends DeployedMachine {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === SEND_FAULT_PATH) {
      this.ctx.storage.kv.put('send-fault', url.searchParams.get('kind') ?? '');
      return new Response('armed');
    }
    if (url.pathname === TIMING_PATH) {
      this.ctx.storage.kv.put('timing', { heartbeatMs: Number(url.searchParams.get('heartbeatMs')), leaseMs: Number(url.searchParams.get('leaseMs')) });
      return new Response('timed');
    }
    if (url.pathname === MACHINE_ABORT_PATH) this.ctx.abort(ABORT_REASON);
    return super.fetch(request);
  }

  protected timing(): Timing {
    return this.ctx.storage.kv.get<Timing>('timing') ?? super.timing();
  }

  async send(frame: DownFrame, generation?: number): Promise<'written' | 'offline'> {
    if (this.ctx.storage.kv.get<string>('send-fault') === frame.t) {
      this.ctx.storage.kv.delete('send-fault');
      throw new Error(`a failure the suite injected into the send of ${frame.t}`);
    }
    return super.send(frame, generation);
  }
}

export class Project extends DeployedProject {
  private held: { promise: Promise<void>; release: () => void } | undefined;

  protected async register(project: string, name: string, machine: string): Promise<ProjectRecord> {
    await this.held?.promise;
    return super.register(project, name, machine);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === PROJECT_HOLD_PATH) {
      const { hold } = (await request.json()) as { hold: boolean };
      if (hold && !this.held) {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => (release = resolve));
        this.held = { promise, release };
      } else if (!hold && this.held) {
        this.held.release();
        this.held = undefined;
      }
      return new Response('held');
    }
    if (url.pathname === PROJECT_LIFE_PATH) return new Response(this.life);
    if (url.pathname === PROJECT_LEASE_PATH) {
      const { op, ...ctx } = (await request.json()) as { op: 'renew' | 'closed'; org: string; project: string; machine: string; generation: number; leaseMs: number };
      if (op === 'renew') this.renew(ctx);
      else this.closed(ctx);
      return new Response('done');
    }
    return super.fetch(request);
  }
}
