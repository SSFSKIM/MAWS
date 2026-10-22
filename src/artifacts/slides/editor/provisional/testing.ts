// P4-A2 G2.3 (docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md, G-R1 to G-R5): what the deck layer's tests
// share. A replica stands in for the port provider as the layers read it: the host's provisional frames pass at once
// (they pass the hold, R4), a write's update is applied and `integrated` advanced in one call, and under the hold the
// updates wait and are applied at its release, the state listeners told in the same call, as `port.ts` does. A host doc
// beside the live one makes a publish's real update, so the swap applies what the host would send.
import type { ArtifactProvisional } from '@shared/artifacts/provisional';
import type { DocumentState } from '../../../host';
import { ProvisionalLayers, type ProvisionalSource } from '../../../provisional';
import { applyV1, diffV1, mergeUpdates, newDoc, stateVector, type Doc } from '../../../yjs';
import { DECK_PATH, serializeDeckJson, slidePath } from '../../deck';
import { deckFiles, readDeckJson, slideFile } from '../../model';
import { publishDeck } from '../../publish';

export interface Replica {
  source: ProvisionalSource;
  layers: ProvisionalLayers;
  /** A host frame, delivered at once (frames pass the hold). */
  frame(frame: ArtifactProvisional): void;
  /** The host's write: applied now (or at the hold's release), `integrated` advanced to `seq` in the same call. */
  update(update: Uint8Array, seq: number): void;
  /** The provider's hold: updates wait while it stands; its release applies them and tells the state listeners. */
  holdRemote(on: boolean): void;
  /** The connection lost (or back). */
  phase(phase: DocumentState['phase']): void;
}

export function replica(doc: Doc): Replica {
  let state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 0, integrated: 0, readOnly: false };
  const frames = new Set<(frame: ArtifactProvisional) => void>();
  const states = new Set<(state: DocumentState) => void>();
  let held = false;
  let buffer: { update: Uint8Array; seq: number }[] = [];
  const tell = (next: Partial<DocumentState>) => {
    state = { ...state, ...next };
    for (const listener of [...states]) listener(state);
  };
  const apply = (runs: { update: Uint8Array; seq: number }[]) => {
    applyV1(doc, mergeUpdates(runs.map((r) => r.update)), 'remote');
    tell({ integrated: Math.max(state.integrated, ...runs.map((r) => r.seq)) });
  };
  const source: ProvisionalSource = {
    onProvisional: (listener) => {
      frames.add(listener);
      return () => frames.delete(listener);
    },
    subscribe: (listener) => {
      states.add(listener);
      return () => states.delete(listener);
    },
    state: () => state,
  };
  const layers = new ProvisionalLayers(source);
  return {
    source,
    layers,
    frame: (frame) => frames.forEach((listener) => listener(frame)),
    update: (update, seq) => (held ? buffer.push({ update, seq }) : apply([{ update, seq }])),
    holdRemote: (on) => {
      held = on;
      if (on || buffer.length === 0) return;
      const runs = buffer;
      buffer = [];
      apply(runs);
    },
    phase: (phase) => tell({ phase }),
  };
}

/** A publish's frame: `files` as the host lists them (G-R1: only those that grew), in the agent's colour. */
export function publishFrame(toolUseId: string, state: ArtifactProvisional['state'], files: Readonly<Record<string, string>> = {}, commitSeq?: number): ArtifactProvisional {
  return {
    toolUseId: toolUseId as never,
    appSessionId: 's1' as never,
    artifactId: 'deck1',
    kind: 'presentation',
    state,
    ...(commitSeq !== undefined ? { commitSeq } : {}),
    at: 0,
    name: 'Fix the dates',
    color: '--author-3',
    ops: Object.entries(files).map(([path, text]) => ({ op: 'file' as const, path, text })),
  };
}

/**
 * A deck made by the agent's create (the publish), so its files read back as `artifact_read` returns them, with a copy
 * of it as the host holds it; `publish` writes the agent's files on the host and answers the update the replica gets.
 */
export function deckWorld(slides: Readonly<Record<string, string>>) {
  const doc = newDoc();
  const created = publishDeck(doc, {}, { [DECK_PATH]: JSON.stringify({ order: Object.keys(slides) }), ...Object.fromEntries(Object.entries(slides).map(([id, source]) => [slidePath(id), source])) }, false);
  if (created.conflicts.length) throw new Error('fixture');
  const host = newDoc();
  applyV1(host, diffV1(doc));
  return {
    doc,
    host,
    /** The slide's file as the agent read it. */
    file: (id: string) => slideFile(doc, id),
    /** The deck's index as the agent read it. */
    index: () => serializeDeckJson(readDeckJson(doc)),
    /** The agent's files written on the host; the update the replica will be sent. */
    publish(sent: Readonly<Record<string, string>>): Uint8Array {
      const before = stateVector(doc);
      const out = publishDeck(host, deckFiles(host), sent, false);
      if (out.conflicts.length) throw new Error(`refused: ${JSON.stringify(out.conflicts)}`);
      return diffV1(host, before);
    },
  };
}
