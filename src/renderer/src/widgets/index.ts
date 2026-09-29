// C11's widgets for C7's slash palette (C11 execution document, Interfaces "Widgets"): one `registerSlashWidget` call
// per name of `WIDGET_COMMANDS`, so every palette name opens a widget over the transcript. Called from App.tsx's C11
// block and the `#widgets` harness; the answer removes every registration it made.
import { registerSlashWidget, WIDGET_COMMANDS, type SlashWidget, type WidgetCommandName } from '../composer';
import { AgentsWidget } from './AgentsWidget';
import { CompactWidget } from './CompactWidget';
import { ConfigWidget } from './ConfigWidget';
import { ContextWidget } from './ContextWidget';
import { WIDGET_TITLE } from './copy';
import { DiffWidget } from './DiffWidget';
import { ExportWidget } from './ExportWidget';
import { HooksWidget } from './HooksWidget';
import { McpWidget } from './McpWidget';
import { MemoryWidget } from './MemoryWidget';
import { modelWidget } from './ModelWidget';
import { PermissionsWidget } from './PermissionsWidget';
import { PluginsWidget } from './PluginsWidget';
import { RenameWidget } from './RenameWidget';
import { ResumeWidget } from './ResumeWidget';
import { SandboxWidget } from './SandboxWidget';
import { SkillsWidget } from './SkillsWidget';
import { StatusWidget } from './StatusWidget';
import { UsageWidget } from './UsageWidget';

export const WIDGETS: Record<WidgetCommandName, SlashWidget['component']> = {
  model: modelWidget('model'),
  effort: modelWidget('effort'),
  fast: modelWidget('fast'),
  permissions: PermissionsWidget,
  usage: UsageWidget,
  config: ConfigWidget,
  plugins: PluginsWidget,
  mcp: McpWidget,
  sandbox: SandboxWidget,
  hooks: HooksWidget,
  memory: MemoryWidget,
  skills: SkillsWidget,
  agents: AgentsWidget,
  status: StatusWidget,
  compact: CompactWidget,
  context: ContextWidget,
  rename: RenameWidget,
  resume: ResumeWidget,
  export: ExportWidget,
  diff: DiffWidget,
};

export function registerAllWidgets(): () => void {
  const offs = WIDGET_COMMANDS.map((w) => w.name).map((name) => registerSlashWidget(name, { title: WIDGET_TITLE[name], component: WIDGETS[name] }));
  return () => offs.forEach((off) => off());
}

export { WidgetFrame, type WidgetFrameProps } from './WidgetFrame';
export { readIntoCache, useEngineRead, WidgetReadPolicyContext, type WidgetReadPolicy } from './read';
