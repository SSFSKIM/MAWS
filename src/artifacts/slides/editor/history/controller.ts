// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; parent §4.7 [binding]; M8): the deck's history
// state outside React. B's rail and history api are reused as they are (src/artifacts/document/editor/history/: the
// version list, Save version, the api over A's IPC); this controller is the deck's own preview, in B's controller's
// shape so the rail drives it unchanged (`select`, `save`, the snapshot's list fields): a version against the one
// before it, two versions compared (shift-click), or the live deck against the version at the owner's last view ("See N
// new changes"), each a per-slide change set (../../history.ts) over two throwaway gc-off docs; the version's pinned
// design system (X29's `designSystemRef`, the floor for a version written with none); ↑ ↓ through the changes; Restore
// (artifact-wide, a new `restore` version keeping conversations: A's store and the deck adapter's `revertScope`), Make a
// copy, Name this version; Show editors of a live element from provenance; the "Restored from …" banner and
// `markViewed` on open and on leaving history, as B's.
//
// A preview owns its two docs; they are destroyed once the editor shows something else (`applied`) and when the editor
// detaches, so the live doc is the only one that outlives a preview, and it is never written.
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { DesignSystemRef } from '../../../design-system/apply';
import type { HistoryApi } from '../../../document/editor/history/api';
import type { ShownEditor } from '../../../document/editor/history/controller';
import { authorOf, formatWhen, newChangesBase, quoted, versionTitle, type SummaryWords } from '../../../document/editor/history/model';
import type { DocumentHandle } from '../../../host';
import { decodeMap, stateV2, type Doc } from '../../../yjs';
import { changeStops, deckChanges, elementEditors, elementHistory, openDeckDiff, type ChangeStop, type DeckChanges, type DeckDiff, type ElementPlace, type KeyChange, type Touch } from '../../history'; // P3-E: elementHistory
import { slideOrder } from '../../model';
import { getThread } from '../../threads';

export type DeckPreviewTarget = { kind: 'version'; versionId: number } | { kind: 'compare'; versionIds: [number, number] } | { kind: 'since'; versionId: number | null };

export interface DeckPreview {
  target: DeckPreviewTarget;
  title: string;
  /** The state shown (the later one) and the one it is compared with (deleted elements and slides are drawn from it). */
  shown: Doc;
  earlier: Doc;
  showChanges: boolean;
  changes: DeckChanges;
  /** ↑ ↓'s stops, in order; `focus` the one reached (an index), null before the first step. */
  stops: ChangeStop[];
  focus: number | null;
  /** The slide on the stage. */
  slideId: string | null;
  /** The design system the shown state draws in: the version's pin, the floor without one; null for the live deck's own. */
  system: DesignSystemRef | { builtin: 'maws' } | null;
  /** The version Restore, Make a copy and Name act on; null when comparing or showing the live deck. */
  versionId: number | null;
  /** When it was asked for (`performance.now()`), so the editor can time it once drawn. */
  requestedAt: number;
  /** Fix wave 1 (R2): the revisions whose assets each state draws with (the version's seq; null for the live deck). */
  revision: number | null;
  earlierRevision: number | null;
  /**
   * P3-E (the P3-E spec's Decision Log 30): one element's history between a place in the earlier state and one in the
   * shown state (`elementHistory` over this preview's own diff, which the controller keeps and frees with the preview);
   * optional for a preview made elsewhere, always set by the controller.
   */
  elementHistory?: (earlier: ElementPlace, shown: ElementPlace) => { inserted: Touch; keys: KeyChange[] };
}

export interface DeckPill {
  since: ArtifactVersion | null;
  count: number | null;
  failed: string | null;
}

/** B's `HistorySnapshot` list fields (the rail reads those), and the deck's preview and pill. */
export interface DeckHistorySnapshot {
  versions: ArtifactVersion[] | null;
  selected: number[];
  loading: boolean;
  preview: DeckPreview | null;
  pill: DeckPill | null;
  banner: string | null;
  status: string | null;
  error: string | null;
}

// a replica's own revision is its last acked frame's, not the document's: the live provenance is asked to the end
const LIVE = Number.MAX_SAFE_INTEGER;
const EMPTY: DeckHistorySnapshot = { versions: null, selected: [], loading: false, preview: null, pill: null, banner: null, status: null, error: null };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** A version's heading over its preview: its name and time, or its time alone. */
const versionHeading = (version: ArtifactVersion): string => (version.label ? `${version.label} · ${formatWhen(version.at)}` : formatWhen(version.at));

