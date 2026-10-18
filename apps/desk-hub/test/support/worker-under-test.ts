// The Worker as the suites load it: the deployed Worker, with seams the deployed one does not have, each reached
// through an object's own fetch at a `/__test/…` path, which only Miniflare reaches (`LocalHub`), never the Worker:
//   - a `Machine` armed to throw on its next send of one frame kind, as a failed RPC from a `Project` would, or to hold
//     it until the suite releases it, as a slow one would;
//   - a `Machine` whose heartbeat and lease are shortened, so a lease can lapse within a test;
//   - a `Machine` the suite terminates (`ctx.abort()`), as a crash or a runtime's reset would: no `closed` reaches its
//     projects, only the lease's lapse;
//   - a `Machine` armed to find itself replaced at its next probe, as an instance Cloudflare replaced under its stream
//     would (Miniflare cannot route an object's new requests to a successor while the old instance streams on), one
//     that probes once and says which instance answered, and one armed to throw from its next request to a path, as a
//     reset object's call fails at the Worker;
//   - a `Machine` armed to hold its next revocation's answer until the suite releases it, or to lose it once the
//     revocation is stored;
//   - a `Project` that says which instance answers (a woken object is a new one), and takes a lease's renewal or close
//     for any generation, as a late one from an older stream would arrive;
//   - a `Project` that holds a `hello` at its registration, so a close can arrive while the Registry answers, and
//     takes a shorter window for a socket's visibility, so one can expire within a test;
//   - a `Project` that counts the calls machines make to it and the frames they carry, and the pages of `hello` backlogs
//     it has read;
//   - a `Project` that holds its archive lookups, lists its send queues, and queues a frame for any generation;
//   - a `Project` armed to fail its next `forget`, as a failed RPC from the Registry would;
//   - a `Registry` whose org record can be rewritten, as an object still on a deploy's previous version would make it;
//   - a `Registry` that takes a member, so a suite has a member who is not an admin, and projects by the thousand;
//   - a `Registry` that drops a project's row, as a hub from before machine projects lacks a machine's, and takes a
//     project's summary report straight, as a late one would arrive.
import { Machine as DeployedMachine, type Timing } from '../../src/objects/machine';
import { Project as DeployedProject } from '../../src/objects/project';
import { Registry as DeployedRegistry, type SummaryReport } from '../../src/objects/registry';
import type { DownFrame, UpFrame } from '../../src/protocol/machine';
import type { MachineContext } from '../../src/objects/project';
import type { Env } from '../../src/env';
import type { ProjectRecord } from '../../src/protocol/identity';
import {
  ABORT_REASON,
  MACHINE_ABORT_PATH,
  MACHINE_FETCH_FAULT_PATH,
  MACHINE_PROBE_PATH,
  MACHINE_REPLACE_PATH,
  MEMBER_PATH,
  ORG_ROW_PATH,
  PROJECT_ARCHIVE_HOLD_PATH,
  PROJECT_BACKLOG_PATH,
  PROJECT_CALLS_PATH,
  PROJECT_FORGET_FAULT_PATH,
  PROJECT_HOLD_PATH,
  PROJECT_LEASE_PATH,
  PROJECT_LIFE_PATH,
  PROJECT_QUEUES_PATH,
  PROJECT_SEND_PATH,
  PROJECT_VISIBLE_PATH,
  PROJECTS_PATH,
  REVOKE_FAULT_PATH,
  REVOKE_HELD_PATH,
  REVOKE_RELEASE_PATH,
  SEND_FAULT_PATH,
  SEND_HOLD_PATH,
  SEND_RELEASE_PATH,
  REPORT_PATH,
  TIMING_PATH,
  UNREGISTER_PATH,
} from './send-fault';

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
    if (url.pathname === REPORT_PATH) {
      const { project, report } = (await request.json()) as { project: string; report: SummaryReport };
      this.summary(project, report);
      return Response.json(this.orgFrame().frame);
    }
    if (url.pathname === UNREGISTER_PATH) {
      const { id } = (await request.json()) as { id: string };
      this.ctx.storage.sql.exec('DELETE FROM projects WHERE id = ?', id);
      return new Response('unregistered');
    }
    if (url.pathname === ORG_ROW_PATH) {
      const { id, name } = (await request.json()) as { id: string; name: string };
      this.ctx.storage.sql.exec('UPDATE org SET id = ?, name = ?', id, name);
      return new Response('rewritten');
    }
    if (url.pathname !== MEMBER_PATH) return super.fetch(request);
    const { email, role } = (await request.json()) as { email: string; role: 'admin' | 'member' };
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO members (id, email, role, created) VALUES (?, ?, ?, ?)', id, email.toLowerCase(), role, new Date().toISOString());
    return new Response('added');
  }
}

