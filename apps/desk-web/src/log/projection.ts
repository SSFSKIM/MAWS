// The project's sessions as its log says them (smns §3's lifecycle kinds, `titled` among them), and the sidebar's
// grouping (§4). The log is read in offset order, which keeps each writer's seq order: a session's lifecycle is one
// writer's, so its latest `joined` / `retired` decides membership, and its latest `titled` its title. The in-charge and
// status lines can be set from two machines, and the later `ts` wins, as smns §3 has it. Presence (DX4) is live and not
// in the log: a session's group reads it while its machine is online, and the last `state` event while the machine is
// offline or its presence is not known yet. A session holding an open async question waits on you as one holding a
// pending request does (owner, 2026-10-18), though its presence says busy, while its process lives: a session whose
// presence says no process is stays under ended, its log question uncounted until it runs again.
import type { LogEvent, SessionPresence } from 'desk-hub/protocol';
import { questionEffect, writerMachine } from 'desk-hub/protocol';

export type SessionGroup = 'waiting' | 'working' | 'idle' | 'ended';
export const GROUPS: readonly SessionGroup[] = ['waiting', 'working', 'idle', 'ended'];

export type ProjectedSession = {
  session: string;
  alias: string;
  machine: string;
  cwd: string | null;
  worktree: string | null;
  /** The seat its latest `joined` names (a `--bg` job sminos spawned); `''` for a session it did not spawn. */
  seat: string;
  /**
   * Its title, as its human knows it (the harness's "Session name": the name `/rename` gave it, else the generated one),
   * from the latest `titled` its machine published; null for none, and the session is named by its alias.
   */
  title: string | null;
  /** Whether the latest membership event is `joined`. */
  member: boolean;
  /** The latest `retired`, while it stands. */
  ended: { by: string; reason: string } | null;
  charge: string | null;
  status: string | null;
  /** The last `state` the daemon published: the record for a machine that is offline. */
  state: { word: string; ts: string } | null;
  /** The offset of the membership's `joined`: the sidebar lists the newest member first. */
  joinedAt: number;
  /**
   * The `ts` of the membership's `joined`: the org view orders sessions of several projects by it, where an offset in
   * one project's log means nothing.
   */
  joinedTs: string;
};

/**
 * What the desk names a session by: its title, the name its human knows it by (the owner, 2026-10-17: "maws-4d
 * @macbook" did not say which session it was), else its alias. The alias stays how a session is addressed with @, so a
 * view that names a session by its title shows the alias beside it.
 */
export function sessionName(session: { title?: string | null; alias: string }): string {
  return session.title || session.alias;
}

/**
 * The sessions of a project that another of its sessions shares a name with — the name the desk shows (`sessionName`)
 * or the alias it is addressed by — which a view tells apart by their ids (the owner's desk, 2026-10-19: a seat and a
 * `--bg` copy that took its name both read acc-ask71 under Ended, and Resume went to the copy).
 */
export function namesakes(sessions: Iterable<{ session: string; title?: string | null; alias: string }>): Set<string> {
  const byName = new Map<string, Set<string>>();
  for (const s of sessions) {
    for (const name of [sessionName(s), s.alias]) {
      const ids = byName.get(name) ?? new Set<string>();
      byName.set(name, ids.add(s.session));
    }
  }
  return new Set([...byName.values()].filter((ids) => ids.size > 1).flatMap((ids) => [...ids]));
}

type Draft = ProjectedSession & { chargeTs: string; statusTs: string };

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function projectSessions(entries: ReadonlyArray<{ offset: number; event: LogEvent }>): Map<string, ProjectedSession> {
  const drafts = new Map<string, Draft>();
  for (const { offset, event } of entries) {
    const session = str(event.session);
    if (!session) continue;
    let s = drafts.get(session);
    const draft = (): Draft => {
      s ??= {
        session,
        alias: session.slice(0, 8),
        machine: writerMachine(event.writer) ?? '',
        cwd: null,
        worktree: null,
        seat: '',
        title: null,
        member: false,
        ended: null,
        charge: null,
        status: null,
        state: null,
        joinedAt: offset,
        joinedTs: event.ts,
        chargeTs: '',
        statusTs: '',
      };
      drafts.set(session, s);
      return s;
    };
    switch (event.kind) {
      case 'joined': {
        const d = draft();
        // A relocated `joined` (the engine moved the session within the project: EnterWorktree, a `/cd`) refreshes where
        // it works and starts no membership: its join time and place stay the membership's first `joined`'s.
        if (event.relocated === true && d.member) {
          d.cwd = str(event.cwd);
          d.worktree = str(event.worktree) || null;
          break;
        }
        d.alias = str(event.alias) ?? d.alias;
        d.machine = str(event.machine) ?? d.machine;
        d.cwd = str(event.cwd);
        d.worktree = str(event.worktree) || null;
        d.seat = str(event.seat) ?? '';
        d.member = true;
        d.ended = null;
        d.joinedAt = offset;
        d.joinedTs = event.ts;
        break;
      }
      case 'retired': {
        const d = draft();
        d.member = false;
        d.ended = { by: str(event.by) ?? '', reason: str(event.reason) ?? '' };
        break;
      }
      case 'renamed':
        draft().alias = str(event.alias) ?? draft().alias;
        break;
      case 'titled':
        draft().title = str(event.title)?.trim() || null;
        break;
      case 'in-charge': {
        const d = draft();
        if (event.ts >= d.chargeTs) {
          d.charge = str(event.text);
          d.chargeTs = event.ts;
        }
        break;
      }
      case 'status': {
        const d = draft();
        if (event.ts >= d.statusTs) {
          d.status = str(event.text) || null;
          d.statusTs = event.ts;
        }
        break;
      }
      case 'state': {
        const word = str(event.state);
        if (word) draft().state = { word, ts: event.ts };
        break;
      }
      default:
        break;
    }
  }
  const sessions = new Map<string, ProjectedSession>();
  for (const [id, d] of drafts) {
    const { session, alias, machine, cwd, worktree, seat, title, member, ended, charge, status, state, joinedAt, joinedTs } = d;
    sessions.set(id, { session, alias, machine, cwd, worktree, seat, title, member, ended, charge, status, state, joinedAt, joinedTs });
  }
  return sessions;
}

