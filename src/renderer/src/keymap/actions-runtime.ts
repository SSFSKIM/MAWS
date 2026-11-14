// The handlers of the action table (C5 execution document, Keyboard runtime). `runAction` is the one entry point for
// menu events (`layout.action`), the ⌘K palette, the renderer's key dispatcher and every button that mirrors an
// action. C5 registers the shell's handlers; later children register theirs (C10 `session.new`). An action with no
// handler renders disabled everywhere: in the page through `useActionEnabled`, in the application menu through the
// enabled set the dispatcher reports to main.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { tabId, type Strip, type TabRef, type TabTarget } from '@shared/ipc/schema/layout';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { ActionId } from '@shared/keymap/actions';
import type { Location } from '@shared/sessions/intent';
import { askEditorHostClose } from '../panel/editor-host'; // P3-G
import { markFocusOnMount, useComposerStore } from '../stores/composer';
import { frontOf, placeOf as viewedPlace, useLayout, type ReplaceVerdict } from '../stores/layout';
import { toast } from '../stores/notices';
import { NEW_CHAT } from '../sessions/title';
import { allTabs, currentSet, locateTab } from '../stores/layout-model';
import { surfaceSession } from '../panel/surface-model';
import { focusPaneElement, paneDomId } from '../main/pane-dom';
import { useMachines } from '../stores/machines';
import { useSessions, type SessionsState } from '../stores/sessions';
import { localProjectOfSet, rowOfListed, selectOrgIndex, sessionSetKey, type RowKey } from '../stores/org-projects'; // P5 O6 M5
import { machineKey } from '@shared/machine/org-key';
import { newChatElsewhere, registrySpawnTarget } from '../sidebar/registry-new-chat'; // U13a: New chat's place elsewhere
import { ipc } from '../ipc/client';
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
// wherever a session can be made; U13a: it is `newChat`, as every New chat control is.
export type SessionCreator = (projectId: ProjectId | null, location?: Location | null) => Promise<AppSessionId | null>;

const creators = createHandlerRegistry<'create', [ProjectId | null, (Location | null)?]>('session creator');

export const registerSessionCreator = (fn: SessionCreator): (() => void) => {
  const offs = [creators.register('create', fn), registerAction('session.new', async () => void (await newChat()))];
  return () => offs.forEach((off) => off());
};
export const isSessionCreatorRegistered = (): boolean => creators.has('create');
export const useSessionCreatorRegistered = (): boolean => creators.useEnabled('create');

// C12: answers the new session's id (null when none was made), so the Worktrees… dialog can set its location. The project
// registry: `registry`, the registry project a New chat with no project here is opened in (sidebar/registry-new-chat.ts),
// the unstarted session's before its tab opens (panel sweep#3), so its tab names that project's row. ticket 497 (UX wave U13a):
// the tab in front is read at the call and again at the answer; a chat whose answer finds another tab in front is added
// after that tab, unselected, and its composer takes the keyboard when the person selects it. UX wave U7b (M5, decision 11):
// what the person looks at is compared (the store's `placeOf`), so a chat that arrives after a page or the Settings dialog opened is
// added unselected and takes neither away.
export async function createSession(projectId: ProjectId | null, opts: { pane?: 0 | 1 | 'focused'; location?: Location; registry?: string } = {}): Promise<AppSessionId | null> {
  const creator = creators.get('create') as SessionCreator | undefined;
  if (!creator) return null; // C12
  const front = viewedPlace(useLayout.getState());
  let appSessionId: AppSessionId | null;
  try {
    appSessionId = await (opts.location ? creator(projectId, opts.location) : creator(projectId));
  } catch (error) {
    console.error('[actions] session creator failed', error);
    return null; // C12
  }
  if (appSessionId === null) return null; // C12
  useSessions.getState().addUnstarted(appSessionId, { projectId, createdAt: new Date().toISOString(), ...(opts.registry !== undefined && { registry: opts.registry }) });
  // W9 (H3): the new tab's composer takes the keyboard as it mounts, so typing goes on without a click (Claude Desktop's
  // and T3's new thread); marked as the tab opens, before anything could render its composer
  markFocusOnMount(appSessionId);
  const tab: TabTarget = { kind: 'session', appSessionId };
  if (viewedPlace(useLayout.getState()) === front) useLayout.getState().openTab(tab, { pane: opts.pane ?? 'focused' });
  else useLayout.getState().openTab(tab, { activate: false });
  return appSessionId; // C12
}

