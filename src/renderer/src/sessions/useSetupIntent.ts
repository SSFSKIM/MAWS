// The hook C7's chips and submit control bind while a session is unstarted (C10 execution document, Interfaces "The
// unstarted session", useSetupIntent.ts; C7 document, "Ask of C10": the names and shapes are C7's). App.tsx registers it
// through C7's `registerSetupIntentHook` at module load, so this module's `SetupIntentHook` extends C7's landed type:
// the intent is C10's whole `SetupIntent` (C7 reads a subset) and `patch` takes C10's patch (C7 writes a subset).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PermissionMode } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import type { ModelCatalogue, ModelCatalogueEntry } from '@shared/sessions/models';
import { autoModeNote, BUILTIN_MODELS } from '@shared/sessions/models';
import type { FirstMessage, Location, SetupIntent, SetupIntentPatch } from '@shared/sessions/intent';
import type { SetupEvent } from '@shared/sessions/setup';
import { defaultBranchName, type WorktreeInfo } from '@shared/sessions/worktree';
import type { ModelInfo, SetupIntentHook as ComposerSetupIntentHook, SetupProject } from '../composer/setup-intent';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings'; // W3
import { patchIntent, startIntent, type HookResult } from './setup-actions';
import { useSetup } from './store';

// C7's `ModelInfo`: the catalogue fills `value`, `displayName`, the two capability flags and `supportedEffortLevels`
// when the entry lists them, and leaves `description` absent (an entry without levels offers every effort level).
export type { ModelInfo };

export interface SetupIntentOptions {
  models: ModelInfo[];
  autoModeNote: string | null;
}

export interface SetupIntentHook extends ComposerSetupIntentHook {
  intent: SetupIntent;
  options: SetupIntentOptions;
  phase: string | null; // the running setup's phase in words: C7's submit control shows it as its disabled-state reason
  patch(p: SetupIntentPatch): Promise<HookResult>;
  start(first: FirstMessage): Promise<HookResult>;
  project: SetupProject; // New chat: the project row above the box
}

// The directory whose repository the options describe: the project's, the new worktree's repository, or the
// existing worktree's.
export function baseDirectoryOf(location: Location): string {
  return location.kind === 'directory' ? location.path : location.kind === 'newWorktree' ? location.repoRoot : location.repoRoot;
}

// The directory whose settings a launch at `location` reads (debt wave 5): the directory or the existing worktree itself;
// a worktree not yet made will be a checkout of its repository, whose root stands in for it.
export function settingsDirectoryOf(location: Location): string {
  return location.kind === 'newWorktree' ? location.repoRoot : location.path;
}

// `<yyyy-mm-dd>-<4 base32>`, prefilled and not selected (the fork sheet's rule, reused by the location chip).
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function defaultWorktreeName(now: Date = new Date(), random: () => number = Math.random): string {
  const date = now.toISOString().slice(0, 10);
  const tail = Array.from({ length: 4 }, () => BASE32[Math.floor(random() * 32)]).join('');
  return `${date}-${tail}`;
}

// New chat (2026-10-01): the Worktree checkbox's new worktree, named `<project>-<4 hex>`: Codex's short id
// (`crypto.randomUUID().slice(0, 4)`, readable/chatgpt-26.928.40906/main-process/worker.js:110755-110757) after the
// project, folded to Codex's name characters (lowercase letters, digits, single hyphens, worker.js:110737-110743). Its
// branch is the engine's `worktree-<name>` convention, started from HEAD; the agent can rename it later.
export function worktreeNameFor(project: string, id: () => string = () => crypto.randomUUID()): string {
  const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'worktree';
  return `${slug}-${id().slice(0, 4)}`;
}

export function newWorktreeLocation(repoRoot: string, name: string): Location {
  return { kind: 'newWorktree', repoRoot, name, branch: { kind: 'new', name: defaultBranchName(name), base: 'HEAD' } };
}

