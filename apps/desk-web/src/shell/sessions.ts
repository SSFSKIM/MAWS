// DX8 — the session as the shell knows it: what the log says of it (alias, machine, working directory, in-charge
// line, membership) joined with what the session plane says now (presence, the machine's lease), and its sidebar
// group. The depth panel receives one as a prop; these hooks serve any view inside an open project. A session whose
// machine moved to MAWS (one of the cut-over machines this device's org state resolves, `cards/board.ts`) says so, and
// the capabilities then offer it nothing (the freeze's one seam, P5 O13 M6).
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { DeskCapabilities, SessionPresence } from 'desk-hub/protocol';
import { movedToMaws, useCardsBoard } from '../cards/board';
import { drawable } from '../log/project-log';
import { groupOf, groupSessions, namesakes, openQuestions, projectSessions, type Liveness, type OpenQuestion, type ProjectedSession, type SessionGroup } from '../log/projection';
import type { LiveState, ProjectConnection } from '../project/connection';
import { requestKey, type ConversationState } from '../project/conversation';

export type DeskSession = ProjectedSession & {
  project: string;
  group: SessionGroup;
  /** The latest DX4 presence; null until the hub sends one (or when the machine's lease lapsed). */
  presence: SessionPresence | null;
  /** The machine's lease as the hub reports it; null until it does. */
  machineOnline: boolean | null;
  /** The machine's owner set it read-only (its DX4 `machine` presence's policy): it runs nothing sent from outside it. */
  machineReadOnly?: boolean;
  /** What the machine's daemon can do itself (its DX4 `machine` presence's `desk`); null from an older daemon or hub. */
  machineDesk?: DeskCapabilities | null;
  /** Another session of the project goes by its name or its alias (`namesakes`): its label then carries its id. */
  namesake?: boolean;
  /** Its machine moved to MAWS: its cards are the phone's channel's, and nothing of it is done from here. */
  movedToMaws?: boolean;
};

/**
 * What the session plane says of a session now, with the async questions its log holds open (`asking`, by session):
 * one the plane settled (a bridge's ask is its call's request, and its settlement reaches this tab before or without
 * the log's `answered`) no longer waits on anyone, as the hub's count has it.
 */
export function livenessOf(live: LiveState, requests: ConversationState['requests'], asking: ReadonlyMap<string, OpenQuestion[]>, session: ProjectedSession): Liveness {
  const machine = live.machines[session.machine];
  const settled = (q: OpenQuestion) => requests[requestKey({ machine: q.machine, session: session.session, request: q.ask })]?.settled != null;
  return {
    presence: live.presence[session.session],
    machineOnline: machine?.online,
    pending: live.pending.filter((p) => p.verified && !p.terminal_only && p.raised.session === session.session).length,
    questions: (asking.get(session.session) ?? []).filter((q) => !settled(q)).length,
  };
}

function view(project: string, live: LiveState, session: ProjectedSession, liveness: Liveness, namesake: boolean, moved: readonly string[]): DeskSession {
  const machineOnline = liveness.machineOnline ?? null;
  const machineReadOnly = live.machines[session.machine]?.policy?.read_only === true;
  const machineDesk = live.machines[session.machine]?.desk ?? null;
  return { ...session, project, group: groupOf(session, liveness), presence: machineOnline === false ? null : (liveness.presence ?? null), machineOnline, machineReadOnly, machineDesk, namesake, movedToMaws: movedToMaws(session.machine, moved) };
}

/** Every session the project's log names, grouped for the sidebar (each group newest member first). */
export function useDeskSessions(connection: ProjectConnection): { sessions: Map<string, DeskSession>; groups: Record<SessionGroup, DeskSession[]> } {
  const logState = useStore(connection.log.store);
  const live = useStore(connection.live);
  const requests = useStore(connection.conversation.store, (s) => s.requests);
  const moved = useCardsBoard(useShallow((s) => s.machines.map((m) => m.name)));
  return useMemo(() => {
    const entries = drawable(logState);
    const projected = projectSessions(entries);
    const asking = openQuestions(entries);
    const liveOf = (s: ProjectedSession) => livenessOf(live, requests, asking, s);
    const groups = groupSessions(projected, liveOf);
    const shared = namesakes(projected.values());
    const sessions = new Map<string, DeskSession>();
    for (const s of projected.values()) sessions.set(s.session, view(connection.project, live, s, liveOf(s), shared.has(s.session), moved));
    const viewOf = (s: ProjectedSession) => sessions.get(s.session)!;
    return {
      sessions,
      groups: { waiting: groups.waiting.map(viewOf), working: groups.working.map(viewOf), idle: groups.idle.map(viewOf), ended: groups.ended.map(viewOf) },
    };
  }, [connection.project, logState, live, requests, moved]);
}

export function useDeskSession(connection: ProjectConnection, session: string): DeskSession | null {
  return useDeskSessions(connection).sessions.get(session) ?? null;
}
