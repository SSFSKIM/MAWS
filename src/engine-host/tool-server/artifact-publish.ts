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
//
// A suggestion (M8; parent Decision Log 27): `mode: 'suggest'`, or any publish to an artifact whose owner set
// `agentEditsAsSuggestions` (which `mode: 'direct'` does not override), goes through the same layers and the same write
// into the artifact's suggestion doc instead (the artifact with the pending suggestions on it), as the session; the
// artifact itself does not move, so the answer carries its live revision and no turn version follows. An html page,
// which has no document to suggest into, is refused.
import { createHash } from 'node:crypto';
import { actorDisplay } from '@shared/artifacts/actor';
import { isDocKind, type Artifact } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
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
    deps.session.joined(opIdOf(ctx), () => answering(TOOL, async () => {
      const parsed = parseToolArguments(TOOL, args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const store = storeOf(TOOL, deps);
      // a repeated call answers what the first one did, before the artifact or the session's base is looked at again
      const replayed = await store.replayOf(opIdOf(ctx));
      if (replayed.found) {
        const recorded = replayed.result as ArtifactPublishResult;
        return toolText(recorded.kind === 'html' ? await mirrored(store, mirror, recorded, input, ctx) : recorded);
      }
      const artifactId = await resolveArtifact(TOOL, deps, store, input.artifact, lineageOf(ctx, deps));
      const artifact = await store.readCommitted(() => store.get(artifactId));
      if (!artifact) throw refuse(TOOL, { reason: 'notFound', artifactId }, `the artifact ${input.artifact} was deleted`);
      if (artifact.kind === 'file') throw refuse(TOOL, { reason: 'invalid', kind: 'file' }, 'a file artifact is delivered again with send_file, not published');
      if (artifact.kind === 'document') throw refuse(TOOL, { reason: 'invalid', kind: 'document' }, 'a document is edited block by block, not published');
      const suggest = input.mode === 'suggest' || artifact.agentEditsAsSuggestions;
      if (suggest && !isDocKind(artifact.kind)) {
        const why = input.mode === 'suggest' ? 'mode "suggest" asks for a suggestion' : `the user set ${artifact.title} to take agent edits as suggestions`;
        throw refuse(TOOL, { reason: 'invalid', kind: artifact.kind, mode: 'suggest', setting: artifact.agentEditsAsSuggestions }, `${why}, and an html page takes none; nothing was written`);
      }
      const result = isDocKind(artifact.kind) ? await publishDoc(deps, store, artifact, input, ctx, suggest) : await mirrored(store, mirror, await publishPage(deps, store, artifact, input, ctx), input, ctx);
      return toolText(result);
    })),
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

async function publishPage(deps: ArtifactToolDeps, store: ArtifactStore, artifact: Artifact, input: ArtifactPublishInput, ctx: McpToolContext): Promise<ArtifactPublishResult> {
  const actor = actorOf(ctx);
  const paths = Object.keys(input.files);
  const base = deps.session.byteBases.get(artifact.id);
  const recorded = await store.writeCommitted(() =>
    store.withOp(
      opIdOf(ctx),
      TOOL,
      artifact.id,
      async (op) => {
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
  return recorded;
}

// An html publish's answer with its X12 mirror's new version (Decision Log 4): the version this call appended (found by
// its tool-use id: a repeated call's, or an overlapping one's), else appended now from the content the store recorded
// at the call's revision, so a repeated call repairs a mirror that failed or never ran after the commit (Decision Log
// 39g) without writing the store again. A version is only appended in the store's order: behind a later publish
// already on the record it is not (the record's versions are numbered, so it cannot go in between). Nothing to add for
// a publish that changed nothing, a page without a record, or content gone from the store.
async function mirrored(store: ArtifactStore, mirror: X12Mirror, recorded: ArtifactPublishResult, input: ArtifactPublishInput, ctx: McpToolContext): Promise<ArtifactPublishResult> {
  if (recorded.changed.length === 0) return recorded;
  const owner = await creatorOf(store, recorded.artifactId);
  const artifact = await store.readCommitted(() => store.get(recorded.artifactId, { includeDeleted: true }));
  if (owner === null || !artifact) return recorded;
  let version = await mirror.versionOf(artifact.id, owner, ctx.appSessionId, ctx.toolUseId);
  if (version === null) {
    const path = await store.readCommitted(() => store.contentRef(artifact.id, recorded.revision).path).catch(() => null);
    if (path !== null) version = await mirror.pageVersion(artifact.id, owner, ctx.appSessionId, artifact.title, path, ctx.toolUseId, (record) => follows(store, record, recorded.revision));
  }
  if (version === null) return recorded;
  const text = input.files[Object.keys(input.files)[0]!] ?? '';
  return { ...recorded, id: artifact.handle ?? artifact.id, deliverableId: artifact.id, version, externalReferences: externalReferenceCount(text), ...(owner !== ctx.appSessionId && { ownerAppSessionId: owner }) };
}

// Whether a version written at `revision` comes after the record's last version: that version's call (its session and
// tool-use id, the op key) answered an earlier revision, or names no call the store recorded (an E2 version, from
// before the store).
async function follows(store: ArtifactStore, record: DeliverableRecord, revision: number): Promise<boolean> {
  const last = record.versions.at(-1);
  if (!last?.toolUseId) return true;
  const prior = await store.replayOf(`${last.appSessionId ?? record.appSessionId}/${last.toolUseId}`);
  const at = prior.found ? (prior.result as { revision?: unknown } | null)?.revision : undefined;
  return typeof at !== 'number' || at < revision;
}

async function publishDoc(deps: ArtifactToolDeps, store: ArtifactStore, artifact: Artifact, input: ArtifactPublishInput, ctx: McpToolContext, suggest: boolean): Promise<ArtifactPublishResult> {
  const actor = actorOf(ctx);
  const replica = store.service.replica(ctx.appSessionId, artifact.id);
  const status = suggest ? 'suggested' : 'published';
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
        const target = suggest ? store.service.suggestionDoc(artifact.id) : artifact.id;
        await store.service.writeAs(
          target,
          actor,
          (doc) => {
            try {
              const published = publish(doc, baseFiles, input.files, input.force ?? false);
              if (published.conflicts.length > 0) outcome.conflicts = published.conflicts;
              else outcome.result = { status, artifactId: artifact.id, kind: artifact.kind, title: artifact.title, revision: 0, changed: published.changed, kept: [], removed: [] };
            } catch (error) {
              // Only the kind's documented refusal of the files, made before it writes anything (`code: 'invalid'`, as
              // `FilesError` and P3-D's `SystemFilesError`), is answered after the write; anything else escapes the write,
              // whose savepoint then takes back whatever the publish had written.
              if (!isFilesRefusal(error)) throw error;
              outcome.failure = error;
            }
          },
          {
            inFrame: (written) => {
              if (!outcome.result) return;
              const revision = suggest ? store.service.revision(artifact.id) : written;
              const live = filesOf(store, artifact.kind, store.service.live(target));
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
          const restored = (path: string) => restoredSince && path in baseFiles && !(path in filesOf(store, artifact.kind, store.service.live(target)));
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
    if (!suggest) replica.setPresence(actorDisplay(actor));
  }
  return recorded;
}

const isFilesRefusal = (error: unknown): boolean => error instanceof Error && (error as { code?: unknown }).code === 'invalid' && typeof (error as { data?: unknown }).data === 'object';

// The session that created the artifact (whose X12 record mirrors it), or null.
async function creatorOf(store: ArtifactStore, artifactId: string): Promise<AppSessionId | null> {
  return store.readCommitted(() => (store.links(artifactId).find((link) => link.role === 'created')?.appSessionId as AppSessionId | undefined) ?? null);
}