// The checkout a directory lies in (the deepest listed worktree holding it), for the branch beside the chip.
function checkoutOf(worktrees: readonly WorktreeInfo[], path: string): WorktreeInfo | null {
  const holding = worktrees.filter((w) => path === w.path || path.startsWith(`${w.path}/`));
  return holding.sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

const NO_PROJECT_LABEL = 'No project';

// What the project row shows of an intent, from the project the index knows and what git reported about the location's
// repository (null while it is read): the chip's words and tooltip path, the read-only branch, and the Worktree
// checkbox (offered for a project in a git repository; hidden with no project, outside git, or on an existing worktree).
export function projectFacts(
  intent: Pick<SetupIntent, 'projectId' | 'location'>,
  project: { name: string; directory: string } | null,
  repository: { repoRoot: string | null; worktrees: readonly WorktreeInfo[] } | null,
): Pick<SetupProject, 'projectId' | 'label' | 'path' | 'branch' | 'worktree'> {
  const location = intent.location;
  if (location === null) return { projectId: null, label: null, path: null, branch: null, worktree: null };
  const worktrees = repository?.worktrees ?? [];
  const base = baseDirectoryOf(location);
  switch (location.kind) {
    case 'existingWorktree':
      return { projectId: intent.projectId, label: basename(location.path), path: location.path, branch: checkoutOf(worktrees, location.path)?.branch ?? null, worktree: null };
    case 'newWorktree':
      return { projectId: intent.projectId, label: project?.name ?? basename(base), path: base, branch: checkoutOf(worktrees, base)?.branch ?? null, worktree: intent.projectId === null ? null : true };
    case 'directory': {
      const label = intent.projectId === null ? NO_PROJECT_LABEL : (project?.name ?? basename(base));
      const git = intent.projectId !== null && (repository?.repoRoot ?? null) !== null;
      return { projectId: intent.projectId, label, path: base, branch: checkoutOf(worktrees, base)?.branch ?? null, worktree: git ? false : null };
    }
  }
}

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// The project an unstarted session will run in, by name (New chat, 2026-10-01): its project's, else (a project the index
// no longer lists) its directory's; null while no project is chosen and for a chat that works in no project. The tab,
// the toolbar title and the heading name it.
export function intentProjectName(intent: Pick<SetupIntent, 'projectId' | 'location'>, project: { name: string } | null | undefined): string | null {
  if (intent.projectId === null || intent.location === null) return null;
  return project?.name ?? basename(baseDirectoryOf(intent.location));
}

// The catalogue's entries as C7's `ModelInfo`. The entry schema is loose, so the engine's other `list_models` fields
// ride along unchecked: `supportedEffortLevels` is kept when it is a list of strings, so the model widget lowers an
// effort the chosen model does not list, as it does for a live session. W3: the resolved model, the description and
// `supportsEffort` too, each when it has its type (the model selector names `default`'s model and shows "From gateway").
// L99 (P2-F): a model's auto verdict comes from the engine alone. The built-in list stands for the pinned engine without
// the launch's model environment: the owner's ANTHROPIC_DEFAULT_HAIKU_MODEL makes `haiku` Haiku 5.5, which holds auto
// (a session switched to it from auto ran its next turn in auto, docs/doperpowers/evidence/p2-finish/
// l99-model-change-from-auto.jsonl), while the list's row is Haiku 4.5's. So its rows claim nothing: every model is
// offered auto, as an unknown one is (statusline/mode-menu.ts), and a refusal at launch is the host's fallback and the
// composer's notice.
function autoVerdictOf(catalogue: ModelCatalogue, entry: ModelCatalogueEntry): ModelCatalogueEntry {
  return catalogue.source === 'builtin' ? { ...entry, supportsAutoMode: true } : entry;
}

export function modelsOf(catalogue: ModelCatalogue): ModelInfo[] {
  return catalogue.models.map((listed) => {
    const entry = autoVerdictOf(catalogue, listed);
    const info: ModelInfo = { value: entry.value, displayName: entry.displayName };
    if (typeof entry.resolvedModel === 'string') info.resolvedModel = entry.resolvedModel;
    if (typeof entry.description === 'string') info.description = entry.description;
    if (typeof entry.supportsEffort === 'boolean') info.supportsEffort = entry.supportsEffort;
    if (entry.supportsAutoMode !== undefined) info.supportsAutoMode = entry.supportsAutoMode;
    if (entry.supportsFastMode !== undefined) info.supportsFastMode = entry.supportsFastMode;
    const levels: unknown = entry.supportedEffortLevels;
    if (Array.isArray(levels) && levels.every((level) => typeof level === 'string')) info.supportedEffortLevels = levels;
    return info;
  });
}

// The note beside the mode and model chips for the model the launch would use (`default` when the intent leaves it
// to the engine).
export function noteFor(catalogue: ModelCatalogue, intent: Pick<SetupIntent, 'model' | 'permissionMode'>, fallback: PermissionMode = 'acceptEdits'): string | null {
  const value = intent.model ?? 'default';
  const listed = catalogue.models.find((m) => m.value === value);
  const entry: ModelCatalogueEntry | null = listed ? autoVerdictOf(catalogue, listed) : intent.model === null ? null : { value: intent.model, displayName: intent.model };
  return autoModeNote(entry, intent.permissionMode, fallback); // W3: the mode MAWS sets when auto is refused
}

// The running setup's phase as the composer says it (Interfaces, "The unstarted session": `Creating worktree <name>` ·
// `Trusting <key>` · `Starting`, from the event's own detail; the bootstrap's "Trust recorded for …" is the log's, so
// the phase still reads as trusting the key the decision answered). Null before a phase and once the setup ended.
export function phaseText(event: SetupEvent | undefined, intent: Pick<SetupIntent, 'trustKey'>): string | null {
  switch (event?.phase) {
    case 'worktree':
      return `${event.detail ?? 'Creating worktree'}…`;
    case 'trusting':
      return `${event.detail?.startsWith('Trusting ') ? event.detail : intent.trustKey !== null ? `Trusting ${intent.trustKey}` : 'Trusting'}…`;
    case 'launching':
      return `${event.detail ?? 'Starting'}…`;
    default:
      return null;
  }
}

// ---- options: read when the tab mounts and again when the location's repository changes ------------------------

interface RepositoryFacts {
  directory: string; // the base directory these facts answer
  repoRoot: string | null;
  worktrees: WorktreeInfo[]; // each checkout with its branch (the project row's read-only branch)
  trustError: string | null; // a failed trust check disables Send with the error
}

const BUILTIN_FALLBACK: ModelCatalogue = { models: [...BUILTIN_MODELS], source: 'builtin', at: null };

async function readRepository(directory: string): Promise<RepositoryFacts> {
  const trust = await ipc.invoke('session.trust.check', { directory });
  if (!trust.ok) return { directory, repoRoot: null, worktrees: [], trustError: trust.error.message };
  if (trust.value.keyKind !== 'repo') return { directory, repoRoot: null, worktrees: [], trustError: null };
  const repoRoot = trust.value.trustKey; // a repository's trust key is its main worktree's root
  const listed = await ipc.invoke('git.worktree.list', { repoRoot });
  return { directory, repoRoot, worktrees: listed.ok ? listed.value.worktrees : [], trustError: null };
}

// The catalogue at every mount and on every route change: the host answers the tab's route's catalogue from its cache
// in memory, which a launch or a refresh updates (the relay's `claude/*` aliases arrive with the first routed launch),
// so each new tab sees what the host knows now for the route it would launch on, not the most recently updated route's.
// A failed read shows the built-in list the host itself answers before any launch. The directory it names is the one
// the launch would read settings from, which may set a model environment of its own (debt wave 5).
async function readCatalogue(gateway: SetupIntent['gateway'], cwd: string | null): Promise<ModelCatalogue> {
  const result = await ipc.invoke('engine.models', cwd === null ? { refresh: false, gateway } : { refresh: false, gateway, cwd });
  if (result.ok) return result.value;
  console.warn('[sessions] engine.models unavailable', result.error);
  return BUILTIN_FALLBACK;
}

function useSetupOptions(
  appSessionId: AppSessionId,
  intent: SetupIntent | null,
): { options: SetupIntentOptions; facts: RepositoryFacts | null; trustError: string | null; recheck(): Promise<string | null> } {
  const location = intent?.location ?? null; // New chat: none until a project is chosen, and nothing to read
  const base = location ? baseDirectoryOf(location) : null;
  const [facts, setFacts] = useState<RepositoryFacts | null>(null);
  const [catalogue, setCatalogue] = useState<ModelCatalogue>(BUILTIN_FALLBACK);
  const fallback = useSettings((s) => s.state?.settings.permissions.autoFallback) ?? 'acceptEdits'; // W3

  // Only an unstarted session reads it: C7 calls this hook from every composer, and a started session's has no intent.
  const route = intent?.gateway ?? null;
  const settingsDirectory = location ? settingsDirectoryOf(location) : null;
  useEffect(() => {
    if (route === null) return;
    let live = true;
    void readCatalogue(route, settingsDirectory).then((c) => live && setCatalogue(c));
    return () => {
      live = false;
    };
  }, [route, settingsDirectory]);

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
    if (intent === null) return { models: [], autoModeNote: null };
    return { models: modelsOf(catalogue), autoModeNote: noteFor(catalogue, intent, fallback) };
  }, [intent, catalogue, fallback]);
  // A failed trust check is read again at Send (the directory may be readable now): the refusal stands only while the
  // check still fails.
  const recheck = useCallback(async () => {
    if (base === null) return null;
    const read = await readRepository(base);
    setFacts(read);
    return read.trustError;
  }, [base]);
  // facts answer the current base only (a project change reads the new one; meanwhile the row shows no branch)
  const current = facts !== null && known ? facts : null;
  return { options, facts: current, trustError: current?.trustError ?? null, recheck };
}

