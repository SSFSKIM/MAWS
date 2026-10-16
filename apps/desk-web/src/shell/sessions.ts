// DX8 — the session as the shell knows it: what the log says of it (alias, machine, working directory, in-charge
// line, membership) joined with what the session plane says now (presence, the machine's lease), and its sidebar
// group. The depth panel receives one as a prop; these hooks serve any view inside an open project.
import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { SessionPresence } from 'desk-hub/protocol';
import { drawable } from '../log/project-log';
import { groupOf, groupSessions, projectSessions, type Liveness, type ProjectedSession, type SessionGroup } from '../log/projection';
import type { LiveState, ProjectConnection } from '../project/connection';

export type DeskSession = ProjectedSession & {
  project: string;
  group: SessionGroup;
  /** The latest DX4 presence; null until the hub sends one (or when the machine's lease lapsed). */
  presence: SessionPresence | null;
  /** The machine's lease as the hub reports it; null until it does. */
  machineOnline: boolean | null;
};

function livenessOf(live: LiveState, session: ProjectedSession): Liveness {
  const machine = live.machines[session.machine];
  return {
    presence: live.presence[session.session],
    machineOnline: machine?.online,
    pending: live.pending.filter((p) => p.verified && !p.terminal_only && p.raised.session === session.session).length,
  };
}

function view(project: string, live: LiveState, session: ProjectedSession): DeskSession {
  const liveness = livenessOf(live, session);
  const machineOnline = liveness.machineOnline ?? null;
  return { ...session, project, group: groupOf(session, liveness), presence: machineOnline === false ? null : (liveness.presence ?? null), machineOnline };
}

/** Every session the project's log names, grouped for the sidebar (each group newest member first). */
export function useDeskSessions(connection: ProjectConnection): { sessions: Map<string, DeskSession>; groups: Record<SessionGroup, DeskSession[]> } {
  const logState = useStore(connection.log.store);
  const live = useStore(connection.live);
  return useMemo(() => {
    const projected = projectSessions(drawable(logState));
    const groups = groupSessions(projected, (s) => livenessOf(live, s));
    const sessions = new Map<string, DeskSession>();
    for (const s of projected.values()) sessions.set(s.session, view(connection.project, live, s));
    const viewOf = (s: ProjectedSession) => sessions.get(s.session)!;
    return {
      sessions,
      groups: { waiting: groups.waiting.map(viewOf), working: groups.working.map(viewOf), idle: groups.idle.map(viewOf), ended: groups.ended.map(viewOf) },
    };
  }, [connection.project, logState, live]);
}

export function useDeskSession(connection: ProjectConnection, session: string): DeskSession | null {
  return useDeskSessions(connection).sessions.get(session) ?? null;
}
