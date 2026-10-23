// What the history rail asks of its environment (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; X23 and
// X24 of the interface ledger): one artifact's versions, their states and provenance, and the owner's history actions.
// The renderer implements it over A's `artifacts.*` IPC and `ArtifactHost` in M8 (bound to one artifact); the tests and
// the harness page over an in-memory host (memory-history.ts).
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { TokenOverrides } from '../../meta';
import type { ContentMap, Doc } from '../../../yjs'; // P3-E
import type { ExtraChange } from '../../history'; // P3-E

export interface HistoryApi {
  /** Every retained version (`artifacts.versions`), in any order. */
  versions(): Promise<ArtifactVersion[]>;
  /** When the owner last viewed the artifact (`Artifact.lastViewedAt`), null if never. */
  lastViewedAt(): Promise<number | null>;
  /** The durable seen revision, independent of a version’s later metadata upgrade. */
  lastViewedSeq?(): Promise<number | null>;
  /** A version's V2 state (`ArtifactHost.versionState`). */
  versionState(versionId: number): Promise<Uint8Array>;
  /** The merged provenance of the rows in [fromSeq, toSeq], an encoded ContentMap (`ArtifactHost.attributions`). */
  attributions(fromSeq: number, toSeq: number): Promise<Uint8Array>;
  /** "Save version" (`artifacts.saveVersion`): a named version of the live state. */
  saveVersion(version: { label: string; note?: string }): Promise<{ versionId: number }>;
  /**
   * "Name this version" (`artifacts.nameVersion`, any version, §4.7): its label becomes `label`; `note` omitted keeps the
   * version's note, `null` clears it. Without it, naming is not offered.
   */
  nameVersion?(versionId: number, naming: { label: string; note?: string | null }): Promise<void>;
  /** Artifact-wide restore (`artifacts.restore`): `versionId` is the new `restore` version. */
  restore(versionId: number): Promise<{ revision: number; versionId: number }>;
  /** "Make a copy" of a version (`artifacts.duplicate {versionId}`): the new artifact. */
  duplicate(versionId: number): Promise<{ artifactId: string }>;
  /** The owner looked (`artifacts.markViewed`): an `auto` version first when the document moved, then the time. */
  markViewed(): Promise<void>;
  /**
   * The `--ds-*` values of a version's pinned design system (X28's `TokenOverrides` shape, through D's
   * `openDesignSystem(host, ref)` once it lands); without it the preview draws with the live tokens.
   */
  designTokens?(ref: { id: string; versionSeq: number }): Promise<TokenOverrides>;
  /** A session's title for its author chip; "Claude" without one (§4.7). */
  sessionTitle?(appSessionId: string): string | undefined;
  /** The clock (epoch ms) the list's days are named by (Today, Yesterday); the wall clock without it. */
  now?(): number;
  /** New versions exist (an automatic or turn version, another window's save or restore): the list re-reads. */
  onVersions?(listener: () => void): () => void;
  /**
   * P4 (tracker L274): the owner came back to the document while its editor stayed open (a panel closed and reopened,
   * the main region shown again from behind the panel), a look as the editor's first showing is: the rail offers the
   * agent's changes since the last look and records this one. A return that remounts the editor looks by itself.
   */
  onReturn?(listener: () => void): () => void;
  /** Where the rail logs a failure it shows (the surface's log). */
  log?(line: string): void;
  /**
   * P3-E (E2 M4; E's Decision Log 8 and 28): the changes of a comparison its tab bodies cannot show (a dashboard's
   * datasets), from its two states and their provenance, merged into the one list the pill, the bar and the paint use.
   * Absent for documents and decks: their history is unchanged.
   */
  extraChanges?(prevDoc: Doc, nextDoc: Doc, attributions: ContentMap): readonly ExtraChange[];
}
