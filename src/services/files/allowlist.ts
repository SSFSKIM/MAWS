// The allowlist of `files.*` (C8c execution document, Terms "Allowlist"; K1): for one session, the realpaths of its
// `directory`, each of its `additionalDirectories` and its `worktree.path`, read through the spine's view. The
// realpath is the native one (`fs.promises.realpath`), which canonicalises case on APFS as the JS implementation does
// not, so a record that spells the repository in another case still names the same root. A root that does not
// resolve is dropped, never replaced by the record's string: a session with no resolvable root reads nothing.
// 2026-11-06 (the home-root rule, src/shared/machine/machine-home.ts): for a remote caller (`HandlerContext.remote`, the
// endpoint's requests), a root whose realpath is the machine's home or an ancestor of it (`/`, `/Users`) is no root, since
// it would reach the whole home tree (a chat in the home has it as its directory); this machine's own clients read every
// root as before.
import fs from 'node:fs';
import { sep } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { coversHome } from '@shared/machine/machine-home';
import type { SpineView } from '@shared/spine/view';
import { workingFolder } from '@shared/sessions/working-folder';

export type AllowlistRecord = Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'> & Partial<Pick<SessionRecord, 'launchFolder' | 'agentFolder'>>;

// RED STUB (M3's cases first): the branch as M2 left it, where nothing admits a fact's folder.
export async function admittedFolder(record: AllowlistRecord, which: 'launch' | 'path'): Promise<{ folder: string; checked: boolean } | null> {
  const folder = workingFolder(record)[which];
  return folder === record.directory || folder === record.worktree?.path ? { folder, checked: false } : null;
}

// Whose directories `files.*` reads (E11's sitting: a New chat's Files pane answered "unknown app session" until the
// session started): a session's record once it has one; before its first send, its setup intent's location, which is
// where it will run: the chosen directory, an existing worktree, or for a worktree still to be made its repository
// until the setup makes it. A New chat with no project chosen yet has none. P5 O3-C (reader R12): both through the view.
export function allowlistOf(view: Pick<SpineView, 'record' | 'intent'>): (appSessionId: AppSessionId) => AllowlistRecord | null {
  return (appSessionId) => {
    const record = view.record(appSessionId);
    if (record !== null) return record;
    const intent = view.intent(appSessionId);
    const location = intent?.location ?? null;
    if (intent === null || intent === undefined || location === null) return null;
    const directory = location.kind === 'newWorktree' ? (intent.progress.worktree?.path ?? location.repoRoot) : location.path;
    return { directory, additionalDirectories: intent.additionalDirectories, worktree: null };
  };
}

// The roots in record order (directory, additional directories, worktree), deduplicated by realpath; for a remote caller
// (`remoteHomes`, the machine's homes' realpaths: machineHomes), less any that is a home or above one.
export async function rootsOf(record: AllowlistRecord, remoteHomes?: readonly string[]): Promise<string[]> {
  const declared = [record.directory, ...record.additionalDirectories, ...(record.worktree ? [record.worktree.path] : [])];
  const resolved = await Promise.all(declared.map((path) => fs.promises.realpath(path).catch(() => null)));
  const roots = [...new Set(resolved.filter((root): root is string => root !== null))];
  return remoteHomes === undefined ? roots : roots.filter((root) => !coversHome(root, remoteHomes));
}

// Whether a realpath lies under a root: equal to it, or inside it at a segment boundary (`/repo2` is not under `/repo`).
export function under(root: string, real: string): boolean {
  if (real === root) return true;
  return real.startsWith(root.endsWith(sep) ? root : root + sep);
}
