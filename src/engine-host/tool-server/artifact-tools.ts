// The artifact namespace's library tools (X25; the P3 composite spec §4.3; the P3-A document's M6): `artifact_list`,
// `artifact_describe_type`, `artifact_create` and `artifact_read`, over the engine host's artifact store. Every call
// carries the session as the actor and links it (`created`, `viewed`); a handle resolves over the session's lineage
// (Decision Log 3); a create is idempotent by its tool-use id (Decision Log 11) and records its answer inside the
// savepoint of the write that commits it; a read captures the session's base for its next publish (Decision Log 9).
// An `html` create also answers E2's fields (`id`, `deliverableId`, `version` 1), which the transcript's artifact row is
// drawn from (P3-L's cutover keeps their names; the deliverable id is the artifact's id).
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readRoots } from '@artifacts/files';
import { KIND_GUIDES } from '@artifacts/types/guides';
import { isDocKind, type Artifact, type ArtifactKind } from '@shared/artifacts/entity';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import {
  parseToolArguments,
  TOOL_ERRORS,
  type ArtifactCreateResult,
  type ArtifactDescribeTypeResult,
  type ArtifactListResult,
  type ArtifactReadResult,
  type ListedArtifact,
  type VersionSummary,
} from '@shared/maws/tools';
import type { Doc } from '@artifacts/yjs';
import type { ArtifactStore, ByteContent } from '../documents/store';
import {
  actorOf,
  answering,
  editorOf,
  filesOf,
  lineageOf,
  opIdOf,
  publisherOf,
  readSourceFile,
  resolveArtifact,
  storeOf,
  ToolRefusal,
  withDoc,
  type ArtifactToolDeps,
} from './artifact-context';
import { externalReferenceCount } from './artifacts';
import { defineMawsTool, toolError, toolText, type McpToolContext, type McpToolDefinition } from './server';

const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const TEXT_READ_MAX = 1024 * 1024; // a file artifact's text is returned under this size (the file guide)
const VERSIONS_LISTED = 10; // a read lists this many of the latest versions
const DESIGN_CONTEXT_KINDS: readonly ArtifactKind[] = ['document', 'presentation', 'design']; // Decision Log 22d

const iso = (ms: number) => new Date(ms).toISOString();

export function artifactListTool(deps: ArtifactToolDeps): McpToolDefinition {
  return defineMawsTool('artifact_list', (args, ctx) =>
    answering('artifact_list', async () => {
      const parsed = parseToolArguments('artifact_list', args);
      if (!parsed.ok) return toolError(parsed.error);
      const { kind, spaceId, query, scope } = parsed.data;
      const store = storeOf('artifact_list', deps);
      const lineage = lineageOf(ctx, deps);
      const artifacts = await store.readCommitted(() => {
        const filter = { kind, spaceId, query };
        const found = scope === 'all' ? store.list(filter) : dedupe(lineage.flatMap((appSessionId) => store.list({ ...filter, appSessionId })));
        return found
          .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1))
          .map((artifact): ListedArtifact => ({
            id: artifact.id, ...(artifact.handle !== undefined && { handle: artifact.handle }), kind: artifact.kind, title: artifact.title,
            revision: store.revision(artifact.id), updatedAt: iso(artifact.updatedAt), lastEditor: editorOf(store.lastWrite(artifact.id), ctx.appSessionId),
          }));
      });
      const result: ArtifactListResult = { status: 'listed', artifacts };
      return toolText(result);
    }),
  );
}

