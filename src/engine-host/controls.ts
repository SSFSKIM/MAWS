// The control catalogue (C3 execution document, Interfaces "Control channel"): every outbound subtype the host issues,
// its timeout class, its typed response schema, and one function per subtype so callers never spell a subtype string.
// Request and response types live in src/shared/wire/control.ts (C1's file, C3's delimited block). A subtype absent
// here (`fork_conversation`, which the engine answers `unsupported`) goes through `ControlClient.requestRaw`.
import * as z from 'zod';
import type { RequestId } from '@shared/graph/ids';
import type * as C from '@shared/wire/control';
import {
  CancelAsyncMessageResponseSchema,
  ClaimSessionResponseSchema,
  ExportConversationResponseSchema,
  GenerateSessionTitleResponseSchema,
  GetBinaryVersionResponseSchema,
  GetContextUsageResponseSchema,
  GetHooksListingResponseSchema,
  GetMemoryDialogResponseSchema,
  GetSandboxDialogResponseSchema,
  GetSessionCostResponseSchema,
  GetSettingsResponseSchema,
  GetSkillsDialogResponseSchema,
  GetStatusResponseSchema,
  GetUsageResponseSchema,
  GetWorkspaceDiffResponseSchema,
  InitializeResponseSchema,
  InterruptResponseSchema,
  ListModelsResponseSchema,
  ListPermissionRulesResponseSchema,
  McpStatusResponseSchema,
  ReloadPluginsResponseSchema,
  RenameSessionResponseSchema,
  RewindConversationResponseSchema,
  RewindFilesResponseSchema,
  SetCwdResponseSchema,
  SetPermissionModeResponseSchema,
  SideQuestionResponseSchema,
  VoidResponseSchema,
} from '@shared/wire/control';
import type { ControlClient } from './rpc';

export type RequestClass = 'read' | 'mutate' | 'interrupt' | 'long' | 'human';

// The three bounded classes fit under X2's 10 s router timeout with the two IPC hops to spare; `long` is never
// awaited by a synchronous X2 command (operations answer a receipt and complete through `session.operation`).
export const REQUEST_TIMEOUT_MS: Record<Exclude<RequestClass, 'human'>, number> = { read: 8_000, mutate: 8_000, interrupt: 8_000, long: 120_000 };

// One row per subtype: request payload type, response schema, timeout class.
interface Control<Req, Res extends z.ZodType> { request: Req; response: Res; klass: Exclude<RequestClass, 'human'> }
const control = <Req, Res extends z.ZodType>(response: Res, klass: Exclude<RequestClass, 'human'>): Control<Req, Res> =>
  ({ response, klass }) as Control<Req, Res>;

export const CONTROLS = {
  // reads
  get_usage: control<C.EmptyRequest, typeof GetUsageResponseSchema>(GetUsageResponseSchema, 'read'),
  get_context_usage: control<C.GetContextUsageRequest, typeof GetContextUsageResponseSchema>(GetContextUsageResponseSchema, 'read'),
  get_settings: control<C.EmptyRequest, typeof GetSettingsResponseSchema>(GetSettingsResponseSchema, 'read'),
  list_permission_rules: control<C.EmptyRequest, typeof ListPermissionRulesResponseSchema>(ListPermissionRulesResponseSchema, 'read'),
  get_hooks_listing: control<C.EmptyRequest, typeof GetHooksListingResponseSchema>(GetHooksListingResponseSchema, 'read'),
  get_memory_dialog: control<C.EmptyRequest, typeof GetMemoryDialogResponseSchema>(GetMemoryDialogResponseSchema, 'read'),
  get_skills_dialog: control<C.EmptyRequest, typeof GetSkillsDialogResponseSchema>(GetSkillsDialogResponseSchema, 'read'),
  get_sandbox_dialog: control<C.EmptyRequest, typeof GetSandboxDialogResponseSchema>(GetSandboxDialogResponseSchema, 'read'),
  get_workspace_diff: control<C.EmptyRequest, typeof GetWorkspaceDiffResponseSchema>(GetWorkspaceDiffResponseSchema, 'read'),
  export_conversation: control<C.EmptyRequest, typeof ExportConversationResponseSchema>(ExportConversationResponseSchema, 'read'),
  get_status: control<C.EmptyRequest, typeof GetStatusResponseSchema>(GetStatusResponseSchema, 'read'),
  mcp_status: control<C.EmptyRequest, typeof McpStatusResponseSchema>(McpStatusResponseSchema, 'read'),
  list_models: control<C.EmptyRequest, typeof ListModelsResponseSchema>(ListModelsResponseSchema, 'read'),
  get_session_cost: control<C.EmptyRequest, typeof GetSessionCostResponseSchema>(GetSessionCostResponseSchema, 'read'),
  get_binary_version: control<C.EmptyRequest, typeof GetBinaryVersionResponseSchema>(GetBinaryVersionResponseSchema, 'read'),
  // mutations
  set_permission_mode: control<C.SetPermissionModeRequest, typeof SetPermissionModeResponseSchema>(SetPermissionModeResponseSchema, 'mutate'),
  set_model: control<C.SetModelRequest, typeof VoidResponseSchema>(VoidResponseSchema, 'mutate'),
  set_max_thinking_tokens: control<C.SetMaxThinkingTokensRequest, typeof VoidResponseSchema>(VoidResponseSchema, 'mutate'),
  apply_flag_settings: control<C.ApplyFlagSettingsRequest, typeof VoidResponseSchema>(VoidResponseSchema, 'mutate'),
  rename_session: control<C.RenameSessionRequest, typeof RenameSessionResponseSchema>(RenameSessionResponseSchema, 'mutate'),
  stop_task: control<C.StopTaskRequest, typeof VoidResponseSchema>(VoidResponseSchema, 'mutate'),
  background_tasks: control<C.BackgroundTasksRequest, typeof VoidResponseSchema>(VoidResponseSchema, 'mutate'),
  cancel_async_message: control<C.CancelAsyncMessageRequest, typeof CancelAsyncMessageResponseSchema>(CancelAsyncMessageResponseSchema, 'mutate'),
  set_cwd: control<C.SetCwdRequest, typeof SetCwdResponseSchema>(SetCwdResponseSchema, 'mutate'),
  rewind_conversation: control<C.RewindConversationRequest, typeof RewindConversationResponseSchema>(RewindConversationResponseSchema, 'mutate'),
  rewind_files: control<C.RewindFilesRequest, typeof RewindFilesResponseSchema>(RewindFilesResponseSchema, 'mutate'), // a dry run is a read in spirit; same 8 s bound
  end_session: control<C.EndSessionRequest, typeof VoidResponseSchema>(VoidResponseSchema, 'mutate'),
  // interrupt
  interrupt: control<C.InterruptRequest, typeof InterruptResponseSchema>(InterruptResponseSchema, 'interrupt'),
  // long: the launch path, title generation, side questions, plugin reloads and MCP server lifecycle
  initialize: control<C.InitializeRequest, typeof InitializeResponseSchema>(InitializeResponseSchema, 'long'),
  claim_session: control<C.ClaimSessionRequest, typeof ClaimSessionResponseSchema>(ClaimSessionResponseSchema, 'long'),
  generate_session_title: control<C.GenerateSessionTitleRequest, typeof GenerateSessionTitleResponseSchema>(GenerateSessionTitleResponseSchema, 'long'),
  side_question: control<C.SideQuestionRequest, typeof SideQuestionResponseSchema>(SideQuestionResponseSchema, 'long'),
  reload_plugins: control<C.EmptyRequest, typeof ReloadPluginsResponseSchema>(ReloadPluginsResponseSchema, 'long'),
  mcp_reconnect: control<C.McpReconnectRequest, typeof VoidResponseSchema>(VoidResponseSchema, 'long'),
  mcp_toggle: control<C.McpToggleRequest, typeof VoidResponseSchema>(VoidResponseSchema, 'long'),
} as const;

