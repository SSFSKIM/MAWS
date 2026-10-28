// What authorization reads about the machine's sessions and checkouts (O10 M5; Interfaces §G), through two injected
// sources: M5 defines them and decides over them, M6 fills them from RL10 (the records from sminos's `member` frames, the
// checkouts from each project's `machine` presence), and O3 adds MAWS's projects to the checkouts. Until a source is
// filled it holds nothing, so every session is one the caller holds no rank on, and no checkout is known: closed.

/**
 * A session as authorization addresses it: lane A by the engine's session id, which sminos keys its records by; lane B
 * by the engine's session id too (the record's key), reached from MAWS's `appSessionId` through `session.status`.
 */
export type SessionTarget = { lane: 'A'; session: string } | { lane: 'B'; session: string; appSessionId: string };

/** RL §6.2's general access level; absent means `listed`. */
export type Access = 'private' | 'listed' | 'org-view' | 'org-converse';
/** An individual share (RL §6.2): a member at `view`, `converse` or `approve`. */
export type Share = { member: string; grade: 'view' | 'converse' | 'approve' };

/**
 * A session's machine-held record (RL6), as far as authorization reads it. `owners` are member ids and `@machine`, which
 * stands for the machine's owners in the head at the time of asking (RL §5.8). M6's `member` frame carries more
 * (provenance, project, state, title); this is the part every decision here rests on.
 */
export interface SessionRecord {
  session: string;
  lane: 'A' | 'B';
  owners: readonly string[];
  access?: Access;
  shares?: readonly Share[];
  /** Lane A: the bridge's per-process id, opaque; absent with no bridge (M7 refuses a lane A act without one). */
  launch?: string;
}

export interface RecordSource {
  /** The session's record, or null when this machine holds none for it (then nobody holds a rank on it). */
  record(target: SessionTarget): SessionRecord | null;
  /** A record changed or left (M8 re-evaluates subscriptions on it). */
  onChange(listener: (target: SessionTarget) => void): () => void;
}

export interface CheckoutSource {
  /** Whether `path` is a checkout this machine knows (a remote spawn runs only in one). */
  known(path: string): boolean;
}

export const NO_RECORDS: RecordSource = { record: () => null, onChange: () => () => {} };
export const NO_CHECKOUTS: CheckoutSource = { known: () => false };

/** The machine's own owners, as `@machine` resolves (RL §5.8). */
export const MACHINE_OWNERS = '@machine';
