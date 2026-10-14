// `send_file` (P1 X9 and X12; E1 execution document, M1 decisions; P3-A M6, X25): each path is resolved against the
// engine's working directory and must name an existing regular file; one that does not refuses the whole call before
// anything is written, so the model gets one error and retries once. Then each file becomes a `file` artifact in the
// artifact store, referenced in place and linked `created` to the session, all in one commit and idempotent by the
// call's tool-use id (P3-A Decision Log 11), and its X12 record is mirrored under the same id (Decision Log 4); the
// result lists those ids as the deliverable ids, its shape unchanged. With the store unavailable the files are still
// delivered, as X12 records alone. The transcript's delivery row is drawn from the call and its answer.
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { parseToolArguments, TOOL_ERRORS, type SendFileResult } from '@shared/maws/tools';
import type { DeliverableWriter } from '../deliverables/store';
import type { ArtifactStore } from '../documents/store';
import { actorOf, ArtifactSession, opIdOf } from './artifact-context';
import { defineMawsTool, toolError, toolText, type McpToolContext, type McpToolDefinition, type McpToolResult } from './server';
import { X12Mirror } from './x12-mirror';

interface SendFileDeps {
  deliverables: DeliverableWriter;
  artifacts?: () => ArtifactStore | null;
  log?: (line: string) => void;
  now?: () => Date;
  newId?: () => string;
  session?: ArtifactSession; // overlapping calls with one tool-use id answer one response
}

export function sendFileTool(deps: SendFileDeps): McpToolDefinition {
  const mirror = new X12Mirror(deps);
  return defineMawsTool('send_file', (args, ctx) => (deps.session ?? SOLO).joined(opIdOf(ctx), () => deliver(args, ctx)));
  async function deliver(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
    const parsed = parseToolArguments('send_file', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { files, caption } = parsed.data; // `urgency` is the row's (its event carries it), not the record's
    const store = deps.artifacts?.() ?? null;
    // a repeated call answers what the first one did, before its files are looked at again (their records written if
    // the first call never got that far)
    const replayed = store ? await store.replayOf(opIdOf(ctx)) : ({ found: false } as const);
    if (replayed.found) {
      const answer = replayed.result as SendFileResult;
      await mirrorMissing(deps, mirror, answer, ctx, caption);
      return toolText(answer);
    }
    const paths = files.map((file) => resolve(ctx.cwd, file));
    for (const path of paths) {
      const found = await stat(path).catch(() => null);
      if (!found?.isFile()) return toolError(TOOL_ERRORS.notAFile(path));
    }
    if (store === null) return recordsAlone(deps, paths, caption, ctx);
    // each file hashed now, streamed, so the delivery's savepoint below only records digests (the file stays in place)
    const digests: { sha256: string; size: number }[] = [];
    for (const path of paths) {
      const described = await store.files.describeStreamed(path).catch(() => null);
      if (!described) return toolError(TOOL_ERRORS.notAFile(path));
      digests.push({ sha256: described.sha256, size: described.size });
    }
    const result = await store.writeCommitted(() =>
      store.withOp(opIdOf(ctx), 'send_file', null, async (op) => {
        // one savepoint for the whole delivery: every artifact, its content and link, and the op row (createAll), so it
        // commits whole or not at all and a retry never duplicates a file
        let answer: SendFileResult | undefined;
        await store.createAll(
          paths.map((path, index) => ({ kind: 'file', title: basename(path), content: { path, digest: digests[index]! } })),
          actorOf(ctx),
          (artifacts) => {
            answer = { status: 'delivered', deliverables: artifacts.map((artifact, index) => ({ id: artifact.id, path: paths[index]!, name: basename(paths[index]!) })) };
            op.record(answer);
          },
        );
        return answer!;
      }),
    );
    await mirrorMissing(deps, mirror, result, ctx, caption);
    return toolText(result);
  }
}

const SOLO = new ArtifactSession(); // a send_file built without a session (tests): its calls join here

// The delivered files' X12 records (Decision Log 4), each written unless it is there already.
async function mirrorMissing(deps: SendFileDeps, mirror: X12Mirror, answer: SendFileResult, ctx: McpToolContext, caption: string | undefined): Promise<void> {
  const missing = [];
  for (const file of answer.deliverables) if (!(await deps.deliverables.get(ctx.appSessionId, file.id).catch(() => null))) missing.push({ id: file.id, path: file.path, title: file.name });
  if (missing.length > 0) await mirror.files(missing, ctx.appSessionId, caption, ctx.toolUseId);
}

// E1's delivery, for a run whose artifact store did not open: one X12 record per file.
async function recordsAlone(deps: SendFileDeps, paths: string[], caption: string | undefined, ctx: McpToolContext): Promise<McpToolResult> {
  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  const records: DeliverableRecord[] = paths.map((path) => ({
    id: deps.newId?.() ?? randomUUID(), appSessionId: ctx.appSessionId, kind: 'file', path, title: basename(path),
    ...(caption !== undefined && { caption }), versions: [{ path, at: createdAt }], ...(ctx.toolUseId !== null && { toolUseId: ctx.toolUseId }), createdAt,
  }));
  for (const record of records) {
    try {
      await deps.deliverables.write(record);
    } catch (error) {
      return toolError(`send_file: ${record.path} was not recorded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const result: SendFileResult = { status: 'delivered', deliverables: records.map((record) => ({ id: record.id, path: record.path, name: basename(record.path) })) };
  return toolText(result);
}