// ---- New chat: the project row's writes ------------------------------------------------------------------------

// "New project": the native folder dialog (main's, `layout.pickFiles`), then the folder as a project by the membership
// rule (`session.projects.addFolder`), chosen with the location main answered. A cancelled dialog changes nothing.
async function newProject(appSessionId: AppSessionId): Promise<HookResult> {
  const picked = await ipc.invoke('layout.pickFiles', { kind: 'directory', directory: null, multiple: false });
  if (!picked.ok) return { ok: false, error: picked.error.message };
  const directory = picked.value.files[0]?.path;
  if (directory === undefined) return { ok: true };
  const added = await ipc.invoke('session.projects.addFolder', { directory });
  if (!added.ok) return { ok: false, error: added.error.message };
  return patchIntent(appSessionId, { projectId: added.value.project.id, location: added.value.location });
}

// Non-null exactly while the session is unstarted: an intent, and no record with an engine status (C7's definition).
export function useSetupIntent(appSessionId: AppSessionId): SetupIntentHook | null {
  const intent = useSetup((s) => s.intents.get(appSessionId) ?? null);
  const started = useSessions((s) => s.records.has(appSessionId) && s.engine.has(appSessionId));
  const event = useSetup((s) => s.phases.get(appSessionId));
  const project = useSessions((s) => (intent?.projectId ? (s.projects.get(intent.projectId) ?? null) : null));
  const { options, facts, trustError, recheck } = useSetupOptions(appSessionId, intent);
  return useMemo(() => {
    if (intent === null || started) return null;
    const shown = projectFacts(intent, project, facts);
    return {
      intent,
      options,
      phase: phaseText(event, intent),
      patch: (p) => patchIntent(appSessionId, p),
      start: async (first) => {
        const error = trustError === null ? null : await recheck();
        return error !== null ? { ok: false, error } : startIntent(appSessionId, first);
      },
      project: {
        ...shown,
        // the same project again keeps the choice (and its Worktree box); from an existing worktree it moves to the project
        choose: async (projectId) =>
          projectId === intent.projectId && intent.location !== null && (projectId === null || intent.location.kind !== 'existingWorktree') ? { ok: true } : patchIntent(appSessionId, { projectId }),
        newProject: () => newProject(appSessionId),
        setWorktree: async (on) => {
          const repoRoot = facts?.repoRoot ?? null;
          if (repoRoot === null || shown.worktree === null || on === shown.worktree) return { ok: true };
          return patchIntent(appSessionId, { location: on ? newWorktreeLocation(repoRoot, worktreeNameFor(shown.label ?? basename(repoRoot))) : { kind: 'directory', path: project?.directory ?? repoRoot } });
        },
      },
    };
  }, [appSessionId, intent, started, event, project, options, facts, trustError, recheck]);
}
