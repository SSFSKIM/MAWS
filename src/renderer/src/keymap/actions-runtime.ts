// The handlers of the action table (C5 execution document, Keyboard runtime). `runAction` is the one entry point for
// menu events (`layout.action`), the ⌘K palette, the renderer's key dispatcher and every button that mirrors an
// action. C5 registers the shell's handlers; later children register theirs (C10 `session.new`). An action with no
// handler renders disabled everywhere: in the page through `useActionEnabled`, in the application menu through the
// enabled set the dispatcher reports to main.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { NO_PROJECT, type LayoutMain, type TabRef, type TabTarget } from '@shared/ipc/schema/layout';
import type { ActionId } from '@shared/keymap/actions';
import type { Location } from '@shared/sessions/intent';
import { markFocusOnMount } from '../stores/composer';
import { useLayout, type ReplaceVerdict } from '../stores/layout';
import { toast } from '../stores/notices';
import { NEW_CHAT } from '../sessions/title';
import { allTabs, currentSet } from '../stores/layout-model';
import { focusPaneElement } from '../main/pane-dom';
import { useSessions } from '../stores/sessions';
import { create } from 'zustand';
import { createHandlerRegistry } from './registry';

export type ActionHandler = (arg: number | null) => void | Promise<void>;

const registry = createHandlerRegistry<ActionId, [number | null]>('actions');

export const registerAction = (id: ActionId, handler: ActionHandler): (() => void) => registry.register(id, handler);
export const runAction = (id: ActionId, arg: number | null = null): void => registry.run(id, arg);
export const isActionEnabled = (id: ActionId): boolean => registry.has(id);
export const enabledActions = (): ActionId[] => registry.ids();
export const subscribeActions = (listener: () => void): (() => void) => registry.subscribe(listener);
export const useActionEnabled = (id: ActionId): boolean => registry.useEnabled(id);

// ---- new sessions -------------------------------------------------------------------------------------------------------
// The owner's design (charter §19, 2026-09-28): no modal sheet. "+" and "New chat" ask the registered creator for an
// app session id with a setup intent and no engine process (C10's `session.create`; in launch mode `scenario` the
// stub's), and the shell opens that unstarted session's tab. A project id cannot ride the numeric `layout.action` arg,
// so the "+" buttons call `createSession(projectId)` directly. W5: a worktree group's "+" in the sidebar names the
// checkout as the location, which the creator puts on the intent (a creator without intents ignores it). New chat
// (2026-10-01): `session.new` (⌘N, File › New chat, the ⌘K palette) is registered with the creator, so it is available
// wherever a session can be made, and starts in the focused project, if any (`focusedProject`).
export type SessionCreator = (projectId: ProjectId | null, location?: Location | null) => Promise<AppSessionId | null>;

const creators = createHandlerRegistry<'create', [ProjectId | null, (Location | null)?]>('session creator');

export const registerSessionCreator = (fn: SessionCreator): (() => void) => {
  const offs = [creators.register('create', fn), registerAction('session.new', async () => void (await createSession(focusedProject())))];
  return () => offs.forEach((off) => off());
};
export const isSessionCreatorRegistered = (): boolean => creators.has('create');
export const useSessionCreatorRegistered = (): boolean => creators.useEnabled('create');

// C12: answers the new session's id (null when none was made), so the Worktrees… dialog can set its location.
export async function createSession(projectId: ProjectId | null, opts: { pane?: 0 | 1 | 'focused'; location?: Location } = {}): Promise<AppSessionId | null> {
  const creator = creators.get('create') as SessionCreator | undefined;
  if (!creator) return null; // C12
  let appSessionId: AppSessionId | null;
  try {
    appSessionId = await (opts.location ? creator(projectId, opts.location) : creator(projectId));
  } catch (error) {
    console.error('[actions] session creator failed', error);
    return null; // C12
  }
  if (appSessionId === null) return null; // C12
  useSessions.getState().addUnstarted(appSessionId, { projectId, createdAt: new Date().toISOString() });
  // W9 (H3): the new tab's composer takes the keyboard as it mounts, so typing goes on without a click (Claude Desktop's
  // and T3's new thread); marked as the tab opens, before anything could render its composer
  markFocusOnMount(appSessionId);
  useLayout.getState().openTab({ kind: 'session', appSessionId }, { pane: opts.pane ?? 'focused' });
  return appSessionId; // C12
}

// ---- closing tabs -------------------------------------------------------------------------------------------------------
// C10's ask of C5 (C5 execution document, Decision Log 2026-09-28): a guard per tab kind, asked before a tab of that
// kind closes; the tab closes only on true. C10 registers the `session` guard, which asks about a non-empty draft
// itself, so the shell shows no dialog of its own. Every close the user makes (the strip's control, a middle-click,
// Delete, ⌘W) goes through `requestCloseTab`; the layout store's `closeTab` stays the unguarded transition underneath.
export type CloseGuard = (ref: TabRef) => Promise<boolean>;

