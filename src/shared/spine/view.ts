// Main's view of the spine (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §B; the O3
// document §7): the one interface through which code that stays in the app (the notifier, the quit guard, the chat
// panels, the interest report, the browser, connectors, the export authors, the org rows, Settings' reveal) and, until
// O3-E, the checkouts (files, `git.lsFiles`, scm) read the spine: records, both project sets, digests, attention with its
// restored marks in band, engine statuses, intents, the visible set, `acquire` and files' admission read. In process it
// is backed by the spine's own parts (src/services/sessions/spine-view.ts); at O3-D main backs it again by a mirror fed by
// mawsd's services front. The synchronous reads answer from memory in every backing; only `acquire` and
// `fileLinkedPaths` may cross a process. A reader declares the narrowest `Pick<SpineView, …>` it reads.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, AttentionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import type { AcquireReason } from '@shared/ipc/schema/session';
import type { SetupIntent } from '@shared/sessions/intent';
import type { AcquireOutcome } from '@shared/sessions/setup';

export interface SpineView {
  unavailable(): string | null; // null while the spine can be read; else why not
  record(appSessionId: AppSessionId): SessionRecord | null;
  records(): readonly SessionRecord[]; // every record, archived included; a record's lineage is its `lineage`
  projects(): readonly ProjectRecord[]; // as session.projects.list answers: visible, and removed ones marked hidden
  projectRows(): readonly ProjectRecord[]; // every project row the index holds, hidden or with no present session
  project(projectId: ProjectId): ProjectRecord | null; // among projectRows()
  digest(appSessionId: AppSessionId): SessionDigest | null;
  digests(): readonly SessionDigest[];
  attention(appSessionId: AppSessionId): readonly AttentionItem[];
  allAttention(): ReadonlyMap<AppSessionId, readonly AttentionItem[]>;
  engineStatuses(): readonly EngineSessionStatus[];
  midTurnCount(): number;
  intent(appSessionId: AppSessionId): SetupIntent | null;
  intents(): readonly SetupIntent[];
  known(appSessionId: AppSessionId): boolean; // a record or an intent
  visibleSessions(): readonly AppSessionId[]; // the sessions some client shows (session.setVisible's union)
  on<E extends keyof SpineViewEvents>(event: E, listener: SpineViewEvents[E]): () => void;
  acquire(appSessionId: AppSessionId, reason: AcquireReason): Promise<AcquireOutcome>;
  fileLinkedPaths(appSessionId: AppSessionId): Promise<string[]>; // files' admission; [] while unavailable (launch mode scenario's aside: its library is still the profile's)
}

export interface SpineViewEvents {
  availability: (unavailable: string | null) => void;
  record: (appSessionId: AppSessionId, record: SessionRecord | null) => void; // null: removed
  projects: () => void; // either project set may have changed; read them again
  digest: (digest: SessionDigest) => void;
  // `silent`: the ids among `items` the notifier must not announce (persisted items the attention service accepted at
  // its start, and owner-channel items it was told are silent; O3 §7's "restored marks in band")
  attention: (appSessionId: AppSessionId, items: readonly AttentionItem[], silent: ReadonlySet<AttentionId>) => void;
  engine: (appSessionId: AppSessionId, status: EngineSessionStatus | null) => void;
  intent: (appSessionId: AppSessionId, intent: SetupIntent | null) => void;
  visible: (appSessionId: AppSessionId, visible: boolean) => void;
}
