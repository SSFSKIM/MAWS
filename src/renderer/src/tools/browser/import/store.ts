// E4b (Task 3.1): the renderer's mirror of the Chrome profile import (E4b execution document, Design §3 and §11;
// Decision Log 28), one vanilla zustand store for the window, connected once from App.tsx so it runs whether or not the
// sheet is mounted. Main owns the inspection and the run; this store holds what main said and which state the sheet
// shows, and the sheet is a view of it that can be closed and reopened:
//
// - `stage`: the sheet's state, pick → consent (the standing inspection) → running (the run's id and latest progress) →
//   report, or failed (main refused or could not answer). A run started in another window, or before a reload, is
//   adopted from `browser.import.list`'s `running` at connect (Decision Log 41) or from its next progress event;
//   progress and the end of any other run are ignored.
// - `records`: the imported profiles, from `browser.import.list` once and `browser.import.changed` after; each change
//   invalidates E4a's `browser.profiles.list` so the partition pill and the profile select follow.
// - `unseen`: the report of a run this window followed that ended cancelled or failed, until a sheet shows it. Such a
//   run leaves no record (Design §14), so with no sheet mounted at its end (Settings closed, or a run adopted from
//   another window) Settings › Browser offers it with Show; a done run is its record's "Show report".
//
// A run that ends `done` makes its profile the active one (Decision Log 7): the `finished` handler writes
// `browser.profile` through `writeSettings` in every window that hears it (the write is idempotent). A removal writes
// `browser.profile: null` when the setting named the removed profile (Design §12).
//
// cua board #90: `reimport`, the profile popover's Re-import this profile… run at app level (ProfileSheets.tsx), so the
// popover closing and the removal closing the profile's tabs, the popover's own included, never cut it: the removal's
// sheet, then the import sheet at the picker on the profile's Chrome folder with the profile chosen. Its done import
// makes the profile active again through the rule above. `syncBookmarks` is the popover's and Settings' Sync bookmarks
// now.
import type { QueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ImportCategories, ImportPhase, ImportReport, ImportedExtension } from '@shared/browser/import';
import type { ImportedProfile } from '@shared/browser/profiles';
import type { CommandOutput } from '@shared/ipc/schema';
import type { BrowserImportInspection } from '@shared/ipc/schema/browser';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { queryClient } from '../../../ipc/query';
import { writeSettings } from '../../../settings-tab/parts';
import { banner, toast } from '../../../stores/notices';
import { useSettings } from '../../../stores/settings';
import { BROWSER_COPY } from '../copy';
import { IMPORT_COPY } from './copy';

export const PROFILES_FILE_BROKEN_BANNER = 'browser-import-profiles-file-broken';

export interface ImportProgress {
  phase: ImportPhase;
  done: number;
  total: number;
}

export type ImportStage =
  | { kind: 'pick' }
  | { kind: 'consent'; inspection: BrowserImportInspection; userDataDir: string }
  | { kind: 'running'; importId: string; name: string | null; progress: ImportProgress | null; cancelling: boolean } // `name`: null for an adopted run
  | { kind: 'report'; report: ImportReport }
  | { kind: 'failed'; message: string };

export interface BrowserImportState {
  stage: ImportStage;
  busy: boolean; // an inspect or a start is in flight
  listed: boolean; // this connection's records came from main (a list answer or a change)
  records: ImportedProfile[];
  unseen: ImportReport | null;
  reimport: Reimport | null; // cua #90
}

// cua #90: a re-import under way, its removal's sheet then its import's; the record as it stood at the start (the
// removal's sheet counts from it, and the picker opens on its Chrome folder once the removal dropped it)
export interface Reimport {
  record: ImportedProfile;
  step: 'remove' | 'import';
}

const initial = (): BrowserImportState => ({ stage: { kind: 'pick' }, busy: false, listed: false, records: [], unseen: null, reimport: null });

export const browserImport = createStore<BrowserImportState>()(initial);
export const useBrowserImport = <T>(selector: (state: BrowserImportState) => T): T => useStore(browserImport, selector);

// Runs this window has seen end, with their reports: a late progress event never brings one back, and a `start` whose
// answer arrives after its run's end shows the report.
const ended = new Map<string, ImportReport>();

const set = (patch: Partial<BrowserImportState>) => browserImport.setState(patch);
const stage = () => browserImport.getState().stage;

// ---- main's events ---------------------------------------------------------------------------------------------------