export class Machine extends DeployedMachine {
  private release: (() => void) | undefined;
  private replacedArmed = false;
  private revokeRelease: (() => void) | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === REVOKE_FAULT_PATH) {
      this.ctx.storage.kv.put('revoke-fault', url.searchParams.get('mode') ?? '');
      return new Response('armed');
    }
    if (url.pathname === REVOKE_HELD_PATH) return new Response(this.revokeRelease ? 'held' : 'none');
    if (url.pathname === REVOKE_RELEASE_PATH) {
      const release = this.revokeRelease;
      this.revokeRelease = undefined;
      release?.();
      return new Response(release ? 'released' : 'none');
    }
    if (url.pathname === SEND_HOLD_PATH) {
      this.ctx.storage.kv.put('send-hold', url.searchParams.get('kind') ?? '');
      return new Response('armed');
    }
    if (url.pathname === SEND_RELEASE_PATH) {
      const release = this.release;
      this.release = undefined;
      release?.();
      return new Response(release ? 'released' : 'none');
    }
    if (url.pathname === SEND_FAULT_PATH) {
      this.ctx.storage.kv.put('send-fault', url.searchParams.get('kind') ?? '');
      return new Response('armed');
    }
    if (url.pathname === TIMING_PATH) {
      const number = (name: string) => (url.searchParams.has(name) ? { [name]: Number(url.searchParams.get(name)) } : {});
      this.ctx.storage.kv.put('timing', { ...number('heartbeatMs'), ...number('leaseMs'), ...number('graceMs'), ...number('probeMs') });
      return new Response('timed');
    }
    if (url.pathname === MACHINE_REPLACE_PATH) {
      this.replacedArmed = true;
      return new Response('armed');
    }
    if (url.pathname === MACHINE_PROBE_PATH) return Response.json({ life: this.life, current: await this.current() });
    if (url.pathname === MACHINE_FETCH_FAULT_PATH) {
      this.ctx.storage.kv.put('fetch-fault', url.searchParams.get('path') ?? '');
      return new Response('armed');
    }
    if (this.ctx.storage.kv.get<string>('fetch-fault') === url.pathname) {
      this.ctx.storage.kv.delete('fetch-fault');
      throw new Error(`a failure the suite injected into the object's ${url.pathname}`);
    }
    if (url.pathname === MACHINE_ABORT_PATH) this.ctx.abort(ABORT_REASON);
    return super.fetch(request);
  }

  /** A suite's timing over the deployed one; a shortened heartbeat shortens the grace with it unless one is given. */
  protected timing(): Timing {
    const set = this.ctx.storage.kv.get<Partial<Timing>>('timing');
    return set ? { ...super.timing(), graceMs: set.heartbeatMs ?? super.timing().graceMs, ...set } : super.timing();
  }

  /** Armed, the next probe finds the object replaced, once: the stream the machine opens next is the successor's. */
  protected async replaced(): Promise<boolean> {
    if (!this.replacedArmed) return super.replaced();
    this.replacedArmed = false;
    return true;
  }

  async revoke(clientId: string | null): Promise<number> {
    const generation = await super.revoke(clientId);
    const fault = this.ctx.storage.kv.get<string>('revoke-fault');
    if (fault) this.ctx.storage.kv.delete('revoke-fault');
    if (fault === 'lose') {
      await this.ctx.storage.sync(); // the revocation is stored; only its answer is lost
      throw new Error('a revocation answer the suite lost');
    }
    if (fault === 'hold') await new Promise<void>((resolve) => (this.revokeRelease = resolve));
    return generation;
  }

  async send(frame: DownFrame, generation?: number): Promise<'written' | 'offline'> {
    if (this.ctx.storage.kv.get<string>('send-fault') === frame.t) {
      this.ctx.storage.kv.delete('send-fault');
      throw new Error(`a failure the suite injected into the send of ${frame.t}`);
    }
    if (this.ctx.storage.kv.get<string>('send-hold') === frame.t) {
      this.ctx.storage.kv.delete('send-hold');
      await new Promise<void>((resolve) => (this.release = resolve));
    }
    return super.send(frame, generation);
  }
}

