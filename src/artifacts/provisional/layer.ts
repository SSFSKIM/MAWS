// P4-A2 (X35, the editors' provisional layer; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2's four rules
// [binding]; the child's execution document R3, R4 and M5): the layers an editor draws over an open document, one per
// streaming artifact call, kept from the host's provisional frames on the document's port. A `streaming` frame replaces
// the call's layer (its text is cumulative), save a publish's files, which merge by path (G2's G-R1: each frame lists
// only the files that grew); `dropped` withdraws it at once, under a composition hold too (rule 3, R4);
// `committed` keeps it until the replica has integrated the write's row (`state().integrated >= commitSeq`, rule 2),
// checked at the frame and on every state change. The provider runs its state listeners in the same task as the row's
// application, the held row's included when the hold releases, so the layer goes in the task that puts the real text on
// the page: no paint shows neither, and none shows both. The layer is never written anywhere (rule 1); what it covers
// is the editor's (rule 4).
import { mergeProvisional, type ArtifactProvisional } from '@shared/artifacts/provisional';
import type { DocumentHandle } from '../host';

/** What the layers read of an open document: its provisional frames and its integration state. */
export type ProvisionalSource = Pick<DocumentHandle, 'onProvisional' | 'subscribe' | 'state'>;

const NONE: ReadonlyMap<string, ArtifactProvisional> = new Map();

export class ProvisionalLayers {
  private layers: ReadonlyMap<string, ArtifactProvisional> = NONE; // by tool use id, a new map on every change
  private readonly listeners = new Set<() => void>();

  constructor(private readonly source: ProvisionalSource) {}

  /**
   * Starts listening to the document; returns the stop, which also clears the layers. Separate from construction so a
   * React StrictMode remount (the app renders under it) stops and restarts the same store, as `HistoryController.attach`.
   */
  attach(): () => void {
    const offFrame = this.source.onProvisional((frame) => this.receive(frame));
    const offState = this.source.subscribe((state) => {
      if (this.layers === NONE) return; // nothing drawn: the person's keystrokes and acks cost the store nothing
      // a lost connection ends every stream on it (the host's frames come only over it; a reconnect's next frame draws
      // the layer again); a committed layer waits on, for the reconnect's step 2 carries its row
      if (state.phase === 'off') this.keep((layer) => layer.state === 'committed');
      this.integrate(state.integrated);
    });
    return () => {
      offFrame();
      offState();
      this.keep(() => false);
    };
  }

  /** The layers to draw, by tool use id, in the order their calls began; the same map until the next change. */
  get(): ReadonlyMap<string, ArtifactProvisional> {
    return this.layers;
  }

  /** Told once per change, synchronously (the editor redraws in the same task); returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private receive(frame: ArtifactProvisional): void {
    const id = frame.toolUseId as string;
    switch (frame.state) {
      case 'streaming':
        // a late tick after the commit is stale: the committed frame carries the batch whole
        if (this.layers.get(id)?.state !== 'committed') this.set(id, mergeProvisional(this.layers.get(id), frame));
        return;
      case 'committed':
        // kept until its row is integrated; a frame without its seq names no row to wait for, so it goes at once. A
        // replica that never drew the call (attached after its last tick, or reconnected since) draws nothing now
        // either: the real text is the next frame, and a layer for one paint before it would be a flash.
        if (!this.layers.has(id)) return;
        this.set(id, (frame.commitSeq ?? 0) > this.source.state().integrated ? mergeProvisional(this.layers.get(id), frame) : null);
        return;
      case 'dropped':
        this.set(id, null);
        return;
    }
  }

  // Withdraws every committed layer whose row the replica has integrated.
  private integrate(integrated: number): void {
    this.keep((layer) => layer.state !== 'committed' || (layer.commitSeq ?? 0) > integrated);
  }

  // The call's layer replaced in its place (or added last), or withdrawn when `layer` is null.
  private set(id: string, layer: ArtifactProvisional | null): void {
    if (layer === null && !this.layers.has(id)) return;
    const next = new Map(this.layers);
    if (layer) next.set(id, layer);
    else next.delete(id);
    this.commit(next);
  }

  private keep(predicate: (layer: ArtifactProvisional) => boolean): void {
    const next = new Map([...this.layers].filter(([, layer]) => predicate(layer)));
    if (next.size !== this.layers.size) this.commit(next);
  }

  private commit(next: Map<string, ArtifactProvisional>): void {
    this.layers = next.size === 0 ? NONE : next;
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * The path of the layer's file still streaming, or null (G-R1): a JSON object's members stream one after another, so
 * while the layer streams every file but the last is whole and the last is open; at the commit all are whole.
 */
export function openFile(layer: ArtifactProvisional): string | null {
  if (layer.state !== 'streaming') return null;
  const files = layer.ops.filter((op) => op.op === 'file');
  return files[files.length - 1]?.path ?? null;
}
