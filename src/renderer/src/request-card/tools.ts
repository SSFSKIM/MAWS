// What a permission request's tool does, in the card's words: the class that picks its preview and its verb, the files
// a file tool touches, and the MCP server a tool belongs to. Pure.
import type { SessionEvent } from '@shared/graph/events';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission.requested' }>;

export type ToolClass = 'command' | 'edit' | 'read' | 'search' | 'fetch' | 'web_search' | 'mcp' | 'other';

const CLASSES: Record<string, ToolClass> = {
  Bash: 'command',
  Edit: 'edit',
  Write: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Read: 'read',
  NotebookRead: 'read',
  LS: 'read',
  Glob: 'search',
  Grep: 'search',
  WebFetch: 'fetch',
  WebSearch: 'web_search',
};

export const toolClass = (toolName: string): ToolClass => CLASSES[toolName] ?? (toolName.startsWith('mcp__') ? 'mcp' : 'other');

export const field = (input: unknown, key: string): string | null => {
  const value = input !== null && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : null;
};

// The file a file tool writes or reads (`notebook_path` for notebooks, `path` for LS).
export const filePath = (input: unknown): string | null => field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path');

// The MCP server and the tool's own name: the engine's `mcp_server` when it sent one, else the `mcp__<server>__<tool>`
// name the engine gives every MCP tool.
export function mcpParts(ev: PermissionEvent): { server: string; source: string | null; tool: string } | null {
  if (toolClass(ev.toolName) !== 'mcp') return null;
  const [, server = '', ...rest] = ev.toolName.split('__');
  return { server: ev.mcpServer?.name ?? server, source: ev.mcpServer?.source ?? null, tool: rest.join('__') || ev.toolName };
}

// "<requester> wants to <verb>": the verb by tool class.
export function toolVerb(ev: PermissionEvent): string {
  switch (toolClass(ev.toolName)) {
    case 'command':
      return 'run a command';
    case 'edit':
      return 'edit 1 file';
    case 'read':
      return 'read a file';
    case 'search':
      return 'search files';
    case 'fetch':
      return 'fetch a page';
    case 'web_search':
      return 'search the web';
    case 'mcp':
      return `use a ${mcpParts(ev)!.server} tool`;
    case 'other':
      return `use ${ev.displayName ?? ev.toolName}`;
  }
}
