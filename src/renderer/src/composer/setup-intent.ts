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
import type { AppSessionId } from '@shared/graph/ids';
import type { ListModelsResponse } from '@shared/wire/control';

// Where an unstarted session will run (C10's `LocationSchema`).
export type BranchChoice = { kind: 'new'; name: string; base: string } | { kind: 'existing'; name: string };
export type Location =
  | { kind: 'directory'; path: string }
  | { kind: 'newWorktree'; repoRoot: string; name: string; branch: BranchChoice }
  | { kind: 'existingWorktree'; repoRoot: string; path: string };

type ModelOption = ListModelsResponse['models'][number]; // C3's landed `session.listModels` entry
// A model the chip offers: C10 fills value, displayName, supportsAutoMode and supportsFastMode from `engine.models`; an
// absent supportedEffortLevels offers every effort level.
export type ModelInfo = Pick<ModelOption, 'value' | 'displayName'> & Partial<Pick<ModelOption, 'description' | 'supportedEffortLevels' | 'supportsAutoMode' | 'supportsFastMode'>>;

export interface FirstMessage {
  content: string | ContentBlock[];
  display: string;
}

export interface SetupIntent {
  location: Location;
  additionalDirectories: string[];
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode | null;
  message: FirstMessage | null; // C10's retained first message: from an accepted start until the session binds or C10 hands it back
  draft: Draft | null; // the composer's draft while unstarted (C4's drafts table has no row for an unstarted session)
}

export type SetupIntentPatch = Partial<Pick<SetupIntent, 'location' | 'additionalDirectories' | 'model' | 'effort' | 'permissionMode' | 'draft'>>;
export type HookResult = { ok: true } | { ok: false; error: string };

export interface SetupIntentHook {
  intent: SetupIntent;
  options: { locations: Location[]; branches: string[]; models: ModelInfo[]; autoModeNote: string | null };
  patch(p: SetupIntentPatch): Promise<HookResult>;
  start(first: FirstMessage): Promise<HookResult>; // ok for starting, needs_trust and relay_unreachable; not ok for invalid, missing_directory, refused
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
