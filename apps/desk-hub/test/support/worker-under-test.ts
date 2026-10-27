// The Worker as the suites load it: the deployed Worker, with seams the deployed one does not have, each reached
// through an object's own fetch at a `/__test/…` path, which only Miniflare reaches (`LocalHub`), never the Worker:
//   - a `Machine` armed to throw on its next send of one frame kind, as a failed RPC from a `Project` would, or to hold
//     it until the suite releases it, as a slow one would, and one armed to stall its next write of a kind, as a stream
//     whose client stopped reading never takes it;
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
//   - a `Project` that holds its archive lookups, lists its send queues and the machine streams it fans out to, and
//     queues a frame for any generation;
//   - a `Project` armed to fail its next `forget`, as a failed RPC from the Registry would;
//   - a `Project` whose clock is moved on, so the org state it cached ages, and a `Registry` armed to fail `head()`, as
//     an unreachable one would (O11 M5);
//   - a `Registry` whose org record can be rewritten, as an object still on a deploy's previous version would make it;
//   - a `Registry` that takes a member, so a suite has a member who is not an admin, and projects by the thousand;
//   - a `Registry` that drops a project's row, as a hub from before machine projects lacks a machine's, and takes a
//     project's summary report straight, as a late one would arrive;
//   - a `Registry` whose `summaries` lose their `live` column, as a registry stored before it had them, and one armed to
//     take its next summary report as the version before `live` took it;
//   - a `Registry` whose machines' `seen` and `confirmed`, keys' expiry and enrollments' expiry are moved back, as the
//     time having passed would leave them, and whose alarm is read or cleared;
//   - a `Registry` armed to hold its next `leave` until the suite releases it, as the Worker held between resolving a
//     machine's credential and asking for its revocation would be;
//   - a `Registry` whose unfinished offline revocations wait less than a minute before they are tried again;
//   - a `Registry` that runs a method for a member record the suite gives, as one the Worker resolved before a state
//     changed it, and one that lacks a method, as a Registry on older code;
//   - a `Registry` that answers its projection of the org state, moves a pending
//     device's expiry back, and calls a method no `Project` has, saying whether it takes the refusal for older code;
//   - a `Project` armed to throw from its next state announcements, as a reset object's call fails or as a project on
//     the code before the announcement refuses it, saying the newest version announced;
//   - a `Machine` armed to throw from its next calls of `directory`, and a `Registry` armed to throw from its next summary
//     reports of a project, as a call to an object a code update reset fails, each counting the calls it took; a
//     `Registry` and a `Project` whose first retry of such a call waits another time than the deployed second; and a
//     `Project` that says whether a retry of its report waits.
import { Machine as DeployedMachine, type Stream, type Timing } from '../../src/objects/machine';
import { Project as DeployedProject } from '../../src/objects/project';
import { Registry as DeployedRegistry, type SummaryReport } from '../../src/objects/registry';
import type { DownFrame, OrgFrame, UpFrame } from '../../src/protocol/machine';
import type { MachineContext } from '../../src/objects/project';
import type { Env } from '../../src/env';
import type { MachineRecord, MemberRecord, ProjectRecord } from '../../src/protocol/identity';
import {
  ABORT_REASON,
  ALARM_PATH,
  BACKDATE_PATH,
  DIRECTORY_FAULT_PATH,
  LEAVE_HELD_PATH,
  LEAVE_HOLD_PATH,
  LEAVE_RELEASE_PATH,
  OFFLINE_RETRY_PATH,
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
  PROJECT_RECEIPTS_PATH,
  PROJECTS_PATH,
  REVOKE_FAULT_PATH,
  REVOKE_HELD_PATH,
  REVOKE_RELEASE_PATH,
  SEND_FAULT_PATH,
  SEND_HOLD_PATH,
  SEND_RELEASE_PATH,
  REPORT_PATH,
  REPORT_RETRY_PATH,
  RETRY_BASE_PATH,
  SUMMARIES_BEFORE_LIVE_PATH,
  SUMMARY_AS_PREVIOUS_PATH,
  SUMMARY_FAULT_PATH,
  TIMING_PATH,
  UNREGISTER_PATH,
  WRITE_STALL_PATH,
  PROJECT_MACHINES_PATH,
  PROJECTION_PATH,
  PROJECT_STATE_FAULT_PATH,
  MISSING_METHOD_PATH,
  REGISTRY_RPC_PATH,
  REGISTRY_HEAD_FAULT_PATH,
  PROJECT_STATE_CACHE_PATH,
  AS_MEMBER_PATH,
  LACKS_PATH,
  CLAIM_HOLD_PATH,
  CLAIM_HELD_PATH,
  CLAIM_RELEASE_PATH,
  UPGRADE_HOLD_PATH,
  UPGRADE_HELD_PATH,
  UPGRADE_RELEASE_PATH,
  RELAY_FAULT_PATH,
  CLAIM_PATH,
} from './send-fault';
import { lacksMethod } from '../../src/objects/retry';

