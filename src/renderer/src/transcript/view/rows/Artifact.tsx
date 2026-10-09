// E2 (M5, Design §9): an `artifact_create` or `artifact_update` call's row. An artifact glyph and one line, "Artifact
// Dashboard · v1" or "Updated artifact Dashboard · v2" ("Registering artifact Dashboard…" until the result is in, no
// version when the result named none, "Could not register artifact Dashboard: <reason>" on a refusal); the console chip while the deliverables store holds
// what that version's frame logged (the store clears it whenever a frame for the version mounts, Decision Log 35); one
// quiet Open that shows the version in the Deliverables viewer. It stays in view when its turn folds (isPersistentRow).
import { ConsoleChip } from '../../../tools/deliverables/ConsoleChip';
import { ARTIFACT, artifactHeading } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useActions, useRowSession } from '../context';
import { ArtifactIcon } from './icons';

type ArtifactRow = Extract<Row, { kind: 'artifact' }>;

export function ArtifactRowView({ row }: { row: ArtifactRow }) {
  const actions = useActions();
  const rowSession = useRowSession();
  const appSessionId = row.ownerAppSessionId ?? rowSession; // P2-E1: a side thread's version of its ancestor's artifact is the ancestor's record
  const registered = row.error === null && row.deliverableId !== null && row.version !== null ? { id: row.deliverableId, version: row.version } : null;
  const state = row.error !== null ? 'error' : registered ? 'registered' : 'pending';
  return (
    <section className="transcript-artifact" data-artifact={row.artifactId} data-artifact-state={state}>
      <div className="transcript-artifact-top">
        <ArtifactIcon />
        <strong data-artifact-heading="">{artifactHeading(row)}</strong>
        {registered && (
          <span className="transcript-artifact-actions">
            {appSessionId !== null && <ConsoleChip appSessionId={appSessionId} deliverableId={registered.id} version={registered.version} />}
            <button type="button" className="transcript-quiet-button" disabled={appSessionId === null} onClick={() => appSessionId && actions.openDeliverable(appSessionId, registered.id, registered.version)}>
              {ARTIFACT.open}
            </button>
          </span>
        )}
      </div>
    </section>
  );
}
