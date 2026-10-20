// `artifact_publish` (X25; the P3 composite spec §4.3; the P3-A document's Decision Log 9, 10, 11, 16 and 33): an
// agent's files written over an artifact in one transaction, through Claude's three concurrency layers.
//
//   1. `baseRevision` must be the revision this session's last read (or create, or publish) of the artifact returned;
//      a session that has none (it never read it, or the host restarted, or its replica closed) reads first.
//   2. A sent file nobody changed since that read applies over the live artifact, the others kept.
//   3. A sent file someone else changed since the read refuses the whole publish naming it ("removed by restore" when a
//      restore since the read took it away); `force` skips 2 and 3 for the files sent. A merge the kind's loader would
//      hold or that would lose content is refused even under force, its detail naming why (P3-F, L214; the parent's
//      Decision Log 73), and the refusal says so rather than offering force.
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
import { assetWarnings } from '@artifacts/slides/answer'; // P3-C
import { boardAssetWarnings } from '@artifacts/design/answer'; // P3-E
import { stateV2 } from '@artifacts/yjs';
import { legacyDashboardFiles, legacyDashboardReason } from '@artifacts/dashboard/legacy'; // P3-E
import type { ArtifactStore } from '../documents/store';
import { actorOf, answering, filesOf, lineageOf, loaderFields, opIdOf, pathsOf, publisherOf, refuse, refusedAfterCommit, resolveArtifact, storeOf, ToolRefusal, withDoc, type ArtifactToolDeps } from './artifact-context';
import { externalReferenceCount } from './artifacts';
import { withProvisional, type ProvisionalEmitter } from './provisional'; // P4-A2 (X35)
import { defineMawsTool, toolError, toolText, type McpToolContext, type McpToolDefinition } from './server';

const TOOL = 'artifact_publish';
const PAGE = 'index.html';

// P4-A2 (X35; G2 draws it): the session's provisional layer of a Y kind's publish, committed from the write's frame and
// dropped on any other ending of the call (`withProvisional`); an html page has none.
type PublishDeps = ArtifactToolDeps & { provisional?: ProvisionalEmitter };

export function artifactPublishTool(deps: PublishDeps): McpToolDefinition {
  return defineMawsTool(TOOL, (args, ctx) =>
    withProvisional(deps.provisional, ctx.toolUseId, () => deps.session.joined(opIdOf(ctx), () => answering(TOOL, async () => {
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
      // P3-E (E2 M2; ledger X25; parent Decision Log 16): a dashboard is a document, its data bound by artifact_dataset
      // (fix wave R1) one made from files before E2 is held, named with its files and the way forward
      if (artifact.kind === 'dashboard') {
        const held = await store.readCommitted(() => legacyDashboardFiles(store.service.live(artifactId)));
        if (held) throw refuse(TOOL, { reason: 'invalid', kind: 'dashboard', held }, `${input.artifact}: ${legacyDashboardReason(held)}; nothing was written`);
        throw refuse(TOOL, { reason: 'invalid', kind: 'dashboard' }, 'a dashboard is edited block by block (artifact_edit) and its data bound with artifact_dataset, not published');
      }
      suggestionPolicy(artifact, input); // a refusal before anything is migrated; read again where the publish writes
      // P3-E (E1's M2; Decision Log 11 (1)): an earlier build's shape is migrated by this session before its replica and
      // base are looked at, so the publish lands on the kind's model
      await store.ensureMigrated(artifact.id, actorOf(ctx));
      const result = isDocKind(artifact.kind) ? await publishDoc(deps, store, artifact, input, ctx) : await placed(store, await publishPage(deps, store, artifact, input, ctx), input, ctx);
      return toolText(result);
    }))),
  );
}