export { default } from '../../src/worker';

/** An armed fault: the throws still armed, and the calls taken since it was armed. */
type Fault = { remaining: number; calls: number };
/** An armed fault of state announcements: `missing` throws workerd's refusal of a method the callee lacks. */
type StateFault = Fault & { missing?: boolean };

/** The Registry's RPC methods a suite calls as an object would (REGISTRY_RPC_PATH). */
const REGISTRY_RPCS = ['storeListing', 'storeEndpoint', 'notify', 'ownersOf', 'push'] as const;

/** The org's registry, which can also take a member (the hub has no endpoint for that before the org phase). */
export class Registry extends DeployedRegistry {
  private asPrevious = false;
  private leaveRelease: (() => void) | undefined;

  /** Armed, the org-state head a `Project` reads to check a v2 event fails, as an unreachable Registry's would. */
  head(): ReturnType<DeployedRegistry['head']> {
    if (this.ctx.storage.kv.get<boolean>('head-fault')) throw new Error('a failure the suite injected into head');
    return super.head();
  }

  /** A suite's wait before an unfinished offline revocation is tried again, over the deployed minute. */
  protected offlineRetryMs(): number {
    return this.ctx.storage.kv.get<number>('offline-retry-ms') ?? super.offlineRetryMs();
  }

  /** A suite's first wait before a failed push of the directory is sent again, over the deployed second. */
  protected retryBaseMs(): number {
    return this.ctx.storage.kv.get<number>('retry-base-ms') ?? super.retryBaseMs();
  }

  /** Armed, the next leave waits for the suite's release before the Registry's own. */
  async leave(machine: MachineRecord): ReturnType<DeployedRegistry['leave']> {
    if (this.ctx.storage.kv.get<boolean>('leave-hold')) {
      this.ctx.storage.kv.delete('leave-hold');
      await new Promise<void>((resolve) => (this.leaveRelease = resolve));
    }
    return super.leave(machine);
  }

  /** Armed, refused as a Registry on the code before the org state would refuse it. */
  orgState(since: string | null): ReturnType<DeployedRegistry['orgState']> {
    if (this.ctx.storage.kv.get<string>('lacks') === 'orgState') throw new TypeError('The RPC receiver does not implement the method "orgState".');
    return super.orgState(since);
  }

  /** Armed, refused as a Registry on the code before the checked list would refuse it. */
  memberPushSubscriptions(member: MemberRecord): ReturnType<DeployedRegistry['memberPushSubscriptions']> {
    if (this.ctx.storage.kv.get<string>('lacks') === 'memberPushSubscriptions') throw new TypeError('The RPC receiver does not implement the method "memberPushSubscriptions".');
    return super.memberPushSubscriptions(member);
  }

