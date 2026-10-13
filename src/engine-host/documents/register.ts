// The engine host's `artifacts.*` and `spaces.*` surface (X23; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4):
// one handler per host-owned command over the artifact store, the store's change feed as `artifacts.changed` and
// `spaces.changed`, and the document ports main posts on the parent port (Decision Log 13), attached to the document
// service under the actor main names. Every write a command makes is the human's: only main and the app window reach
// this surface, and an agent's writes come through the tools (M6) as its session.
//
// Every command is answered from the store once its write has committed (the `immediate` deadline shape of
// `ipc.ts`), so none can outlive the bridge's 10 s router timeout. A refusal the store names is a `HostCommandError`
// whose `issues` is an `ArtifactRefusal` (schema/artifacts.ts); a store that failed to open answers `unavailable`.
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { HostCommandError, type HostClientHooks, type HostEmit, type HostOn } from '@shared/host/runtime';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { isDocKind } from '@shared/artifacts/entity';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { ArtifactRefusal, ArtifactRow, commands as ArtifactCommands } from '@shared/ipc/schema/artifacts';
import type { commands as SpaceCommands } from '@shared/ipc/schema/spaces';
import type { DeadlineShape } from '../ipc';
import { ArtifactFiles } from './bytes';
import { ArtifactStoreError, StoreTooNewError } from './errors';
import { fromMessagePortMain } from './ports';
import type { Documents } from '.';
import type { ArtifactStore, ByteContent } from './store';

type HostArtifactCommand = Exclude<keyof typeof ArtifactCommands, 'artifacts.open'> | keyof typeof SpaceCommands;

export const ARTIFACTS_DEADLINE_SHAPES: Record<HostArtifactCommand, DeadlineShape> = {
  'artifacts.list': 'immediate', 'artifacts.get': 'immediate', 'artifacts.create': 'immediate', 'artifacts.update': 'immediate',
  'artifacts.delete': 'immediate', 'artifacts.duplicate': 'immediate', 'artifacts.search': 'immediate', 'artifacts.versions': 'immediate',
  'artifacts.saveVersion': 'immediate', 'artifacts.restore': 'immediate', 'artifacts.markViewed': 'immediate', 'artifacts.pruneVersions': 'immediate',
  'artifacts.versionState': 'immediate', 'artifacts.attributions': 'immediate', 'artifacts.uploadAsset': 'immediate', 'artifacts.testLoopDelay': 'immediate',
  'artifacts.setDefaults': 'immediate', 'artifacts.content': 'immediate', 'artifacts.status': 'immediate', 'artifacts.testWrite': 'immediate',
  'spaces.list': 'immediate', 'spaces.create': 'immediate', 'spaces.update': 'immediate', 'spaces.delete': 'immediate',
};