// Whether the publish is a suggestion (`mode: 'suggest'`, or the owner's `agentEditsAsSuggestions`), throwing the refusal
// of a kind that takes none. P3-F (artifact-protocol finding 8): asked again inside the publish's write, of the artifact
// as it is then, so an owner who turned the setting on while the publish waited (on a batch, a migration) is obeyed;
// that refusal is store state, released after the batch it was read in.
function suggestionPolicy(artifact: Artifact, input: ArtifactPublishInput): boolean {
  const suggest = input.mode === 'suggest' || artifact.agentEditsAsSuggestions;
  if (suggest && !isDocKind(artifact.kind)) {
    const why = input.mode === 'suggest' ? 'mode "suggest" asks for a suggestion' : `the user set ${artifact.title} to take agent edits as suggestions`;
    throw refuse(TOOL, { reason: 'invalid', kind: artifact.kind, mode: 'suggest', setting: artifact.agentEditsAsSuggestions }, `${why}, and an html page takes none; nothing was written`);
  }
  // P3-C (the parent's Decision Log 53 (2)): nothing shows or settles a deck's suggestions in P3; P3-E: nor a design's,
  // whether or not its adapter is registered (the parent's Decision Log 21 (2))
  if (suggest && (artifact.kind === 'presentation' || artifact.kind === 'design')) {
    const a = artifact.kind === 'design' ? 'a design' : 'a presentation';
    const why = input.mode === 'suggest' ? `mode "suggest" asks for a suggestion, and ${a} takes none in this build of MAWS: publish with mode "direct"` : `the user set ${artifact.title} to take agent edits as suggestions, and ${a} takes none in this build of MAWS: ask the user to turn off agent edits as suggestions for it`;
    throw refuse(TOOL, { reason: 'invalid', kind: artifact.kind, mode: 'suggest', setting: artifact.agentEditsAsSuggestions }, `${why}; nothing was written`);
  }
  return suggest;
}

const staleBase = (liveRevision: number, sentence: string) => refuse(TOOL, { reason: 'staleBase', liveRevision }, sentence);
const NEVER_READ = 'read the artifact first: this session has not read it since MAWS started (or its read expired)';
const notLastRead = (sent: number, read: number) => `baseRevision ${sent} is not the revision your last read returned (${read}); read the artifact again`;

