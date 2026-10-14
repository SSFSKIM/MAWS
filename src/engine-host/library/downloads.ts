// An agent's finished download as a File artifact (the in-app browser spec of 2026-10-08 in the cua repository,
// "Downloads"; `maws.download.recorded`; P3-L's cutover, Decision Log 10): main saw a file an agent downloaded through
// cua complete in ~/Downloads and asks the session's engine host to record it. One `file` artifact per path and
// session, the file in place, titled with its name and created by the session that drove the browser (linked
// `created`), as `send_file`'s files are. The URL it came from is not kept (the entity has no field for it, and no
// surface showed it). The check and the create run in one chain per session, so two reports of one path (a retry, two
// windows) record it once.
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsDownloadRecorded } from '@shared/ipc/schema/maws';
import type { ArtifactStore } from '../documents/store';

const tails = new Map<string, Promise<unknown>>(); // per session: the last report's settling

// Runs `task` after every report queued before it for the session settled; a failed one releases the chain.
function chained<T>(appSessionId: string, task: () => Promise<T>): Promise<T> {
  const next = (tails.get(appSessionId) ?? Promise.resolve()).then(task, task);
  const tail = next.catch(() => {});
  tails.set(appSessionId, tail);
  void tail.then(() => {
    if (tails.get(appSessionId) === tail) tails.delete(appSessionId);
  });
  return next;
}

export function recordDownload(store: Pick<ArtifactStore, 'list' | 'create' | 'readCommitted' | 'files'>, download: MawsDownloadRecorded): Promise<'recorded' | 'duplicate'> {
  const { appSessionId, path, filename } = download;
  const actor: Actor = { kind: 'session', appSessionId: appSessionId as AppSessionId };
  return chained(appSessionId, async () => {
    const held = await store.readCommitted(() => store.list({ kind: 'file', appSessionId }).some((artifact) => artifact.linkedPath === path));
    if (held) return 'duplicate';
    // hashed now, streamed, so the create only records the digest and a large download never holds the event loop
    const { sha256, size } = await store.files.describeStreamed(path);
    await store.create({ kind: 'file', title: filename, content: { path, digest: { sha256, size } } }, actor);
    return 'recorded';
  });
}