/**
 * P3-E (E1 M4; the P3-E spec's Decision Log 23): an optional count for the new-change pill, read from the diff and its
 * change set before the diff is discarded (a design counts a cross-board move once); absent, the change set's own count.
 */
export interface DeckHistoryOptions {
  countChanges?(diff: DeckDiff, changes: DeckChanges): number;
}

export class DeckHistoryController {
  private snapshot: DeckHistorySnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private loaded: DeckDiff | null = null;
  private readonly diffs = new Set<DeckDiff>();
  private load = 0;
  private liveSlide: string | null = null;
  private begun = false;

  constructor(
    private readonly handle: Pick<DocumentHandle, 'doc' | 'onRestored'>,
    private readonly api: HistoryApi,
    private readonly options: DeckHistoryOptions = {}, // P3-E
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): DeckHistorySnapshot => this.snapshot;

  /** P4 W1-B: what B's rail names the deck's comments by in a turn's lines: each thread's quote in the live deck. */
  words = (): SummaryWords => ({ block: () => null, thread: (id) => quoted(getThread(this.handle.doc, id)?.quote ?? '') });

  /**
   * The editor opened: follow restores (the banner) and new versions; the first time, read the list and the last view,
   * offer "See N new changes" when an agent changed the deck since, then mark it viewed. Returns the detach, which drops
   * any preview and its docs.
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

  private versionRead = 0;

  private async begin(): Promise<void> {
    const read = ++this.versionRead;
    try {
      const [versions, lastViewedAt] = await Promise.all([this.api.versions(), this.api.lastViewedAt()]);
      if (read === this.versionRead) this.set({ versions });
      const base = newChangesBase(versions, lastViewedAt);
      if (base) {
        this.set({ pill: { since: base.since, count: null, failed: null } });
        void this.count(base.since);
      }
      await this.api.markViewed();
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  /** The slide the live editor shows: a preview opens on it when the state shown has it. */
  setLiveSlide(slideId: string | null): void {
    this.liveSlide = slideId;
  }

  /** Reads the list again (a previewed version's heading with it), and counts the new changes again if counting them failed. */
  async refresh(): Promise<ArtifactVersion[] | undefined> {
    const read = ++this.versionRead;
    let versions: ArtifactVersion[] | undefined;
    try {
      versions = await this.api.versions();
      if (read === this.versionRead) this.set({ versions, ...this.headingFrom(versions) });
    } catch (error) {
      if (read === this.versionRead) this.set({ error: message(error) });
    }
    if (this.snapshot.pill?.failed != null) await this.recount();
    return versions;
  }

  async recount(): Promise<void> {
    const pill = this.snapshot.pill;
    if (pill) await this.count(pill.since);
  }

  /** A row clicked: preview it against the version before it; with `extend` (shift-click), compare it with the selected one. */
  /** The time the rail names the list's days against: the wall clock (B's rail reads it; a deck's history has no clock of its own). */
  now = (): number => Date.now();

  select(versionId: number, { extend = false }: { extend?: boolean } = {}): Promise<void> {
    const [first] = this.snapshot.selected;
    if (extend && first !== undefined && first !== versionId) return this.open({ kind: 'compare', versionIds: [first, versionId] });
    return this.open({ kind: 'version', versionId });
  }

  /** P4-B4: whether the artifact retains the version with `versionId` (a link's `#v`): the list read, else read now. */
  async hasVersion(versionId: number): Promise<boolean> {
    const versions = this.snapshot.versions ?? (await this.api.versions());
    return versions.some((version) => version.id === versionId);
  }

  /** The pill: the live deck against the version at the last view. */
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

  setShowChanges(on: boolean): void {
    const preview = this.snapshot.preview;
    if (preview && preview.showChanges !== on) this.set({ preview: { ...preview, showChanges: on, focus: null } });
  }

  /** The stage shows another slide of the shown state (the filmstrip's click). */
  showSlide(slideId: string): void {
    const preview = this.snapshot.preview;
    if (preview && preview.slideId !== slideId) this.set({ preview: { ...preview, slideId, focus: null } });
  }