// ---- New chat (UX wave U13a: its section's rule 6, O-01 "New chat"; the plan's Interfaces §E) ------------------------------
// The one way an empty chat is asked for: every New chat control calls `newChat`. It brings back an empty chat of the
// place it would start one in rather than make a second, and closes the strip's other empty chats. `createSession`
// stays underneath for a creation that carries something (the Worktrees dialog's checkout, the Library's prompt).

// What `sessions/` tells the shell about a chat (registered by its composition in launch mode `index`; with none, as in
// mode `scenario`, no chat is empty and each press makes one).
export interface EmptyChats {
  isEmpty(appSessionId: AppSessionId): boolean;
  /** Discards the chat's intent and asks nothing. false: main refused, and the person has been told why. */
  discard(appSessionId: AppSessionId): Promise<boolean>;
}

let emptyChats: EmptyChats | null = null;

export function registerEmptyChats(port: EmptyChats): () => void {
  emptyChats = port;
  return () => {
    if (emptyChats === port) emptyChats = null;
  };
}

export interface NewChatOptions {
  pane?: 0 | 1;
  row?: RowKey;
}

// Where a chat for a row starts: in its folder on this Mac that is not hidden; else, for a registry project, on a
// machine that has the project, as the row's "+" starts it there; else with no project ("Choose a project").
type Place = { kind: 'here'; projectId: ProjectId } | { kind: 'elsewhere'; target: Parameters<typeof newChatElsewhere>[0] } | { kind: 'none' };

function placeOf(row: RowKey | null): Place {
  if (row === null) return { kind: 'none' };
  const sessions = useSessions.getState();
  const project = localProjectOfSet(sessions, row, ipc.localMachine);
  if (project !== undefined && !project.hidden) return { kind: 'here', projectId: project.id };
  const registered = selectOrgIndex(sessions, ipc.localMachine).orgs.get(row)?.registry;
  const target = registered === undefined ? null : registrySpawnTarget(registered, useMachines.getState().machines);
  return target === null ? { kind: 'none' } : { kind: 'elsewhere', target };
}

// Whether a chat is for the place a press resolves to: made for it, or given it since (a project chosen in it).
function isFor(appSessionId: AppSessionId, place: Place): boolean {
  const projectId = unstartedProjectOf(appSessionId);
  if (place.kind === 'here') return projectId === place.projectId;
  if (projectId !== null) return false;
  const registry = useSessions.getState().unstarted.get(appSessionId)?.registry;
  return place.kind === 'elsewhere' ? registry === place.target.registry : registry === undefined;
}

const sessionTab = (appSessionId: AppSessionId): TabTarget => ({ kind: 'session', appSessionId });

function emptyChatsOfStrip(): AppSessionId[] {
  const port = emptyChats;
  if (port === null) return [];
  return allTabs(useLayout.getState().main).flatMap((t) => (t.kind === 'session' && port.isEmpty(t.appSessionId) ? [t.appSessionId] : []));
}

// The chat comes to the front in the pane asked for, moved there from the other, and its composer takes the keyboard: at
// once when it is mounted there already, else as it mounts.
function bringForward(appSessionId: AppSessionId, pane: 0 | 1 | undefined): void {
  const id = tabId(sessionTab(appSessionId));
  const layout = useLayout.getState();
  const { panes, focusedPane } = layout.main;
  const at = locateTab(layout.main, id)!;
  const to = pane !== undefined && pane < panes.length ? pane : focusedPane;
  const target = panes[to]!; // a pane the strip has
  const mounted = at.pane === to && target.activeTabId === id;
  if (at.pane === to) layout.activateTab(id);
  else layout.moveTab(id, to, target.tabs.findIndex((t) => t.id === target.activeTabId) + 1);
  const composer = mounted ? useComposerStore.getState().focusTargets.get(appSessionId) : undefined;
  if (composer) composer.focusFrame();
  else markFocusOnMount(appSessionId);
}

async function pressNewChat({ pane, row }: NewChatOptions): Promise<AppSessionId | null> {
  const place = placeOf(row ?? currentRow());
  const found = emptyChatsOfStrip();
  const same = found.find((id) => isFor(id, place));
  if (same !== undefined) {
    bringForward(same, pane);
    for (const id of found) if (id !== same) closeEmptyChat(id);
    return same;
  }
  const opts = pane === undefined ? {} : { pane };
  const created = place.kind === 'elsewhere' ? await newChatElsewhere(place.target, opts) : await createSession(place.kind === 'here' ? place.projectId : null, opts);
  // after the arrival, so a new chat takes the front from an empty one beside it before that one is closed
  if (created !== null) for (const id of found) closeEmptyChat(id);
  return created;
}

let pressing: Promise<AppSessionId | null> | null = null;

/** A New chat, from any control: the chat brought forward or made, null when none could be made. A press while an
    earlier one waits for its chat is that press. */
