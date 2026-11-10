// `maws` aimed at another machine, main's half (docs/doperpowers/plans/2026-11-10-project-registry.md, M12, Interfaces §K;
// Decision Logs 20 and 21). A terminal on this Mac types `maws project add mini:/srv/scrape`; this Mac's `mawsd` asks
// the attached app (`projects.act.request` on machine.sock, the hello's `machine.project-acts`), since only a member's
// device can sign an act for another machine. Main holds the request for the page's sheet (`org.projectActs`, its
// `.changed`), and on the person's Confirm (`org.projectActs.decide`) sends it as remote lane B's act over that
// machine's link (`send`), whose step-up is the Touch ID: this module adds no second path to a signature. Its result,
// or its refusal, is the terminal's answer (`projects.act.answer`), in the words `maws` prints on its own machine.
//
// A request the app cannot show is refused at once and never waits unseen: signed out (`signed-out`), or with no window
// open (`no-window`); one the person dismisses is `declined`. A remove or a link names the row by the registry's location
// at that path on that machine (its `pid`). A request whose terminal has gone is withdrawn by the daemon
// (`projects.act.withdrawn`) and taken off the page unacted; one already confirmed goes on, since its act may be under
// way. The daemon's connection ending drops every ask, which covers a daemon restart (Decision Log 22). The machine a
// request names is read on demand (`registry.machines`, which verifies the certificates it reads; branch review 1, P1);
// a request withdrawn or dropped while it is read is never shown. Idle, it holds its two event listeners and its two
// handlers and nothing else: no timer, and the machine link is watched only while an ask is held or being read.
import type { HostSupervisor } from '@shared/host/host-supervisor';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventPayload } from '@shared/ipc/schema';
import type { ProjectActAsk, ProjectActAsks } from '@shared/ipc/schema/org';
import type { ProjectForwardResult } from '@shared/ipc/schema/projects';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import { actRefusal, addWords, canonicalPath, hasParentSegment, linkWords, NO_WINDOW, notCanonical, NOT_CONFIRMED, notSignedIn, removeWords } from '@shared/machine/maws-words';
import type { MachineRef } from '@shared/machine/ref';
import type { MainHandler } from '../ipc/router';
import { appWindows } from '../windows';
import type { ProjectRegistry } from './project-registry';

type Request = EventPayload<'projects.act.request'>;

export interface ProjectActsDeps<L> {
  hosts: Pick<HostSupervisor, 'onEvent' | 'onState' | 'dispatch'>;
  registry: Pick<ProjectRegistry, 'projects' | 'machines'>;
  /** O7's RL2 roster: the machines this Mac reaches. */
  roster(): readonly MachineRef[];
  link(ref: MachineRef): L | null;
  /** Remote lane B's act over the link (`remoteLaneB.dispatch`), its step-up its own. */
  send(link: L, name: CommandName, input: unknown): Promise<CommandResult<CommandName>>;
  register<N extends 'org.projectActs' | 'org.projectActs.decide'>(name: N, handler: MainHandler<N>): void;
  emit(value: ProjectActAsks): void;
  log(line: string): void;
}

