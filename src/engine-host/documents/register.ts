// The engine host's `artifacts.*` and `spaces.*` surface (X23; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4):
// one handler per host-owned command over the artifact store, the store's change feed as `artifacts.changed` and
// `spaces.changed`, and the document ports main posts on the parent port (Decision Log 13), attached to the document
// service under the actor main names. Every write a command makes is the human's: only main and the app window reach
// this surface, and an agent's writes come through the tools (M6) as its session.
//
// Every command is answered from the store once its write has committed (the `immediate` deadline shape of
// `ipc.ts`), so none can outlive the bridge's 10 s router timeout. An answer that carries store state (a row, a
// revision, versions, bytes) is read through `store.readCommitted`: the reads share the batch's connection, so the
// answer waits for any batch open at the read to commit and fails with it (Decision Log 33). A refusal the store
// names is a `HostCommandError` whose `issues` is an `ArtifactRefusal` (schema/artifacts.ts); a store that failed to
// open answers `unavailable`; a refusal waits for the batch its validation read the same way (`writeCommitted`).
import { join } from 'node:path';
import { HostCommandError, type HostClientHooks, type HostEmit, type HostOn } from '@shared/host/runtime';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { isDocKind, type Space } from '@shared/artifacts/entity';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { ArtifactRefusal, ArtifactRow, commands as ArtifactCommands } from '@shared/ipc/schema/artifacts';
import type { commands as SpaceCommands } from '@shared/ipc/schema/spaces';
import type { DeadlineShape } from '../ipc';
import { ArtifactFiles } from './bytes';
import { ArtifactStoreError, StoreTooNewError } from './errors';
import { SuggestionError } from '@artifacts/yjs';
import { LoopDelaySampler } from './loop-delay'; // P3-F L158
import { fromMessagePortMain } from './ports';
import { suggestionKey, type DocumentService } from './service';
import type { Documents } from '.';
import type { ArtifactStore, ByteContent } from './store';
import { datasetReaderOf } from '../dashboards/read'; // P3-E
import { datasetFilesOf } from '../dashboards/file-sources'; // WR 67
import { ConnectionHolds } from '../dashboards/holds'; // E3
import type { DatasetRefreshRequests } from '../connectors/dataset-requests'; // E3

type HostArtifactCommand = Exclude<keyof typeof ArtifactCommands, 'artifacts.open' | 'artifacts.export' | 'artifacts.downloadAsset' /* P3-E: main's */ | 'artifacts.connectorGrants' | 'artifacts.grantConnectorTool' | 'artifacts.revokeConnectorTool' /* P3-H H3b: main's */ | 'artifacts.holdDatasets' | 'artifacts.releaseDatasets' /* E3: main's */> | keyof typeof SpaceCommands;

export const ARTIFACTS_DEADLINE_SHAPES: Record<HostArtifactCommand, DeadlineShape> = {
  'artifacts.list': 'immediate', 'artifacts.get': 'immediate', 'artifacts.create': 'immediate', 'artifacts.update': 'immediate',
  'artifacts.delete': 'immediate', 'artifacts.duplicate': 'immediate', 'artifacts.search': 'immediate', 'artifacts.versions': 'immediate',
  'artifacts.saveVersion': 'immediate', 'artifacts.nameVersion': 'immediate', 'artifacts.restore': 'immediate', 'artifacts.markViewed': 'immediate', 'artifacts.pruneVersions': 'immediate',
  'artifacts.versionState': 'immediate', 'artifacts.attributions': 'immediate', 'artifacts.acceptSuggestion': 'immediate', 'artifacts.rejectSuggestion': 'immediate', 'artifacts.uploadAsset': 'immediate', 'artifacts.copyAsset': 'immediate' /* P3-C */, 'artifacts.readDataset': 'immediate' /* P3-E */, 'artifacts.testLoopDelay': 'immediate',
  'artifacts.setDefaults': 'immediate', 'artifacts.content': 'immediate', 'artifacts.state': 'immediate', 'artifacts.assets': 'immediate', 'artifacts.status': 'immediate', 'artifacts.testWrite': 'immediate',
  'artifacts.captureDatasetState': 'immediate', 'artifacts.holdAssets': 'immediate', 'artifacts.releaseAssets': 'immediate', 'artifacts.datasetRefreshRequest': 'immediate', // E3
  'artifacts.datasetFiles': 'immediate', 'artifacts.rereadDatasetFile': 'immediate', // WR 67
  'spaces.list': 'immediate', 'spaces.create': 'immediate', 'spaces.update': 'immediate', 'spaces.delete': 'immediate',
};

