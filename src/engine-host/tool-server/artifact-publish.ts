// `artifact_publish` (X25; the P3 composite spec §4.3; the P3-A document's Decision Log 9, 10, 11, 16 and 33): an
// agent's files written over an artifact in one transaction, through Claude's three concurrency layers.
//
//   1. `baseRevision` must be the revision this session's last read (or create, or publish) of the artifact returned;
//      a session that has none (it never read it, or the host restarted, or its replica closed) reads first.
//   2. A sent file nobody changed since that read applies over the live artifact, the others kept.
//   3. A sent file someone else changed since the read refuses the whole publish naming it ("removed by restore" when a
//      restore since the read took it away); `force` skips 2 and 3 for the files sent.
//
// An `html` page is its one file (`index.html`, or the name it was created under), written as a new immutable version;
// its X12 record gains the version after the commit (Decision Log 4). A Y kind's files go through its kind's `publish`
// (else the generic file model) inside the session's host-replica write, so the check and the write see one state and
// the op row commits in the write's savepoint; the session's base then becomes what it knows: the files it read with
// its own changes applied, at the new revision. The session's presence shows on the artifact until its turn ends.
import { createHash } from 'node:crypto';
import { actorDisplay } from '@shared/artifacts/actor';
import { isDocKind, type Artifact } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import { parseToolArguments, type ArtifactPublishInput, type ArtifactPublishResult } from '@shared/maws/tools';
import { stateV2 } from '@artifacts/yjs';
import type { ArtifactStore } from '../documents/store';
import { actorOf, answering, filesOf, lineageOf, opIdOf, publisherOf, refuse, refusedAfterCommit, resolveArtifact, storeOf, ToolRefusal, withDoc, type ArtifactToolDeps } from './artifact-context';
import { externalReferenceCount } from './artifacts';
import { defineMawsTool, toolError, toolText, type McpToolContext, type McpToolDefinition } from './server';
import { X12Mirror } from './x12-mirror';

const TOOL = 'artifact_publish';
const PAGE = 'index.html';

