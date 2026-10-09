// C11's widgets for C7's slash palette (C11 execution document, Interfaces "Widgets"): one `registerSlashWidget` call
// per name of `WIDGET_COMMANDS`, so every palette name opens a widget (W3: the model selector's three in the model chip). Called from App.tsx's C11
// block and the `#widgets` harness; the answer removes every registration it made.
import { registerSlashWidget, WIDGET_COMMANDS, type SlashWidget, type WidgetCommandName } from '../composer';
import { BtwWidget } from '../side/BtwWidget'; // E3
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
import { modelSelector } from './ModelSelector';
import { PermissionsWidget } from './PermissionsWidget';
import { PluginsWidget } from './PluginsWidget';
import { ReloadPluginsWidget } from './ReloadPluginsWidget'; // E11 §2.2
import { RenameWidget } from './RenameWidget';
import { ResumeWidget } from './ResumeWidget';
import { RewindWidget } from './RewindWidget'; // W3 (B7)
import { SandboxWidget } from './SandboxWidget';
import { SkillsWidget } from './SkillsWidget';
import { StatusWidget } from './StatusWidget';
import { TYPED_APPLY } from './typed';
import { UsageWidget } from './UsageWidget';

export const WIDGETS: Record<WidgetCommandName, SlashWidget['component']> = {
  model: modelSelector('model'),
  effort: modelSelector('effort'),
  fast: modelSelector('fast'),
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
  rewind: RewindWidget, // W3 (B7)
  btw: BtwWidget, // E3: registered here alone; its typed apply is `applyBtw` (TYPED_APPLY)
  'reload-plugins': ReloadPluginsWidget, // E11 §2.2
};

// W3: `/model`, `/effort` and `/fast` are the model selector, which opens in the composer's model chip menu.
const IN_MODEL_CHIP: ReadonlySet<WidgetCommandName> = new Set(['model', 'effort', 'fast']);
// P2-B (2026-10-09; X19): the libraries open in the library box. P2-D (2026-10-09): `/resume`'s chooser too; the union
// of B's `plugins` and `skills` and D's `resume`, made by B as the second to land.
const LIBRARY: ReadonlySet<WidgetCommandName> = new Set(['plugins', 'skills', 'resume']);

export function registerAllWidgets(): () => void {
  const offs = WIDGET_COMMANDS.map((w) => w.name).map((name) =>
    registerSlashWidget(name, {
      title: WIDGET_TITLE[name],
      component: WIDGETS[name],
      apply: TYPED_APPLY[name],
      ...(IN_MODEL_CHIP.has(name) && { placement: 'modelChip' as const }),
      ...(LIBRARY.has(name) && { size: 'library' as const }), // P2-B (2026-10-09)
    }),
  );
  return () => offs.forEach((off) => off());
}

export { WidgetFrame, type WidgetFrameProps } from './WidgetFrame';
export { readIntoCache, useEngineRead, WidgetReadPolicyContext, type WidgetReadPolicy } from './read';
