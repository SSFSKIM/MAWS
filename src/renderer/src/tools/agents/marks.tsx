// The agent tools' icons and a background task's kind mark (the UX wave's U8b document, M7 decision 1; Interfaces §F):
// a shell is marked with the Terminal tool's icon, a workflow with the Subagents tool's, a monitor and a task of another
// kind with the Background tasks tool's, since the panel's sections and the Background tasks card no longer say the
// kind. Here, not in either tool's module, so a row draws them without a cycle through its tool.
import { Icon } from '../../app/IconButton';
import { usePanelHost } from '../../panel/host';
import type { TaskKind } from './model/task-graph';

export function SubagentsIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M8 6v2M8 8l-3 2.4M8 8l3 2.4" />
    </Icon>
  );
}

export function BackgroundIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5 6.5h6M5 9.5h3.5" />
    </Icon>
  );
}

// The Terminal tool's own icon, read from its registration (its module is the terminal's, heavy to import here).
const TERMINAL_TOOL_ID = 'terminal';

export function KindMark({ kind, className = 'size-3.5' }: { kind: TaskKind; className?: string }) {
  const terminal = usePanelHost((s) => s.tools.get(TERMINAL_TOOL_ID));
  return (
    <span data-kind-mark={kind} aria-hidden className="flex shrink-0 text-fg-muted">
      {kind === 'shell' ? terminal && <terminal.icon className={className} /> : kind === 'workflow' ? <SubagentsIcon className={className} /> : <BackgroundIcon className={className} />}
    </span>
  );
}