  /** ↓ (1) or ↑ (-1) through the changes, wrapping; the stage moves to the stop's slide. Returns the stop reached. */
  step(direction: 1 | -1): ChangeStop | null {
    const preview = this.snapshot.preview;
    if (!preview || preview.stops.length === 0) return null;
    const n = preview.stops.length;
    let focus: number;
    if (preview.focus !== null) focus = (preview.focus + direction + n) % n;
    else {
      // from the slide shown: the first stop on or after it (↓), the last before it (↑)
      const order = slideOrderOf(preview);
      const here = preview.slideId === null ? -1 : order.indexOf(preview.slideId);
      const at = (stop: ChangeStop) => (stop.slideId === null ? -1 : order.indexOf(stop.slideId));
      const after = preview.stops.findIndex((stop) => at(stop) >= here);
      focus = direction === 1 ? (after >= 0 ? after : 0) : ((after >= 0 ? after : n) - 1 + n) % n;
    }
    const stop = preview.stops[focus]!;
    this.set({ preview: { ...preview, focus, slideId: stop.slideId ?? preview.slideId } });
    return stop;
  }

  /** Back to the live deck; the owner has now seen it. */
  close(): void {
    this.load += 1;
    if (!this.loaded && !this.snapshot.loading && !this.snapshot.preview) return;
    this.loaded = null;
    this.set({ preview: null, selected: [], loading: false });
    void this.api.markViewed().catch((error: unknown) => this.set({ error: message(error) }));
  }

