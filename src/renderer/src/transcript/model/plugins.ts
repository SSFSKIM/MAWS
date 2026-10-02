// R1 (charter D-9 as amended 2026-10-01): the plugins' pinned status lines a session's transcript state holds
// (reduce.ts, `pluginStatus`, the most recently set last): every line for the panel summary's Plugins block, by plugin
// name so a line keeps its place as it changes, and the most recent one for the line under a working turn's divider.
import { PLUGIN } from './copy';
import type { PluginStatus } from './reduce';

export interface PluginLine {
  plugin: string;
  text: string;
  at: string;
}

export const pluginLines = (status: ReadonlyMap<string, PluginStatus>): PluginLine[] =>
  [...status].map(([plugin, line]) => ({ plugin, ...line })).sort((a, b) => a.plugin.localeCompare(b.plugin));

// The most recent line across plugins as the transcript shows it (`<plugin> · <text>`), or null when none is pinned.
export function latestPluginLine(status: ReadonlyMap<string, PluginStatus> | undefined): string | null {
  const last = status ? [...status].at(-1) : undefined;
  return last ? PLUGIN.status(last[0], last[1].text) : null;
}