export function artifactPublishTool(deps: ArtifactToolDeps): McpToolDefinition {
  const mirror = new X12Mirror(deps);
  return defineMawsTool(TOOL, (args, ctx) =>
    answering(TOOL, async () => {
      const parsed = parseToolArguments(TOOL, args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const store = storeOf(TOOL, deps);
      const artifactId = await resolveArtifact(TOOL, store, input.artifact, lineageOf(ctx, deps));
      const artifact = await store.readCommitted(() => store.get(artifactId));
      if (!artifact) throw refuse(TOOL, { reason: 'notFound', artifactId }, `the artifact ${input.artifact} was deleted`);
      if (artifact.kind === 'file') throw refuse(TOOL, { reason: 'invalid', kind: 'file' }, 'a file artifact is delivered again with send_file, not published');
      if (artifact.kind === 'document') throw refuse(TOOL, { reason: 'invalid', kind: 'document' }, 'a document is edited block by block, not published');
      const result = isDocKind(artifact.kind) ? await publishDoc(deps, store, artifact, input, ctx) : await publishPage(deps, store, mirror, artifact, input, ctx);
      return toolText(result);
    }),
  );
}

const staleBase = (liveRevision: number, sentence: string) => refuse(TOOL, { reason: 'staleBase', liveRevision }, sentence);
const NEVER_READ = 'read the artifact first: this session has not read it since MAWS started (or its read expired)';
const notLastRead = (sent: number, read: number) => `baseRevision ${sent} is not the revision your last read returned (${read}); read the artifact again`;

// Layer 3's refusal, with each file's reason.
function conflict(conflicts: { path: string; detail?: string }[]): ToolRefusal {
  const paths = conflicts.map((c) => c.path);
  const named = conflicts.map((c) => (c.detail ? `${c.path} (${c.detail})` : c.path)).join(', ');
  return refuse(TOOL, { reason: 'conflict', paths, conflicts }, `changed by someone else since your read: ${named}; read the artifact again, apply your change to what you read and publish again (force: true overwrites them)`);
}

async function publishPage(deps: ArtifactToolDeps, store: ArtifactStore, mirror: X12Mirror, artifact: Artifact, input: ArtifactPublishInput, ctx: McpToolContext): Promise<ArtifactPublishResult> {
  const actor = actorOf(ctx);
  const paths = Object.keys(input.files);
  const base = deps.session.byteBases.get(artifact.id);
  let fresh = false;
  const recorded = await store.writeCommitted(() =>
    store.withOp(
      opIdOf(ctx),
      TOOL,
      artifact.id,
      async (op) => {
        fresh = true;
        // checked and written in one turn of the event loop: the state checked is the state written over
        const live = store.contentRef(artifact.id);
        const names = new Set([PAGE, live.ref.name]);
        const text = input.files[paths[0]!];
        if (paths.length !== 1 || !names.has(paths[0]!) || text === null || text === undefined) {
          throw refuse(TOOL, { reason: 'invalid', paths }, `an html artifact is one file: send files: {"${PAGE}": "<the whole page>"}`);
        }
        if (!base) return refusedAfterCommit(store, staleBase(live.revision, NEVER_READ));
        if (input.baseRevision !== base.revision) return refusedAfterCommit(store, staleBase(live.revision, notLastRead(input.baseRevision, base.revision)));
        const bytes = Buffer.from(text, 'utf8');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (live.ref.sha256 !== base.sha256 && sha256 !== live.ref.sha256 && !input.force) return refusedAfterCommit(store, conflict([{ path: PAGE, detail: 'changed since your read' }]));
        const answer = (revision: number): ArtifactPublishResult => ({
          status: 'published', artifactId: artifact.id, kind: artifact.kind, title: artifact.title, revision, changed: revision === live.revision ? [] : [PAGE], kept: [], removed: [],
        });
        const linked = store.link(artifact.id, ctx.appSessionId, 'edited');
        linked.catch(() => {}); // awaited below; a write that fails first reports the batch's failure itself
        let result: ArtifactPublishResult;
        if (sha256 === live.ref.sha256) {
          result = answer(live.revision); // the page as it is: nothing to write but the op
          await store.service.inBatch(() => op.record(result));
        } else {
          const written = await store.writeContent(artifact.id, { bytes, name: live.ref.name }, actor, {}, (w) => op.record(answer(w.revision)));
          result = answer(written.revision);
        }
        await linked;
        deps.session.byteBases.set(artifact.id, { revision: result.revision, sha256 });
        return result;
      },
      { actor },
    ),
  );
  const result = { ...recorded };
  if (result.changed.length === 0) return result;
  const owner = await creatorOf(store, artifact.id);
  if (owner === null) return result;
  let version: number | null;
  if (fresh) {
    const { path } = await store.readCommitted(() => store.contentRef(artifact.id, result.revision));
    version = await mirror.pageVersion(artifact.id, owner, artifact.title, path, ctx.toolUseId);
  } else {
    version = await mirror.versionOf(artifact.id, owner, ctx.toolUseId);
  }
  if (version === null) return result;
  const text = input.files[Object.keys(input.files)[0]!] ?? '';
  return { ...result, id: artifact.handle ?? artifact.id, deliverableId: artifact.id, version, externalReferences: externalReferenceCount(text), ...(owner !== ctx.appSessionId && { ownerAppSessionId: owner }) };
}

async function publishDoc(deps: ArtifactToolDeps, store: ArtifactStore, artifact: Artifact, input: ArtifactPublishInput, ctx: McpToolContext): Promise<ArtifactPublishResult> {
  const actor = actorOf(ctx);
  const replica = store.service.replica(ctx.appSessionId, artifact.id);
  const base = replica.base;
  const publish = publisherOf(store, artifact.kind);
  const outcome: { conflicts?: { path: string; detail?: string }[]; failure?: unknown; result?: ArtifactPublishResult } = {};
  const recorded = await store.writeCommitted(() =>
    store.withOp(
      opIdOf(ctx),
      TOOL,
      artifact.id,
      async (op) => {
        if (!base) return refusedAfterCommit(store, staleBase(store.revision(artifact.id), NEVER_READ));
        if (input.baseRevision !== base.revision) return refusedAfterCommit(store, staleBase(store.revision(artifact.id), notLastRead(input.baseRevision, base.revision)));
        const baseFiles = withDoc(base.state, (doc) => filesOf(store, artifact.kind, doc));
        const restoredSince = store.listVersions(artifact.id).some((v) => v.kind === 'restore' && v.seq > base.revision);
        const linked = store.link(artifact.id, ctx.appSessionId, 'edited');
        linked.catch(() => {}); // awaited below; a write that fails first reports the batch's failure itself
        await store.service.writeAs(
          artifact.id,
          actor,
          (doc) => {
            try {
              const published = publish(doc, baseFiles, input.files, input.force ?? false);
              if (published.conflicts.length > 0) outcome.conflicts = published.conflicts;
              else outcome.result = { status: 'published', artifactId: artifact.id, kind: artifact.kind, title: artifact.title, revision: 0, changed: published.changed, kept: [], removed: [] };
            } catch (error) {
              outcome.failure = error; // the kind refused the files before writing any (KindAdapter.publish's contract)
            }
          },
          {
            inFrame: (revision) => {
              if (!outcome.result) return;
              const live = filesOf(store, artifact.kind, store.service.live(artifact.id));
              const changed = outcome.result.changed;
              const removed = changed.filter((path) => !(path in live));
              outcome.result = { ...outcome.result, revision, changed: changed.filter((path) => path in live), removed, kept: Object.keys(live).filter((path) => !changed.includes(path)) };
              op.record(outcome.result);
            },
          },
        );
        await linked;
        if (outcome.failure !== undefined) throw outcome.failure;
        if (outcome.conflicts) {
          const restored = (path: string) => restoredSince && path in baseFiles && !(path in filesOf(store, artifact.kind, store.service.live(artifact.id)));
          throw conflict(outcome.conflicts.map((c) => (restored(c.path) ? { path: c.path, detail: 'removed by restore' } : c)));
        }
        return outcome.result!;
      },
      { actor },
    ),
  );
  // What the session now knows: the files it read with its own changes, at the revision it wrote (a later publish
  // still conflicts on a file someone else changed that it never saw); none when that view cannot be built.
  if (outcome.result) {
    try {
      const known = withDoc(base!.state, (doc) => {
        publish(doc, filesOf(store, artifact.kind, doc), input.files, true);
        return stateV2(doc);
      });
      replica.base = { revision: recorded.revision, state: known };
    } catch {
      replica.base = null;
    }
    replica.setPresence(actorDisplay(actor));
  }
  return recorded;
}

// The session that created the artifact (whose X12 record mirrors it), or null.
async function creatorOf(store: ArtifactStore, artifactId: string): Promise<AppSessionId | null> {
  return store.readCommitted(() => (store.links(artifactId).find((link) => link.role === 'created')?.appSessionId as AppSessionId | undefined) ?? null);
}
