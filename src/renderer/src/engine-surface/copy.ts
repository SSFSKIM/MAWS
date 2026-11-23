// The plugin pane tool's words (R2; PaneTool.tsx): its title, the panel "+" group of open panes, the placeholder until
// the plugin draws (one line since the word cut, P511) and a pane the engine closed.
export const PANE_COPY = {
  title: 'Plugin pane',
  menu: 'Plugin panes',
  notDrawn: (plugin: string) => `${plugin} has not drawn here yet`,
  closed: 'This pane has closed',
} as const;