/** An async question the log holds open: the machine whose feed holds it, and its id (the log's `src`). */
export type OpenQuestion = { machine: string; ask: string };

/**
 * The async questions the log holds open, by session, read as the hub counts them for its waiting count (desk-hub
 * `questionEffect`, owner 2026-10-18): a session's `question` opens its ask, an `answered` from it with the same id
 * closes it, and its `retired` closes every ask it holds, since an ask dies with its process.
 */
export function openQuestions(entries: ReadonlyArray<{ event: LogEvent }>): Map<string, OpenQuestion[]> {
  const open = new Map<string, Map<string, OpenQuestion>>();
  for (const { event } of entries) {
    const effect = questionEffect(event);
    if (effect?.kind === 'retired') open.delete(effect.session);
    else if (effect?.kind === 'answered') open.get(effect.session)?.delete(effect.ask);
    else if (effect?.kind === 'question') {
      const asks = open.get(effect.session) ?? new Map<string, OpenQuestion>();
      if (!asks.has(effect.ask)) asks.set(effect.ask, { machine: effect.machine, ask: effect.ask });
      open.set(effect.session, asks);
    }
  }
  return new Map([...open].filter(([, asks]) => asks.size > 0).map(([session, asks]) => [session, [...asks.values()]]));
}

export type Liveness = {
  /** The session's latest DX4 presence, when one arrived. */
  presence?: SessionPresence;
  /** The machine's lease as the hub reports it; undefined until the hub says. */
  machineOnline?: boolean;
  /** Requests of the session still pending (verified), questions and permission prompts alike. */
  pending: number;
  /** Async questions of the session its log holds open (`openQuestions`) and the plane has not settled, as this tab
   * knows it; a bridge's ask is in `pending` too while it is raised. */
  questions: number;
};

/** sminos's state words (`STATES` in sminos.py): a live word, or one that says the session is not running. */
function fromState(word: string | undefined): SessionGroup {
  if (word === undefined || word === 'idle') return 'idle';
  if (word === 'waiting') return 'waiting';
  if (word === 'busy') return 'working';
  return 'ended'; // stopped, gone, vacant, retired
}

export function groupOf(session: ProjectedSession, live: Liveness): SessionGroup {
  if (!session.member) return 'ended';
  if (live.machineOnline === false || live.presence === undefined) return fromState(session.state?.word);
  if (live.pending > 0) return 'waiting';
  if (live.presence.record === null) return 'ended';
  // An open log question, while its session's process lives (a stopped seat never retires, so its ask stays open in the
  // log): its session works on, so its presence says busy, and that stays its state word. The hub counts it alike.
  if (live.questions > 0) return 'waiting';
  const status = live.presence.record.status;
  if (status === 'waiting') return 'waiting';
  if (status === 'idle') return 'idle';
  return 'working'; // busy, shell, or anything newer: sminos's `peer_state` reads them as busy
}

export function groupSessions(sessions: ReadonlyMap<string, ProjectedSession>, liveOf: (session: ProjectedSession) => Liveness): Record<SessionGroup, ProjectedSession[]> {
  const groups: Record<SessionGroup, ProjectedSession[]> = { waiting: [], working: [], idle: [], ended: [] };
  for (const session of sessions.values()) groups[groupOf(session, liveOf(session))].push(session);
  for (const group of GROUPS) groups[group].sort((a, b) => b.joinedAt - a.joinedAt);
  return groups;
}