export interface ArtifactsSurfaceDeps {
  documents: Documents | null; // null: the store failed to open this run (`openDocuments` logged why)
  env: Record<string, string | undefined>; // MAWS_E2E=1 opens the test writer and the loop delay
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the host's registry of agents' dataset refreshes,
  // which main reads a pending request from. Absent only where the host runs no sessions' tools (a test of this surface
  // alone): every request then reads null.
  datasetRefresh?: Pick<DatasetRefreshRequests, 'read'>;
}

const HUMAN: Actor = { kind: 'human' };

function refused(reason: ArtifactRefusal['reason'], message: string, data: Record<string, unknown> = {}, code: 'invalid_input' | 'internal' = 'invalid_input'): HostCommandError {
  return new HostCommandError(ipcError(code, message, { reason, data } satisfies ArtifactRefusal));
}

// The store's typed refusals as the caller sees them; anything else stays the runtime's `internal`.
function typed(error: unknown): unknown {
  if (error instanceof ArtifactStoreError) return refused(error.code, error.message, error.data);
  if (error instanceof StoreTooNewError) return refused('storeTooNew', error.message, {}, 'internal');
  return error;
}

// E3: `onClientGone` releases the holds main's connection took (its absence: a test's surface, holds released at close)
export function registerArtifacts(on: HostOn, emit: HostEmit, client: Pick<HostClientHooks, 'onDocPort'> & Partial<Pick<HostClientHooks, 'onClientGone'>>, { documents, env, datasetRefresh }: ArtifactsSurfaceDeps): { close(): void } {
  const e2e = env.MAWS_E2E === '1';
  const loopDelay = e2e ? new LoopDelaySampler() : null; // P3-F L158: its own timer, started at the first read

  const storeOf = (): ArtifactStore => {
    if (!documents) throw refused('unavailable', 'the artifact store could not be opened this run', {}, 'internal');
    return documents.store;
  };
  const e2eOnly = (name: string) => {
    if (!e2e) throw new HostCommandError(ipcError('internal', `${name} answers only when the engine host runs under MAWS_E2E=1`));
  };
  // A handler whose store refusals reach the caller typed, each released only after the batch its validation may have
  // read (`store.writeCommitted`; a read's own refusal already waits in `readCommitted`).
  const serve = <N extends HostArtifactCommand>(name: N, handler: (input: CommandInput<N>) => CommandOutput<N> | Promise<CommandOutput<N>>) =>
    on(name, async (input) => {
      try {
        const run = async () => handler(input);
        return await (documents ? documents.store.writeCommitted(run) : run());
      } catch (error) {
        throw typed(error);
      }
    });
  const row = (store: ArtifactStore, artifactId: string, includeDeleted = false): ArtifactRow | null => {
    const artifact = store.get(artifactId, { includeDeleted });
    return artifact && { ...artifact, revision: store.revision(artifactId) };
  };
  const required = (store: ArtifactStore, artifactId: string): ArtifactRow => {
    const found = row(store, artifactId);
    if (!found) throw new ArtifactStoreError('notFound', `no artifact ${artifactId}`);
    return found;
  };
  const requiredSpace = (store: ArtifactStore, spaceId: string): Space => {
    const found = store.getSpace(spaceId);
    if (!found) throw new ArtifactStoreError('notFound', `no space ${spaceId}`);
    return found;
  };
  // P3-E (docs/doperpowers/plans/2026-10-16-p3-e-design-dashboard.md Decision Log 11 (1); E1's M2): before a live read
  // that answers from a document, an earlier build's shape is migrated by the human (`ArtifactStore.ensureMigrated`),
  // or the read is refused naming why; a kind without the hook goes on at once.
  const prepared = async (store: ArtifactStore, artifactId: string) => {
    const kind = store.get(artifactId)?.kind;
    if (kind && isDocKind(kind) && store.service.adapterFor(kind)?.migrate) await store.ensureMigrated(artifactId, HUMAN);
  };
  // A write's answer: the row as it stands, read once the write committed, released after any batch open at that read.
  const written = (store: ArtifactStore, artifactId: string) => store.readCommitted(() => ({ artifact: required(store, artifactId) }));

  serve('artifacts.list', ({ filter }) => {
    const store = storeOf();
    return store.readCommitted(() => ({ artifacts: store.list(filter).map((artifact) => ({ ...artifact, revision: store.revision(artifact.id) })) }));
  });
  serve('artifacts.get', async ({ artifactId, includeDeleted, prepare = true }) => {
    const store = storeOf();
    // P3-E: main's open preflight, so a document that cannot be opened is refused by name; `prepare: false` (Decision Log
    // 22) is a retained version's reader, which never touches the live document
    if (prepare) await prepared(store, artifactId);
    return store.readCommitted(() => ({ artifact: row(store, artifactId, includeDeleted) }));
  });
  serve('artifacts.create', async ({ content, ...input }) => {
    const store = storeOf();
    const byteContent: ByteContent | undefined = content && ('bytes' in content ? { bytes: content.bytes, name: content.name } : { path: content.path }); // F (L139): the store hashes a file once the create is checked
    const artifact = await store.create({ ...input, content: byteContent }, HUMAN);
    return written(store, artifact.id);
  });
  serve('artifacts.update', async ({ artifactId, ...change }) => {
    const store = storeOf();
    await store.update(artifactId, change);
    return written(store, artifactId);
  });
  serve('artifacts.delete', async ({ artifactId }) => {
    await storeOf().delete(artifactId);
  });
  serve('artifacts.duplicate', async ({ artifactId, versionId }) => {
    const store = storeOf();
    const copy = await store.duplicate(artifactId, { versionId }, HUMAN);
    return written(store, copy.id);
  });
  serve('artifacts.search', ({ query }) => {
    const store = storeOf();
    return store.readCommitted(() => ({ artifacts: store.list({ query }).map((artifact) => ({ ...artifact, revision: store.revision(artifact.id) })) }));
  });
  serve('artifacts.versions', ({ artifactId }) => {
    const store = storeOf();
    return store.readCommitted(() => {
      required(store, artifactId);
      return { versions: store.listVersions(artifactId) };
    });
  });
  serve('artifacts.saveVersion', async ({ artifactId, label, note }) => {
    const versionId = await storeOf().createVersion(artifactId, { kind: 'named', actor: HUMAN, label, note });
    if (versionId === null) throw new Error(`no version of ${artifactId} was written`); // only an `auto` finds nothing to write
    return { versionId };
  });
  serve('artifacts.nameVersion', async ({ artifactId, versionId, label, note }) => {
    const store = storeOf();
    await store.nameVersion(artifactId, versionId, { label, note });
    return store.readCommitted(() => {
      const version = store.versions.version(artifactId, versionId);
      if (!version) throw new ArtifactStoreError('notFound', `no version ${versionId} of ${artifactId}`);
      return { version };
    });
  });
  serve('artifacts.restore', ({ artifactId, versionId }) => storeOf().restore(artifactId, versionId, HUMAN));
  serve('artifacts.markViewed', async ({ artifactId }) => {
    await storeOf().markViewed(artifactId);
  });
  serve('artifacts.pruneVersions', async ({ artifactId, olderThan }) => ({ removed: await storeOf().pruneVersions(artifactId ?? null, olderThan) }));
  serve('artifacts.versionState', ({ artifactId, versionId, seq }) => {
    const store = storeOf();
    return store.readCommitted(() => ({ bytes: store.versionState(artifactId, versionId ?? { seq: seq! }) }));
  });
  serve('artifacts.attributions', ({ artifactId, fromSeq, toSeq, doc }) => {
    const store = storeOf();
    return store.readCommitted(() => {
      required(store, artifactId);
      return { bytes: store.attributions(doc === 'suggestions' ? suggestionKey(artifactId) : artifactId, fromSeq, toSeq) };
    });
  });
  // Decision Log 45: the human accepts or rejects proposals of a document kind; a range the plan refuses is `invalid`.
  const settle = (artifactId: string, settled: (service: DocumentService) => Promise<number>) => {
    const store = storeOf();
    const artifact = required(store, artifactId);
    if (!isDocKind(artifact.kind)) throw new ArtifactStoreError('invalid', `a ${artifact.kind} artifact has no suggestions`, { kind: artifact.kind });
    let pending: Promise<number>;
    try {
      pending = settled(store.service);
    } catch (error) {
      pending = Promise.reject(error);
    }
    return pending.then(
      (revision) => ({ revision }),
      (error: unknown) => {
        throw error instanceof SuggestionError ? new ArtifactStoreError('invalid', error.message, error.data) : error;
      },
    );
  };
  serve('artifacts.acceptSuggestion', ({ artifactId, ranges }) => settle(artifactId, (service) => service.acceptSuggestion(artifactId, ranges, HUMAN)));
  serve('artifacts.rejectSuggestion', ({ artifactId, ranges }) => settle(artifactId, (service) => service.rejectSuggestion(artifactId, ranges, HUMAN)));
  serve('artifacts.uploadAsset', ({ artifactId, name, mime, bytes }) => storeOf().uploadAsset(artifactId, bytes, { name, mime }, HUMAN));
  serve('artifacts.copyAsset', ({ from, ref, to }) => storeOf().copyAsset(from, ref, to, HUMAN)); // P3-C (Decision Log 25)
  // P3-E (E2 M2): a page of a dataset snapshot by its immutable ref and format, ownership checked on every call
  serve('artifacts.readDataset', ({ artifactId, ref, format, offset, limit }) => {
    const store = storeOf();
    return store.readCommitted(() => datasetReaderOf(store).read(artifactId, ref, { format, offset, limit }));
  });
  serve('artifacts.datasetFiles', ({ artifactId }) => datasetFilesOf(storeOf()).check(artifactId));
  serve('artifacts.rereadDatasetFile', ({ artifactId, id, baseRevision }) => datasetFilesOf(storeOf()).reread(artifactId, id, baseRevision));
  serve('artifacts.testLoopDelay', ({ reset }) => {
    e2eOnly('artifacts.testLoopDelay');
    return loopDelay!.read({ reset });
  });
  serve('artifacts.setDefaults', ({ owner, spaces }) => storeOf().setDefaults({ owner, spaces }));
  // A retained version pinned to a since-deleted design system still renders with that system's faces and images
  // (Decision Log 46, X29): a deleted artifact's files answer for a named revision, never `live`, while any retained
  // version pins it; otherwise a deleted artifact is not found.
  const servable = (store: ArtifactStore, artifactId: string, revision: number | undefined): ArtifactRow => {
    const entity = store.entity(artifactId);
    if (entity && entity.deletedAt !== null && revision !== undefined && store.versions.pinsSystem(artifactId)) return row(store, artifactId, true)!;
    return required(store, artifactId);
  };
  serve('artifacts.content', ({ artifactId, revision, path }) => {
    const store = storeOf();
    return store.readCommitted(() => {
      const { kind } = servable(store, artifactId, revision);
      if (path !== undefined && path.startsWith('assets/')) {
        const asset = store.listAssets(artifactId).find((candidate) => candidate.ref === path);
        if (!asset) throw new ArtifactStoreError('notFound', `no asset ${path} in ${artifactId}`);
        return { revision: store.revision(artifactId), kind, name: asset.name, size: asset.size, sha256: asset.sha256, path: join(store.files.dirOf(artifactId), ArtifactFiles.assetPath(asset.sha256)) };
      }
      const content = store.contentRef(artifactId, revision);
      if (path !== undefined && path !== content.ref.name) throw new ArtifactStoreError('notFound', `no file ${path} in ${artifactId} at revision ${content.revision}`);
      return { revision: content.revision, kind, name: content.ref.name, size: content.ref.size, sha256: content.ref.sha256, path: content.path };
    });
  });
  serve('artifacts.assets', ({ artifactId, versionId }) => {
    const store = storeOf();
    return store.readCommitted(() => {
      required(store, artifactId);
      // P4 (W1, L245 and L160): a version's listing is what it pinned
      const pinned = versionId === undefined ? null : new Set(JSON.parse(store.requireVersion(artifactId, versionId).assetRefs) as string[]);
      const assets = pinned ? store.listAssets(artifactId).filter((asset) => pinned.has(asset.assetId)) : store.listAssets(artifactId);
      return { assets: assets.map(({ ref, name, mime, size }) => ({ ref, name, mime, size })) };
    });
  });
  serve('artifacts.state', async ({ artifactId }) => {
    const store = storeOf();
    await prepared(store, artifactId); // P3-E: the live state is the kind's model
    return store.readCommitted(() => {
      const { kind } = required(store, artifactId);
      if (!isDocKind(kind)) throw new ArtifactStoreError('invalid', `a ${kind} artifact has no document state`);
      const { revision, state } = store.service.readState(artifactId);
      return { revision, bytes: state };
    });
  });
  // E3 start: main's holds over snapshot bytes (src/engine-host/dashboards/holds.ts), its connection's alone
  const holds = new ConnectionHolds();
  const stopGone = client.onClientGone?.(() => holds.releaseAll());
  serve('artifacts.captureDatasetState', async ({ artifactId, versionId }) => {
    const store = storeOf();
    if (versionId === undefined) await prepared(store, artifactId); // the live state is the kind's model, as `artifacts.state`'s
    return holds.capture(store, artifactId, versionId);
  });
  serve('artifacts.holdAssets', async ({ artifactId, refs }) => ({ assetHoldId: await holds.hold(storeOf(), artifactId, refs) }));
  serve('artifacts.releaseAssets', ({ assetHoldId }) => ({ released: holds.release(assetHoldId) }));
  // E3: an agent's pending dataset refresh, as main reads it once its id was announced (main-only)
  serve('artifacts.datasetRefreshRequest', ({ requestId }) => ({ request: datasetRefresh?.read(requestId) ?? null }));
  // E3 end
  serve('artifacts.status', () => {
    if (!documents) return { status: 'unavailable' as const, reason: 'the artifact store could not be opened this run (the host log says why)' };
    return { status: documents.storage.status, reason: documents.storage.statusReason };
  });
  serve('artifacts.testWrite', ({ artifactId, opId, ops, appSessionId }) => {
    e2eOnly('artifacts.testWrite');
    return storeOf().testWrite(artifactId, opId, ops, appSessionId ? { kind: 'session', appSessionId: appSessionId as AppSessionId } : HUMAN);
  });
  serve('spaces.list', () => {
    const store = storeOf();
    return store.readCommitted(() => ({ spaces: store.listSpaces() }));
  });
  serve('spaces.create', async (input) => {
    const store = storeOf();
    const { id } = await store.createSpace(input);
    return store.readCommitted(() => ({ space: requiredSpace(store, id) }));
  });
  serve('spaces.update', async ({ spaceId, ...change }) => {
    const store = storeOf();
    await store.updateSpace(spaceId, change);
    return store.readCommitted(() => ({ space: requiredSpace(store, spaceId) }));
  });
  serve('spaces.delete', async ({ spaceId }) => {
    await storeOf().deleteSpace(spaceId);
  });

  const offs: (() => void)[] = [];
  if (documents) {
    offs.push(documents.store.onChange((change) => void emit('artifacts.changed', change)));
    offs.push(documents.store.onSpaceChange((change) => void emit('spaces.changed', change)));
  }

  // A document's port (Decision Log 13): attached for a live document kind, closed for anything else, so a window never
  // waits on a port nobody serves.
  client.onDocPort(({ channel, artifactId, actor, doc }, port) => {
    const artifact = documents?.store.get(artifactId) ?? null;
    if (!documents || !artifact || !isDocKind(artifact.kind)) {
      console.error(`[artifacts] closed document channel ${channel}: ${!documents ? 'the store is unavailable' : !artifact ? `no artifact ${artifactId}` : `a ${artifact.kind} artifact has no document`}`);
      port.close();
      return;
    }
    const open = () => documents.service.attach(doc === 'suggestions' ? documents.service.suggestionDoc(artifactId) : artifactId, fromMessagePortMain(port), actor);
    if (!documents.service.adapterFor(artifact.kind)?.migrate) return void open();
    // P3-E (E1's M2): a kind with a migration is brought into its model first, as the port's actor; the port's close is
    // watched before that wait, so a port its window closed meanwhile is never attached, and a refusal closes it
    let closed = false;
    port.on('close', () => void (closed = true));
    documents.store
      .ensureMigrated(artifactId, actor)
      .then(() => {
        if (!closed) open();
      })
      .catch((error: unknown) => {
        console.error(`[artifacts] closed document channel ${channel}: ${error instanceof Error ? error.message : String(error)}`);
        port.close();
      });
  });

  return {
    close: () => {
      for (const off of offs.splice(0)) off();
      loopDelay?.close();
      stopGone?.(); // E3
      holds.releaseAll(); // E3
    },
  };
}

