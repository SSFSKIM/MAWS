// The hook C7's chips and submit control bind while a session is unstarted (C10 execution document, Interfaces "The
// unstarted session", useSetupIntent.ts; C7 document, "Ask of C10": the names and shapes are C7's). App.tsx registers it
// through C7's `registerSetupIntentHook` at module load, so this module's `SetupIntentHook` extends C7's landed type:
// the intent is C10's whole `SetupIntent` (C7 reads a subset) and `patch` takes C10's patch (C7 writes a subset).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ModelCatalogue, ModelCatalogueEntry } from '@shared/sessions/models';
import { autoModeNote, BUILTIN_MODELS } from '@shared/sessions/models';
import type { FirstMessage, Location, SetupIntent, SetupIntentPatch } from '@shared/sessions/intent';
import { defaultBranchName, type WorktreeInfo } from '@shared/sessions/worktree';
import type { ModelInfo, SetupIntentHook as ComposerSetupIntentHook } from '../composer/setup-intent';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { patchIntent, startIntent, type HookResult } from './setup-actions';
import { useSetup } from './store';

// C7's `ModelInfo`: the catalogue fills `value`, `displayName` and the two capability flags and leaves `description`
// and `supportedEffortLevels` absent (C7 then offers every effort level).
export type { ModelInfo };

export interface SetupIntentOptions {
  locations: Location[]; // the project directory; each listed worktree of its repository; one new-worktree template
  branches: string[]; // local branches, the current one first
  models: ModelInfo[];
  autoModeNote: string | null;
}

export interface SetupIntentHook extends ComposerSetupIntentHook {
  intent: SetupIntent;
  options: SetupIntentOptions;
  patch(p: SetupIntentPatch): Promise<HookResult>;
  start(first: FirstMessage): Promise<HookResult>;
}

// The directory whose repository the options describe: the project's, the new worktree's repository, or the
// existing worktree's.
export function baseDirectoryOf(location: Location): string {
  return location.kind === 'directory' ? location.path : location.kind === 'newWorktree' ? location.repoRoot : location.repoRoot;
}

// `<yyyy-mm-dd>-<4 base32>`, prefilled and not selected (the fork sheet's rule, reused by the location chip).
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function defaultWorktreeName(now: Date = new Date(), random: () => number = Math.random): string {
  const date = now.toISOString().slice(0, 10);
  const tail = Array.from({ length: 4 }, () => BASE32[Math.floor(random() * 32)]).join('');
  return `${date}-${tail}`;
}

export function newWorktreeTemplate(repoRoot: string, name: string): Location {
  return { kind: 'newWorktree', repoRoot, name, branch: { kind: 'new', name: defaultBranchName(name), base: 'HEAD' } };
}

// The location list the location chip offers, from what git reported about the repository (null outside one).
export function locationsOf(input: { projectDirectory: string; intent: SetupIntent; repoRoot: string | null; worktrees: WorktreeInfo[]; worktreeName: string }): Location[] {
  const directory: Location = { kind: 'directory', path: input.projectDirectory };
  if (input.repoRoot === null) return [directory];
  const repoRoot = input.repoRoot;
  const existing: Location[] = input.worktrees.filter((w) => !w.isMain && !w.prunable).map((w) => ({ kind: 'existingWorktree', repoRoot, path: w.path }));
  const template = input.intent.location.kind === 'newWorktree' ? input.intent.location : newWorktreeTemplate(repoRoot, input.worktreeName);
  return [directory, ...existing, template];
}

export function modelsOf(catalogue: ModelCatalogue): ModelInfo[] {
  return catalogue.models.map((entry) => {
    const info: ModelInfo = { value: entry.value, displayName: entry.displayName };
    if (entry.supportsAutoMode !== undefined) info.supportsAutoMode = entry.supportsAutoMode;
    if (entry.supportsFastMode !== undefined) info.supportsFastMode = entry.supportsFastMode;
    return info;
  });
}

// The note beside the mode and model chips for the model the launch would use (`default` when the intent leaves it
// to the engine).
export function noteFor(catalogue: ModelCatalogue, intent: Pick<SetupIntent, 'model' | 'permissionMode'>): string | null {
  const value = intent.model ?? 'default';
  const entry: ModelCatalogueEntry | null = catalogue.models.find((m) => m.value === value) ?? (intent.model === null ? null : { value: intent.model, displayName: intent.model });
  return autoModeNote(entry, intent.permissionMode);
}

// ---- options: read when the tab mounts and again when the location's repository changes ------------------------

interface RepositoryFacts {
  directory: string; // the base directory these facts answer
  repoRoot: string | null;
  worktrees: WorktreeInfo[];
  branches: string[];
  trustError: string | null; // a failed trust check disables Send with the error
}