// Layer 3's refusal, with each file's reason. P3-F (L214): what a forced publish still conflicts on is a merge force does
// not settle (held or lossy), so its copy does not offer force; unforced, the copy names that case beside force.
function conflict(conflicts: { path: string; detail?: string }[], forced: boolean): ToolRefusal {
  const paths = conflicts.map((c) => c.path);
  const named = conflicts.map((c) => (c.detail ? `${c.path} (${c.detail})` : c.path)).join(', ');
  const again = 'read the artifact again, apply your change to what you read and publish again';
  const sentence = forced
    ? `even with force, merging with the changes since your read would leave content held or lost: ${named}; ${again}`
    : `changed by someone else since your read: ${named}; ${again} (force: true overwrites their changes, but never a merge that would leave content held or lost)`;
  return refuse(TOOL, { reason: 'conflict', paths, conflicts }, sentence);
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
        try {
          suggestionPolicy(store.get(artifact.id) ?? artifact, input); // P3-F: the owner's setting where the publish writes
        } catch (refusal) {
          return refusedAfterCommit(store, refusal as ToolRefusal);
        }
        if (!base) return refusedAfterCommit(store, staleBase(live.revision, NEVER_READ));
        if (input.baseRevision !== base.revision) return refusedAfterCommit(store, staleBase(live.revision, notLastRead(input.baseRevision, base.revision)));
        const bytes = Buffer.from(text, 'utf8');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (live.ref.sha256 !== base.sha256 && sha256 !== live.ref.sha256 && !input.force) return refusedAfterCommit(store, conflict([{ path: PAGE, detail: 'changed since your read' }], false));
        const answer = (revision: number): ArtifactPublishResult => ({
          status: 'published', artifactId: artifact.id, kind: artifact.kind, title: artifact.title, revision, changed: revision === live.revision ? [] : [PAGE], kept: [], removed: [],
        });
        // the op and the session's `edited` link, recorded in the frame of what the publish writes (P3-F)
        const settled = (result: ArtifactPublishResult) => {
          op.record(result);
          store.linkInWrite(artifact.id, ctx.appSessionId, 'edited');
        };
        let result: ArtifactPublishResult;
        if (sha256 === live.ref.sha256) {
          result = answer(live.revision); // the page as it is: nothing to write but the op
          await store.service.inBatch(() => settled(result));
        } else {
          const written = await store.writeContent(artifact.id, { bytes, name: live.ref.name }, actor, {}, (w) => settled(answer(w.revision)));
          result = answer(written.revision);
        }
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

async function publishDoc(deps: PublishDeps, store: ArtifactStore, artifact: Artifact, input: ArtifactPublishInput, ctx: McpToolContext): Promise<ArtifactPublishResult> {
  const actor = actorOf(ctx);
  const replica = store.service.replica(ctx.appSessionId, artifact.id);
  let suggest = false;
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
        try {
          suggest = suggestionPolicy(store.get(artifact.id) ?? artifact, input); // P3-F: the owner's setting where the publish writes
        } catch (refusal) {
          return refusedAfterCommit(store, refusal as ToolRefusal);
        }
        const status = suggest ? 'suggested' : 'published';
        if (!base) return refusedAfterCommit(store, staleBase(store.revision(artifact.id), NEVER_READ));
        if (input.baseRevision !== base.revision) return refusedAfterCommit(store, staleBase(store.revision(artifact.id), notLastRead(input.baseRevision, base.revision)));
        baseFiles = base.files ?? withDoc(base.state, (doc) => filesOf(store, artifact.kind, doc)); // P3-C: the files the session read, kept on its base
        const assets = artifact.kind === 'presentation' || artifact.kind === 'design' ? new Set(store.listAssets(artifact.id).map((asset) => asset.ref)) : null; // P3-C: D6's warnings; P3-E: a design's by board path
        const pictureWarnings = artifact.kind === 'design' ? boardAssetWarnings : assetWarnings; // P3-E
        const restoredSince = store.listVersions(artifact.id).some((v) => v.kind === 'restore' && v.seq > base.revision);
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
            inFrame: (written, { edited }) => {
              if (!outcome.result) return;
              const revision = suggest ? store.service.revision(artifact.id) : written;
              const doc = store.service.live(target);
              const live = new Set(pathsOf(store, artifact.kind, doc)); // P3-C: the paths, not the files
              const changed = new Set(outcome.result.changed);
              const kept = [...live].filter((path) => !changed.has(path));
              const changedLive = outcome.result.changed.filter((path) => live.has(path));
              const removed = outcome.result.changed.filter((path) => !live.has(path));
              const warnings = [...(outcome.result.warnings ?? []), ...(assets ? pictureWarnings(doc, assets, changedLive) : [])]; // P3-C; P3-E
              outcome.result = { ...outcome.result, revision, changed: changedLive, kept, removed, ...(warnings.length > 0 && { warnings }) };
              op.record(outcome.result);
              store.linkInWrite(artifact.id, ctx.appSessionId, 'edited'); // P3-F: only with files taken, never on a refusal
              if (ctx.toolUseId !== null) {
                // P4-A2 (X35 rule 2): the publish's own row; files as they were wrote none, and the layer goes now
                if (edited !== null) deps.provisional?.committed(ctx.toolUseId, target, edited);
                else deps.provisional?.uncommitted(ctx.toolUseId, target);
              }
            },
          },
        );
        if (outcome.failure !== undefined) throw outcome.failure;
        if (outcome.conflicts) {
          const restored = (path: string) => restoredSince && path in baseFiles && !pathsOf(store, artifact.kind, store.service.live(target)).includes(path); // P3-C: paths
          throw conflict(outcome.conflicts.map((c) => (restored(c.path) ? { path: c.path, detail: 'removed by restore' } : c)), input.force ?? false);
        }
        return outcome.result!;
      },
      { actor },
    ),
  );
  // What the session now knows: the files it read with its own changes, at the revision it wrote (a later publish
  // still conflicts on a file someone else changed that it never saw); none when that view cannot be built. P3-F
  // (artifact-protocol finding 1): only the files its publish changed move, so a file a read of some files did not
  // return keeps the text the session knew of it, however its base's state holds it (still one read of the files).
  if (outcome.result) {
    try {
      replica.base = withDoc(base!.state, (doc) => {
        const { changed } = publish(doc, baseFiles, input.files, true);
        const after = filesOf(store, artifact.kind, doc);
        const files = { ...baseFiles }; // P3-C: kept for the next publish
        for (const path of changed) {
          if (path in after) files[path] = after[path]!;
          else delete files[path];
        }
        return { revision: recorded.revision, state: stateV2(doc), files };
      });
    } catch {
      replica.base = null;
    }
    if (!suggest) replica.setPresence(actorDisplay(actor));
  }
  return recorded;
}

const isFilesRefusal = (error: unknown): boolean => error instanceof Error && (error as { code?: unknown }).code === 'invalid' && typeof (error as { data?: unknown }).data === 'object';
