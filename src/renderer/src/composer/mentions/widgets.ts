// The slash palette's widgets (C7 execution document, "Mentions, palette and the "+" menu"): the declared widget
// catalogue, every name of which is a palette item whether or not the engine's catalogue lists it (ten of these exist
// only as terminal menus), and the registry through which C11 supplies a widget per name. A registered widget opens for
// its name whatever the item's origin.
import { useSyncExternalStore, type ComponentType } from 'react';
import type { AppSessionId } from '@shared/graph/ids';

export const WIDGET_COMMANDS = [
  { name: 'model', description: 'Choose the model for this session' },
  { name: 'effort', description: 'Set the effort level' },
  { name: 'fast', description: 'Toggle fast mode' },
  { name: 'permissions', description: 'Review and edit permission rules' },
  { name: 'usage', description: 'Plan usage and what counts against it' },
  { name: 'config', description: 'Settings for this session' },
  { name: 'plugins', description: 'Browse and manage plugins' },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'sandbox', description: 'Sandbox settings' },
  { name: 'hooks', description: 'Review configured hooks' },
  { name: 'memory', description: 'Edit memory files' },
  { name: 'skills', description: 'Browse available skills' },
  { name: 'agents', description: 'Browse and manage agents' },
  { name: 'status', description: 'Session and account status' },
  { name: 'compact', description: 'Free up context by summarising the conversation' },
  { name: 'context', description: 'Context usage' },
  { name: 'rename', description: 'Rename this session' },
  { name: 'resume', description: 'Resume another session' },
  { name: 'export', description: 'Export the conversation' },
  { name: 'diff', description: 'Changes in the working tree' },
] as const satisfies ReadonlyArray<{ name: string; description: string }>;

export type WidgetCommandName = (typeof WIDGET_COMMANDS)[number]['name'];

export interface SlashWidget {
  title: string;
  component: ComponentType<{ appSessionId: AppSessionId; args: string; close(): void }>;
  // C11 start: a typed `/<name> <args>` whose argument the widget resolves fully is applied through the widget's own
  // control path with no widget shown (the architect's correction of 2026-09-29); resolves false to open it instead.
  apply?: (appSessionId: AppSessionId, args: string) => Promise<boolean>;
  // C11 end
}

const widgets = new Map<string, SlashWidget>();
const listeners = new Set<() => void>();
let names: ReadonlySet<string> = new Set();

function changed(): void {
  names = new Set(widgets.keys());
  listeners.forEach((listener) => listener());
}

// The latest registration for a name wins; the disposer removes only its own.
export function registerSlashWidget(name: WidgetCommandName, widget: SlashWidget): () => void {
  widgets.set(name, widget);
  changed();
  return () => {
    if (widgets.get(name) !== widget) return;
    widgets.delete(name);
    changed();
  };
}

export const slashWidget = (name: string): SlashWidget | null => widgets.get(name) ?? null;
export const registeredWidgetNames = (): ReadonlySet<string> => names;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
// The registered names; a new set whenever a registration comes or goes.
export const useRegisteredWidgets = (): ReadonlySet<string> => useSyncExternalStore(subscribe, registeredWidgetNames);