export function newChat(opts: NewChatOptions = {}): Promise<AppSessionId | null> {
  if (pressing !== null) return pressing;
  const press = pressNewChat(opts).finally(() => {
    if (pressing === press) pressing = null;
  });
  pressing = press;
  return press;
}

/** Closes an empty chat for the person, never through `requestCloseTab` (whose tab stays selectable while its discard
    is on the way): checked again and taken out of the strip in one run, and only then discarded, put back unselected
    if main refuses. A chat in front, no longer empty or with no tab is left alone. */
export function closeEmptyChat(appSessionId: AppSessionId): void {
  const port = emptyChats;
  const tab = sessionTab(appSessionId);
  const layout = useLayout.getState();
  const open = findTab(layout.main, tabId(tab));
  if (port === null || open === null || !port.isEmpty(appSessionId) || frontOf(layout) === tabId(tab)) return;
  // only the tab leaves now, with no reopen entry (as an unstarted chat's close); what else the session holds (its side
  // tools and their state) goes once main has agreed, so a refusal puts back exactly what was there
  layout.closeTab(open.id, { remember: false });
  const putBack = () => {
    useLayout.getState().openTab(tab, { activate: false });
    if (open.pinned) useLayout.getState().togglePinned(open.id); // a new ref is unpinned
  };
  port.discard(appSessionId).then(
    (discarded) => {
      if (!discarded) return putBack();
      useLayout.getState().dropSession(appSessionId);
      useSessions.getState().dropUnstarted(appSessionId);
    },
    (error: unknown) => {
      console.error('[actions] discarding an empty chat failed; its tab is back', error);
      putBack();
    },
  );
}

// ---- closing tabs -------------------------------------------------------------------------------------------------------
// C10's ask of C5 (C5 execution document, Decision Log 2026-09-28): a guard per tab kind, asked before a tab of that
// kind closes; the tab closes only on true. C10 registers the `session` guard, which asks about a non-empty draft
// itself, so the shell shows no dialog of its own. Every close the user makes (the strip's control, a middle-click,
// Delete, ⌘W) goes through `requestCloseTab`; the layout store's `closeTab` stays the unguarded transition underneath.
export type CloseGuard = (ref: TabRef) => Promise<boolean>;

const closeGuards = createHandlerRegistry<TabRef['kind'], [TabRef]>('close guard');

export const registerCloseGuard = (kind: TabRef['kind'], guard: CloseGuard): (() => void) => closeGuards.register(kind, guard);

const findTab = (main: Strip, id: string): TabRef | null => allTabs(main).find((t) => t.id === id) ?? null;

async function guardAllows(ref: TabRef): Promise<boolean> {
  // P3-G (§D2.3): an editor registered in the tab (X32) is asked first; its veto stops before the kind's guard.
  const editor = askEditorHostClose({ surface: 'main', tabId: ref.id });
  if (editor !== null && !(await editor)) return false;
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
    // Wait for React to replace the tab/content, including collapsing a split whose last tab closed. The restore only
    // places the focus the close let fall: focus that another surface took within that frame (the Overview opened at
    // once, a dialog, a click elsewhere) stays there (P3-F, tracker rows 200 and 264).
    requestAnimationFrame(() => {
      const target = currentSet(useLayout.getState().main).panes.length === 1 ? 0 : pane as 0 | 1;
      if (!focusLeftTo(pane as 0 | 1, target)) return;
      focusPaneElement(target);
    });
  }
}