const closeGuards = createHandlerRegistry<TabRef['kind'], [TabRef]>('close guard');

export const registerCloseGuard = (kind: TabRef['kind'], guard: CloseGuard): (() => void) => closeGuards.register(kind, guard);

const findTab = (main: LayoutMain, id: string): TabRef | null => allTabs(main).find((t) => t.id === id) ?? null;

async function guardAllows(ref: TabRef): Promise<boolean> {
  const guard = closeGuards.get(ref.kind) as CloseGuard | undefined;
  if (!guard) return true;
  try {
    return await guard(ref);
  } catch (error) {
    console.error(`[actions] close guard for ${ref.kind} failed; keeping the tab`, error);
    return false;
  }
}

// A session with no record yet: an unstarted tab, which leaves nothing to reopen.
export const isUnstarted = (appSessionId: AppSessionId): boolean => !useSessions.getState().records.has(appSessionId);

export async function requestCloseTab(id: string): Promise<void> {
  const before = useLayout.getState().main;
  const ref = findTab(before, id);
  if (!ref) return;
  const pane = currentSet(before).panes.findIndex((p) => p.tabs.some((t) => t.id === id));
  // Capture DOM ownership before a guard's sheet displaces focus. Selection alone does not own
  // the keyboard: a middle-close in one pane must leave the other pane's editor alone.
  const focused = document.activeElement;
  // A portaled tab menu carries its originating tab's ownership outside the pane DOM.
  const focusedTab = focused?.closest('[data-tab-id]')?.getAttribute('data-tab-id')
    ?? focused?.closest('[data-tab-focus-owner]')?.getAttribute('data-tab-focus-owner');
  const focusedContent = focused?.closest('[role="tabpanel"]')?.closest('[data-pane]')?.getAttribute('data-pane');
  const restore = pane !== -1 && (focusedTab === id || (focusedContent === String(pane) && currentSet(before).panes[pane].activeTabId === id));
  if (!(await guardAllows(ref))) return;
  // An unstarted tab and its intent disappear without a reopen entry; other tabs close normally.
  if (ref.kind === 'session' && isUnstarted(ref.appSessionId)) {
    useLayout.getState().dropSession(ref.appSessionId);
    useSessions.getState().dropUnstarted(ref.appSessionId);
  } else {
    useLayout.getState().closeTab(id);
  }
  if (restore) {
    // Wait for React to replace the tab/content, including collapsing a split whose last tab closed.
    requestAnimationFrame(() => {
      const main = useLayout.getState().main;
      if (main.current !== before.current) return;
      focusPaneElement(currentSet(main).panes.length === 1 ? 0 : pane as 0 | 1);
    });
  }
}

// I2: an unstarted tab a session opened beside in its place (the layout store's `ReplaceGuard`): its guard as for a
// close, then its intent goes; the store drops the tab itself, so it leaves no ⌘⇧T entry either.
export async function discardForReplace(ref: TabRef): Promise<boolean> {
  if (ref.kind !== 'session' || !(await guardAllows(ref))) return false;
  useSessions.getState().dropUnstarted(ref.appSessionId);
  return true;
}

// E11 F2b (plan 2.5; owner decision 2): what replacing a tab would cost, per kind (the layout store's
// `ReplaceGuard.verdict`), answered at once and without asking: E5's editor keeps an unsaved or saving file, C10 keeps a
// launch in flight and sets an unstarted chat's draft aside. A kind with none registered is replaced.
export type ReplaceVerdictOf = (ref: TabRef) => ReplaceVerdict;
const replaceVerdicts = createHandlerRegistry<TabRef['kind'], [TabRef]>('replace verdict');
export const registerReplaceVerdict = (kind: TabRef['kind'], verdict: ReplaceVerdictOf): (() => void) => replaceVerdicts.register(kind, verdict);
export const replaceVerdict = (ref: TabRef): ReplaceVerdict => (replaceVerdicts.get(ref.kind) as ReplaceVerdictOf | undefined)?.(ref) ?? null;

// Says why a tab stayed, or where its work went (with the way back).
export function announceReplace(ref: TabRef, verdict: NonNullable<ReplaceVerdict>): void {
  if ('keep' in verdict) {
    toast({ level: 'info', text: `${verdict.keep}, so it stays open`, actions: [], dismissible: true });
    return;
  }
  const reopen = () => {
    const { id: _id, pinned: _pinned, ...target } = ref;
    void _id;
    void _pinned;
    useLayout.getState().openTab(target as TabTarget);
  };
  toast({ level: 'info', text: verdict.aside, actions: [{ label: 'Reopen', run: reopen }], dismissible: true });
}