export function startProjectActs<L>(deps: ProjectActsDeps<L>): { stop(): void } {
  const asks = new Map<string, { ask: ProjectActAsk; request: Request }>();
  const value = (): ProjectActAsks => ({ asks: [...asks.values()].map((entry) => entry.ask) });
  const nameOf = (id: string) => deps.registry.projects().projects.find((p) => p.id === id)?.name ?? null;
  const reading = new Set<string>(); // the requests whose machine is being read, not yet asked or refused
  let unwatch: (() => void) | null = null; // the machine link's state, watched while an ask is held or being read

  /** The link is watched while an ask is held or being read. */
  function watch(): void {
    const held = asks.size > 0 || reading.size > 0;
    if (held && unwatch === null) unwatch = deps.hosts.onState('machine', (state) => state.state !== 'ready' && dropAll());
    if (!held && unwatch !== null) {
      unwatch();
      unwatch = null;
    }
  }
  /** The asks held now on the page. */
  function changed(): void {
    deps.emit(value());
    watch();
  }
  /** The daemon's connection ended: no terminal waits for any ask any more. */
  function dropAll(): void {
    reading.clear();
    asks.clear();
    changed();
  }
  /** Whether a request still waits once its machine is read: neither withdrawn nor dropped meanwhile. */
  function read(request: Request): boolean {
    const waits = reading.delete(request.id);
    watch();
    return waits;
  }

  const answer = (id: string, result: ProjectForwardResult) =>
    void deps.hosts.dispatch('machine', 'projects.act.answer', { id, result }).then(
      (sent) => !sent.ok && deps.log(`[project-acts] the answer to ${id} was refused: ${sent.error.code} ${sent.error.message}`),
      (error: unknown) => deps.log(`[project-acts] the answer to ${id} could not be sent: ${error instanceof Error ? error.message : String(error)}`),
    );

  function asked(request: Request): void {
    reading.add(request.id);
    watch();
    void deps.registry.machines().then(
      (machines) => read(request) && show(request, machines),
      (error: unknown) => read(request) && answer(request.id, { ok: false, code: 'internal', text: error instanceof Error ? error.message : String(error) }),
    );
  }

  function show(request: Request, machines: Awaited<ReturnType<ProjectActsDeps<L>['registry']['machines']>>): void {
    if (machines === null) return answer(request.id, { ok: false, code: 'signed-out', text: notSignedIn(request) });
    const windows = appWindows();
    if (windows.length === 0) return answer(request.id, { ok: false, code: 'no-window', text: NO_WINDOW });
    const machine = machines.find((m) => m.name === request.machine);
    if (machine === undefined) return answer(request.id, { ok: false, code: 'unknown-machine', text: `unknown-machine: ${request.machine} is no machine of this org` });
    if (hasParentSegment(request.path)) return answer(request.id, { ok: false, code: 'not-canonical', text: notCanonical(request.path) }); // that machine's to resolve
    const intoName = typeof request.into === 'string' ? nameOf(request.into) : null;
    const ask: ProjectActAsk = {
      id: request.id,
      verb: request.verb,
      machine: machine.ref,
      machineName: machine.name,
      path: canonicalPath(request.path), // as that machine's rows hold it, however the terminal spelled it
      ...(request.into !== undefined && { into: request.into }),
      ...(intoName !== null && { intoName }),
      ...(request.own === true && { own: true as const }),
      ...(request.name !== undefined && { name: request.name }),
      askedAt: new Date().toISOString(),
    };
    asks.set(request.id, { ask, request });
    changed();
    windows[0]!.focus(); // the person is at the terminal: the sheet comes to them
  }

  /** The act on the machine, its words or its refusal. */
  async function perform({ verb, machine, machineName, path }: ProjectActAsk, request: Request): Promise<ProjectForwardResult> {
    const link = deps.roster().includes(machine) ? deps.link(machine) : null;
    if (link === null) return { ok: false, code: 'host_unavailable', text: `host_unavailable: ${machineName} is not reachable from this Mac now` };
    const refused = (result: CommandResult<CommandName>) => (result.ok ? null : actRefusal(result.error));
    if (verb === 'add') {
      const added = await deps.send(link, 'session.projects.addFolder', { directory: path, ...(typeof request.into === 'string' && { into: request.into }), ...(request.own === true && { own: true }) });
      if (!added.ok) return refused(added)!;
      const value = added.value as { project: ProjectRecord; by?: string; at?: string | null; restated?: boolean };
      let project = value.project;
      if (request.name !== undefined) {
        const renamed = await deps.send(link, 'session.projects.update', { id: project.id, patch: { name: request.name } });
        if (!renamed.ok) return refused(renamed)!;
        project = renamed.value as ProjectRecord;
      }
      return { ok: true, text: addWords({ ...value, project }, { enrolled: true, nameOf, machine: machineName }) };
    }
    const pid = deps.registry.projects().projects.flatMap((p) => p.locations).find((l) => l.machine === machine && l.path === path)?.pid;
    if (pid === undefined) return { ok: false, code: 'not-declared', text: `not-declared: ${path} is not a project folder on ${machineName}` };
    if (verb === 'remove') {
      const removed = await deps.send(link, 'session.projects.remove', { id: pid });
      return removed.ok ? { ok: true, text: removeWords(path) } : refused(removed)!;
    }
    const into = request.into ?? null;
    const linked = await deps.send(link, 'session.projects.link', { id: pid, into });
    if (!linked.ok) return refused(linked)!;
    return { ok: true, text: linkWords(linked.value as { project: ProjectRecord; restated: boolean }, { into, nameOf, machine: machineName }) };
  }

  const offRequest = deps.hosts.onEvent('projects.act.request', asked);
  const offWithdrawn = deps.hosts.onEvent('projects.act.withdrawn', ({ id }) => {
    if (reading.delete(id)) watch();
    if (asks.delete(id)) changed();
  });
  deps.register('org.projectActs', value);
  deps.register('org.projectActs.decide', async ({ id, confirm }) => {
    const entry = asks.get(id);
    if (entry === undefined) throw new HostCommandError(ipcError('invalid_input', `no request ${id} from a terminal is waiting`));
    asks.delete(id);
    changed();
    if (!confirm) return answer(id, { ok: false, code: 'declined', text: NOT_CONFIRMED });
    let result: ProjectForwardResult;
    try {
      result = await perform(entry.ask, entry.request);
    } catch (error) {
      result = { ok: false, code: 'internal', text: error instanceof Error ? error.message : String(error) };
    }
    answer(id, result);
  });
  return {
    stop() {
      offRequest();
      offWithdrawn();
      unwatch?.();
      unwatch = null;
    },
  };
}