export class Project extends DeployedProject {
  private held: { promise: Promise<void>; release: () => void } | undefined;
  private heldArchive: { promise: Promise<void>; release: () => void } | undefined;
  private backlogPages = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Counts the pages of `hello` backlogs as they are read.
    const log = (this as unknown as { log: { beyond: (...args: unknown[]) => Iterable<unknown> } }).log;
    const beyond = log.beyond.bind(log);
    log.beyond = (...args: unknown[]) => {
      const pages = beyond(...args);
      const count = () => this.backlogPages++;
      return (function* () {
        for (const page of pages) {
          count();
          yield page;
        }
      })();
    };
  }

  protected async archiveMachine(project: string): Promise<string | null | undefined> {
    await this.heldArchive?.promise;
    return super.archiveMachine(project);
  }

  async fromMachine(ctx: MachineContext, frames: UpFrame[]): Promise<{ applied: number; stale: boolean; failed: boolean }> {
    const calls = this.ctx.storage.kv.get<{ calls: number; frames: number }>('calls') ?? { calls: 0, frames: 0 };
    this.ctx.storage.kv.put('calls', { calls: calls.calls + 1, frames: calls.frames + frames.length });
    return super.fromMachine(ctx, frames);
  }

  protected visibleMs(): number {
    return this.ctx.storage.kv.get<number>('visible-window') ?? super.visibleMs();
  }

  forget(org: string, project: string, machine: string, generation: number): void {
    if (this.ctx.storage.kv.get<boolean>('forget-fault')) {
      this.ctx.storage.kv.delete('forget-fault');
      throw new Error('a failure the suite injected into forget');
    }
    super.forget(org, project, machine, generation);
  }

  protected async register(project: string, name: string, machine: string): Promise<ProjectRecord> {
    await this.held?.promise;
    return super.register(project, name, machine);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === PROJECT_VISIBLE_PATH) {
      this.ctx.storage.kv.put('visible-window', ((await request.json()) as { ms: number }).ms);
      return new Response('windowed');
    }
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
    if (url.pathname === PROJECT_ARCHIVE_HOLD_PATH) {
      const { hold } = (await request.json()) as { hold: boolean };
      if (hold && !this.heldArchive) {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => (release = resolve));
        this.heldArchive = { promise, release };
      } else if (!hold && this.heldArchive) {
        this.heldArchive.release();
        this.heldArchive = undefined;
      }
      return new Response('held');
    }
    if (url.pathname === PROJECT_QUEUES_PATH) return Response.json([...this.queues.keys()]);
    if (url.pathname === PROJECT_SEND_PATH) {
      const { machine, generation, frame } = (await request.json()) as { machine: string; generation: number; frame: DownFrame };
      void this.toMachine(machine, generation, frame).catch(() => {});
      return new Response('queued');
    }
    if (url.pathname === PROJECT_BACKLOG_PATH) return Response.json(this.backlogPages);
    if (url.pathname === PROJECT_FORGET_FAULT_PATH) {
      this.ctx.storage.kv.put('forget-fault', true);
      return new Response('armed');
    }
    if (url.pathname === PROJECT_LIFE_PATH) return new Response(this.life);
    if (url.pathname === PROJECT_CALLS_PATH) return Response.json(this.ctx.storage.kv.get('calls') ?? { calls: 0, frames: 0 });
    if (url.pathname === PROJECT_LEASE_PATH) {
      const { op, ...ctx } = (await request.json()) as { op: 'renew' | 'closed'; org: string; project: string; machine: string; client: string; generation: number; leaseMs: number };
      if (op === 'renew') this.renew(ctx);
      else this.closed(ctx);
      return new Response('done');
    }
    return super.fetch(request);
  }
}
