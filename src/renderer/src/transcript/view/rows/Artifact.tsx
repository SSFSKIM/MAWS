// E2 (M5, Design §9): an `artifact_create` or `artifact_update` call's row. An artifact glyph and one line, "Artifact
// Dashboard · v1" or "Updated artifact Dashboard · v2" ("Registering artifact Dashboard…" until the result is in, no
// version when the result named none, "Could not register artifact Dashboard: <reason>" on a refusal); the console chip while the console store holds
// what that version's frame logged (the store clears it whenever a frame for the version mounts, Decision Log 35); the
// heading itself is the press that shows the version in the panel's Artifacts tool (the word cut, T103: no worded Open;
// "Open" is the press's description) (P3-L M6b: the row's deliverable id is the artifact's,
// its version the n-th of the artifact's versions; fix wave 2: the revision the call wrote when its answer named it). It
// stays in view when its turn folds (isPersistentRow).
//
// UX wave U10b (M5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.4): an `artifact_delete` call's row.
// "Deleting <title>…" until the answer, then "Deleted <title>" with Undo, or "Could not delete <title>: <reason>" in the
// person's words. While the library of the session's machine lists the artifact again it reads "Restored <title>", the
// heading the press that opens it (T103): read, not remembered, so it holds after a relaunch, in a second window and after an Undo pressed elsewhere.
// Until that read has answered, Undo is drawn disabled. Why Undo is disabled, or what an Undo that ended without its
// effect said, is a line of the row under the heading. A host with no Undo (the desk) draws the heading alone.
import { useId, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactOpenAt } from '../../../artifacts/open-at';
import { useSessionArtifactListed, useSessionUndoUnavailable, useUndoAct } from '../../../library/undo-delete';
import { ArtifactVersionConsoleChip } from '../../../tools/artifacts/viewers/ConsoleChip';
import { ARTIFACT, artifactHeading } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useActions, useRowSession } from '../context';
import { ArtifactIcon } from './icons';

type ArtifactRow = Extract<Row, { kind: 'artifact' }>;

// The heading, which is the press that opens the artifact where it opens one: its name says where it leads, and Open is
// its description.
function Heading({ opens, disabled, children }: { opens: (() => void) | null; disabled: boolean; children: ReactNode }) {
  const describedBy = useId();
  if (opens === null) return <strong data-artifact-heading="">{children}</strong>;
  return (
    <>
      <button type="button" className="transcript-artifact-open" aria-describedby={describedBy} disabled={disabled} onClick={opens}>
        <strong data-artifact-heading="">{children}</strong>
      </button>
      <span id={describedBy} hidden>
        {ARTIFACT.open}
      </span>
    </>
  );
}

export function ArtifactRowView({ row }: { row: ArtifactRow }) {
  if (row.action === 'delete') return <DeleteRowView row={row} />; // UX wave U10b
  return <VersionRowView row={row} />;
}

function VersionRowView({ row }: { row: ArtifactRow }) {
  const actions = useActions();
  const rowSession = useRowSession();
  const appSessionId = row.ownerAppSessionId ?? rowSession; // P2-E1: a side thread's version of its ancestor's artifact opens in the ancestor's panel
  const registered = row.error === null && row.deliverableId !== null && row.version !== null ? { id: row.deliverableId, version: row.version } : null;
  // M6b fix wave 2: the version the call wrote, by its revision when the answer named it (stable whatever thinning does);
  // an older row's ordinal otherwise
  const at: ArtifactOpenAt | null = registered && (row.revision !== undefined ? { revision: row.revision } : { version: registered.version });
  const state = row.error !== null ? 'error' : registered ? 'registered' : 'pending';
  return (
    <section className="transcript-artifact" data-artifact={row.artifactId} data-artifact-state={state}>
      <div className="transcript-artifact-top">
        <ArtifactIcon />
        <Heading opens={registered && (() => appSessionId && actions.openArtifact(appSessionId, registered.id, at!))} disabled={appSessionId === null}>
          {artifactHeading(row)}
        </Heading>
        {registered && (
          <span className="transcript-artifact-actions">
            <ArtifactVersionConsoleChip artifactId={registered.id} at={at!} />
          </span>
        )}
      </div>
    </section>
  );
}

// UX wave U10b (M5, §C.4): the delete's row. Its controls read the library and the machine's standing only once the
// answer is in and the host offers Undo.
function DeleteRowView({ row }: { row: ArtifactRow }) {
  const actions = useActions();
  const rowSession = useRowSession();
  const appSessionId = row.ownerAppSessionId ?? rowSession;
  const state = row.error !== null ? 'error' : row.answered ? 'deleted' : 'pending';
  if (state === 'deleted' && actions.undeleteArtifact !== undefined) return <DeletedRow row={row} appSessionId={appSessionId} undelete={actions.undeleteArtifact} />;
  return (
    <section className="transcript-artifact" data-artifact={row.artifactId} data-artifact-action="delete" data-artifact-state={state}>
      <div className="transcript-artifact-top">
        <ArtifactIcon />
        <strong data-artifact-heading="">{artifactHeading(row)}</strong>
      </div>
    </section>
  );
}

function DeletedRow({ row, appSessionId, undelete }: { row: ArtifactRow; appSessionId: AppSessionId | null; undelete: NonNullable<ReturnType<typeof useActions>['undeleteArtifact']> }) {
  const actions = useActions();
  const listed = useSessionArtifactListed(appSessionId, row.artifactId);
  const unavailable = useSessionUndoUnavailable(appSessionId);
  const act = useUndoAct(() => (appSessionId === null ? Promise.resolve(null) : undelete(appSessionId, row.artifactId)));
  const name = row.title ?? row.artifactId;
  const restored = listed === true;
  // A disabled Undo says why; an act that ended without its effect says what it ended with (in the danger tone).
  const line = restored ? null : unavailable !== null ? { text: unavailable, tone: 'muted' } : act.failure !== null ? { text: act.failure, tone: 'danger' } : null;
  return (
    <section className="transcript-artifact" data-artifact={row.artifactId} data-artifact-action="delete" data-artifact-state={restored ? 'restored' : 'deleted'}>
      <div className="transcript-artifact-top">
        <ArtifactIcon />
        <Heading opens={restored ? () => appSessionId && actions.openArtifact(appSessionId, row.artifactId) : null} disabled={appSessionId === null}>
          {restored ? ARTIFACT.restored(name) : ARTIFACT.deleted(name)}
        </Heading>
        {!restored && (
          <span className="transcript-artifact-actions">
            <button type="button" className="transcript-quiet-button" disabled={appSessionId === null || listed === null || unavailable !== null || act.busy} onClick={act.press}>
              {ARTIFACT.undo}
            </button>
          </span>
        )}
      </div>
      {line && (
        <p className="transcript-artifact-line" data-tone={line.tone} data-artifact-line="">
          {line.text}
        </p>
      )}
    </section>
  );
}
