// The unstarted session's seam (C7 execution document, "Unstarted sessions and the docked host", and the Decision Log
// "execution start 2026-09-29" item 4): C10's `useSetupIntent` reaches the composer through a registration, because
// C7 cannot import a child that has not landed. The types are the Ask of C10's shape in C7's names, which C10's own
// document adopts (`SetupIntent` there carries more fields; C7 reads these). C10 registers its hook once at module load
// (its App.tsx block), before any composer renders, so the registered function is called as a hook under React's rules;
// until then every session is live or exited (`() => null`).
import type { Draft } from '@shared/ipc/schema/session';
import type { Effort } from '@shared/engine/launch-spec';
import type { ContentBlock } from '@shared/graph/events';
import type { PermissionMode } from '@shared/graph/enums';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { ListModelsResponse } from '@shared/wire/control';

// Where an unstarted session will run (C10's `LocationSchema`).
export type BranchChoice = { kind: 'new'; name: string; base: string } | { kind: 'existing'; name: string };
export type Location =
  | { kind: 'directory'; path: string }
  | { kind: 'newWorktree'; repoRoot: string; name: string; branch: BranchChoice }
  | { kind: 'existingWorktree'; repoRoot: string; path: string };

type ModelOption = ListModelsResponse['models'][number]; // C3's landed `session.listModels` entry
// A model the chip offers: C10 fills value, displayName, supportsAutoMode, supportsFastMode and supportedEffortLevels
// from `engine.models` (each as the catalogue entry carries it); W3 adds the resolved model (what `default` runs, and
// how a live session's resolved id finds its alias), the description and `supportsEffort`.
export type ModelInfo = Pick<ModelOption, 'value' | 'displayName'> &
  Partial<Pick<ModelOption, 'resolvedModel' | 'description' | 'supportsEffort' | 'supportedEffortLevels' | 'supportsAutoMode' | 'supportsFastMode'>>;

export interface FirstMessage {
  content: string | ContentBlock[];
  display: string;
}

export interface SetupIntent {
  location: Location | null; // New chat: null while no project is chosen; Send waits for one
  additionalDirectories: string[];
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode | null;
  message: FirstMessage | null; // C10's retained first message: from an accepted start until the session binds or C10 hands it back
  draft: Draft | null; // the composer's draft while unstarted (C4's drafts table has no row for an unstarted session)
}

export type SetupIntentPatch = Partial<Pick<SetupIntent, 'additionalDirectories' | 'model' | 'effort' | 'permissionMode' | 'draft'>> & { location?: Location };
export type HookResult = { ok: true } | { ok: false; error: string };

export interface SetupIntentHook {
  intent: SetupIntent;
  options: { models: ModelInfo[]; autoModeNote: string | null };
  // C10: the running setup's phase in words ("Creating worktree <name>…", "Trusting <key>…", "Starting…"), the submit
  // control's disabled-state reason while it runs; null (or absent) otherwise.
  phase?: string | null;
  patch(p: SetupIntentPatch): Promise<HookResult>;
  start(first: FirstMessage): Promise<HookResult>; // ok for starting, needs_trust and relay_unreachable; not ok for invalid, missing_directory, refused
  // New chat: the project row's facts and writes (C10's); a hook without them, the harness's stub, keeps the toolbar's
  // location chip on the intent's location
  project?: SetupProject;
}

// New chat (2026-10-01, the owner's ruling after Codex's new-thread composer): what the row above the box shows of an
// unstarted session and what it can change: the project chip, the branch beside it, and the Worktree checkbox.
export interface SetupProject {
  projectId: ProjectId | null;
  label: string | null; // the chip's words: the project's name, an existing worktree's folder, "No project"; null until one is chosen
  path: string | null; // where the session would run, the chip's tooltip
  branch: string | null; // the checkout's current branch, read-only beside the chip
  worktree: boolean | null; // the Worktree checkbox; null hides it (no project, no git repository, or an existing worktree chosen)
  choose(projectId: ProjectId | null): Promise<HookResult>; // null: "Don't work in a project" (the home directory)
  newProject(): Promise<HookResult>; // the native folder dialog; the folder becomes a project and is chosen
  setWorktree(on: boolean): Promise<HookResult>; // on: the first send creates a new worktree with a generated name
}

export type UseSetupIntent = (appSessionId: AppSessionId) => SetupIntentHook | null;

const NONE: UseSetupIntent = () => null;
let registered: UseSetupIntent = NONE;

// C10 (and the harness's stub) register the hook once, before any composer renders; the disposer restores the default.
export function registerSetupIntentHook(hook: UseSetupIntent): () => void {
  registered = hook;
  return () => {
    if (registered === hook) registered = NONE;
  };
}

// Called as a hook from the composer: the registered function is fixed for the page's life.
export function useSetupIntent(appSessionId: AppSessionId): SetupIntentHook | null {
  return registered(appSessionId);
}

// The directory a location runs in, for the chip's label and the history row's project.
export function locationPath(location: Location): string {
  switch (location.kind) {
    case 'directory':
      return location.path;
    case 'existingWorktree':
      return location.path;
    case 'newWorktree':
      return `${location.repoRoot}/.claude/worktrees/${location.name}`;
  }
}
