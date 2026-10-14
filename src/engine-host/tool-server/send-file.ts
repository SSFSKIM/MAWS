// `send_file` (P1 X9 and X12; E1 execution document, M1 decisions; P3-A M6, X25): each path is resolved against the
// engine's working directory and must name an existing regular file; one that does not refuses the whole call before
// anything is written, so the model gets one error and retries once. Then each file becomes a `file` artifact in the
// artifact store, referenced in place and linked `created` to the session, all in one commit and idempotent by the
// call's tool-use id (P3-A Decision Log 11); the result lists those ids as the deliverable ids, its shape unchanged
// (P3-L's cutover keeps the name). With the store unavailable nothing is delivered and the call says so. The caption
// and the urgency are the transcript's delivery row's (its event carries them), not the artifact's.
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseToolArguments, TOOL_ERRORS, type SendFileResult } from '@shared/maws/tools';
import type { ArtifactStore } from '../documents/store';
import { actorOf, ArtifactSession, opIdOf } from './artifact-context';
import { defineMawsTool, toolError, toolText, type McpToolContext, type McpToolDefinition, type McpToolResult } from './server';

interface SendFileDeps {
  artifacts?: () => ArtifactStore | null;
  session?: ArtifactSession; // overlapping calls with one tool-use id answer one response
}

export function sendFileTool(deps: SendFileDeps): McpToolDefinition {
  return defineMawsTool('send_file', (args, ctx) => (deps.session ?? SOLO).joined(opIdOf(ctx), () => deliver(args, ctx)));
  async function deliver(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
    const parsed = parseToolArguments('send_file', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { files } = parsed.data;
    const store = deps.artifacts?.() ?? null;
    if (store === null) return toolError(TOOL_ERRORS.deliveryUnavailable);
    // a repeated call answers what the first one did, before its files are looked at again
    const replayed = await store.replayOf(opIdOf(ctx));
    if (replayed.found) return toolText(replayed.result as SendFileResult);
    const paths = files.map((file) => resolve(ctx.cwd, file));
    for (const path of paths) {
      const found = await stat(path).catch(() => null);
      if (!found?.isFile()) return toolError(TOOL_ERRORS.notAFile(path));
    }
    const result = await store.writeCommitted(() =>
      store.withOp(opIdOf(ctx), 'send_file', null, async (op) => {
        // one savepoint for the whole delivery: every artifact, its content and link, and the op row (createAll), so it
        // commits whole or not at all and a retry never duplicates a file
        let answer: SendFileResult | undefined;
        await store.createAll(
          paths.map((path) => ({ kind: 'file', title: basename(path), content: { path } })),
          actorOf(ctx),
          (artifacts) => {
            answer = { status: 'delivered', deliverables: artifacts.map((artifact, index) => ({ id: artifact.id, path: paths[index]!, name: basename(paths[index]!) })) };
            op.record(answer);
          },
        );
        return answer!;
      }),
    );
    return toolText(result);
  }
}

const SOLO = new ArtifactSession(); // a send_file built without a session (tests): its calls join here
