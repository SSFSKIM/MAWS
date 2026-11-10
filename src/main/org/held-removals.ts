// The held removals (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §I, "A held
// removal"; design §6, "Remove from sidebar"): a removal of a location on a machine that is off, kept by main in
// `<userData>/org/held-removals.json` (M10's decision: main's file, not the page's layout) until that machine can take it.
//
// - It holds the location as it was when asked: machine, `pid`, path and project, read from the registry then. While
//   held, the location is left out of this device's registry view and listed among its removals, with a way to cancel.
// - When the machine's link is next up (and it serves the project acts, `rl2.project-acts`), the removal goes as
//   `session.projects.remove` with `expect` naming that path and project, and the machine decides (§G): done drops it;
//   `changed` drops it and tells the person the location changed and was not removed; `unresolved`, or no answer from
//   the machine (unreachable, timed out, or main's own failure), keeps it, sent again at the next link-up or after
//   `retryMs`. Any other refusal drops it, the person told why.
// - A removal is the asking member's act: it is listed and sent only while that member of that org is signed in here.
//
// Electron-free: the registry (project-registry.ts) injects the registry's read, the links' state and the act's send.
import { randomUUID } from 'node:crypto';
import type { HeldRemoval } from '@shared/ipc/schema/org';
import type { CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { OrgFiles } from './files';
import type { OrgSession } from './session';

export const HELD_REMOVALS_FILE = 'held-removals.json';
/** A minute: how soon a removal the machine could not decide (`unresolved`) or did not answer is sent again. */
export const REMOVAL_RETRY_MS = 60_000;

type Entry = HeldRemoval & { org: string; member: string };
export type HeldRemovalsFile = { version: 1; removals: Entry[] };
export type RemovalAnswer = CommandResult<'session.projects.remove'>;
export type RemovalInput = { id: string; expect: { path: string; project: string } };

export interface HeldRemovalsDeps {
  session: OrgSession;
  files: OrgFiles;
  /** The location as the verified records hold it now; null when none names it. */
  locate(machine: MachineRef, pid: string): { path: string; project: string } | null;
  /** The machine's link is up and serves the project acts. */
  ready(machine: MachineRef): boolean;
  /** A machine's name for the person's words. */
  name(machine: MachineRef): string;
  send(machine: MachineRef, input: RemovalInput): Promise<RemovalAnswer>;
  /** Tells the person something they asked for did not happen. */
  notify(text: string): void;
  now?(): number;
  retryMs?: number;
  log(line: string): void;
}

export interface HeldRemovals {
  hold(input: { machine: MachineRef; pid: string }): Promise<void>;
  cancel(input: { id: string }): Promise<void>;
  /** The signed-in member's held removals, oldest first. */
  list(): HeldRemoval[];
  /** Whether a removal of this location is held for the signed-in member. */
  holds(machine: string, pid: string): boolean;
  /** The machine's link came up: its removals go. */
  linkUp(machine: MachineRef): void;
  onChanged(listener: () => void): () => void;
  loaded: Promise<void>;
  settled(): Promise<void>;
  close(): Promise<void>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const TEXT_FIELDS = ['id', 'project', 'machine', 'pid', 'path', 'askedAt', 'org', 'member'] as const;
const isEntry = (value: unknown): value is Entry => isObject(value) && TEXT_FIELDS.every((field) => typeof value[field] === 'string');
const isFile = (value: unknown): value is HeldRemovalsFile => isObject(value) && value.version === 1 && Array.isArray(value.removals);

/** What the machine's answer means for the removal: gone (done, or not to be sent again) or kept. */
function judged(answer: RemovalAnswer): { drop: false } | { drop: true; why: string | null } {
  if (answer.ok) return { drop: true, why: null };
  const { code, message, issues } = answer.error;
  if (code === 'invalid_input' && message.startsWith('changed:')) return { drop: true, why: 'it changed after you asked' };
  if (code === 'invalid_input' && message.startsWith('unresolved:')) return { drop: false };
  // nothing decided: the machine unreachable, its answer lost, or main's own failure before it went
  const refusal = isObject(issues) && typeof issues.refusal === 'string';
  if (code === 'host_unavailable' || code === 'timeout' || (code === 'internal' && !refusal)) return { drop: false };
  return { drop: true, why: message.replace(/\.$/, '') };
}

export function createHeldRemovals(deps: HeldRemovalsDeps): HeldRemovals {
  const now = () => deps.now?.() ?? Date.now();
  const retryMs = deps.retryMs ?? REMOVAL_RETRY_MS;
  const log = (line: string) => deps.log(`[org-removals] ${line}`);
  let entries: Entry[] = [];
  const sending = new Set<string>();
  const listeners = new Set<() => void>();
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let writing: Promise<void> = Promise.resolve();

  let queue: Promise<void> = (async () => {
    const raw = await deps.files.read(HELD_REMOVALS_FILE);
    if (raw === null) return;
    if (isFile(raw)) entries = raw.removals.filter(isEntry);
    else log(`${HELD_REMOVALS_FILE} is not a held removals file, treated as absent`);
  })().catch((error: unknown) => log(`${HELD_REMOVALS_FILE} did not read: ${(error as Error).message}`));

  function enqueue<T>(step: () => Promise<T> | T): Promise<T> {
    const run = queue.then(step);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const reader = (): { org: string; member: string } | null => {
    const current = deps.session.current();
    return current === null ? null : { org: current.identity.org, member: current.identity.member };
  };
  const mine = (entry: Entry, who = reader()): boolean => who !== null && entry.org === who.org && entry.member === who.member;

  function changed(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log(`a listener failed: ${(error as Error).message}`);
      }
    }
    const file: HeldRemovalsFile = { version: 1, removals: entries.map((e) => ({ ...e })) };
    writing = writing.then(async () => {
      try {
        const check = await deps.files.check();
        if (check === null || !check.ok) return void log(`${HELD_REMOVALS_FILE} not written: ${check === null ? `${deps.files.dir} does not exist` : check.detail}`);
        await deps.files.write(HELD_REMOVALS_FILE, file);
      } catch (error) {
        log(`${HELD_REMOVALS_FILE} not written: ${(error as Error).message}`);
      }
    });
  }

  function scheduleRetry(): void {
    if (closed || retry !== null) return;
    retry = setTimeout(() => {
      retry = null;
      for (const entry of entries) void deliver(entry);
    }, retryMs);
    (retry as { unref?: () => void }).unref?.();
  }

  /** Sends one removal if its member is signed in and its machine can take it; one send per removal at a time. */
  function deliver(entry: Entry): Promise<void> {
    const machine = entry.machine as MachineRef;
    if (closed || sending.has(entry.id) || !mine(entry) || !deps.ready(machine)) return Promise.resolve();
    sending.add(entry.id);
    const run = deps
      .send(machine, { id: entry.pid, expect: { path: entry.path, project: entry.project } })
      .catch((error: unknown): RemovalAnswer => ({ ok: false, error: { code: 'internal', message: (error as Error).message } }))
      .then((answer) =>
        enqueue(() => {
          sending.delete(entry.id);
          const verdict = judged(answer);
          if (!verdict.drop) {
            log(`the removal of ${entry.pid} on ${deps.name(machine)} stays held: ${answer.ok ? '' : answer.error.message}`);
            return scheduleRetry();
          }
          const before = entries.length;
          entries = entries.filter((e) => e.id !== entry.id);
          if (verdict.why !== null) deps.notify(`${entry.path} on ${deps.name(machine)} was not removed: ${verdict.why}.`);
          if (entries.length !== before) changed();
        }),
      );
    return run;
  }

  const loaded = enqueue(() => {});

  return {
    hold: ({ machine, pid }) =>
      enqueue(() => {
        const who = reader();
        if (who === null) throw new Error('signed out: no removal is held');
        if (entries.some((e) => mine(e, who) && e.machine === machine && e.pid === pid)) return;
        const at = deps.locate(machine, pid);
        if (at === null) throw new Error(`the location ${pid} on ${deps.name(machine)} is not in the registry`);
        const entry: Entry = { id: randomUUID(), project: at.project, machine, pid, path: at.path, askedAt: new Date(now()).toISOString(), ...who };
        entries = [...entries, entry];
        changed();
        void deliver(entry);
      }),
    cancel: ({ id }) =>
      enqueue(() => {
        const before = entries.length;
        entries = entries.filter((e) => !(e.id === id && mine(e)));
        if (entries.length !== before) changed();
      }),
    list: () => entries.filter((e) => mine(e)).map(({ id, project, machine, pid, path, askedAt }) => ({ id, project, machine: machine as MachineRef, pid, path, askedAt })),
    holds: (machine, pid) => entries.some((e) => mine(e) && e.machine === machine && e.pid === pid),
    linkUp(machine) {
      void enqueue(() => {
        for (const entry of entries) if (entry.machine === machine) void deliver(entry);
      });
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    loaded,
    async settled() {
      // a send's answer is entered in the queue when it comes: wait for both until neither moves
      for (;;) {
        await queue;
        if (sending.size === 0) return;
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      await queue;
      await writing;
    },
  };
}
