// The history rail's state outside React (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the
// parent): the version list, the preview (a version against the one before it, two versions compared, or the live
// document against the version at the owner's last view), what the editor binds for it, the version's pinned tokens,
// the moved and retyped blocks, and the owner's actions (Save version, Restore, Make a copy, Show editors), with the
// "See N new changes" pill, the "Restored from …" banner and `markViewed` on open and on leaving history.
//
// A preview owns two throwaway gc-off docs; they are destroyed once the editor shows something else (`applied`) and when
// the editor detaches, so the live doc is the only one that outlives a preview.
import type { ArtifactVersion } from '@shared/artifacts/version';
import { decodeMap, stateV2, type Carry, type ContentMap } from '../../../yjs';
import type { DocumentHandle } from '../../../host';
import type { VersionView } from '../../collab';
import { carriedBlocks, changeList, openDiff, renderDiff, showEditors, type Diff } from '../../history';
import { dsOverrides, type TokenOverrides } from '../../meta';
import { listTabs, tabBody, type TabInfo } from '../../tabs';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { HistoryApi } from './api';
import { authorOf, formatWhen, newChangesBase, versionTitle } from './model';

export type PreviewTarget = { kind: 'version'; versionId: number } | { kind: 'compare'; versionIds: [number, number] } | { kind: 'since'; versionId: number | null };

export interface Preview {
  target: PreviewTarget;
  title: string;
  /** The tabs of the state shown (a tab deleted since is among them, one created since is not). */
  tabs: TabInfo[];
  tabId: string | null;
  showChanges: boolean;
  /** What the editor binds: the shown tab's fragment, drawn through the diff while Show changes is on. */
  view: VersionView | null;
  carried: ReadonlyMap<string, Carry['kind']>;
  /** The version's pinned design-system tokens and its own overrides (empty for the live document). */
  tokens: TokenOverrides;
  /** The version Restore and Make a copy act on; null when comparing. */
  versionId: number | null;
}

export interface Pill {
  since: ArtifactVersion | null;
  /** The changes since, once counted. */
  count: number | null;
}

export interface ShownEditor {
  name: string;
  color: string;
  at: number;
  when: string;
  kinds: string[];
}

export interface HistorySnapshot {
  versions: ArtifactVersion[] | null;
  /** The rows the preview shows: one version, or two compared. */
  selected: number[];
  loading: boolean;
  preview: Preview | null;
  pill: Pill | null;
  banner: string | null;
  status: string | null;
  error: string | null;
}

interface Loaded {
  preview: Preview;
  diff: Diff;
  attributions: ContentMap;
}

// "Through the live revision" as a seq bound: a replica's `state().revision` is the revision its own last frame was
// acked at, not the document's (a replica that only reads has never been acked), so the provenance of the live state
// is asked up to the largest seq there can be.
const LIVE = Number.MAX_SAFE_INTEGER;