// ---- unstarted titles ---------------------------------------------------------------------------------------------------
// What the strip and the toolbar call a session tab with no record yet. C10 registers its `unstartedTitle` over its
// intent store; until then C5 answers from `sessions.unstarted`: "New chat" and the project it was created in. The
// registered function is called during render and must not call hooks; when what it would answer changes, its
// registrant calls `unstartedTitlesChanged` (New chat, 2026-10-01: the project row chooses the project after the tab
// opened). `projectId` is the project the unstarted session is in, for New chat's preselection.
export { NEW_CHAT }; // W11: one string, `sessions/title.ts`, for the control and an untitled session's title
export interface UnstartedTitleAnswer {
  title: string;
  project: string | null;
  projectId: ProjectId | null;
}
export type UnstartedTitle = (appSessionId: AppSessionId) => UnstartedTitleAnswer | null;

const unstartedTitles = createHandlerRegistry<'title', [AppSessionId]>('unstarted title');
// a hook by name, so the React Compiler never memoizes its call away
const useTitleRevision = create<{ n: number }>()(() => ({ n: 0 }));

export const registerUnstartedTitle = (fn: UnstartedTitle): (() => void) => unstartedTitles.register('title', fn);
export const unstartedTitlesChanged = (): void => useTitleRevision.setState((s) => ({ n: s.n + 1 }));

// The answer: the registrant's, else C5's own from `sessions.unstarted`. `revision` is an input so that a memoizing
// compiler (the React Compiler runs over the renderer) computes it again when the registrant announces a change.
function answerOf(appSessionId: AppSessionId, registered: UnstartedTitle | undefined, fallback: Omit<UnstartedTitleAnswer, 'title'>, revision: number): UnstartedTitleAnswer {
  void revision;
  return registered?.(appSessionId) ?? { title: NEW_CHAT, ...fallback };
}

function fallbackOf(appSessionId: AppSessionId): Omit<UnstartedTitleAnswer, 'title'> {
  const { unstarted, projects } = useSessions.getState();
  const projectId = unstarted.get(appSessionId)?.projectId ?? null;
  return { projectId, project: projectId ? (projects.get(projectId)?.name ?? null) : null };
}

const unstartedTitleOf = (appSessionId: AppSessionId): UnstartedTitleAnswer =>
  answerOf(appSessionId, unstartedTitles.get('title') as UnstartedTitle | undefined, fallbackOf(appSessionId), useTitleRevision.getState().n);

export function useUnstartedTitle(appSessionId: AppSessionId): UnstartedTitleAnswer {
  const projectId = useSessions((s) => s.unstarted.get(appSessionId)?.projectId ?? null);
  const project = useSessions((s) => (projectId ? (s.projects.get(projectId)?.name ?? null) : null));
  const registered = unstartedTitles.useHandler('title') as UnstartedTitle | undefined;
  const revision = useTitleRevision((s) => s.n);
  return answerOf(appSessionId, registered, { projectId, project }, revision);
}

// W12: the project an unstarted session's tab belongs with until its record exists (the shell's `projectOf` for the
// layout): C10's registered answer, else C5's own.
export const unstartedProjectOf = (appSessionId: AppSessionId): ProjectId | null => unstartedTitleOf(appSessionId).projectId;

// ---- New chat's preselection (2026-10-01) -------------------------------------------------------------------------------
// The project a New chat starts in when a project is focused, so the common case is one step: the project whose tab set
// the strip shows (W12; every session tab in it is that project's, and a click or Enter on a project row in the sidebar
// switches to it), unless it is gone or hidden from the sidebar (W11). None from the no-project set: the chat then
// starts with "Choose a project".
export function focusedProject(): ProjectId | null {
  const { current } = useLayout.getState().main;
  const project = current === NO_PROJECT ? undefined : useSessions.getState().projects.get(current);
  return project && !project.hidden ? project.id : null;
}

// ---- tab retention ------------------------------------------------------------------------------------------------------
// C10's seventh ask of C5: an unstarted session has no record, so without a say from C10 a relaunch would drop its tab
// (hydration keeps only tabs whose record exists) though its draft persists, and a rollback that removes a provisional
// record would close the tab before its failure card can offer recovery. C10 registers once: hydration waits for
// `ready` (its intent snapshot) and keeps a record-less session tab `retains` claims; `session.removed` closes a tab
// only when `retains` says no. Unregistered, the default rules stand.
export interface TabRetention {
  ready: Promise<void>;
  retains(appSessionId: string): boolean;
}

let retention: TabRetention | null = null;

export function registerTabRetention(r: TabRetention): () => void {
  retention = r;
  return () => {
    if (retention === r) retention = null;
  };
}

export const currentTabRetention = (): TabRetention | null => retention;