  /** The editor now draws `shown` (or the live deck, null): every other preview's docs can go. */
  applied(shown: Doc | null): void {
    for (const diff of this.diffs) {
      if (diff === this.loaded || diff.nextDoc === shown) continue;
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

  get canName(): boolean {
    return typeof this.api.nameVersion === 'function';
  }

  async name(label: string): Promise<boolean> {
    const versionId = this.snapshot.preview?.versionId;
    if (versionId == null || !this.api.nameVersion) return false;
    try {
      await this.api.nameVersion(versionId, { label });
      await this.refresh();
      this.set({ status: `Named “${label}”.` });
      return true;
    } catch (error) {
      this.set({ error: message(error) });
      return false;
    }
  }

  /** Restores the previewed version (a new `restore` version, conversations kept) and leaves history. */
  async restore(): Promise<void> {
    const versionId = this.snapshot.preview?.versionId;
    if (versionId == null) return;
    try {
      await this.api.restore(versionId);
      this.close();
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  async duplicate(): Promise<void> {
    const versionId = this.snapshot.preview?.versionId;
    if (versionId == null) return;
    try {
      await this.api.duplicate(versionId);
      this.set({ status: 'A copy of this version was made.' });
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  /** An actor key as the preview names and colours it (B's chips: "You", a session's title or "Claude"; `--author-N`). */
  author(key: string): { name: string; color: string; when(at: number | null): string } {
    const { name, color } = authorOf(key, this.api.sessionTitle?.bind(this.api));
    return { name, color, when: (at) => (at === null ? '' : formatWhen(at)) };
  }

  /** Show editors: who set a live element's keys and typed its text, and when, from provenance (older than a compaction too). */
  async editorsOf(slideId: string, elementId: string): Promise<ShownEditor[]> {
    const provenance = decodeMap(await this.api.attributions(0, LIVE));
    return elementEditors(this.handle.doc, slideId, elementId, provenance).map(({ who, at, kinds }) => {
      const author = authorOf(who, this.api.sessionTitle?.bind(this.api));
      return { key: who, name: author.name, color: author.color, at, when: formatWhen(at), kinds };
    });
  }

  // ── loading a preview ──
  private async open(target: DeckPreviewTarget): Promise<void> {
    const requestedAt = performance.now();
    const load = ++this.load;
    const selected = target.kind === 'version' ? [target.versionId] : target.kind === 'compare' ? [...target.versionIds] : [];
    this.set({ selected, loading: true, status: null, error: null });
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
        const shown = next;
        prev = versions.filter((v) => v.seq < shown.seq || (v.seq === shown.seq && v.id < shown.id)).sort((a, b) => b.seq - a.seq || b.id - a.id)[0] ?? null;
        title = versionHeading(next);
      } else if (target.kind === 'compare') {
        [prev, next] = target.versionIds.map(byId).sort((a, b) => a.seq - b.seq || a.id - b.id) as [ArtifactVersion, ArtifactVersion];
        title = `${versionTitle(prev)} → ${versionTitle(next)}`;
      } else {
        prev = target.versionId === null ? null : byId(target.versionId);
        next = null;
        title = 'Changes since you last looked';
      }
      const [prevState, nextState, attributions] = await Promise.all([
        prev ? this.api.versionState(prev.id) : Promise.resolve(null),
        next ? this.api.versionState(next.id) : Promise.resolve(stateV2(this.handle.doc)),
        this.api.attributions(prev?.seq ?? 0, next?.seq ?? LIVE),
      ]);
      if (load !== this.load) return;
      const diff = openDeckDiff({ prevState, nextState, attributions: decodeMap(attributions) });
      this.diffs.add(diff);
      const changes = deckChanges(diff);
      const stops = changeStops(changes);
      const order = slideOrder(diff.nextDoc);
      const slideId = this.liveSlide !== null && order.includes(this.liveSlide) ? this.liveSlide : (stops.find((s) => s.slideId !== null)?.slideId ?? order[0] ?? null);
      this.loaded = diff;
      this.set({
        loading: false,
        preview: {
          target,
          title,
          shown: diff.nextDoc,
          earlier: diff.prevDoc,
          showChanges: true,
          changes,
          stops,
          focus: (() => {
            const at = stops.findIndex((stop) => stop.slideId === slideId || stop.slideId === null);
            return at < 0 ? null : at;
          })(),
          slideId,
          system: next ? (next.designSystemRef ?? { builtin: 'maws' }) : null,
          versionId: target.kind === 'version' ? target.versionId : null,
          requestedAt,
          revision: next ? next.seq : null,
          earlierRevision: prev ? prev.seq : null,
          elementHistory: (earlier, shown) => elementHistory(diff, earlier, shown), // P3-E
        },
      });
    } catch (error) {
      if (load === this.load) this.set({ loading: false, error: message(error) });
    }
  }

  // A previewed version's heading as the list now names it (Name this version here, or a name given elsewhere), so it
  // reads as the version's row does; nothing when it reads the same.
  private headingFrom(versions: ArtifactVersion[]): Partial<DeckHistorySnapshot> {
    const preview = this.snapshot.preview;
    const target = preview?.target;
    const version = target?.kind === 'version' ? versions.find((v) => v.id === target.versionId) : undefined;
    if (!preview || !version || versionHeading(version) === preview.title) return {};
    return { preview: { ...preview, title: versionHeading(version) } };
  }

  // Counts the changes since the last view, headless; a failure is kept on the pill and logged (refresh retries).
  private async count(since: ArtifactVersion | null): Promise<void> {
    const current = () => {
      const pill = this.snapshot.pill;
      return pill && pill.since === since ? pill : null;
    };
    try {
      const [prevState, attributions] = await Promise.all([since ? this.api.versionState(since.id) : Promise.resolve(null), this.api.attributions(since?.seq ?? 0, LIVE)]);
      const diff = openDeckDiff({ prevState, nextState: stateV2(this.handle.doc), attributions: decodeMap(attributions) });
      let count: number;
      try {
        const changes = deckChanges(diff);
        count = this.options.countChanges ? this.options.countChanges(diff, changes) : changes.count; // P3-E: the hook's count when given
      } finally {
        diff.destroy();
      }
      const pill = current();
      if (!pill) return;
      const recovered = pill.failed !== null;
      this.set({ pill: count > 0 ? { ...pill, count, failed: null } : null, ...(recovered ? { error: null } : {}) });
    } catch (error) {
      const pill = current();
      if (!pill) return;
      this.api.log?.(`history: counting the changes since the last view failed: ${message(error)}`);
      this.set({ pill: { ...pill, count: null, failed: message(error) }, error: `Could not count the new changes: ${message(error)}` });
    }
  }

  private async restored(versionId: number): Promise<void> {
    if (this.snapshot.preview || this.snapshot.loading) this.close();
    // Use this read even when a concurrent refresh owns (or has replaced) the snapshot.
    const versions = (await this.refresh()) ?? this.snapshot.versions;
    const version = versions?.find((v) => v.id === versionId);
    this.set({ banner: version?.label ?? 'Restored from an earlier version' });
  }

  private set(change: Partial<DeckHistorySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}

/** The shown deck's slides in order, removed ones at their earlier place (the filmstrip's, the stops'). */
export function slideOrderOf(preview: Pick<DeckPreview, 'shown' | 'earlier' | 'changes'>): string[] {
  const after = slideOrder(preview.shown);
  const before = slideOrder(preview.earlier);
  const order = [...after];
  for (const [i, id] of before.entries()) {
    if (order.includes(id)) continue;
    if (!preview.changes.slides.some((s) => s.id === id && s.kind === 'removed')) continue;
    const prevKept = before.slice(0, i).reverse().find((s) => order.includes(s));
    order.splice(prevKept === undefined ? 0 : order.indexOf(prevKept) + 1, 0, id);
  }
  return order;
}