export function connectBrowserImport(client: MawsBridge = ipc, queries: QueryClient = queryClient): () => void {
  set({ listed: false }); // this connection's list answer applies unless a change lands first
  const offs = [
    client.on('browser.import.progress', ({ importId, phase, done, total }) => {
      if (ended.has(importId)) return;
      const current = stage();
      const progress = { phase, done, total };
      if (current.kind === 'running') {
        if (current.importId === importId) set({ stage: { ...current, progress } });
        return;
      }
      adopt(importId, progress);
    }),
    client.on('browser.import.finished', ({ importId, report }) => {
      if (ended.has(importId)) return;
      ended.set(importId, report);
      const current = stage();
      const ours = current.kind === 'running' ? current.importId === importId : current.kind !== 'consent' || browserImport.getState().busy;
      if (ours) set({ stage: { kind: 'report', report }, unseen: report.outcome === 'done' ? null : report });
      if (report.outcome === 'done') void writeSettings({ browser: { profile: report.profileDir } }, client);
    }),
    client.on('browser.import.changed', ({ profiles }) => {
      set({ records: profiles, listed: true });
      void queries.invalidateQueries({ queryKey: ['maws', 'browser.profiles.list'] });
      void queries.invalidateQueries({ queryKey: ['maws', 'browser.import.profiles'] }); // the picker's "Imported" marks
    }),
    // cua #90: a partition's bookmark rows were replaced (an import, a sync): its bars read the tree again
    client.on('browser.bookmarks.changed', ({ partition }) => void queries.invalidateQueries({ queryKey: ['maws', 'browser.bookmarks.tree', { partition }] })),
  ];
  void list(client);
  return () => offs.forEach((off) => off());
}

async function list(client: MawsBridge): Promise<void> {
  const result = await client.invoke('browser.import.list', undefined);
  if (!result.ok) {
    console.error('[browser-import] browser.import.list failed', result.error);
    return;
  }
  if (!browserImport.getState().listed) set({ records: result.value.profiles, listed: true }); // a change that landed first is newer
  const { running } = result.value;
  if (running && !ended.has(running.importId) && stage().kind !== 'running') adopt(running.importId, running.phase && { phase: running.phase, done: 0, total: 0 });
  if (result.value.fileBroken) banner({ id: PROFILES_FILE_BROKEN_BANNER, level: 'warning', text: IMPORT_COPY.profilesFileBroken, actions: [], dismissible: true });
}

// A run this window did not start, or forgot in a reload, shown under no name (main's events carry none). A window
// mid-consent with no start of its own in flight leaves it alone: that run is someone else's.
function adopt(importId: string, progress: ImportProgress | null): void {
  if (stage().kind === 'consent' && !browserImport.getState().busy) return;
  set({ stage: { kind: 'running', importId, name: null, progress, cancelling: false } });
}

// ---- the sheet's actions ---------------------------------------------------------------------------------------------

// "Import a Chrome profile…": a running import shows itself; anything else starts over at the picker.
export function openImport(client: MawsBridge = ipc): void {
  if (stage().kind === 'running') return;
  discard(client);
  set({ stage: { kind: 'pick' } });
}

// "Show report": a record's report, unless a run is showing; a standing inspection is discarded first.
export function showReport(report: ImportReport, client: MawsBridge = ipc): void {
  if (stage().kind === 'running') return;
  discard(client);
  set({ stage: { kind: 'report', report } });
}

// Each inspect takes a ticket; a close (`discard`) while it is out voids it, so its answer is discarded on arrival.
let ticket = 0;

export async function inspect(userDataDir: string, profileDir: string, client: MawsBridge = ipc): Promise<void> {
  const mine = ++ticket;
  set({ busy: true });
  const result = await client.invoke('browser.import.inspect', { userDataDir, profileDir });
  if (mine !== ticket || stage().kind !== 'pick') {
    if (mine === ticket) set({ busy: false }); // a run adopted meanwhile; a newer inspect is still out otherwise
    if (result.ok) void client.invoke('browser.import.discard', { inspectionId: result.value.inspectionId }); // the sheet moved on meanwhile
    return;
  }
  set({ busy: false, stage: result.ok ? { kind: 'consent', inspection: result.value, userDataDir } : { kind: 'failed', message: IMPORT_COPY.inspectFailed(result.error.message) } });
}

// The sheet's close in pick or consent: a standing inspection's staging is deleted (Design §4), and one still being
// made is discarded when it answers.
export function discard(client: MawsBridge = ipc): void {
  const current = stage();
  ticket++;
  if (current.kind === 'consent') void client.invoke('browser.import.discard', { inspectionId: current.inspection.inspectionId });
  if (current.kind === 'consent' || current.kind === 'failed') set({ stage: { kind: 'pick' } });
  if (current.kind !== 'running') set({ busy: false });
}

export interface ImportChoice {
  categories: ImportCategories;
  extensionIds: string[];
  allowUnverifiedExtensions: boolean;
}