export type OutboundSubtype = keyof typeof CONTROLS;
export const OUTBOUND_SUBTYPES = Object.keys(CONTROLS) as OutboundSubtype[];
export type OutboundRequest<S extends OutboundSubtype> = (typeof CONTROLS)[S]['request'];
export type OutboundResponse<S extends OutboundSubtype> = z.infer<(typeof CONTROLS)[S]['response']>;

export function isOutboundSubtype(subtype: string): subtype is OutboundSubtype {
  return Object.hasOwn(CONTROLS, subtype);
}

export function requestClassOf(subtype: string): Exclude<RequestClass, 'human'> {
  return isOutboundSubtype(subtype) ? CONTROLS[subtype].klass : 'mutate';
}

// ---------------------------------------------------------------------------------------------------------------------
// One function per subtype. `opts` is the client's (`timeoutMs`, `signal`).

// `onWritten` runs once the request frame reached the pipe, with the minted id (an operation's receipt, M5).
export type RequestOptions = { timeoutMs?: number; signal?: AbortSignal; onWritten?: (requestId: RequestId) => void };
type Fn<S extends OutboundSubtype> = (client: ControlClient, payload: OutboundRequest<S>, opts?: RequestOptions) => Promise<OutboundResponse<S>>;
const fn =
  <S extends OutboundSubtype>(subtype: S): Fn<S> =>
  (client, payload, opts) =>
    client.request(subtype, payload, opts);

export const getUsage = fn('get_usage');
export const getContextUsage = fn('get_context_usage');
export const getSettings = fn('get_settings');
export const listPermissionRules = fn('list_permission_rules');
export const getHooksListing = fn('get_hooks_listing');
export const getMemoryDialog = fn('get_memory_dialog');
export const getSkillsDialog = fn('get_skills_dialog');
export const getSandboxDialog = fn('get_sandbox_dialog');
export const getWorkspaceDiff = fn('get_workspace_diff');
export const exportConversation = fn('export_conversation');
export const getStatus = fn('get_status');
export const mcpStatus = fn('mcp_status');
export const listModels = fn('list_models');
export const getSessionCost = fn('get_session_cost');
export const getBinaryVersion = fn('get_binary_version');
export const setPermissionMode = fn('set_permission_mode');
export const setModel = fn('set_model');
export const setMaxThinkingTokens = fn('set_max_thinking_tokens');
export const applyFlagSettings = fn('apply_flag_settings');
export const renameSession = fn('rename_session');
export const stopTask = fn('stop_task');
export const backgroundTasks = fn('background_tasks');
export const cancelAsyncMessage = fn('cancel_async_message');
export const setCwd = fn('set_cwd');
export const rewindConversation = fn('rewind_conversation');
export const rewindFiles = fn('rewind_files');
export const endSession = fn('end_session');
export const interrupt = fn('interrupt');
export const initialize = fn('initialize');
export const claimSession = fn('claim_session');
export const generateSessionTitle = fn('generate_session_title');
export const sideQuestion = fn('side_question');
export const reloadPlugins = fn('reload_plugins');
export const mcpReconnect = fn('mcp_reconnect');
export const mcpToggle = fn('mcp_toggle');
