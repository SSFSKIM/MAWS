// Which requests may be answered outside the session pane (charter §5.1: approve from the hover card only for
// read-only tools). Shared so C5's hover card and C7's request card agree.
import type { SessionEvent } from '../graph/events';

export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoRead', 'WebSearch', 'WebFetch', 'ListMcpResourcesTool', 'ReadMcpResourceTool'] as const;
const READ_ONLY = new Set<string>(READ_ONLY_TOOLS);

// A `permission.requested` whose tool is in the set; everything else (Bash, Edit, Write, MultiEdit, NotebookEdit, Task,
// MCP tools, unknown names, other request kinds) is not.
export function isReadOnlyRequest(event: SessionEvent | null): boolean {
  return event?.kind === 'permission.requested' && READ_ONLY.has(event.toolName);
}
