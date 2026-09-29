// A permission request's input, bounded per tool class (C7 execution document, Request card, permission row): a
// command in a mono block (Expand past six lines) with its description as `Why:`; a file edit as the file and a
// bounded before and after; reads and searches as paths and patterns; a fetch or search as its URL or query; an MCP or
// unknown tool as pretty JSON, eight lines then scroll. The primary value carries `data-testid="request-input"` in
// every placement (C5's smoke reads it).
import { useState } from 'react';
import type { SessionEvent } from '@shared/graph/events';
import { pretty } from '../controls';
import { field, filePath, mcpParts, toolClass } from '../tools';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission.requested' }>;

const COMMAND_LINES = 6;
const MONO = 'm-0 overflow-auto rounded-sm border border-border bg-bg px-2.5 py-2 font-mono text-ui-sm break-words whitespace-pre-wrap';

function Command({ command, description }: { command: string; description: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const long = command.split('\n').length > COMMAND_LINES;
  return (
    <div className="flex flex-col gap-1">
      <pre data-testid="request-input" className={`${MONO} ${long && !expanded ? 'max-h-[6lh] overflow-hidden' : 'max-h-[24lh]'}`}>
        {command}
      </pre>
      {long && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="self-start text-ui-sm text-fg-muted underline outline-accent focus-visible:outline-2">
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      )}
      {description && <p className="m-0 text-ui-sm text-fg-muted">Why: {description}</p>}
    </div>
  );
}

// One edit: the text replaced and its replacement, each bounded.
function Change({ before, after }: { before: string | null; after: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      {before !== null && before !== '' && <pre className={`${MONO} max-h-[6lh] bg-diff-del-bg`}>{before}</pre>}
      {after !== null && <pre className={`${MONO} max-h-[6lh] bg-diff-add-bg`}>{after}</pre>}
    </div>
  );
}

function edits(ev: PermissionEvent): { before: string | null; after: string | null }[] {
  const input = ev.input as Record<string, unknown> | null;
  switch (ev.toolName) {
    case 'Edit':
      return [{ before: field(input, 'old_string'), after: field(input, 'new_string') }];
    case 'MultiEdit':
      return Array.isArray(input?.edits) ? input.edits.map((e) => ({ before: field(e, 'old_string'), after: field(e, 'new_string') })) : [];
    case 'Write':
      return [{ before: null, after: field(input, 'content') }];
    case 'NotebookEdit':
      return [{ before: null, after: field(input, 'new_source') }];
    default:
      return [];
  }
}

export function ToolPreview({ request, compact = false }: { request: PermissionEvent; compact?: boolean }) {
  const { input } = request;
  switch (toolClass(request.toolName)) {
    case 'command':
      return <Command command={field(input, 'command') ?? pretty(input)} description={field(input, 'description') ?? request.description} />;
    case 'edit': {
      const path = filePath(input);
      return (
        <div className="flex flex-col gap-1.5">
          <p data-testid="request-input" className="m-0 truncate font-mono text-ui-sm text-fg" title={path ?? undefined}>
            {path ?? request.toolName}
          </p>
          {!compact && edits(request).map((change, i) => <Change key={i} {...change} />)}
        </div>
      );
    }
    case 'read':
    case 'search': {
      const shown = [field(input, 'pattern'), filePath(input)].filter((part): part is string => part !== null);
      return (
        <pre data-testid="request-input" className={`${MONO} max-h-[4lh]`}>
          {shown.length > 0 ? shown.join('\n') : pretty(input)}
        </pre>
      );
    }
    case 'fetch':
    case 'web_search':
      return (
        <pre data-testid="request-input" className={`${MONO} max-h-[4lh]`}>
          {field(input, 'url') ?? field(input, 'query') ?? pretty(input)}
        </pre>
      );
    case 'mcp':
    case 'other': {
      const mcp = mcpParts(request);
      return (
        <div className="flex flex-col gap-1">
          {mcp && (
            <p className="m-0 text-ui-sm text-fg-muted">
              {mcp.server}
              {mcp.source && ` (${mcp.source})`} · {mcp.tool}
            </p>
          )}
          <pre data-testid="request-input" className={`${MONO} max-h-[8lh]`}>
            {pretty(input)}
          </pre>
        </div>
      );
    }
  }
}