export async function start(choice: ImportChoice, client: MawsBridge = ipc): Promise<void> {
  const current = stage();
  if (current.kind !== 'consent') return;
  const { inspectionId, profile } = current.inspection;
  set({ busy: true });
  const result = await client.invoke('browser.import.start', { inspectionId, ...choice });
  set({ busy: false });
  if (!result.ok) {
    void client.invoke('browser.import.discard', { inspectionId }); // a refused start may leave the inspection standing
    set({ stage: { kind: 'failed', message: IMPORT_COPY.startFailed(result.error.message) } });
    return;
  }
  const { importId } = result.value;
  const report = ended.get(importId);
  if (report) return set({ stage: { kind: 'report', report } }); // the run ended before its answer arrived
  const now = stage();
  const progress = now.kind === 'running' && now.importId === importId ? now.progress : null; // adopted from an early event
  set({ stage: { kind: 'running', importId, name: profile.name, progress, cancelling: false } });
}

// The sheet rendered this report: it is no longer one to offer.
export function reportShown(report: ImportReport): void {
  if (browserImport.getState().unseen === report) set({ unseen: null });
}

export function cancel(client: MawsBridge = ipc): void {
  const current = stage();
  if (current.kind !== 'running' || current.cancelling) return;
  set({ stage: { ...current, cancelling: true } });
  void client.invoke('browser.import.cancel', { importId: current.importId });
}

// ---- Settings › Browser's actions ------------------------------------------------------------------------------------

export async function setExtension(profileDir: string, extensionId: string, enabled: boolean, client: MawsBridge = ipc): Promise<ImportedExtension | null> {
  const result = await client.invoke('browser.import.setExtension', { profileDir, extensionId, enabled });
  if (!result.ok) {
    const name = browserImport.getState().records.find((r) => r.profileDir === profileDir)?.extensions.find((e) => e.id === extensionId)?.name ?? extensionId;
    toast({ level: 'warning', text: IMPORT_COPY.toggleFailed(name, enabled, result.error.message), actions: [], dismissible: true });
    return null;
  }
  const { extension } = result.value;
  const replace = (record: ImportedProfile) =>
    record.profileDir === profileDir ? { ...record, extensions: record.extensions.map((e) => (e.id === extensionId ? extension : e)) } : record;
  set({ records: browserImport.getState().records.map(replace) }); // main's change event follows with the same record
  return extension;
}

// Removal (Design §12): main closes the tabs and drops everything; then new tabs browse with the default profile if
// this one was active. Answers the refusal's message, or null when removed.
export async function removeProfile(profileDir: string, client: MawsBridge = ipc): Promise<string | null> {
  const result = await client.invoke('browser.import.remove', { profileDir });
  if (!result.ok) return result.error.message;
  set({ records: browserImport.getState().records.filter((record) => record.profileDir !== profileDir) });
  if (useSettings.getState().state?.settings.browser.profile === profileDir) await writeSettings({ browser: { profile: null } }, client);
  return null;
}

// cua #90 start: the profile popover's actions (Settings › Browser's Sync bookmarks now too)

// Main re-reads the profile's `Bookmarks` now; a failure is said in a toast (the popover's line follows the record).
export async function syncBookmarks(profileDir: string, client: MawsBridge = ipc): Promise<CommandOutput<'browser.bookmarks.sync'> | null> {
  const result = await client.invoke('browser.bookmarks.sync', { profileDir });
  const failed = (why: string) => toast({ level: 'warning', text: BROWSER_COPY.profile.syncFailed(why), actions: [], dismissible: true });
  if (!result.ok) {
    failed(result.error.message);
    return null;
  }
  const answer = result.value;
  if ('error' in answer) {
    if (answer.error === 'refused') failed(answer.reason ?? 'refused');
    else failed(answer.error === 'indexUnavailable' ? BROWSER_COPY.profile.indexUnavailable : BROWSER_COPY.profile.unreadableShort);
  }
  return answer;
}

// Re-import this profile…: the removal's sheet first (ProfileSheets.tsx). Nothing starts while an import runs (a
// removal would be refused) or for a profile with no record.
export function startReimport(profileDir: string): void {
  const record = browserImport.getState().records.find((r) => r.profileDir === profileDir);
  if (!record || stage().kind === 'running') return;
  set({ reimport: { record, step: 'remove' } });
}

// The removal done: the import sheet, at the picker.
export function reimportRemoved(client: MawsBridge = ipc): void {
  const current = browserImport.getState().reimport;
  if (!current) return;
  openImport(client);
  set({ reimport: { ...current, step: 'import' } });
}

export function endReimport(): void {
  set({ reimport: null });
}
// cua #90 end

// Tests.
export function resetBrowserImport(): void {
  ended.clear();
  ticket = 0;
  browserImport.setState(initial(), true);
}
