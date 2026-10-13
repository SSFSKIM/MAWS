// An in-memory `HistoryApi` over the in-memory document host (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md),
// for the editor's tests and the harness page: provenance as A's store writes it (one attribution map per update the
// host applies, credited to the connection's actor, times floored to the minute), versions as V2 states of the host doc
// at a revision, and the owner's actions as A's host performs them as far as an editor can observe: Save version,
// restore (an `auto` version first when the document moved, the revert since the version keeping conversations
// through the document adapter's `revertScope`, a `restore` version "Restored from …", then `restored` to every
// replica), Make a copy (recorded), markViewed (an `auto` version when the document moved, then the time). Portable.
import { actorKey, type Actor } from '@shared/artifacts/actor';
import type { ArtifactVersion } from '@shared/artifacts/version';
import { applyV2, attributionMap, carryAttribution, contentIdsOf, encodeMap, mergeMaps, newDoc, revertUpdate, stateV2, type Carry, type ContentMap } from '../../../yjs';
import { revertScope } from '../../adapter';
import type { TokenOverrides } from '../../meta';
import type { MemoryDocumentHost } from '../memory-host';
import type { HistoryApi } from './api';

const HUMAN: Actor = { kind: 'human' };
const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

interface Stored extends ArtifactVersion {
  state: Uint8Array;
}

export interface MemoryHistoryOptions {
  /** The clock (epoch ms) rows and versions are timed by. */
  now?: () => number;
  /** Titles of the sessions acting on the document. */
  sessionTitles?: Record<string, string>;
  /** Each pinned design-system revision's tokens, keyed `<id>@<versionSeq>`. */
  designTokens?: Record<string, TokenOverrides>;
}

export class MemoryHistory implements HistoryApi {
  /** The artifacts "Make a copy" made, by the version each copied. */
  readonly copies: number[] = [];
  viewedAt: number | null = null;
  private readonly rows: Array<{ seq: number; map: ContentMap }> = [];
  private readonly stored: Stored[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly offLanded: () => void;
  private readonly now: () => number;

  constructor(
    private readonly host: MemoryDocumentHost,
    private readonly options: MemoryHistoryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.offLanded = host.onLanded(({ update, actor, revision }) => {
      const key = actorKey(actor);
      this.rows.push({ seq: revision, map: attributionMap(contentIdsOf(update), { insertActor: key, deleteActor: key, at: this.now() }) });
    });
    if (options.designTokens) this.designTokens = async (ref) => options.designTokens?.[`${ref.id}@${ref.versionSeq}`] ?? {};
  }

  /** A version of the host doc as it is now (what A's store writes at idle, a turn's end, a save or a restore). */
  version(kind: ArtifactVersion['kind'], actor: Actor = HUMAN, fields: Partial<Pick<ArtifactVersion, 'label' | 'note' | 'summary' | 'designSystemRef'>> = {}): ArtifactVersion {
    const version: Stored = { id: this.stored.length + 1, seq: this.host.revision, at: this.now(), actor, kind, assetRefs: [], ...fields, state: stateV2(this.host.doc) };
    this.stored.push(version);
    this.notify();
    return strip(version);
  }

  /** The last update's attribution with a batch's carries applied, as A's attribution step does after `afterUpdate`. */
  carryLast(carries: Carry[]): void {
    const row = this.rows[this.rows.length - 1];
    if (row) row.map = carryAttribution(row.map, mergeMaps(this.rows.slice(0, -1).map((r) => r.map)), carries);
  }

  destroy(): void {
    this.offLanded();
    this.listeners.clear();
  }

  // ── HistoryApi ──
  designTokens?: HistoryApi['designTokens'];

  sessionTitle = (appSessionId: string): string | undefined => this.options.sessionTitles?.[appSessionId];

  async versions(): Promise<ArtifactVersion[]> {
    return this.stored.map(strip);
  }

  async lastViewedAt(): Promise<number | null> {
    return this.viewedAt;
  }

  async versionState(versionId: number): Promise<Uint8Array> {
    return this.get(versionId).state;
  }

  async attributions(fromSeq: number, toSeq: number): Promise<Uint8Array> {
    return encodeMap(mergeMaps(this.rows.filter((row) => row.seq >= fromSeq && row.seq <= toSeq).map((row) => row.map)));
  }

  async saveVersion({ label, note }: { label: string; note?: string }): Promise<{ versionId: number }> {
    return { versionId: this.version('named', HUMAN, { label, ...(note ? { note } : {}) }).id };
  }

  async restore(versionId: number): Promise<{ revision: number; versionId: number }> {
    const target = this.get(versionId);
    this.autoVersion();
    const old = newDoc();
    applyV2(old, target.state);
    const update = revertUpdate(target.state, stateV2(this.host.doc), revertScope(this.host.doc, old).keep);
    old.destroy();
    this.host.write((doc) => applyV2(doc, update));
    const restored = this.version('restore', HUMAN, { label: `Restored from ${target.label ?? WHEN.format(target.at)}` });
    this.host.announceRestored(restored.id);
    return { revision: this.host.revision, versionId: restored.id };
  }

  /** The names given to versions through `nameVersion`, as sent. */
  readonly namings: Array<{ versionId: number; label: string; note?: string | null }> = [];

  async nameVersion(versionId: number, naming: { label: string; note?: string | null }): Promise<void> {
    const version = this.get(versionId);
    this.namings.push({ versionId, ...naming });
    version.label = naming.label;
    if (naming.note === null) delete version.note;
    else if (naming.note !== undefined) version.note = naming.note;
    this.notify();
  }

  async duplicate(versionId: number): Promise<{ artifactId: string }> {
    this.get(versionId);
    this.copies.push(versionId);
    return { artifactId: `copy-${this.copies.length}` };
  }

  async markViewed(): Promise<void> {
    this.autoVersion();
    this.viewedAt = this.now();
  }

  onVersions(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private autoVersion(): void {
    const last = this.stored[this.stored.length - 1];
    if (!last || last.seq < this.host.revision) this.version('auto');
  }

  private get(versionId: number): Stored {
    const version = this.stored.find((stored) => stored.id === versionId);
    if (!version) throw new Error(`no version ${versionId}`);
    return version;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function strip(stored: Stored): ArtifactVersion {
  const version: Partial<Stored> = { ...stored };
  delete version.state;
  return version as ArtifactVersion;
}
