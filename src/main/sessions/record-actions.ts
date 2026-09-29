// What the session service does to a record (C10 execution document, Interfaces "Session service": `session.archive`,
// `session.delete`, `session.rename`, `session.revealPath`, and the intent a `session.fork` of it starts). The service
// runs each inside the record's serialised operation; the holder is always a fresh read (holders.ts), never
// `SessionRecord.holder`.
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { FirstMessage, ForkTarget, Location, SetupIntent } from '@shared/sessions/intent';
import type { ArchiveOutcome, DeleteOutcome } from '@shared/ipc/schema/session';
import { EffortSchema } from '@shared/engine/launch-spec';
import { resolveStorePaths, slugOf } from '../../engine-host/fs/paths';
import type { ProjectStore } from '../index/projects';
import { emptyProgress, hostCall, realOrSelf, reservationOf } from './context';
import { describeConversation, enumerateConversation, type DeletionManifests } from './delete-manifest';
import { canonicalPath, holderAuthority } from './holders';
import type { Setup } from './setup-steps';

export function recordOf(s: Setup, appSessionId: AppSessionId): SessionRecord {
  const record = s.sessions.get(appSessionId);
  if (record === null) throw new Error(`unknown app session: ${appSessionId}`);
  return record;
}

const authorityOf = (s: Setup, record: SessionRecord) => holderAuthority({ dispatch: s.dispatch, sessions: s.sessions }, { engineSessionId: record.engineSessionId, appSessionId: record.appId });

// `session.archive`: never a foreign holder's process; under `onlyIfIdle` (the cleanup dialog's step, whose snapshot
// may be stale) any live session is skipped, nothing stopped. The store file is kept (C3's archive deletes only the
// journal), so an unarchived session resumes with its queue and grants.
export async function archiveRecord(s: Setup, appSessionId: AppSessionId, opts: { onlyIfIdle?: boolean }): Promise<ArchiveOutcome> {
  const record = recordOf(s, appSessionId);
  const verdict = await authorityOf(s, record);
  if (verdict.live === 'foreign') return { status: 'held', holder: verdict.holder };
  if (opts.onlyIfIdle && verdict.live !== 'none') return { status: 'skipped_live', holder: verdict.holder };
  if ((await reservationOf(s.dispatch, appSessionId)) !== null) await hostCall(s.dispatch, 'session.stop', { appSessionId, reason: 'archive' });
  s.sessions.update(appSessionId, { archived: true });
  return { archived: true };
}

// `session.delete`: whole or not at all. Refused for a foreign holder, and for a MAWS-live session unless the caller
// asked to stop it, in which case only a confirmed exit continues; the files are enumerated and persisted before the
// first Trash move, the transcript last; then C3's store file and journal are forgotten and the record removed.
export async function deleteRecord(
  s: Setup,
  io: { manifests: DeletionManifests; trash: (path: string) => Promise<void> },
  appSessionId: AppSessionId,
  stopIfLive: boolean,
): Promise<DeleteOutcome> {
  const record = recordOf(s, appSessionId);
  let verdict = await authorityOf(s, record);
  if (verdict.live === 'foreign') return { status: 'held', holder: verdict.holder };
  if (verdict.live === 'self') {
    if (!stopIfLive) return { status: 'live' };
    if ((await reservationOf(s.dispatch, appSessionId)) !== null) {
      const stopped = await hostCall(s.dispatch, 'session.stop', { appSessionId, reason: 'archive' });
      if (!stopped.exited) return { status: 'stop_unconfirmed', detail: 'the session has not exited yet; try again in a moment' };
    }
    verdict = await authorityOf(s, record);
    if (verdict.live !== 'none') return { status: 'held', holder: verdict.holder };
  }

  const existing = await io.manifests.get(appSessionId);
  const paths = record.engineSessionId === null ? [] : await enumerateConversation(projectDirOf(s, record), record.engineSessionId);
  const manifest = { appSessionId, engineSessionId: record.engineSessionId, paths, trashed: existing?.trashed ?? [], createdAt: existing?.createdAt ?? s.now() };
  await io.manifests.put(manifest);
  const trashed: string[] = [];
  for (const path of paths) {
    try {
      await io.trash(path);
    } catch (error) {
      await io.manifests.put({ ...manifest, trashed: [...manifest.trashed, ...trashed] });
      return { status: 'partial', trashed, failed: { path, error: error instanceof Error ? error.message : String(error) } };
    }
    trashed.push(path);
  }
  await hostCall(s.dispatch, 'session.forget', { appSessionId }); // a failure keeps the manifest: a retry finishes
  s.sessions.remove(appSessionId);
  await io.manifests.remove(appSessionId);
  return { status: 'deleted', trashed };
}

