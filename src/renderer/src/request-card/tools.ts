// What a permission request's tool does, in the card's words: the class that picks its preview and its verb, the files
// a file tool touches, and the MCP server a tool belongs to. Pure.
import type { SessionEvent } from '@shared/graph/events';
import type { Proposed } from './preview/proposed';

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

// The file rows a file tool touches: its own path and any path an individual edit names, each once.
export function filePaths(input: unknown): string[] {
  const edits = input !== null && typeof input === 'object' && Array.isArray((input as { edits?: unknown }).edits) ? (input as { edits: unknown[] }).edits : [];
  const paths = [filePath(input), ...edits.map((edit) => field(edit, 'file_path'))].filter((path): path is string => path !== null);
  return [...new Set(paths)];
}

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

// UX wave U1a (§D): what a permission prompt asks, the card's first line, by the tool's class. A file tool names its file
// or counts several: "Create <name>" or "Edit <name>" as its diff against the file read says (§I), else "Write <name>"
// for the Write tool and "Edit <name>" for the others.
export function askedLine(ev: PermissionEvent, proposed: Proposed | null = null): string {
  switch (toolClass(ev.toolName)) {
    case 'command':
      return 'Run a command';
    case 'edit': {
      const paths = filePaths(ev.input);
      if (paths.length > 1) return `Edit ${paths.length} files`;
      const name = paths.length === 1 ? baseName(paths[0]!) : 'a file';
      if (proposed?.kind === 'diff') return proposed.change === 'create' ? `Create ${name}` : `Edit ${name}`;
      return ev.toolName === 'Write' ? `Write ${name}` : `Edit ${name}`;
    }
    case 'read':
      return 'Read a file';
    case 'search':
      return 'Search files';
    case 'fetch':
      return 'Fetch a page';
    case 'web_search':
      return 'Search the web';
    case 'mcp': {
      const { server, tool } = mcpParts(ev)!;
      return `Use ${server} · ${tool}`;
    }
    case 'other':
      return `Use ${ev.displayName ?? ev.toolName}`;
  }
}

const baseName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path;

// UX wave U1a (§I): a file's path as the card shows it, relative to the session's working folder when it lies inside it,
// whole otherwise (and where the window knows no folder: null, or the '' a record that names none holds).
export function pathIn(path: string, folder: string | null): string {
  if (folder === null || folder === '') return path;
  const root = folder.endsWith('/') ? folder : `${folder}/`;
  return path.startsWith(root) && path.length > root.length ? path.slice(root.length) : path;
}
