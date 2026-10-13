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
import { actorOf, opIdOf } from './artifact-context';
import { defineMawsTool, toolError, toolText, type McpToolContext, type McpToolDefinition, type McpToolResult } from './server';
import { X12Mirror } from './x12-mirror';

interface SendFileDeps {
  deliverables: DeliverableWriter;
  artifacts?: () => ArtifactStore | null;
  log?: (line: string) => void;
  now?: () => Date;
  newId?: () => string;
}

export function sendFileTool(deps: SendFileDeps): McpToolDefinition {
  const mirror = new X12Mirror(deps);
  return defineMawsTool('send_file', async (args, ctx) => {
    const parsed = parseToolArguments('send_file', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { files, caption } = parsed.data; // `urgency` is the row's (its event carries it), not the record's
    const paths = files.map((file) => resolve(ctx.cwd, file));
    for (const path of paths) {
      const found = await stat(path).catch(() => null);
      if (!found?.isFile()) return toolError(TOOL_ERRORS.notAFile(path));
    }
    const store = deps.artifacts?.() ?? null;
    if (store === null) return recordsAlone(deps, paths, caption, ctx);
    let fresh = false;
    const result = await store.writeCommitted(() =>
      store.withOp(opIdOf(ctx), 'send_file', null, async (op) => {
        fresh = true;
        // every create's rows join the one open batch (each validates and writes synchronously), the answer recorded in
        // the last one's savepoint, so the delivery commits whole or not at all
        const answer: SendFileResult = { status: 'delivered', deliverables: [] };
        const creating = paths.map((path, index) =>
          store.create({ kind: 'file', title: basename(path), content: { path } }, actorOf(ctx), (artifact) => {
            answer.deliverables.push({ id: artifact.id, path, name: basename(path) });
            if (index === paths.length - 1) op.record(answer);
          }),
        );
        await Promise.all(creating);
        return answer;
      }),
    );
    if (fresh) await mirror.files(result.deliverables.map((file) => ({ id: file.id, path: file.path, title: file.name })), ctx.appSessionId, caption, ctx.toolUseId);
    return toolText(result);
  });
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