  /** Armed, refused as a Registry on the code before the relay's binding check would refuse it. */
  machineBinds(name: string, ref: string): ReturnType<DeployedRegistry['machineBinds']> {
    if (this.ctx.storage.kv.get<string>('lacks') === 'machineBinds') throw new TypeError('The RPC receiver does not implement the method "machineBinds".');
    return super.machineBinds(name, ref);
  }

  /** Armed, the next report is taken as the version before `live` took it, once: its counts stored without `live`, and
   * nothing answered. */
  summary(project: string, report: SummaryReport): true {
    const fault = this.ctx.storage.kv.get<Fault>(`summary-fault:${project}`);
    if (fault) {
      this.ctx.storage.kv.put(`summary-fault:${project}`, { remaining: Math.max(0, fault.remaining - 1), calls: fault.calls + 1 });
      if (fault.remaining > 0) throw new Error(`a failure the suite injected into a summary report of ${project}`);
    }
    if (!this.asPrevious) return super.summary(project, report);
    this.asPrevious = false;
    super.summary(project, { ...report, live: undefined });
    return undefined as unknown as true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === OFFLINE_RETRY_PATH) {
      const { ms } = (await request.json()) as { ms: number | null };
      if (ms === null) this.ctx.storage.kv.delete('offline-retry-ms');
      else this.ctx.storage.kv.put('offline-retry-ms', ms);
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return new Response('set');
    }
    if (url.pathname === REGISTRY_HEAD_FAULT_PATH) {
      this.ctx.storage.kv.put('head-fault', ((await request.json()) as { fail: boolean }).fail);
      return new Response('armed');
    }
    if (url.pathname === LEAVE_HOLD_PATH) {
      this.ctx.storage.kv.put('leave-hold', true);
      return new Response('armed');
    }
    if (url.pathname === SUMMARY_FAULT_PATH) {
      const { project, times } = (await request.json()) as { project: string; times?: number };
      if (times !== undefined) this.ctx.storage.kv.put(`summary-fault:${project}`, { remaining: times, calls: 0 });
      return Response.json(this.ctx.storage.kv.get<Fault>(`summary-fault:${project}`) ?? { remaining: 0, calls: 0 });
    }
    if (url.pathname === RETRY_BASE_PATH) {
      this.ctx.storage.kv.put('retry-base-ms', ((await request.json()) as { ms: number }).ms);
      return new Response('set');
    }
    if (url.pathname === LEAVE_HELD_PATH) return new Response(this.leaveRelease ? 'held' : 'none');
    if (url.pathname === LEAVE_RELEASE_PATH) {
      const release = this.leaveRelease;
      this.leaveRelease = undefined;
      release?.();
      return new Response(release ? 'released' : 'none');
    }
    if (url.pathname === BACKDATE_PATH) {
      const { machines, key, enrollment, pendingDevice } = (await request.json()) as {
        machines?: Array<{ name: string; seen?: string; confirmed?: string }>;
        key?: { id: string; expires: string };
        enrollment?: { machine: string; expires: string };
        pendingDevice?: { member: string; device: string; expires: string };
      };
      const sql = this.ctx.storage.sql;
      for (const machine of machines ?? []) {
        if (machine.seen !== undefined) sql.exec('UPDATE machines SET seen = ? WHERE name = ?', machine.seen, machine.name);
        if (machine.confirmed !== undefined) sql.exec('UPDATE machines SET confirmed = ? WHERE name = ?', machine.confirmed, machine.name);
      }
      if (key) sql.exec('UPDATE provisioning_keys SET expires = ? WHERE id = ?', key.expires, key.id);
      if (enrollment) sql.exec('UPDATE enrollments SET expires = ? WHERE id = (SELECT enrollment FROM machines WHERE name = ?)', enrollment.expires, enrollment.machine);
      if (pendingDevice) sql.exec('UPDATE pending_devices SET expires = ? WHERE member = ? AND device = ?', pendingDevice.expires, pendingDevice.member, pendingDevice.device);
      await this.scheduleAlarm();
      return Response.json({ alarm: await this.ctx.storage.getAlarm() });
    }
    if (url.pathname === ALARM_PATH) {
      if (request.method === 'POST' && ((await request.json()) as { clear?: boolean }).clear) await this.ctx.storage.deleteAlarm();
      return Response.json({ alarm: await this.ctx.storage.getAlarm() });
    }
    if (url.pathname === SUMMARY_AS_PREVIOUS_PATH) {
      this.asPrevious = true;
      return new Response('armed');
    }
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
    if (url.pathname === SUMMARIES_BEFORE_LIVE_PATH) {
      this.ctx.storage.sql.exec('ALTER TABLE summaries DROP COLUMN live');
      return new Response('dropped');
    }
    if (url.pathname === UNREGISTER_PATH) {
      const { id } = (await request.json()) as { id: string };
      this.ctx.storage.sql.exec('DELETE FROM projects WHERE id = ?', id);
      return new Response('unregistered');
    }
    if (url.pathname === PROJECTION_PATH) {
      const sql = this.ctx.storage.sql;
      return Response.json({
        members: sql.exec('SELECT id, email, role FROM members ORDER BY id').toArray(),
        devices: sql.exec('SELECT id, member, class, access_client_id FROM devices ORDER BY id').toArray(),
        machines: sql
          .exec<{ ref: string; name: string; pub: string; owners: string }>('SELECT ref, name, pub, owners FROM state_machines ORDER BY ref')
          .toArray()
          .map((m) => ({ ...m, owners: JSON.parse(m.owners) as unknown })),
      });
    }
    if (url.pathname === REGISTRY_RPC_PATH) {
      type Call = { method: (typeof REGISTRY_RPCS)[number]; args: unknown[] };
      const body = (await request.json()) as Call | { concurrent: Call[] };
      const calls = 'concurrent' in body ? body.concurrent : [body];
      if (!calls.every((c) => REGISTRY_RPCS.includes(c.method))) return new Response('no such RPC', { status: 400 });
      const results = await Promise.all(calls.map(async ({ method, args }) => ((await (this[method] as (...a: unknown[]) => unknown).apply(this, args)) ?? null)));
      return Response.json('concurrent' in body ? results : results[0]);
    }
    if (url.pathname === LACKS_PATH) {
      const { method } = (await request.json()) as { method: string | null };
      if (method === null) this.ctx.storage.kv.delete('lacks');
      else this.ctx.storage.kv.put('lacks', method);
      return new Response('armed');
    }
    if (url.pathname === AS_MEMBER_PATH) {
      const { call, member, args } = (await request.json()) as { call: string; member: MemberRecord; args: unknown[] };
      const method = (this as unknown as Record<string, (member: MemberRecord, ...args: unknown[]) => unknown>)[call];
      return Response.json(await method.call(this, member, ...args));
    }
    if (url.pathname === MISSING_METHOD_PATH) {
      const stub = this.env.PROJECT.get(this.env.PROJECT.idFromName('missing-method')) as unknown as { noSuchMethod(): Promise<void> };
      try {
        await stub.noSuchMethod();
        return Response.json({ lacks: false, message: 'answered' });
      } catch (error) {
        return Response.json({ lacks: lacksMethod(error, 'noSuchMethod'), message: error instanceof Error ? error.message : String(error) });
      }
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
  private claimHeld = false;
  private claimRelease: (() => void) | undefined;
  private upgradeHeld = false;
  private upgradeRelease: (() => void) | undefined;
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
    if (url.pathname === CLAIM_HOLD_PATH) {
      this.claimHeld = true;
      return new Response('armed');
    }
    if (url.pathname === CLAIM_HELD_PATH) return new Response(this.claimRelease ? 'held' : 'none');
    if (url.pathname === CLAIM_RELEASE_PATH) {
      const release = this.claimRelease;
      this.claimRelease = undefined;
      release?.();
      return new Response(release ? 'released' : 'none');
    }
    if (url.pathname === UPGRADE_HOLD_PATH) {
      this.upgradeHeld = true;
      return new Response('armed');
    }
    if (url.pathname === UPGRADE_HELD_PATH) return new Response(this.upgradeRelease ? 'held' : 'none');
    if (url.pathname === UPGRADE_RELEASE_PATH) {
      const release = this.upgradeRelease;
      this.upgradeRelease = undefined;
      release?.();
      return new Response(release ? 'released' : 'none');
    }
    if (url.pathname === '/socket' && this.upgradeHeld) {
      this.upgradeHeld = false;
      await new Promise<void>((resolve) => (this.upgradeRelease = resolve));
    }
    if (url.pathname === CLAIM_PATH) {
      const { org, name, ref, client } = (await request.json()) as { org: string; name: string; ref: string; client: string };
      return Response.json(await this.claimGeneration(org, name, ref, client));
    }
    if (url.pathname === RELAY_FAULT_PATH) {
      const { method, times } = (await request.json()) as { method: string; times: number };
      this.ctx.storage.kv.put(`relay-fault:${method}`, times);
      return new Response('armed');
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
    if (url.pathname === WRITE_STALL_PATH) {
      this.ctx.storage.kv.put('write-stall', url.searchParams.get('kind') ?? '');
      return new Response('armed');
    }
    if (url.pathname === TIMING_PATH) {
      const number = (name: string) => (url.searchParams.has(name) ? { [name]: Number(url.searchParams.get(name)) } : {});
      this.ctx.storage.kv.put('timing', { ...number('heartbeatMs'), ...number('leaseMs'), ...number('graceMs'), ...number('probeMs'), ...number('writeTimeoutMs') });
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
    if (url.pathname === DIRECTORY_FAULT_PATH) {
      const { times } = (await request.json()) as { times?: number };
      if (times !== undefined) this.ctx.storage.kv.put('directory-fault', { remaining: times, calls: 0 });
      return Response.json(this.ctx.storage.kv.get<Fault>('directory-fault') ?? { remaining: 0, calls: 0 });
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
    if (this.ctx.storage.kv.get<string>('revoke-fault') === 'fail') {
      this.ctx.storage.kv.delete('revoke-fault');
      throw new Error('a revocation that failed before it was applied (the suite armed it)');
    }
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

  /** Armed, the next write of the frame kind is never taken, as by a stream whose client stopped reading. */
  protected put(stream: Stream, frame: DownFrame): Promise<void> {
    if (this.ctx.storage.kv.get<string>('write-stall') === frame.t) {
      this.ctx.storage.kv.delete('write-stall');
      return new Promise<void>(() => {});
    }
    return super.put(stream, frame);
  }

  /** Armed, the next calls throw before the directory reaches the stream; every call is counted. */
  async directory(frame: OrgFrame, version: number): Promise<'written' | 'offline'> {
    const fault = this.ctx.storage.kv.get<Fault>('directory-fault');
    if (fault) {
      this.ctx.storage.kv.put('directory-fault', { remaining: Math.max(0, fault.remaining - 1), calls: fault.calls + 1 });
      if (fault.remaining > 0) throw new Error(`a failure the suite injected into the directory push of version ${version}`);
    }
    return super.directory(frame, version);
  }

  /** Armed, the next claim is granted and stored, and its answer held until the suite releases it: a claim in flight. */
  async claimGeneration(...args: Parameters<DeployedMachine['claimGeneration']>): ReturnType<DeployedMachine['claimGeneration']> {
    const claimed = await super.claimGeneration(...args);
    if (this.claimHeld) {
      this.claimHeld = false;
      await new Promise<void>((resolve) => (this.claimRelease = resolve));
    }
    return claimed;
  }

  /** Throws from a relay method while the suite's fault for it has throws left. */
  private relayFault(method: string): void {
    const left = this.ctx.storage.kv.get<number>(`relay-fault:${method}`) ?? 0;
    if (left <= 0) return;
    this.ctx.storage.kv.put(`relay-fault:${method}`, left - 1);
    throw new Error(`a failure the suite injected into ${method}`);
  }

  relayRevoke(...args: Parameters<DeployedMachine['relayRevoke']>): ReturnType<DeployedMachine['relayRevoke']> {
    this.relayFault('relayRevoke');
    return super.relayRevoke(...args);
  }

  relayState(...args: Parameters<DeployedMachine['relayState']>): ReturnType<DeployedMachine['relayState']> {
    this.relayFault('relayState');
    return super.relayState(...args);
  }

  async send(frame: DownFrame, generation?: number): ReturnType<DeployedMachine['send']> {
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
  private readHold: { promise: Promise<void>; release: () => void } | undefined;

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

  async fromMachine(ctx: MachineContext, frames: UpFrame[]): ReturnType<DeployedProject['fromMachine']> {
    const calls = this.ctx.storage.kv.get<{ calls: number; frames: number }>('calls') ?? { calls: 0, frames: 0 };
    this.ctx.storage.kv.put('calls', { calls: calls.calls + 1, frames: calls.frames + frames.length });
    return super.fromMachine(ctx, frames);
  }

  protected visibleMs(): number {
    return this.ctx.storage.kv.get<number>('visible-window') ?? super.visibleMs();
  }

  /** The deployed clock, moved on by what the suite asked (`PROJECT_STATE_CACHE_PATH`). */
  protected now(): number {
    return super.now() + (this.ctx.storage.kv.get<number>('clock-ahead') ?? 0);
  }

  /** The org-state head as deployed, each read counted, and held while the suite holds it. */
  protected async readOrgState(): ReturnType<DeployedProject['readOrgState']> {
    this.ctx.storage.kv.put('state-reads', (this.ctx.storage.kv.get<number>('state-reads') ?? 0) + 1);
    await this.readHold?.promise;
    return super.readOrgState();
  }

  /** The bound on a read of the org-state head, as the suite set it. */
  protected stateReadTimeoutMs(): number {
    return this.ctx.storage.kv.get<number>('read-timeout-ms') ?? super.stateReadTimeoutMs();
  }

  /** A suite's first wait before a failed summary report is sent again, over the deployed second. */
  protected retryBaseMs(): number {
    return this.ctx.storage.kv.get<number>('retry-base-ms') ?? super.retryBaseMs();
  }

  forget(org: string, project: string, machine: string, generation: number): void {
    if (this.ctx.storage.kv.get<boolean>('forget-fault')) {
      this.ctx.storage.kv.delete('forget-fault');
      throw new Error('a failure the suite injected into forget');
    }
    super.forget(org, project, machine, generation);
  }

  /** Armed, the next announcements throw: as a reset object's call fails, or as one on older code lacks the method. */
  async stateAdvanced(version: number, members?: string[]): Promise<void> {
    const fault = this.ctx.storage.kv.get<StateFault>('state-fault');
    if (fault) {
      this.ctx.storage.kv.put('state-fault', { ...fault, remaining: Math.max(0, fault.remaining - 1), calls: fault.calls + 1 });
      if (fault.remaining > 0) {
        throw fault.missing ? new TypeError('The RPC receiver does not implement the method "stateAdvanced".') : new Error('a failure the suite injected into a state announcement');
      }
    }
    this.ctx.storage.kv.put('announced', Math.max(version, this.ctx.storage.kv.get<number>('announced') ?? 0));
    return super.stateAdvanced(version, members);
  }

  protected async register(project: string, name: string, machine: string): Promise<ProjectRecord> {
    await this.held?.promise;
    return super.register(project, name, machine);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === PROJECT_RECEIPTS_PATH) {
      const { ageByMs } = await request.json() as { ageByMs: number };
      const before = this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM op_outcomes').one().count;
      // Model the elapsed day without any browser/machine message or ops() read that could lazy-clean the table.
      this.ctx.storage.sql.exec('UPDATE op_outcomes SET updated = updated - ?', ageByMs);
      await this.ctx.storage.deleteAlarm();
      await this.alarm();
      return Response.json({ before, rows: this.ctx.storage.sql.exec('SELECT rpc, updated FROM op_outcomes').toArray(), alarm: await this.ctx.storage.getAlarm() });
    }
    if (url.pathname === PROJECT_VISIBLE_PATH) {
      this.ctx.storage.kv.put('visible-window', ((await request.json()) as { ms: number }).ms);
      return new Response('windowed');
    }
    if (url.pathname === RETRY_BASE_PATH) {
      this.ctx.storage.kv.put('retry-base-ms', ((await request.json()) as { ms: number }).ms);
      return new Response('set');
    }
    if (url.pathname === REPORT_RETRY_PATH) return Response.json({ waiting: (this as unknown as { reportRetry: unknown }).reportRetry !== undefined });
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
    if (url.pathname === PROJECT_MACHINES_PATH) return Response.json(this.ctx.storage.sql.exec('SELECT name, generation FROM machines').toArray());
    if (url.pathname === PROJECT_SEND_PATH) {
      const { machine, generation, frame } = (await request.json()) as { machine: string; generation: number; frame: DownFrame };
      void this.toMachine(machine, generation, frame, 'replies').catch(() => {});
      return new Response('queued');
    }
    if (url.pathname === PROJECT_BACKLOG_PATH) return Response.json(this.backlogPages);
    if (url.pathname === PROJECT_STATE_FAULT_PATH) {
      const { times, missing = false } = (await request.json()) as { times?: number; missing?: boolean };
      if (times !== undefined) this.ctx.storage.kv.put('state-fault', { remaining: times, calls: 0, missing });
      const fault = this.ctx.storage.kv.get<StateFault>('state-fault') ?? { remaining: 0, calls: 0 };
      return Response.json({ remaining: fault.remaining, calls: fault.calls, announced: this.ctx.storage.kv.get<number>('announced') ?? null });
    }
    if (url.pathname === PROJECT_STATE_CACHE_PATH) {
      const { ahead = 0, hold, readTimeoutMs } = (await request.json()) as { ahead?: number; hold?: boolean; readTimeoutMs?: number };
      this.ctx.storage.kv.put('clock-ahead', (this.ctx.storage.kv.get<number>('clock-ahead') ?? 0) + ahead);
      if (readTimeoutMs !== undefined) this.ctx.storage.kv.put('read-timeout-ms', readTimeoutMs);
      if (hold && !this.readHold) {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => (release = resolve));
        this.readHold = { promise, release };
      } else if (hold === false && this.readHold) {
        this.readHold.release();
        this.readHold = undefined;
      }
      return Response.json({ reads: this.ctx.storage.kv.get<number>('state-reads') ?? 0 });
    }
    if (url.pathname === PROJECT_FORGET_FAULT_PATH) {
      this.ctx.storage.kv.put('forget-fault', true);
      return new Response('armed');
    }
    if (url.pathname === PROJECT_LIFE_PATH) return new Response(this.life);
    if (url.pathname === PROJECT_CALLS_PATH) return Response.json(this.ctx.storage.kv.get('calls') ?? { calls: 0, frames: 0 });
    if (url.pathname === PROJECT_LEASE_PATH) {
      const { op, ...ctx } = (await request.json()) as { op: 'renew' | 'closed' | 'forget'; org: string; project: string; machine: string; client: string; generation: number; leaseMs: number };
      if (op === 'renew') this.renew(ctx);
      else if (op === 'forget') this.forget(ctx.org, ctx.project, ctx.machine, ctx.generation);
      else this.closed(ctx);
      return new Response('done');
    }
    return super.fetch(request);
  }
}
