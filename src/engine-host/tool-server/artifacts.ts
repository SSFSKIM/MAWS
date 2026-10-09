// The artifact tools (P1 X9 and X12; E2 execution document, Design §6 and §7). `artifact_create` and `artifact_update`
// copy a self-contained HTML file the agent wrote into the store as the next version of an artifact, which MAWS keeps
// (A-3); `artifact_list` lists the session's artifacts; `artifact_screenshot` asks main to render one and returns the
// PNG as an image block before the text block. Every path is resolved against the engine's working directory and must
// name a regular `.html` or `.htm` file within ARTIFACT_MAX_BYTES before anything is written; a refusal writes nothing.
// The read, copy and rewrite of a version run inside the session's write chain, so two calls never interleave their
// version numbers. Create, update and list involve no window, so a session with no renderer serves them (X13); the
// screenshot's capture bridge has a deadline. The transcript's rows come from the calls and their answers.
//
// P2-E1 (G4, D10; P2 Decision Log 9): a side thread's tools also see its ancestors' artifacts. `artifactScope` is the
// thread's ancestor chain, nearest first, as main resolved it at launch (empty for any other session): update, list and
// screenshot resolve over [self, ...artifactScope], the nearest session holding the id owning it; an update writes the
// owner's next version inside the owner's write chain (shared by every session in the host), and a result about an
// ancestor's artifact names it in `ownerAppSessionId`. Create refuses an id an ancestor holds; a thread's own artifacts
// stay its own.
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_SCREENSHOT_DEFAULT,
  parseToolArguments,
  TOOL_ERRORS,
  type ArtifactCreateResult,
  type ArtifactListResult,
  type ArtifactScreenshotResult,
  type ArtifactToolName,
  type ArtifactUpdateResult,
  type ListedArtifact,
} from '@shared/maws/tools';
import type { DeliverableWriter } from '../deliverables/store';
import type { HostBridge } from './bridge';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

// What the host asks main to render (`maws.artifact.capture`, the session adding its app session id). P2-E1:
// `ownerAppSessionId` when the record is an ancestor's (main reads it there; the answer still routes by the requester).
export interface ArtifactCaptureRequest {
  requestId: RequestId;
  deliverableId: string;
  version: number;
  width: number;
  height: number;
  ownerAppSessionId?: AppSessionId;
}
export type CaptureBridge = HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>;

// P2-E1: the side thread's ancestors, nearest first (main's `artifactScopeOf`); absent or empty for any other session
type ArtifactScope = readonly AppSessionId[];

interface WriterDeps {
  deliverables: DeliverableWriter;
  artifactScope?: ArtifactScope; // P2-E1
  now?: () => Date;
  newId?: () => string;
}

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

