// The message tools the desk reads (P4-R7; the owner's ruling of 2026-10-21): MAWS's own, and the to-human plugin's.
// MAWS reads only its own (`@shared/owner/message-call`); the desk shows the org's sessions, most of them terminal
// sessions that message their owner through the plugin's tool, so it reads both alike. The transcripts it hands MAWS's
// store name them (`source/desk-transcript.ts`, the source's `messageTools`), and its own readers of a call, a message
// streaming in (`view/streaming-rows.ts`) and a landing on one (`views/project/landed-message.ts`), read the same names.
import { MESSAGE_TOOLS } from '@shared/owner/message-call';

export const PLUGIN_MESSAGE_TOOL = 'mcp__to-human__message';
export const DESK_MESSAGE_TOOLS: readonly string[] = [...MESSAGE_TOOLS, PLUGIN_MESSAGE_TOOL];

export const isDeskMessageTool = (toolName: unknown): boolean => typeof toolName === 'string' && DESK_MESSAGE_TOOLS.includes(toolName);
