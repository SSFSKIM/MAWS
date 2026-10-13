// The artifact namespace's library tools (X25; the P3 composite spec §4.3; the P3-A document's M6): `artifact_list`,
// `artifact_describe_type`, `artifact_create` and `artifact_read`, over the engine host's artifact store. Every call
// carries the session as the actor and links it (`created`, `viewed`); a handle resolves over the session's lineage
// (Decision Log 3); a create is idempotent by its tool-use id (Decision Log 11) and records its answer inside the
// savepoint of the write that commits it; a read captures the session's base for its next publish (Decision Log 9).
// An `html` or `file` artifact is mirrored into X12 after the commit (Decision Log 4).
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
import { X12Mirror } from './x12-mirror';

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

export function artifactDescribeTypeTool(): McpToolDefinition {
  return defineMawsTool('artifact_describe_type', async (args) => {
    const parsed = parseToolArguments('artifact_describe_type', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { kind } = parsed.data;
    const result: ArtifactDescribeTypeResult = { status: 'described', kind, ...KIND_GUIDES[kind] };
    return toolText(result);
  });
}

export function artifactCreateTool(deps: ArtifactToolDeps): McpToolDefinition {
  const mirror = new X12Mirror(deps);
  return defineMawsTool('artifact_create', (args, ctx) =>
    answering('artifact_create', async () => {
      const parsed = parseToolArguments('artifact_create', args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const kind = input.kind ?? 'html';
      const handle = input.handle ?? input.id;
      const path = input.path ?? input.html_path;
      const store = storeOf('artifact_create', deps);
      const actor = actorOf(ctx);

      // What the artifact starts from, read and checked before anything is written
      let content: ByteContent | undefined;
      let page: { bytes: Buffer; sourcePath?: string } | null = null;
      if (kind === 'html') {
        if (path !== undefined) {
          const source = resolve(ctx.cwd, path);
          const found = await stat(source).catch(() => null);
          if (found?.isFile() && !HTML_EXTENSIONS.has(extname(source).toLowerCase())) return toolError(TOOL_ERRORS.notHtml('artifact_create', source));
          page = { bytes: await readSourceFile('artifact_create', source), sourcePath: source };
          content = { bytes: page.bytes, name: basename(source) };
        } else {
          page = { bytes: Buffer.from(input.content!, 'utf8') };
          content = { bytes: page.bytes, name: 'index.html' };
        }
      } else if (kind === 'file') {
        const source = resolve(ctx.cwd, path!);
        if (!(await stat(source).catch(() => null))?.isFile()) return toolError(TOOL_ERRORS.artifactNotAFile('artifact_create', source));
        content = { path: source };
      } else if (input.files) {
        // a dry run on an empty doc: files the kind cannot hold are refused before the artifact exists
        withDoc(null, (scratch) => publisherOf(store, kind)(scratch, {}, input.files!, false));
      }

      // E2 and P2-E1: a handle the session, or a session it was opened from, already holds is refused
      if (handle !== undefined) {
        const taken = await store.readCommitted(() => (store.resolve(handle, [ctx.appSessionId]) ? 'self' : deps.artifactScope?.length && store.resolve(handle, deps.artifactScope) ? 'above' : null));
        if (taken === 'self') return toolError(TOOL_ERRORS.artifactExists(handle));
        if (taken === 'above') return toolError(TOOL_ERRORS.artifactExistsInParent(handle));
      }

      let base: { revision: number; state: Uint8Array } | null = null;
      let fresh = false; // the call ran here, not answered from the ledger
      const recorded = await store.writeCommitted(() =>
        store.withOp(
          opIdOf(ctx),
          'artifact_create',
          null,
          async (op) => {
            fresh = true;
            const made: { artifact?: Artifact; answer?: ArtifactCreateResult } = {};
            // the answer, built and recorded inside the savepoint of the write that completes the create
            const complete = (artifact: Artifact, revision: number) => {
              made.answer = { status: 'created', artifactId: artifact.id, kind, title: artifact.title, revision, ...(handle !== undefined && { handle }) };
              if (isDocKind(kind)) base = { revision, state: store.service.readState(artifact.id).state };
              op.record(made.answer);
            };
            const files = isDocKind(kind) ? input.files : undefined;
            const creating = store.create({ kind, title: input.title, ...(handle !== undefined && { handle }), ...(content && { content }) }, actor, (artifact) => {
              made.artifact = artifact;
              if (!files) complete(artifact, store.revision(artifact.id));
            });
            // a Y kind's first files: written through the session's host replica in the batch that holds the entity row
            const { artifact } = made;
            const writing = files && artifact ? store.service.writeAs(artifact.id, actor, (doc) => void publisherOf(store, kind)(doc, {}, files, false), { inFrame: (revision) => complete(artifact, revision) }) : null;
            await creating;
            await writing;
            return made.answer!;
          },
          { actor },
        ),
      );
      const result = { ...recorded };
      // the session's base: what it just wrote (a replayed call leaves none for a Y kind: the agent reads first)
      if (base) store.service.replica(ctx.appSessionId, result.artifactId).base = base;
      if (page !== null) {
        const sha256 = createHash('sha256').update(page.bytes).digest('hex');
        deps.session.byteBases.set(result.artifactId, { revision: result.revision, sha256 });
        const version = fresh ? await mirrorPage(store, mirror, result, ctx.appSessionId, page.sourcePath, ctx.toolUseId) : await mirror.versionOf(result.artifactId, ctx.appSessionId, ctx.toolUseId);
        if (version !== null) Object.assign(result, { id: handle ?? result.artifactId, deliverableId: result.artifactId, version, externalReferences: externalReferenceCount(page.bytes.toString('utf8')) });
      } else if (kind === 'file' && fresh && content && 'path' in content) {
        await mirror.files([{ id: result.artifactId, path: content.path, title: result.title }], ctx.appSessionId, undefined, ctx.toolUseId);
      }
      if (!deps.session.guided.has(kind)) {
        deps.session.guided.add(kind);
        result.guide = KIND_GUIDES[kind];
      }
      if (DESIGN_CONTEXT_KINDS.includes(kind)) {
        const system = await store.designSystemContextFor(result.artifactId);
        if (system !== null) result.designSystem = system;
      }
      return toolText(result);
    }),
  );
}

// The page's X12 record, its copy the store's own content file.
async function mirrorPage(store: ArtifactStore, mirror: X12Mirror, created: ArtifactCreateResult, owner: AppSessionId, sourcePath: string | undefined, toolUseId: McpToolContext['toolUseId']): Promise<number | null> {
  const { path } = await store.readCommitted(() => store.contentRef(created.artifactId, created.revision));
  return mirror.page({ id: created.artifactId, title: created.title, ...(created.handle !== undefined && { handle: created.handle }) }, owner, { path, ...(sourcePath !== undefined && { sourcePath }) }, toolUseId);
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
