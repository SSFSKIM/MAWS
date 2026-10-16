// P3-H H4: the session an owner's gesture on an artifact starts or resumes (docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H and Decision Log 24, 83 and 85; reused by Send to, Decision Log 87). The connector sheet's Start uses it today;
// it is the one place that reads an artifact's durable session context in the window.
//
// The context, in order (main's route E eligibility, src/main/connectors/eligibility.ts, reads the same facts):
// - the artifact's own session (its creating session, or for an import its `created` link; a session that only viewed
//   or edited it is no context) while the window's index knows it in the artifact's project: resumed;
// - else the artifact's Space's linked directory, else the directory of the project the artifact itself names: a new
//   session there;
// - else none: the owner links a Space first. A root is never guessed from a path.
//
// The gesture (an owner's click only, never a mount, a timer or a page): a resume is `session.acquire` for a read; a new
// session is created with the directory and started with no message and no option, and a repeated Start reuses the
// session the earlier one created (started again while it is still an intent, resumed once it is a record). A trust or
// relay card the attempt meets docks in that session's composer, unanswered: nothing here accepts trust or sends a
// message, so no model turn runs.
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { StartOutcome } from '@shared/sessions/setup';
import { startRefusal } from '../gateway/session-start';
import { ipc } from '../ipc/client';
import { acquireSession, acquisitionWords, cardWords, dockFor } from '../sessions/acquire';
import { createUnstartedSession } from '../sessions/connect';
import { useSetup } from '../sessions/store';
import { useSessions } from '../stores/sessions';

export type ArtifactSessionContext =
  | { kind: 'session'; appSessionId: AppSessionId }
  | { kind: 'directory'; path: string; projectId: ProjectId | null }
  | { kind: 'none' };

export interface ArtifactContextFacts {
  records: ReadonlyMap<AppSessionId, { projectId: ProjectId | null }>; // the window's index records
  spaces: readonly { id: string; linkedDir?: string }[];
  projects: ReadonlyMap<ProjectId, { directory: string }>; // hidden ones included
}

export interface ArtifactContextOf {
  createdBy: Actor;
  projectId?: ProjectId;
  spaceId?: string;
  sessions: readonly { appSessionId: AppSessionId; roles: readonly string[] }[];
}

export function artifactSessionContext(artifact: ArtifactContextOf, facts: ArtifactContextFacts): ArtifactSessionContext {
  const own = artifact.createdBy.kind === 'session' ? artifact.createdBy.appSessionId : (artifact.sessions.find((session) => session.roles.includes('created'))?.appSessionId ?? null);
  const record = own === null ? undefined : facts.records.get(own);
  if (own !== null && record !== undefined && (artifact.projectId === undefined || record.projectId === artifact.projectId)) return { kind: 'session', appSessionId: own };
  const linked = artifact.spaceId === undefined ? undefined : facts.spaces.find((space) => space.id === artifact.spaceId)?.linkedDir;
  if (linked !== undefined) {
    const project = [...facts.projects].find(([, { directory }]) => directory === linked)?.[0] ?? null;
    return { kind: 'directory', path: linked, projectId: project };
  }
  const named = artifact.projectId === undefined ? undefined : facts.projects.get(artifact.projectId);
  if (artifact.projectId !== undefined && named !== undefined) return { kind: 'directory', path: named.directory, projectId: artifact.projectId };
  return { kind: 'none' };
}

export type ArtifactSessionStart =
  | { status: 'ready' | 'starting'; appSessionId: AppSessionId } // live now, or its setup running
  | { status: 'card'; appSessionId: AppSessionId; words: string } // a trust or relay card docked in its composer
  | { status: 'refused'; appSessionId: AppSessionId | null; words: string };

export const NO_SESSION_CONTEXT = 'Put this artifact in a Space linked to a folder to start a session for it';
const COULD_NOT_CREATE = 'Couldn’t create a session';

async function resume(appSessionId: AppSessionId, client: MawsBridge): Promise<ArtifactSessionStart> {
  let outcome;
  try {
    outcome = await acquireSession(appSessionId, 'read', {}, client); // docks a card it meets
  } catch (error) {
    return { status: 'refused', appSessionId, words: error instanceof Error ? error.message : String(error) };
  }
  if (outcome.status === 'ready') return { status: 'ready', appSessionId };
  if (outcome.status === 'needs_trust' || outcome.status === 'relay_unreachable') return { status: 'card', appSessionId, words: cardWords(outcome) };
  return { status: 'refused', appSessionId, words: acquisitionWords(outcome) ?? outcome.status };
}

async function start(appSessionId: AppSessionId, client: MawsBridge): Promise<ArtifactSessionStart> {
  const result = await client.invoke('session.start', { appSessionId, message: null, options: {} });
  if (!result.ok) return { status: 'refused', appSessionId, words: result.error.message };
  const outcome: StartOutcome = result.value;
  dockFor(appSessionId, outcome, null);
  if (outcome.status === 'starting') return { status: 'starting', appSessionId };
  if (outcome.status === 'already_live') return { status: 'ready', appSessionId };
  if (outcome.status === 'needs_trust' || outcome.status === 'relay_unreachable') return { status: 'card', appSessionId, words: cardWords(outcome) };
  return { status: 'refused', appSessionId, words: startRefusal(outcome) ?? outcome.status };
}

// `previous`: the session an earlier Start of this surface created, if any.
export async function startArtifactSession(context: ArtifactSessionContext, previous: AppSessionId | null, client: MawsBridge = ipc): Promise<ArtifactSessionStart> {
  if (context.kind === 'none') return { status: 'refused', appSessionId: null, words: NO_SESSION_CONTEXT };
  if (context.kind === 'session') return resume(context.appSessionId, client);
  if (previous !== null) {
    if (useSessions.getState().records.has(previous)) return resume(previous, client);
    if (useSetup.getState().intents.has(previous)) return start(previous, client);
  }
  const created = await createUnstartedSession(context.projectId, client, { kind: 'directory', path: context.path });
  if (created === null) return { status: 'refused', appSessionId: null, words: COULD_NOT_CREATE };
  return start(created, client);
}
