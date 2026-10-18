// P3-H H3b: route E's eligible sessions for an artifact (docs/doperpowers/plans/2026-10-12-p3-co-work.md, Decision Log
// 24, 83 and 85; X16). Pure: main gathers the facts (the host's artifact row and links, its Space, main's index record of
// the own session and the indexed project, the engine host's live sessions) and this decides.
//
// - The own session is the artifact's creating session, or for an import its `created` link.
// - The directories a session must run in, canonical (realpath), compared exactly:
//   the own session's durable context — its index record's directory — while that record exists and is still filed in
//   the artifact's project (a creator now in another project is no context); the artifact's Space's linked directory;
//   and, when no own context stands, the indexed directory of the project the artifact row itself names. Nothing else:
//   no project root inferred from a path, no other worktree of the project (local MCP configuration differs by
//   directory), so with none of these the artifact has no route (paused: noRoute) until the owner links a Space.
// - A session is eligible while its process is ready and its current cwd is one of those directories; the own session
//   first (a creator moved elsewhere loses access by the same rule), then the most recently used. Archive is no gate.
// Every eligible session still needs the server connected in its mcp_status, which the host reads.
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactSessionLink } from '@shared/artifacts/entity';
import type { EngineSessionStatus } from '@shared/engine/status';

// An engine host session as `engine.sessions` reports it, the fields read here.
export interface LiveSession {
  appSessionId: string;
  launchId: string;
  cwd: string;
  process: EngineSessionStatus['process'];
  lastUsedAt: string;
}

// P3-HD M2c: the facts the directory decision reads, shared by route E (here) and route D (./direct-route.ts).
export interface DirectoryFacts {
  artifact: { createdBy: Actor; projectId?: string };
  links: readonly { appSessionId: string; role: ArtifactSessionLink['role'] }[];
  space: { linkedDir?: string } | null; // the artifact's Space, when it is in one
  creator: { projectId: string | null; directory: string } | null; // main's index record of the own session, when there is one
  project: { directory: string } | null; // the indexed project the artifact row names, hidden ones included
  realpath(path: string): string | null; // null: the path does not exist
}

export interface EligibilityFacts extends DirectoryFacts {
  live: readonly LiveSession[]; // the engine host's sessions
}

// The session `cwd` main found eligible, with its launch: the host refuses another launch or a moved cwd at the call.
export interface EligibleSession {
  appSessionId: string;
  launchId: string;
  cwd: string;
  own: boolean;
}

export function ownSessionOf(artifact: { createdBy: Actor }, links: EligibilityFacts['links']): string | null {
  if (artifact.createdBy.kind === 'session') return artifact.createdBy.appSessionId;
  return links.find((link) => link.role === 'created')?.appSessionId ?? null;
}

// P3-HD M2c: the canonical directories an artifact's connector calls may run in, the decision route E's eligibility and
// route D share. `hasContext`: a valid own-session context stands (E prefers its session first), even when its directory
// has since vanished (the project fallback is then not taken: a context decides, as for E).
export function artifactDirectories(facts: DirectoryFacts): { directories: ReadonlySet<string>; hasContext: boolean } {
  const own = ownSessionOf(facts.artifact, facts.links);
  const context = own !== null && facts.creator !== null && (facts.artifact.projectId === undefined || facts.creator.projectId === facts.artifact.projectId) ? facts.creator.directory : null;
  const named = [context, facts.space?.linkedDir ?? null, context === null && facts.artifact.projectId !== undefined ? (facts.project?.directory ?? null) : null];
  const directories = new Set(named.flatMap((path) => (path === null ? [] : [facts.realpath(path)])).filter((path): path is string => path !== null));
  return { directories, hasContext: context !== null };
}

export function eligibleSessions(facts: EligibilityFacts): EligibleSession[] {
  const own = ownSessionOf(facts.artifact, facts.links);
  const { directories, hasContext } = artifactDirectories(facts);
  if (directories.size === 0) return [];
  const eligible = facts.live.filter((session) => {
    if (session.process !== 'ready') return false;
    const cwd = facts.realpath(session.cwd);
    return cwd !== null && directories.has(cwd);
  });
  const isOwn = (session: LiveSession) => hasContext && session.appSessionId === own;
  return eligible
    .sort((a, b) => Number(isOwn(b)) - Number(isOwn(a)) || b.lastUsedAt.localeCompare(a.lastUsedAt))
    .map((session) => ({ appSessionId: session.appSessionId, launchId: session.launchId, cwd: session.cwd, own: isOwn(session) }));
}
