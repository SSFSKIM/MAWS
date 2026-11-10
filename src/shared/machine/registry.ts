// The project registry's seams (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §H; its design
// §3): what a machine's services ask of its endpoint, in process (`RegistrySeam`), what the endpoint reads of the index
// (`ProjectsSource`), and what the daemon's front reads of the endpoint for `maws` (`RegistryRead`). Types only, and the
// seam's default: the index (src/services/index/) implements `ProjectsSource`, the endpoint (src/endpoint/) the other
// two, and `mawsd` wires them. Until it does, the services hold `NO_REGISTRY`: no stored statement is made, and a machine
// behaves as before the registry.
import type { RegistryProject } from 'org-protocol';
import type { ProjectOrg } from '@shared/ipc/schema/session';
import type { MachineRef } from './ref';

/**
 * The folder a stored statement was made on (design §2): its `st_dev`, `st_ino` and birth time in nanoseconds, each the
 * exact decimal of a 64-bit `stat`; `birth` is "0" where the filesystem reports none, never the change time (§D).
 */
export type Anchor = { dev: string; ino: string; birth: string };

/** Why the machine makes no stored statement now (§G's `statements-unavailable`). */
export type StatementsUnavailable = 'not-enrolled' | 'sminos-too-old' | 'endpoint-off';
export type StatementsState = { possible: true } | { possible: false; reason: StatementsUnavailable };

/** A declared row as the endpoint states it in the machine's projects record (§A's `ProjectLocation`, less `id` and `key`, which `org` carries). */
export type DeclaredRow = {
  pid: string; // the row's project id on this machine
  path: string; // the real path, NFC
  name: string; // the location's own name (§A)
  nameRev?: number;
  org: ProjectOrg; // `smnsId` is the rule's project; null for the machine's own
  stated?: 'minted' | 'linked'; // a stored statement decides its project, the row's own or one above it
  statedAt?: string; // where `stated`: the folder holding that statement (the row's own `path` for its own; §D's frame
  // carries `stated` and `anchor` only for a statement at that folder)
  hub?: false;
  remote?: string;
  state?: 'missing' | 'replaced';
};

/** A row's stored statement whole, as the endpoint keeps it to give a rebuilt index its statements back (§H). */
export type KeptStatement = { path: string; minted: string | null; linked: string | null; anchor: Anchor | null; name: string; nameRev: number | null; hidden: boolean };

/** What the machine's services ask of the endpoint, in process. */
export interface RegistrySeam {
  statements(): StatementsState;
  /** It changed; turning to possible is minting's moment (c) (§F.4). Answers the unsubscribe. */
  onStatements(listener: () => void): () => void;
  /** A project of the verified records: whether it is a hub project, and the highest `nameRev` they hold for it; null when none names it. */
  project(id: string): { hub: boolean; nameRev: number } | null;
  /** Whether a record of these rows keeps within §A's bounds. */
  fits(rows: readonly DeclaredRow[]): boolean;
  /** Resolves when sminos acknowledged the next locations frame, or after the endpoint's wait with `restated: false`. */
  published(): Promise<{ restated: boolean }>;
}

/** M8's default: no statement possible (`endpoint-off`), no project, everything fits, published at once unrestated. */
export const NO_REGISTRY: RegistrySeam = {
  statements: () => ({ possible: false, reason: 'endpoint-off' }),
  onStatements: () => () => {},
  project: () => null,
  fits: () => true,
  published: async () => ({ restated: false }),
};

/** What the endpoint reads of the index, in process. */
export interface ProjectsSource {
  /** Null while the index is not loaded or not available: unknown is not empty. */
  snapshot(): { indexId: string; rows: DeclaredRow[]; statements: KeptStatement[] } | null;
  /** Writes each statement to the row at its path, the row created when absent and hidden when the statement says so. */
  restore(statements: readonly KeptStatement[]): void;
  onChange(listener: () => void): () => void;
}

/** What the daemon's front reads of the endpoint, in process, for `maws` (§K); read on demand, its certificates verified. */
export interface RegistryRead {
  read(): Promise<{ enrolled: boolean; machine: { ref: MachineRef; name: string }; machines: Array<{ ref: MachineRef; name: string }>; projects: RegistryProject[] }>;
}