// Whether focus is still the close's to place: fallen to the page, or still inside the pane it closed in or the one it
// goes to.
function focusLeftTo(...panes: Array<0 | 1>): boolean {
  const now = document.activeElement;
  if (now === null || now === document.body) return true;
  return panes.some((index) => document.getElementById(paneDomId(index))?.contains(now) ?? false);
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

// The project an unstarted session sits under until its record exists (`sessionRow`): C10's registered answer, else
// C5's own.
export const unstartedProjectOf = (appSessionId: AppSessionId): ProjectId | null => unstartedTitleOf(appSessionId).projectId;

// ---- the current project (UX wave U13a; its section's rules 4 and 5, the plan's Interfaces §D) --------------------------
// The session in front is the one whose card column and side surfaces the window shows (`surfaceSession`), and the
// current project is the sidebar row it sits under. It decides the title bar's chip, where New chat starts and the
// project Customize is opened for. A page or a dialog changes neither.

type RowState = Pick<SessionsState, 'projects' | 'registry' | 'records' | 'listed' | 'unstarted'>;

// The row a session sits under (rule 5), what the shell filed a session's tabs by before U13a, unchanged: its record's
// project's row (a hidden project's included, so that the chip can bring it back), a machine's own row for a session in
// no listed project, else the project chosen in its unstarted chat. `revision` is an input so that a memoizing compiler
// asks again when the unstarted titles change.
function rowOf(appSessionId: AppSessionId, state: RowState, loaded: ReadonlySet<MachineRef>, revision: number): RowKey | null | undefined {
  void revision;
  if (!loaded.has(machineOf(appSessionId))) return undefined;
  // a listed session with no record read, of either lane, sits where its listing's row is (the branch review: lane A's
  // opener reads no record; `sessionSetKey` knows a listing only for lane B)
  const listing = state.records.has(appSessionId) ? undefined : state.listed.get(appSessionId);
  if (listing !== undefined) return rowOfListed(selectOrgIndex(state, ipc.localMachine), listing) ?? listing.orgKey ?? machineKey(listing.machine);
  return sessionSetKey(state, ipc.localMachine, appSessionId, () => {
    const retention = currentTabRetention();
    const unstarted = retention ? retention.retains(appSessionId) : state.unstarted.has(appSessionId);
    return unstarted ? unstartedProjectOf(appSessionId) : undefined;
  });
}

// What `sessionRow` reads, for a reader outside React that must hear its answer change (the branch review: a drag's
// targets): the sessions, the machines' loads and the unstarted titles.
export function subscribeSessionRows(listener: () => void): () => void {
  const offs = [useSessions.subscribe(listener), useMachines.subscribe(listener), useTitleRevision.subscribe(listener)];
  return () => offs.forEach((off) => off());
}

/** The row a session sits under (rule 5): its project's, a machine's own, or the project chosen in an unstarted chat.
    null: an unstarted chat with no project. undefined: its machine has not answered in this run, or it is not known. */
export const sessionRow = (appSessionId: AppSessionId): RowKey | null | undefined =>
  rowOf(appSessionId, useSessions.getState(), useMachines.getState().loaded, useTitleRevision.getState().n);

const rowOrNone = (row: RowKey | null | undefined): RowKey | null => row ?? null;

export function currentRow(): RowKey | null {
  const session = surfaceSession(useLayout.getState());
  return session === null ? null : rowOrNone(sessionRow(session));
}

export function useCurrentRow(): RowKey | null {
  const session = useLayout(surfaceSession);
  const loaded = useMachines((s) => s.loaded);
  const projects = useSessions((s) => s.projects);
  const registry = useSessions((s) => s.registry);
  const records = useSessions((s) => s.records);
  const listed = useSessions((s) => s.listed);
  const unstarted = useSessions((s) => s.unstarted);
  const revision = useTitleRevision((s) => s.n);
  return session === null ? null : rowOrNone(rowOf(session, { projects, registry, records, listed, unstarted }, loaded, revision));
}

/** `sessionRow` of each session, as a hook (U13a: the place each session tab names, `main/tab-place.ts`). */
export function useSessionRows(appSessionIds: readonly AppSessionId[]): (RowKey | null | undefined)[] {
  const loaded = useMachines((s) => s.loaded);
  const projects = useSessions((s) => s.projects);
  const registry = useSessions((s) => s.registry);
  const records = useSessions((s) => s.records);
  const listed = useSessions((s) => s.listed);
  const unstarted = useSessions((s) => s.unstarted);
  const revision = useTitleRevision((s) => s.n);
  return appSessionIds.map((id) => rowOf(id, { projects, registry, records, listed, unstarted }, loaded, revision));
}

// New chat's preselection (2026-10-01): the current project's folder on this Mac, unless it is hidden from the sidebar
// (W11). None for a machine's row, a project with no folder here or no current project (U13a: New chat's place, which
// may then be another machine's).
export function focusedProject(): ProjectId | null {
  const place = placeOf(currentRow());
  return place.kind === 'here' ? place.projectId : null;
}

// ---- tab retention ------------------------------------------------------------------------------------------------------
// C10's seventh ask of C5: an unstarted session has no record, so without a say from C10 a relaunch would drop its tab
// (hydration keeps only tabs whose record exists) though its draft persists, and a rollback that removes a provisional
// record would close the tab before its failure card can offer recovery. C10 registers once: hydration waits for
// `ready` (its intent snapshot's first answer) and keeps a record-less session tab `retains` claims; `session.removed`
// closes a tab only when `retains` says no. Unregistered, the default rules stand. 2026-10-31: `ready` says whether that
// answer held the intents; a failed read is asked again, never taken as none, and `known` resolves once they are held,
// until when the local machine's tabs are kept (ipc/events.ts).
export interface TabRetention {
  ready: Promise<boolean>;
  known: Promise<void>;
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