const EMPTY: HistorySnapshot = { versions: null, selected: [], loading: false, preview: null, pill: null, banner: null, status: null, error: null };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class HistoryController {
  private snapshot: HistorySnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private loaded: Loaded | null = null;
  private readonly diffs = new Set<Diff>();
  private load = 0;
  private liveTab: string | null = null;
  private begun = false;

  constructor(
    private readonly handle: DocumentHandle,
    private readonly api: HistoryApi,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): HistorySnapshot => this.snapshot;

  /**
   * The editor opened: follow restores (the banner) and new versions; the first time, read the list and the last view,
   * offer "See N new changes" when an agent changed the document since, then mark it viewed. Returns the detach, which
   * also drops any preview and its docs (an attach after it starts from the live document).
   */
  attach(): () => void {
    const stops = [this.handle.onRestored(({ versionId }) => void this.restored(versionId)), this.api.onVersions?.(() => void this.refresh()) ?? (() => {})];
    if (!this.begun) {
      this.begun = true;
      void this.begin();
    }
    return () => {
      for (const stop of stops) stop();
      this.load += 1;
      this.loaded = null;
      for (const diff of this.diffs) diff.destroy();
      this.diffs.clear();
      if (this.snapshot.preview || this.snapshot.loading) this.set({ preview: null, selected: [], loading: false });
    };
  }

  private async begin(): Promise<void> {
    try {
      const [versions, lastViewedAt] = await Promise.all([this.api.versions(), this.api.lastViewedAt()]);
      this.set({ versions });
      const base = newChangesBase(versions, lastViewedAt);
      if (base) {
        this.set({ pill: { since: base.since, count: null } });
        void this.count(base.since);
      }
      await this.api.markViewed();
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  /** The tab the editor shows live: a preview opens on the same tab when the state shown has it. */
  setLiveTab(tabId: string | null): void {
    this.liveTab = tabId;
  }

  async refresh(): Promise<void> {
    try {
      this.set({ versions: await this.api.versions() });
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  /** A row clicked: preview it against the version before it; with `extend` (shift-click), compare it with the selected one. */
  select(versionId: number, { extend = false }: { extend?: boolean } = {}): Promise<void> {
    const [first] = this.snapshot.selected;
    if (extend && first !== undefined && first !== versionId) return this.open({ kind: 'compare', versionIds: [first, versionId] });
    return this.open({ kind: 'version', versionId });
  }

  /** The pill: the live document against the version at the last view. */
  openNewChanges(): Promise<void> {
    const since = this.snapshot.pill?.since ?? null;
    this.set({ pill: null });
    return this.open({ kind: 'since', versionId: since?.id ?? null });
  }

  dismissPill(): void {
    this.set({ pill: null });
  }
  dismissBanner(): void {
    this.set({ banner: null });
  }
  dismissStatus(): void {
    this.set({ status: null, error: null });
  }

  setShowChanges(on: boolean): void {
    const loaded = this.loaded;
    if (!loaded) return;
    this.show(loaded, { ...loaded.preview, showChanges: on });
  }

  setTab(tabId: string): void {
    const loaded = this.loaded;
    if (!loaded || !loaded.preview.tabs.some((tab) => tab.id === tabId)) return;
    this.show(loaded, { ...loaded.preview, tabId });
  }

  /** Back to the live document; the owner has now seen it. */
  close(): void {
    this.load += 1;
    if (!this.loaded && !this.snapshot.loading) return;
    this.loaded = null;
    this.set({ preview: null, selected: [], loading: false });
    void this.api.markViewed().catch((error: unknown) => this.set({ error: message(error) }));
  }

  /** The editor now shows `view` (or the live document): every other preview's docs can go. */
  applied(view: VersionView | null): void {
    for (const diff of this.diffs) {
      if (diff === this.loaded?.diff) continue;
      const shown = view !== null && (view.renderer === diff.renderer || view.ytype.doc === diff.nextDoc);
      if (shown) continue;
      diff.destroy();
      this.diffs.delete(diff);
    }
  }

  async save(version: { label: string; note?: string }): Promise<boolean> {
    try {
      await this.api.saveVersion(version);
      await this.refresh();
      this.set({ status: `Saved “${version.label}”.` });
      return true;
    } catch (error) {
      this.set({ error: message(error) });
      return false;
    }
  }

  /** Restores the previewed version (a new `restore` version) and leaves history; the banner follows the restore. */
  async restore(): Promise<void> {
    const versionId = this.loaded?.preview.versionId;
    if (versionId == null) return;
    try {
      await this.api.restore(versionId);
      this.close();
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  /** Make a copy of the previewed version as a new artifact. */
  async duplicate(): Promise<void> {
    const versionId = this.loaded?.preview.versionId;
    if (versionId == null) return;
    try {
      await this.api.duplicate(versionId);
      this.set({ status: 'A copy of this version was made.' });
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  /** Show editors: who edited [from, to) of the live tab and when, from provenance (an edit older than a compaction too). */
  async editorsOf({ doc, from, to, tabId }: { doc: PMNode; from: number; to: number; tabId: string }): Promise<ShownEditor[]> {
    const liveRoot = tabBody(this.handle.doc, tabId);
    if (!liveRoot) return [];
    const provenance = decodeMap(await this.api.attributions(0, LIVE));
    return showEditors({ doc, from, to, liveRoot, provenance }).map(({ who, at, kinds }) => {
      const author = authorOf(who, this.api.sessionTitle?.bind(this.api));
      return { name: author.name, color: author.color, at, when: formatWhen(at), kinds };
    });
  }

  // ── loading a preview ──
  private async open(target: PreviewTarget): Promise<void> {
    const load = ++this.load;
    const selected = target.kind === 'version' ? [target.versionId] : target.kind === 'compare' ? [...target.versionIds] : [];
    this.set({ selected, loading: true, error: null });
    try {
      const versions = this.snapshot.versions ?? (await this.api.versions());
      const byId = (id: number) => {
        const version = versions.find((v) => v.id === id);
        if (!version) throw new Error(`no version ${id}`);
        return version;
      };
      let prev: ArtifactVersion | null;
      let next: ArtifactVersion | null;
      let title: string;
      if (target.kind === 'version') {
        next = byId(target.versionId);
        prev = versions.filter((v) => v.seq < next!.seq || (v.seq === next!.seq && v.id < next!.id)).sort((a, b) => b.seq - a.seq || b.id - a.id)[0] ?? null;
        title = next.label ? `${next.label} · ${formatWhen(next.at)}` : formatWhen(next.at);
      } else if (target.kind === 'compare') {
        [prev, next] = target.versionIds.map(byId).sort((a, b) => a.seq - b.seq || a.id - b.id);
        title = `${versionTitle(prev)} → ${versionTitle(next)}`;
      } else {
        prev = target.versionId === null ? null : byId(target.versionId);
        next = null;
        title = 'Changes since you last looked';
      }
      const [prevState, nextState, attributions, tokens] = await Promise.all([
        prev ? this.api.versionState(prev.id) : Promise.resolve(null),
        next ? this.api.versionState(next.id) : Promise.resolve(stateV2(this.handle.doc)),
        this.api.attributions(prev?.seq ?? 0, next?.seq ?? LIVE),
        next?.designSystemRef && this.api.designTokens ? this.api.designTokens(next.designSystemRef) : Promise.resolve({}),
      ]);
      if (load !== this.load) return;
      const provenance = decodeMap(attributions);
      const diff = openDiff({ prevState, nextState, attributions: provenance });
      this.diffs.add(diff);
      const tabs = listTabs(diff.nextDoc);
      const tabId = tabs.some((tab) => tab.id === this.liveTab) ? this.liveTab : (tabs[0]?.id ?? null);
      const preview: Preview = {
        target,
        title,
        tabs,
        tabId,
        showChanges: true,
        view: null,
        carried: new Map(),
        tokens: next ? { ...tokens, ...dsOverrides(diff.nextDoc) } : {},
        versionId: target.kind === 'version' ? target.versionId : null,
      };
      this.loaded = { preview, diff, attributions: provenance };
      this.show(this.loaded, preview, true);
    } catch (error) {
      if (load === this.load) this.set({ loading: false, error: message(error) });
    }
  }

  // Publishes a preview with the view of its tab and Show changes setting (`fresh`: its moved and retyped blocks too).
  private show(loaded: Loaded, preview: Preview, fresh = false): void {
    const ytype = preview.tabId ? tabBody(loaded.diff.nextDoc, preview.tabId) : undefined;
    const carried = !fresh && preview.tabId === loaded.preview.tabId ? preview.carried : ytype ? carriedBlocks(ytype, loaded.attributions) : new Map<string, Carry['kind']>();
    const next: Preview = { ...preview, carried, view: ytype ? { ytype, renderer: preview.showChanges ? loaded.diff.renderer : null } : null };
    loaded.preview = next;
    this.set({ preview: next, loading: false });
  }

  // Counts the changes since the last view, over every tab, headless.
  private async count(since: ArtifactVersion | null): Promise<void> {
    try {
      const [prevState, attributions] = await Promise.all([since ? this.api.versionState(since.id) : Promise.resolve(null), this.api.attributions(since?.seq ?? 0, LIVE)]);
      const diff = openDiff({ prevState, nextState: stateV2(this.handle.doc), attributions: decodeMap(attributions) });
      try {
        const count = listTabs(diff.nextDoc).reduce((n, tab) => n + changeList(renderDiff(tabBody(diff.nextDoc, tab.id)!, diff.renderer)).length, 0);
        const pill = this.snapshot.pill;
        if (pill && pill.since === since) this.set({ pill: count > 0 ? { ...pill, count } : null });
      } finally {
        diff.destroy();
      }
    } catch {
      // the pill stays without a count
    }
  }

  private async restored(versionId: number): Promise<void> {
    if (this.snapshot.preview || this.snapshot.loading) this.close();
    await this.refresh();
    const version = this.snapshot.versions?.find((v) => v.id === versionId);
    this.set({ banner: version?.label ?? 'Restored from an earlier version' });
  }

  private set(change: Partial<HistorySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}