const BUILTIN_FALLBACK: ModelCatalogue = { models: [...BUILTIN_MODELS], source: 'builtin', at: null };

async function readRepository(directory: string): Promise<RepositoryFacts> {
  const trust = await ipc.invoke('session.trust.check', { directory });
  if (!trust.ok) return { directory, repoRoot: null, worktrees: [], branches: [], trustError: trust.error.message };
  if (trust.value.keyKind !== 'repo') return { directory, repoRoot: null, worktrees: [], branches: [], trustError: null };
  const repoRoot = trust.value.trustKey; // a repository's trust key is its main worktree's root
  const [listed, branches] = await Promise.all([ipc.invoke('git.worktree.list', { repoRoot }), ipc.invoke('git.branches', { directory: repoRoot })]);
  const names = branches.ok ? [...branches.value.branches].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)).map((b) => b.name) : [];
  return { directory, repoRoot, worktrees: listed.ok ? listed.value.worktrees : [], branches: names, trustError: null };
}

// The catalogue at every mount: the host answers from its cache in memory, which a launch or a refresh updates (the
// relay's `claude/*` aliases arrive with the first routed launch), so each new tab sees what the host knows now. A
// failed read shows the built-in list the host itself answers before any launch.
async function readCatalogue(): Promise<ModelCatalogue> {
  const result = await ipc.invoke('engine.models', { refresh: false });
  if (result.ok) return result.value;
  console.warn('[sessions] engine.models unavailable', result.error);
  return BUILTIN_FALLBACK;
}

function useSetupOptions(
  appSessionId: AppSessionId,
  intent: SetupIntent | null,
): { options: SetupIntentOptions; trustError: string | null; recheck(): Promise<string | null> } {
  const projectDirectory = useSessions((s) => (intent?.projectId ? (s.projects.get(intent.projectId)?.directory ?? null) : null));
  const base = intent ? baseDirectoryOf(intent.location) : null;
  const [facts, setFacts] = useState<RepositoryFacts | null>(null);
  const [catalogue, setCatalogue] = useState<ModelCatalogue>(BUILTIN_FALLBACK);
  const [worktreeName] = useState(() => defaultWorktreeName());

  useEffect(() => {
    let live = true;
    void readCatalogue().then((c) => live && setCatalogue(c));
    return () => {
      live = false;
    };
  }, []);

  // The repository is read again only when the base directory moves to another repository or out of one; a move
  // between two locations of one repository keeps what was read.
  const known = facts !== null && base !== null && (facts.directory === base || (facts.repoRoot !== null && (base === facts.repoRoot || facts.worktrees.some((w) => w.path === base))));
  useEffect(() => {
    if (base === null || known) return;
    let live = true;
    void readRepository(base).then((f) => live && setFacts(f));
    return () => {
      live = false;
    };
  }, [appSessionId, base, known]);

  const options = useMemo((): SetupIntentOptions => {
    if (intent === null) return { locations: [], branches: [], models: [], autoModeNote: null };
    return {
      locations: locationsOf({ projectDirectory: projectDirectory ?? facts?.repoRoot ?? baseDirectoryOf(intent.location), intent, repoRoot: facts?.repoRoot ?? null, worktrees: facts?.worktrees ?? [], worktreeName }),
      branches: facts?.branches ?? [],
      models: modelsOf(catalogue),
      autoModeNote: noteFor(catalogue, intent),
    };
  }, [intent, projectDirectory, facts, catalogue, worktreeName]);
  // A failed trust check is read again at Send (the directory may be readable now): the refusal stands only while the
  // check still fails.
  const recheck = useCallback(async () => {
    if (base === null) return null;
    const read = await readRepository(base);
    setFacts(read);
    return read.trustError;
  }, [base]);
  return { options, trustError: facts?.trustError ?? null, recheck };
}

// Non-null exactly while the session is unstarted: an intent, and no record with an engine status (C7's definition).
export function useSetupIntent(appSessionId: AppSessionId): SetupIntentHook | null {
  const intent = useSetup((s) => s.intents.get(appSessionId) ?? null);
  const started = useSessions((s) => s.records.has(appSessionId) && s.engine.has(appSessionId));
  const { options, trustError, recheck } = useSetupOptions(appSessionId, intent);
  return useMemo(() => {
    if (intent === null || started) return null;
    return {
      intent,
      options,
      patch: (p) => patchIntent(appSessionId, p),
      start: async (first) => {
        const error = trustError === null ? null : await recheck();
        return error !== null ? { ok: false, error } : startIntent(appSessionId, first);
      },
    };
  }, [appSessionId, intent, started, options, trustError, recheck]);
}