export interface ArtifactsSurfaceDeps {
  documents: Documents | null; // null: the store failed to open this run (`openDocuments` logged why)
  env: Record<string, string | undefined>; // MAWS_E2E=1 opens the test writer and the loop delay
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

export function registerArtifacts(on: HostOn, emit: HostEmit, client: Pick<HostClientHooks, 'onDocPort'>, { documents, env }: ArtifactsSurfaceDeps): { close(): void } {
  const e2e = env.MAWS_E2E === '1';
  const loopDelay: ReturnType<typeof monitorEventLoopDelay> | null = e2e ? monitorEventLoopDelay({ resolution: 10 }) : null;
  loopDelay?.enable();

  const storeOf = (): ArtifactStore => {
    if (!documents) throw refused('unavailable', 'the artifact store could not be opened this run', {}, 'internal');
    return documents.store;
  };
  const e2eOnly = (name: string) => {
    if (!e2e) throw new HostCommandError(ipcError('internal', `${name} answers only when the engine host runs under MAWS_E2E=1`));
  };
  // A handler whose store refusals reach the caller typed.
  const serve = <N extends HostArtifactCommand>(name: N, handler: (input: CommandInput<N>) => CommandOutput<N> | Promise<CommandOutput<N>>) =>
    on(name, async (input) => {
      try {
        return await handler(input);
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

  serve('artifacts.list', ({ filter }) => {
    const store = storeOf();
    return { artifacts: store.list(filter).map((artifact) => ({ ...artifact, revision: store.revision(artifact.id) })) };
  });
  serve('artifacts.get', ({ artifactId, includeDeleted }) => ({ artifact: row(storeOf(), artifactId, includeDeleted) }));
  serve('artifacts.create', async ({ content, ...input }) => {
    const store = storeOf();
    const byteContent: ByteContent | undefined = content && ('bytes' in content ? { bytes: content.bytes, name: content.name } : { path: content.path });
    const artifact = await store.create({ ...input, content: byteContent }, HUMAN);
    return { artifact: required(store, artifact.id) };
  });
  serve('artifacts.update', async ({ artifactId, ...change }) => {
    const store = storeOf();
    await store.update(artifactId, change);
    return { artifact: required(store, artifactId) };
  });
  serve('artifacts.delete', async ({ artifactId }) => {
    await storeOf().delete(artifactId);
  });
  serve('artifacts.duplicate', async ({ artifactId, versionId }) => {
    const store = storeOf();
    const copy = await store.duplicate(artifactId, { versionId }, HUMAN);
    return { artifact: required(store, copy.id) };
  });
  serve('artifacts.search', ({ query }) => {
    const store = storeOf();
    return { artifacts: store.list({ query }).map((artifact) => ({ ...artifact, revision: store.revision(artifact.id) })) };
  });
  serve('artifacts.versions', ({ artifactId }) => {
    const store = storeOf();
    required(store, artifactId);
    return { versions: store.listVersions(artifactId) };
  });
  serve('artifacts.saveVersion', async ({ artifactId, label, note }) => {
    const versionId = await storeOf().createVersion(artifactId, { kind: 'named', actor: HUMAN, label, note });
    if (versionId === null) throw new Error(`no version of ${artifactId} was written`); // only an `auto` finds nothing to write
    return { versionId };
  });
  serve('artifacts.restore', ({ artifactId, versionId }) => storeOf().restore(artifactId, versionId, HUMAN));
  serve('artifacts.markViewed', async ({ artifactId }) => {
    await storeOf().markViewed(artifactId);
  });
  serve('artifacts.pruneVersions', async ({ artifactId, olderThan }) => ({ removed: await storeOf().pruneVersions(artifactId ?? null, olderThan) }));
  serve('artifacts.versionState', ({ artifactId, versionId, seq }) => ({ bytes: storeOf().versionState(artifactId, versionId ?? { seq: seq! }) }));
  serve('artifacts.attributions', ({ artifactId, fromSeq, toSeq }) => {
    const store = storeOf();
    required(store, artifactId);
    return { bytes: store.attributions(artifactId, fromSeq, toSeq) };
  });
  serve('artifacts.uploadAsset', ({ artifactId, name, mime, bytes }) => storeOf().uploadAsset(artifactId, bytes, { name, mime }, HUMAN));
  serve('artifacts.testLoopDelay', ({ reset }) => {
    e2eOnly('artifacts.testLoopDelay');
    const histogram = loopDelay!;
    const ms = (ns: number) => ns / 1e6;
    const empty = histogram.count === 0;
    const answer = empty ? { p50: 0, p99: 0, max: 0, mean: 0 } : { p50: ms(histogram.percentile(50)), p99: ms(histogram.percentile(99)), max: ms(histogram.max), mean: ms(histogram.mean) };
    if (reset) histogram.reset();
    return answer;
  });
  serve('artifacts.setDefaults', ({ owner, spaces }) => storeOf().setDefaults({ owner, spaces }));
  serve('artifacts.content', ({ artifactId, revision, path }) => {
    const store = storeOf();
    required(store, artifactId);
    if (path !== undefined && path.startsWith('assets/')) {
      const asset = store.listAssets(artifactId).find((candidate) => candidate.ref === path);
      if (!asset) throw new ArtifactStoreError('notFound', `no asset ${path} in ${artifactId}`);
      return { revision: store.revision(artifactId), name: asset.name, size: asset.size, sha256: asset.sha256, path: join(store.files.dirOf(artifactId), ArtifactFiles.assetPath(asset.sha256)) };
    }
    const content = store.contentRef(artifactId, revision);
    if (path !== undefined && path !== content.ref.name) throw new ArtifactStoreError('notFound', `no file ${path} in ${artifactId} at revision ${content.revision}`);
    return { revision: content.revision, name: content.ref.name, size: content.ref.size, sha256: content.ref.sha256, path: content.path };
  });
  serve('artifacts.status', () => {
    if (!documents) return { status: 'unavailable' as const, reason: 'the artifact store could not be opened this run (the host log says why)' };
    return { status: documents.storage.status, reason: documents.storage.statusReason };
  });
  serve('artifacts.testWrite', ({ artifactId, opId, ops, appSessionId }) => {
    e2eOnly('artifacts.testWrite');
    return storeOf().testWrite(artifactId, opId, ops, appSessionId ? { kind: 'session', appSessionId: appSessionId as AppSessionId } : HUMAN);
  });
  serve('spaces.list', () => ({ spaces: storeOf().listSpaces() }));
  serve('spaces.create', async (input) => ({ space: await storeOf().createSpace(input) }));
  serve('spaces.update', async ({ spaceId, ...change }) => ({ space: await storeOf().updateSpace(spaceId, change) }));
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
  client.onDocPort(({ channel, artifactId, actor }, port) => {
    const artifact = documents?.store.get(artifactId) ?? null;
    if (!documents || !artifact || !isDocKind(artifact.kind)) {
      console.error(`[artifacts] closed document channel ${channel}: ${!documents ? 'the store is unavailable' : !artifact ? `no artifact ${artifactId}` : `a ${artifact.kind} artifact has no document`}`);
      port.close();
      return;
    }
    documents.service.attach(artifactId, fromMessagePortMain(port), actor);
  });

  return {
    close: () => {
      for (const off of offs.splice(0)) off();
      loopDelay?.disable();
    },
  };
}