// The source's refusal text, or null when it is a regular HTML file within the cap.
async function sourceProblem(tool: ArtifactToolName, path: string): Promise<string | null> {
  const found = await stat(path).catch(() => null);
  if (!found?.isFile()) return TOOL_ERRORS.artifactNotAFile(tool, path);
  if (!HTML_EXTENSIONS.has(extname(path).toLowerCase())) return TOOL_ERRORS.notHtml(tool, path);
  if (found.size > ARTIFACT_MAX_BYTES) return TOOL_ERRORS.tooLarge(tool, path, found.size);
  return null;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function artifactCreateTool(deps: WriterDeps): McpToolDefinition {
  return defineMawsTool('artifact_create', async (args, ctx) => {
    const parsed = parseToolArguments('artifact_create', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { id: artifactId, html_path, title } = parsed.data;
    const source = resolve(ctx.cwd, html_path);
    const problem = await sourceProblem('artifact_create', source);
    if (problem !== null) return toolError(problem);
    return deps.deliverables.exclusive(ctx.appSessionId, async () => {
      if ((await deps.deliverables.findArtifact(ctx.appSessionId, artifactId)) !== null) return toolError(TOOL_ERRORS.artifactExists(artifactId));
      if ((await nearestArtifact(deps.deliverables, deps.artifactScope ?? [], artifactId)) !== null) return toolError(TOOL_ERRORS.artifactExistsInParent(artifactId)); // P2-E1
      const id = deps.newId?.() ?? randomUUID();
      const at = (deps.now?.() ?? new Date()).toISOString();
      const toolUseId = ctx.toolUseId !== null ? { toolUseId: ctx.toolUseId } : {};
      let externalReferences: number;
      try {
        const copy = await deps.deliverables.copyVersion(ctx.appSessionId, id, 1, source);
        externalReferences = externalReferenceCount(copy.content.toString('utf8'));
        const record: DeliverableRecord = {
          id, appSessionId: ctx.appSessionId, kind: 'artifact', artifactId, title, path: copy.path,
          versions: [{ path: copy.path, at, ...toolUseId, sourcePath: source }], ...toolUseId, createdAt: at, updatedAt: at,
        };
        await deps.deliverables.write(record);
      } catch (error) {
        return toolError(TOOL_ERRORS.notRecorded('artifact_create', source, messageOf(error)));
      }
      const result: ArtifactCreateResult = { status: 'created', id: artifactId, deliverableId: id, version: 1, title, externalReferences };
      return toolText(result);
    });
  });
}

export function artifactUpdateTool(deps: WriterDeps): McpToolDefinition {
  return defineMawsTool('artifact_update', async (args, ctx) => {
    const parsed = parseToolArguments('artifact_update', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { id: artifactId, html_path, title } = parsed.data;
    const source = resolve(ctx.cwd, html_path);
    const problem = await sourceProblem('artifact_update', source);
    if (problem !== null) return toolError(problem);
    // P2-E1: the nearest session holding the id owns the write; the record is read again inside the owner's chain, so a
    // version another session wrote meanwhile is seen. An id none holds is refused from inside the session's own chain.
    const owner = deps.artifactScope?.length ? ((await nearestArtifact(deps.deliverables, scopeOf(ctx.appSessionId, deps.artifactScope), artifactId))?.owner ?? ctx.appSessionId) : ctx.appSessionId;
    return deps.deliverables.exclusive(owner, async () => {
      const record = await deps.deliverables.findArtifact(owner, artifactId);
      if (record === null) return toolError(TOOL_ERRORS.noArtifact('artifact_update', artifactId));
      const version = record.versions.length + 1;
      const at = (deps.now?.() ?? new Date()).toISOString();
      let updated: DeliverableRecord;
      let externalReferences: number;
      try {
        const copy = await deps.deliverables.copyVersion(owner, record.id, version, source);
        externalReferences = externalReferenceCount(copy.content.toString('utf8'));
        updated = {
          ...record, path: copy.path, ...(title !== undefined && { title }), updatedAt: at,
          versions: [...record.versions, { path: copy.path, at, ...(ctx.toolUseId !== null && { toolUseId: ctx.toolUseId }), sourcePath: source }],
        };
        await deps.deliverables.update(updated);
      } catch (error) {
        return toolError(TOOL_ERRORS.notRecorded('artifact_update', source, messageOf(error)));
      }
      const result: ArtifactUpdateResult = { status: 'updated', id: artifactId, deliverableId: record.id, version, title: titleOf(updated), externalReferences, ...ownerOf(owner, ctx.appSessionId) };
      return toolText(result);
    });
  });
}

export function artifactListTool(deps: { deliverables: DeliverableWriter; artifactScope?: ArtifactScope }): McpToolDefinition {
  return defineMawsTool('artifact_list', async (args, ctx) => {
    const parsed = parseToolArguments('artifact_list', args);
    if (!parsed.ok) return toolError(parsed.error);
    // P2-E1: its own artifacts, then each ancestor's in chain order, an id already listed nearer skipped
    const artifacts: ListedArtifact[] = [];
    const nearer = new Set<string>();
    for (const owner of scopeOf(ctx.appSessionId, deps.artifactScope)) {
      const records = (await artifactsOf(deps.deliverables, owner)).filter((record) => !nearer.has(record.artifactId!));
      for (const record of records) {
        artifacts.push({
          id: record.artifactId!, deliverableId: record.id, title: titleOf(record), versions: record.versions.length, createdAt: record.createdAt, updatedAt: record.updatedAt ?? record.createdAt,
          ...ownerOf(owner, ctx.appSessionId),
        });
      }
      for (const record of records) nearer.add(record.artifactId!);
    }
    const result: ArtifactListResult = { status: 'listed', artifacts };
    return toolText(result);
  });
}

// What a capture that settled without main's answer answers (never written when the call was withdrawn or ended).
const WITHDRAWN = 'artifact_screenshot: the request was withdrawn';
const ENDED = 'artifact_screenshot: the session ended';

export function artifactScreenshotTool(deps: { deliverables: DeliverableWriter; capture: CaptureBridge; artifactScope?: ArtifactScope }): McpToolDefinition {
  return defineMawsTool('artifact_screenshot', async (args, ctx) => {
    const parsed = parseToolArguments('artifact_screenshot', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { id: artifactId } = parsed.data;
    const found = await nearestArtifact(deps.deliverables, scopeOf(ctx.appSessionId, deps.artifactScope), artifactId); // P2-E1: resolved as an update is
    if (found === null) return toolError(TOOL_ERRORS.noArtifact('artifact_screenshot', artifactId));
    const { record } = found;
    const owner = ownerOf(found.owner, ctx.appSessionId);
    const versions = record.versions.length;
    const version = parsed.data.version ?? versions;
    if (version > versions) return toolError(TOOL_ERRORS.noVersion(artifactId, version, versions));
    const width = parsed.data.width ?? ARTIFACT_SCREENSHOT_DEFAULT.width;
    const height = parsed.data.height ?? ARTIFACT_SCREENSHOT_DEFAULT.height;
    const outcome = await deps.capture.request({ requestId: ctx.requestId, deliverableId: record.id, version, width, height, ...owner }, ctx.signal);
    switch (outcome.kind) {
      case 'timeout':
        return toolError(TOOL_ERRORS.captureTimeout);
      case 'withdrawn':
        return toolError(WITHDRAWN);
      case 'ended':
        return toolError(ENDED);
      case 'noClient':
        return toolError(TOOL_ERRORS.appNotOpen('artifact_screenshot')); // E10
      case 'answered':
        break;
    }
    const answer = outcome.answer;
    if (!answer.ok) return toolError(TOOL_ERRORS.captureFailed(answer.error));
    const result: ArtifactScreenshotResult = {
      status: 'captured', id: artifactId, deliverableId: record.id, title: titleOf(record), version, width: answer.width, height: answer.height,
      bytes: Buffer.from(answer.png, 'base64').length, consoleErrors: answer.consoleErrors, ...owner,
    };
    return { content: [{ type: 'image', data: answer.png, mimeType: 'image/png' }, ...toolText(result).content] };
  });
}

async function artifactsOf(deliverables: DeliverableWriter, appSessionId: AppSessionId): Promise<DeliverableRecord[]> {
  return (await deliverables.list(appSessionId)).filter((record) => record.kind === 'artifact' && record.artifactId !== undefined);
}

// P2-E1 start (2026-10-09): the scope's resolution. The sessions a call looks in, itself first; the nearest one's record
// holding the id (read outside any chain: a writer reads it again inside the owner's); the owner field a result carries,
// present only when the record is not the calling session's own.
const scopeOf = (self: AppSessionId, scope: ArtifactScope | undefined): AppSessionId[] => [self, ...(scope ?? [])];

async function nearestArtifact(deliverables: DeliverableWriter, sessions: readonly AppSessionId[], artifactId: string): Promise<{ owner: AppSessionId; record: DeliverableRecord } | null> {
  for (const owner of sessions) {
    const record = await deliverables.findArtifact(owner, artifactId);
    if (record !== null) return { owner, record };
  }
  return null;
}

const ownerOf = (owner: AppSessionId, self: AppSessionId): { ownerAppSessionId?: AppSessionId } => (owner === self ? {} : { ownerAppSessionId: owner });
// P2-E1 end

const titleOf = (record: DeliverableRecord): string => record.title ?? record.artifactId ?? record.id;

// How many http(s) URLs the page names where a browser would fetch them: `src` and `href` attributes, each candidate of
// a `srcset`, CSS `url(` and a string `@import` (one in `url(` form is counted by the `url(` pattern). Advisory to the
// agent, a regex over the text: the frame loads none of them.
const ATTRIBUTE = /\b(?:src|href)\s*=\s*["']?\s*https?:\/\//gi;
const SRCSET = /\bsrcset\s*=\s*(["'])([\s\S]*?)\1/gi;
const CSS_URL = /url\(\s*["']?\s*https?:\/\//gi;
const CSS_IMPORT = /@import\s+["']\s*https?:\/\//gi;
const URL_START = /https?:\/\//gi;

export function externalReferenceCount(html: string): number {
  const count = (pattern: RegExp, text: string) => text.match(pattern)?.length ?? 0;
  let srcset = 0;
  for (const match of html.matchAll(SRCSET)) srcset += count(URL_START, match[2]!);
  return count(ATTRIBUTE, html) + srcset + count(CSS_URL, html) + count(CSS_IMPORT, html);
}
