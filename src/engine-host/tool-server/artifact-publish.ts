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
// its answer carries E2's fields the transcript's artifact row is drawn from (`id`, `deliverableId`, the version's place
// `version`; P3-L's cutover keeps their names, the deliverable id being the artifact's). A Y kind's files go through its kind's `publish`
// (else the generic file model) inside the session's host-replica write, so the check and the write see one state and
// the op row commits in the write's savepoint; the session's base then becomes what it knows: the files it read with
// its own changes applied, at the new revision. The session's presence shows on the artifact until its turn ends.
//
// A suggestion (M8; parent Decision Log 27): `mode: 'suggest'`, or any publish to an artifact whose owner set
// `agentEditsAsSuggestions` (which `mode: 'direct'` does not override), goes through the same layers and the same write
// into the artifact's suggestion doc instead (the artifact with the pending suggestions on it), as the session; the
// artifact itself does not move, so the answer carries its live revision and no turn version follows. An html page,
// which has no document to suggest into, is refused.
//
// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md; the parent's Decision Log 53 and 58): a kind's loader
// fields (`added`, `warnings`, `notes`, `held`) reach the answer, a deck's with the pictures its assets do not hold; the
// answer's `kept` and `removed` come from the kind's paths, and the session's base keeps the files it knows, so a
// publish reads no whole document but the session's new base; a presentation takes no suggestion.
import { createHash } from 'node:crypto';
import { actorDisplay } from '@shared/artifacts/actor';
import { isDocKind, type Artifact } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import { parseToolArguments, type ArtifactPublishInput, type ArtifactPublishResult } from '@shared/maws/tools';
import type { PublishOutcome } from '@artifacts/files';
import { assetWarnings } from '@artifacts/slides/answer'; // P3-C
import { stateV2 } from '@artifacts/yjs';
import type { ArtifactStore } from '../documents/store';
import { actorOf, answering, filesOf, lineageOf, opIdOf, pathsOf, publisherOf, refuse, refusedAfterCommit, resolveArtifact, storeOf, ToolRefusal, withDoc, type ArtifactToolDeps } from './artifact-context';
import { externalReferenceCount } from './artifacts';
import { defineMawsTool, toolError, toolText, type McpToolContext, type McpToolDefinition } from './server';

const TOOL = 'artifact_publish';
const PAGE = 'index.html';

export function artifactPublishTool(deps: ArtifactToolDeps): McpToolDefinition {
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
        return toolText(recorded.kind === 'html' ? await placed(store, recorded, input, ctx) : recorded);
      }
      const artifactId = await resolveArtifact(TOOL, store, input.artifact, lineageOf(ctx, deps));
      const artifact = await store.readCommitted(() => store.get(artifactId));
      if (!artifact) throw refuse(TOOL, { reason: 'notFound', artifactId }, `the artifact ${input.artifact} was deleted`);
      if (artifact.kind === 'file') throw refuse(TOOL, { reason: 'invalid', kind: 'file' }, 'a file artifact is delivered again with send_file, not published');
      if (artifact.kind === 'document') throw refuse(TOOL, { reason: 'invalid', kind: 'document' }, 'a document is edited block by block, not published');
      const suggest = input.mode === 'suggest' || artifact.agentEditsAsSuggestions;
      if (suggest && !isDocKind(artifact.kind)) {
        const why = input.mode === 'suggest' ? 'mode "suggest" asks for a suggestion' : `the user set ${artifact.title} to take agent edits as suggestions`;
        throw refuse(TOOL, { reason: 'invalid', kind: artifact.kind, mode: 'suggest', setting: artifact.agentEditsAsSuggestions }, `${why}, and an html page takes none; nothing was written`);
      }
      // P3-C (the parent's Decision Log 53 (2)): nothing shows or settles a deck's suggestions in P3
      if (suggest && artifact.kind === 'presentation') {
        const why = input.mode === 'suggest' ? 'mode "suggest" asks for a suggestion, and a presentation takes none in this build of MAWS: publish with mode "direct"' : `the user set ${artifact.title} to take agent edits as suggestions, and a presentation takes none in this build of MAWS: ask the user to turn off agent edits as suggestions for it`;
        throw refuse(TOOL, { reason: 'invalid', kind: artifact.kind, mode: 'suggest', setting: artifact.agentEditsAsSuggestions }, `${why}; nothing was written`);
      }
      const result = isDocKind(artifact.kind) ? await publishDoc(deps, store, artifact, input, ctx, suggest) : await placed(store, await publishPage(deps, store, artifact, input, ctx), input, ctx);
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