// The kind's guide and format reference; for a kind a design system styles, the guide of the system that would govern a
// new artifact (the chain's answer for no system or Space of its own, Decision Log 42), when the store has one.
export function artifactDescribeTypeTool(deps: Pick<ArtifactToolDeps, 'artifacts'> = {}): McpToolDefinition {
  return defineMawsTool('artifact_describe_type', async (args) => {
    const parsed = parseToolArguments('artifact_describe_type', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { kind } = parsed.data;
    const store = deps.artifacts?.() ?? null;
    const designSystem = store && DESIGN_CONTEXT_KINDS.includes(kind) ? await store.designSystemContextFor({}) : null;
    const result: ArtifactDescribeTypeResult = { status: 'described', kind, ...KIND_GUIDES[kind], ...(designSystem !== null && { designSystem }) };
    return toolText(result);
  });
}

export function artifactCreateTool(deps: ArtifactToolDeps): McpToolDefinition {
  return defineMawsTool('artifact_create', (args, ctx) =>
    deps.session.joined(opIdOf(ctx), () => answering('artifact_create', async () => {
      const parsed = parseToolArguments('artifact_create', args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const kind = input.kind ?? 'html';
      const handle = input.handle ?? input.id;
      const path = input.path ?? input.html_path;
      const store = storeOf('artifact_create', deps);
      const actor = actorOf(ctx);
      // a repeated call answers what the first one did, before anything that may have moved since is checked
      const replayed = await store.replayOf(opIdOf(ctx));
      if (replayed.found) {
        const answer = replayed.result as ArtifactCreateResult;
        deps.session.guided.add(answer.kind);
        return toolText(answer);
      }

      // What the artifact starts from, read and checked before anything is written
      let content: ByteContent | undefined;
      let page: { bytes: Buffer } | null = null;
      if (kind === 'html') {
        if (path !== undefined) {
          const source = resolve(ctx.cwd, path);
          const found = await stat(source).catch(() => null);
          if (found?.isFile() && !HTML_EXTENSIONS.has(extname(source).toLowerCase())) return toolError(TOOL_ERRORS.notHtml('artifact_create', source));
          page = { bytes: await readSourceFile('artifact_create', source) };
          content = { bytes: page.bytes, name: basename(source) };
        } else {
          page = { bytes: Buffer.from(input.content!, 'utf8') };
          content = { bytes: page.bytes, name: 'index.html' };
        }
      } else if (kind === 'file') {
        const source = resolve(ctx.cwd, path!);
        if (!(await stat(source).catch(() => null))?.isFile()) return toolError(TOOL_ERRORS.artifactNotAFile('artifact_create', source));
        content = { path: source };
      } else if (kind === 'document' && input.content !== undefined) {
        // a document's markdown content is P3-B's document create (ledger X25), served by B's wrapper; this build's
        // generic create would lose it
        return toolError(TOOL_ERRORS.refused('artifact_create', { reason: 'invalid', kind: 'document' }, "a document's markdown content is read by P3-B's document create, which this build does not have; create it empty"));
      } else if (input.files) {
        // a dry run on an empty doc: files the kind cannot hold are refused before the artifact exists
        withDoc(null, (scratch) => publisherOf(store, kind)(scratch, {}, input.files!, false));
      }

      // E2 and P2-E1: a handle the session, or a session it was opened from, already holds is refused
      if (handle !== undefined) {
        const taken = await handleHolder(store, deps, handle, ctx);
        if (taken === 'self') return toolError(TOOL_ERRORS.artifactExists(handle));
        if (taken === 'above') return toolError(TOOL_ERRORS.artifactExistsInParent(handle));
      }

      // The first answer's decorations, settled before the write so the recorded answer is the whole first answer: the
      // kind's guide when this session has not had it, the governing design system's guide as the registered chain names
      // it (Decision Log 22d, 42; a new artifact has no system or Space of its own; `{builtin}` attaches nothing, and the
      // artifact's `designSystemId` stays unset, so the chain keeps deciding by reference)
      const guide = deps.session.guided.has(kind) ? undefined : KIND_GUIDES[kind];
      const designSystem = DESIGN_CONTEXT_KINDS.includes(kind) ? await store.designSystemContextFor({}) : null;
      const files = isDocKind(kind) ? input.files : undefined;
      let base: { revision: number; state: Uint8Array } | null = null;
      const recorded = await store.writeCommitted(() =>
        store.withOp(
          opIdOf(ctx),
          'artifact_create',
          null,
          async (op) => {
            let answer: ArtifactCreateResult | undefined;
            // the answer, built and recorded inside the savepoint of the write that completes the create (with the first
            // files when there are any: Decision Log 40b)
            const complete = (artifact: Artifact) => {
              const revision = store.revision(artifact.id);
              answer = {
                status: 'created', artifactId: artifact.id, kind, title: artifact.title, revision, ...(handle !== undefined && { handle }),
                ...(page !== null && { id: handle ?? artifact.id, deliverableId: artifact.id, version: 1 as const, externalReferences: externalReferenceCount(page.bytes.toString('utf8')) }),
                ...(guide && { guide }), ...(designSystem !== null && { designSystem }),
              };
              if (isDocKind(kind)) base = { revision, state: store.service.readState(artifact.id).state };
              op.record(answer);
            };
            await store.create(
              { kind, title: input.title, ...(handle !== undefined && { handle }), ...(content && { content }), ...(files && { initial: (doc: Doc) => void publisherOf(store, kind)(doc, {}, files, false) }) },
              actor,
              complete,
            );
            return answer!;
          },
          { actor },
        ),
      );
      deps.session.guided.add(kind);
      // the session's base: what it just wrote (a replayed call leaves none for a Y kind: the agent reads first)
      if (base) store.service.replica(ctx.appSessionId, recorded.artifactId).base = base;
      if (page !== null) deps.session.byteBases.set(recorded.artifactId, { revision: recorded.revision, sha256: createHash('sha256').update(page.bytes).digest('hex') });
      return toolText(recorded);
    })),
  );
}

// Who already holds a handle a create names: this session, or a session above it.
async function handleHolder(store: ArtifactStore, deps: ArtifactToolDeps, handle: string, ctx: McpToolContext): Promise<'self' | 'above' | null> {
  const above = deps.artifactScope ?? [];
  return store.readCommitted(() => (store.resolve(handle, [ctx.appSessionId]) ? 'self' : above.length > 0 && store.resolve(handle, above) ? 'above' : null));
}

export function artifactReadTool(deps: ArtifactToolDeps): McpToolDefinition {
  return defineMawsTool('artifact_read', (args, ctx) =>
    answering('artifact_read', async () => {
      const parsed = parseToolArguments('artifact_read', args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const store = storeOf('artifact_read', deps);
      const artifactId = await resolveArtifact('artifact_read', store, input.artifact, lineageOf(ctx, deps));
      const read = await store.readCommitted(() => {
        const artifact = store.get(artifactId);
        if (!artifact) throw new ToolRefusal(TOOL_ERRORS.noArtifact('artifact_read', input.artifact));
        const version = input.version === undefined ? null : store.versions.version(artifactId, input.version);
        if (input.version !== undefined && !version) throw new ToolRefusal(TOOL_ERRORS.refused('artifact_read', { reason: 'notFound', version: input.version }, `version ${input.version} does not exist; read the artifact for the versions it has`));
        const versions = store.listVersions(artifactId).slice(-VERSIONS_LISTED).reverse().map((v) => summaryOf(v, ctx.appSessionId));
        const head = { status: 'read' as const, artifactId, kind: artifact.kind, title: artifact.title, ...(artifact.handle !== undefined && { handle: artifact.handle }), ...(version && { version: summaryOf(version, ctx.appSessionId) }), versions };
        if (isDocKind(artifact.kind)) {
          if (input.revision !== undefined) throw new ToolRefusal(TOOL_ERRORS.refused('artifact_read', { reason: 'invalid' }, `a ${artifact.kind} artifact is read live or by version, not by revision`));
          const { revision, state } = version ? { revision: version.seq, state: store.versionState(artifactId, version.id) } : store.service.readState(artifactId);
          const body = withDoc(state, (doc) => ({ files: filesOf(store, artifact.kind, doc), json: readRoots(doc) }));
          return { kind: 'doc' as const, head: { ...head, revision }, body, base: version ? null : { revision, state } };
        }
        const ref = version ? { revision: version.seq, ref: JSON.parse(store.versions.get(artifactId, version.id)!.content!) as ReturnType<typeof store.contentRef>['ref'] } : store.contentRef(artifactId, input.revision);
        const path = store.files.resolve(artifactId, ref.ref);
        const bytes = artifact.kind === 'html' ? Buffer.from(store.files.read(artifactId, ref.ref)) : null;
        return { kind: 'bytes' as const, head: { ...head, revision: ref.revision }, ref: ref.ref, path, bytes, live: !version && input.revision === undefined };
      });

      let result: ArtifactReadResult;
      if (read.kind === 'doc') {
        const { files, json } = read.body;
        const named = input.paths ? Object.fromEntries(input.paths.filter((p) => p in files).map((p) => [p, files[p]!])) : files;
        const missing = input.paths?.filter((p) => !(p in files)) ?? [];
        result = { ...read.head, ...(Object.keys(named).length > 0 || input.paths ? { files: named } : {}), ...(missing.length > 0 && { missing }), ...(Object.keys(json).length > 0 && !input.paths && { json }) };
        if (read.base) store.service.replica(ctx.appSessionId, artifactId).base = read.base;
      } else if (read.bytes !== null) {
        result = { ...read.head, files: { 'index.html': read.bytes.toString('utf8') } };
        if (read.live) deps.session.byteBases.set(artifactId, { revision: read.head.revision, sha256: read.ref.sha256 });
      } else {
        result = { ...read.head, file: { name: read.ref.name, path: read.path, size: read.ref.size, sha256: read.ref.sha256, ...(await textOf(read.path)) } };
      }
      await store.writeCommitted(() => store.link(artifactId, ctx.appSessionId, 'viewed'));
      return toolText(result);
    }),
  );
}

function summaryOf(version: ArtifactVersion, self: AppSessionId): VersionSummary {
  const by = editorOf({ actor: version.actor, at: version.at }, self)!.by;
  return { id: version.id, kind: version.kind, revision: version.seq, at: iso(version.at), by, ...(version.label !== undefined && { label: version.label }) };
}

// A file artifact's text, when the file is there, under TEXT_READ_MAX and UTF-8 text without NULs.
async function textOf(path: string): Promise<{ exists: boolean; text?: string }> {
  const found = await stat(path).catch(() => null);
  if (!found?.isFile()) return { exists: false };
  if (found.size > TEXT_READ_MAX) return { exists: true };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
    return text.includes('\u0000') ? { exists: true } : { exists: true, text };
  } catch {
    return { exists: true };
  }
}

function dedupe(artifacts: Artifact[]): Artifact[] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => !seen.has(artifact.id) && seen.add(artifact.id));
}