// `session.deletions.preview`: what `session.delete` would move, for its sheet; nothing moves.
export async function previewDeletion(s: Setup, appSessionId: AppSessionId): Promise<{ transcript: string | null; subagents: number; recordings: number; paths: number }> {
  const record = recordOf(s, appSessionId);
  if (record.engineSessionId === null) return { transcript: null, subagents: 0, recordings: 0, paths: 0 };
  return describeConversation(projectDirOf(s, record), record.engineSessionId);
}

// The directory of the record's current transcript: its summary's path, else (a `/clear` rebind cleared it until the
// new transcript's first summary) the slug of the record's directory.
function projectDirOf(s: Setup, record: SessionRecord): string {
  const summary = s.sessions.summaryOf(record.appId);
  if (summary?.transcriptPath) return dirname(summary.transcriptPath);
  return join(resolveStorePaths(s.env).projects, slugOf(record.directory));
}

// `session.rename`: a ready process renames through the engine (its store carries the title and C4 reads it back);
// otherwise C4's override, which a later terminal `/rename` supersedes.
export async function renameRecord(s: Setup, appSessionId: AppSessionId, title: string): Promise<{ record: SessionRecord; via: 'engine' | 'override' }> {
  const record = recordOf(s, appSessionId);
  const text = title.trim();
  const live = await reservationOf(s.dispatch, appSessionId);
  if (live?.process === 'ready') {
    await hostCall(s.dispatch, 'session.renameSession', { appSessionId, title: text });
    return { record: s.sessions.get(appSessionId) ?? record, via: 'engine' };
  }
  return { record: s.sessions.update(appSessionId, { title: { text, source: 'user' } }), via: 'override' };
}

// `session.revealPath`: only a project directory, a session's directory or worktree, or a path under the store's
// `projects/`. Answers the canonical path to reveal.
export async function revealablePath(s: Setup, projects: Pick<ProjectStore, 'list'>, path: string): Promise<string> {
  const target = await canonicalPath(path);
  const within = (dir: string) => target === dir || target.startsWith(`${dir}/`);
  const allowed = [
    ...projects.list({ includeHidden: true }).map((p) => p.directory),
    ...s.sessions.list({ includeArchived: true }).flatMap((r) => [r.directory, ...(r.worktree ? [r.worktree.path] : [])]),
  ];
  const store = await realOrSelf(resolveStorePaths(s.env).projects);
  const ok = within(store) || (await Promise.all(allowed.map(canonicalPath))).some((dir) => target === dir);
  if (!ok) throw new Error(`not a project, session directory or store path: ${path}`);
  return target;
}

// The intent a fork starts: the source's conversation (its current engine id), its directories, model, effort, mode
// and route, in place or in a new worktree of its repository; `null` with the reason when the target cannot be one.
export async function forkIntentOf(
  s: Setup,
  source: SessionRecord,
  target: ForkTarget,
  args: { message: FirstMessage | null; rewindTo: MessageUuid | null },
): Promise<SetupIntent | { invalid: string }> {
  let location: Location;
  if (target.kind === 'inPlace') location = { kind: 'directory', path: source.directory };
  else {
    const listed = await s.worktrees.list(source.directory).catch(() => null);
    if (listed === null) return { invalid: `not a git repository: ${source.directory}` };
    location = { kind: 'newWorktree', repoRoot: listed.repoRoot, name: target.name, branch: target.branch };
  }
  const effort = EffortSchema.safeParse(source.effort);
  const routed = source.gateway.routed;
  const now = s.now();
  return {
    appSessionId: randomUUID() as AppSessionId,
    projectId: source.projectId,
    createdAt: now,
    updatedAt: now,
    kind: 'fork',
    source: { appSessionId: source.appId, engineSessionId: source.engineSessionId!, rewindTo: args.rewindTo },
    location,
    additionalDirectories: source.additionalDirectories,
    model: source.model.requested,
    effort: effort.success ? effort.data : null,
    permissionMode: source.permissionMode.requested,
    gateway: routed === true ? 'gateway' : routed === false ? 'direct' : s.settings().gateway.defaultRoute,
    trust: 'unanswered',
    trustKey: null,
    message: args.message,
    draft: null,
    progress: emptyProgress(),
  };
}