// An html publish's answer with E2's fields for the transcript's artifact row: `version` is the place, from 1, of the
// version the publish wrote among the artifact's versions in the order of their revisions (the viewers' `v1 … vN`,
// P3-L's Decision Log 4), `ownerAppSessionId` the session that made the page when another (P2-E1). Nothing is added
// for a publish that changed nothing, or a version no longer kept. A repeated call's answer is placed the same way.
async function placed(store: ArtifactStore, recorded: ArtifactPublishResult, input: ArtifactPublishInput, ctx: McpToolContext): Promise<ArtifactPublishResult> {
  if (recorded.changed.length === 0) return recorded;
  const found = await store.readCommitted(() => {
    const artifact = store.get(recorded.artifactId, { includeDeleted: true });
    const place = artifact ? store.listVersions(artifact.id).findIndex((version) => version.seq === recorded.revision) + 1 : 0;
    const owner = (store.links(recorded.artifactId).find((link) => link.role === 'created')?.appSessionId as AppSessionId | undefined) ?? null;
    return artifact && place > 0 ? { artifact, place, owner } : null;
  });
  if (found === null) return recorded;
  const { artifact, place, owner } = found;
  const text = input.files[Object.keys(input.files)[0]!] ?? '';
  return { ...recorded, id: artifact.handle ?? artifact.id, deliverableId: artifact.id, version: place, externalReferences: externalReferenceCount(text), ...(owner !== null && owner !== ctx.appSessionId && { ownerAppSessionId: owner }) };
}

async function publishDoc(deps: ArtifactToolDeps, store: ArtifactStore, artifact: Artifact, input: ArtifactPublishInput, ctx: McpToolContext, suggest: boolean): Promise<ArtifactPublishResult> {
  const actor = actorOf(ctx);
  const replica = store.service.replica(ctx.appSessionId, artifact.id);
  const status = suggest ? 'suggested' : 'published';
  const base = replica.base;
  const publish = publisherOf(store, artifact.kind);
  const outcome: { conflicts?: { path: string; detail?: string }[]; failure?: unknown; result?: ArtifactPublishResult } = {};
  let baseFiles: Record<string, string> = {};
  const recorded = await store.writeCommitted(() =>
    store.withOp(
      opIdOf(ctx),
      TOOL,
      artifact.id,
      async (op) => {
        if (!base) return refusedAfterCommit(store, staleBase(store.revision(artifact.id), NEVER_READ));
        if (input.baseRevision !== base.revision) return refusedAfterCommit(store, staleBase(store.revision(artifact.id), notLastRead(input.baseRevision, base.revision)));
        baseFiles = base.files ?? withDoc(base.state, (doc) => filesOf(store, artifact.kind, doc)); // P3-C: the files the session read, kept on its base
        const assets = artifact.kind === 'presentation' ? new Set(store.listAssets(artifact.id).map((asset) => asset.ref)) : null; // P3-C: D6's warnings
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
              else outcome.result = { status, artifactId: artifact.id, kind: artifact.kind, title: artifact.title, revision: 0, changed: published.changed, kept: [], removed: [], ...loaderFields(published) /* P3-C */ };
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
              const doc = store.service.live(target);
              const live = new Set(pathsOf(store, artifact.kind, doc)); // P3-C: the paths, not the files
              const changed = new Set(outcome.result.changed);
              const kept = [...live].filter((path) => !changed.has(path));
              const changedLive = outcome.result.changed.filter((path) => live.has(path));
              const removed = outcome.result.changed.filter((path) => !live.has(path));
              const warnings = [...(outcome.result.warnings ?? []), ...(assets ? assetWarnings(doc, assets, changedLive) : [])]; // P3-C
              outcome.result = { ...outcome.result, revision, changed: changedLive, kept, removed, ...(warnings.length > 0 && { warnings }) };
              op.record(outcome.result);
            },
          },
        );
        await linked;
        if (outcome.failure !== undefined) throw outcome.failure;
        if (outcome.conflicts) {
          const restored = (path: string) => restoredSince && path in baseFiles && !pathsOf(store, artifact.kind, store.service.live(target)).includes(path); // P3-C: paths
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
      replica.base = withDoc(base!.state, (doc) => {
        publish(doc, baseFiles, input.files, true);
        return { revision: recorded.revision, state: stateV2(doc), files: filesOf(store, artifact.kind, doc) /* P3-C: kept for the next publish */ };
      });
    } catch {
      replica.base = null;
    }
    if (!suggest) replica.setPresence(actorDisplay(actor));
  }
  return recorded;
}

// P3-C: what a kind's loader said of the files, each field when it says something
function loaderFields(outcome: PublishOutcome): Pick<ArtifactPublishResult, 'added' | 'warnings' | 'notes' | 'held'> {
  return {
    ...(outcome.added && outcome.added.length > 0 && { added: outcome.added }),
    ...(outcome.warnings && outcome.warnings.length > 0 && { warnings: outcome.warnings }),
    ...(outcome.notes !== undefined && outcome.notes > 0 && { notes: outcome.notes }),
    ...(outcome.held && outcome.held.length > 0 && { held: outcome.held }),
  };
}

const isFilesRefusal = (error: unknown): boolean => error instanceof Error && (error as { code?: unknown }).code === 'invalid' && typeof (error as { data?: unknown }).data === 'object';
