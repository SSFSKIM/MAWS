// The six browser tools in the engine host (P1 X9 and X12; E4c execution document, Design §1 to §3 and §7). The host owns
// what the engine sees: it parses a call with the tool's input schema (the normaliser admits by the same schema), asks
// main through the browser bridge, and formats main's answer. Main owns everything that touches a page; its answer is
// checked against the tool's result schema before the model reads it, since a malformed success would be trusted. The
// formats: the result as one JSON text block; `browser_snapshot` adds the snapshot's text as a second block (Decision
// Log 12); `browser_screenshot` puts the image block first and the JSON second (E2's live-proven order), reading the
// picture from the file main wrote at the path the host named for the record, and writing the `screenshot` record
// (X12, `sourceUrl` additive) through the session's deliverable writer, which outlives the app (X13). The browser tools
// never read the engine's working directory.
import { randomUUID } from 'node:crypto';
import { readFile, stat, unlink } from 'node:fs/promises';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { MawsBrowserAnswerResult } from '@shared/ipc/schema/maws';
import { hostOf } from '@shared/browser/url';
import { BROWSER_SCREENSHOT_MAX_BYTES, BROWSER_TOOL_NAMES, browserToolResultSchemaOf, type BrowserScreenshotResult, type BrowserToolName } from '@shared/maws/browser';
import { DeliverableRecordSchema, type DeliverableRecord } from '@shared/maws/deliverable';
import { screenshotPath } from '@shared/maws/deliverable-files';
import { parseToolArguments, TOOL_ERRORS } from '@shared/maws/tools';
import type { DeliverableWriter } from '../deliverables/store';
import type { BrowserBridge, BrowserRequest } from './browser-bridge';
import { defineMawsTool, toolError, toolText, type McpToolDefinition, type McpToolResult } from './server';

export interface BrowserToolsDeps {
  bridge: BrowserBridge;
  deliverables: DeliverableWriter;
  userData: string; // where main writes a screenshot: the host and main derive the same path from it (Design §7)
  readFile?: (path: string) => Promise<Buffer>;
  now?: () => Date;
  newId?: () => string;
}

export function browserTools(deps: BrowserToolsDeps): McpToolDefinition[] {
  return BROWSER_TOOL_NAMES.map((tool) => defineMawsTool(tool, (args, ctx) => callBrowserTool(tool, args, ctx, deps)));
}

const malformed = (tool: BrowserToolName) => toolError(TOOL_ERRORS.actionFailed(tool, 'answer', '', 'malformed answer from MAWS'));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function callBrowserTool(tool: BrowserToolName, args: unknown, ctx: Parameters<McpToolDefinition['call']>[1], deps: BrowserToolsDeps): Promise<McpToolResult> {
  const parsed = parseToolArguments(tool, args);
  if (!parsed.ok) return toolError(parsed.error);
  const request: BrowserRequest = { requestId: ctx.requestId, toolUseId: ctx.toolUseId, tool, args: parsed.data };
  if (tool === 'browser_screenshot') {
    request.deliverableId = (deps.newId ?? randomUUID)();
    request.path = screenshotPath(deps.userData, ctx.appSessionId, request.deliverableId, 'png');
  }
  const outcome = await deps.bridge.request(request, ctx.signal);
  switch (outcome.kind) {
    case 'noClient':
      return toolError(TOOL_ERRORS.appNotOpen(tool));
    case 'timeout':
      return toolError(TOOL_ERRORS.browserTimeout(tool));
    case 'withdrawn': // never written: the server answers an aborted call with nothing
      return toolError(TOOL_ERRORS.interrupted(tool));
    case 'ended': // never written: the process is gone
      return toolError(`${tool}: the session ended`);
    case 'answered':
      break;
  }
  const answer = outcome.answer;
  if (!answer.ok) return toolError(answer.error); // main's text, from BROWSER_TOOL_ERRORS
  const result = browserToolResultSchemaOf(tool).safeParse(answer.result);
  if (!result.success) return malformed(tool);
  if (tool === 'browser_snapshot') {
    if (answer.text === undefined) return malformed(tool);
    return { content: [...toolText(result.data).content, { type: 'text', text: answer.text }] };
  }
  if (tool === 'browser_screenshot') return screenshotAnswer(result.data as BrowserScreenshotResult, answer, request, ctx, deps);
  return toolText(result.data);
}

// The picture main wrote, checked to be the file the host named for this record (the `.png`, or the `.jpg` beside it
// after the JPEG fallback), capped by its size before it is read (a refused one is removed: no record will name it),
// then read and recorded. A record is written only for a picture the model receives.
async function screenshotAnswer(
  result: BrowserScreenshotResult,
  answer: Extract<MawsBrowserAnswerResult, { ok: true }>,
  request: BrowserRequest,
  ctx: { appSessionId: AppSessionId; toolUseId: ToolUseId | null },
  deps: BrowserToolsDeps,
): Promise<McpToolResult> {
  const id = request.deliverableId!;
  const image = answer.image;
  if (!image || result.deliverableId !== id || result.path !== image.path || result.mimeType !== image.mimeType) return malformed('browser_screenshot');
  const path = screenshotPath(deps.userData, ctx.appSessionId, id, image.mimeType === 'image/png' ? 'png' : 'jpg');
  if (image.path !== path) return malformed('browser_screenshot');
  let bytes: Buffer;
  try {
    const { size } = await stat(path);
    if (size > BROWSER_SCREENSHOT_MAX_BYTES) {
      await unlink(path).catch(() => {}); // best effort: the answer is the refusal either way
      return toolError(TOOL_ERRORS.screenshotTooLarge(size));
    }
    bytes = await (deps.readFile ?? readFile)(path);
  } catch (error) {
    return toolError(TOOL_ERRORS.screenshotFailed(`the picture MAWS wrote could not be read (${messageOf(error)})`));
  }
  const at = (deps.now?.() ?? new Date()).toISOString();
  const title = result.title || hostOf(result.url);
  const toolUseId = ctx.toolUseId ?? undefined;
  const record: DeliverableRecord = {
    id, appSessionId: ctx.appSessionId, kind: 'screenshot', path,
    ...(title !== '' && { title }),
    // Decision Log 40: a tab that never navigated has no URL; the record leaves the field out rather than fail
    ...(SOURCE_URL.safeParse(result.url).success && { sourceUrl: result.url }),
    versions: [{ path, at, ...(toolUseId && { toolUseId }) }],
    ...(toolUseId && { toolUseId }),
    createdAt: at,
  };
  await deps.deliverables.exclusive(ctx.appSessionId, () => deps.deliverables.write(record));
  return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType: image.mimeType }, ...toolText(result).content] };
}

const SOURCE_URL = DeliverableRecordSchema.shape.sourceUrl.unwrap();
