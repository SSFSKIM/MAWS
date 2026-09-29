// Which child brings each P0 panel tool (C8 spec, X5 table). A tab or a summary row whose tool is not registered yet
// names its child from here (C8a residue *Placeholder tabs and rows*).
export const ARRIVES_WITH: Readonly<Record<string, string>> = {
  terminal: 'C9',
  'session-info': 'C11',
  subagents: 'C8b',
  background: 'C8b',
  log: 'C8b',
  review: 'C8c',
  files: 'C8c',
};

// The §5.6 order "+" lists tools in; any other registered tool follows in registration order.
export const MENU_ORDER: readonly string[] = ['subagents', 'review', 'terminal', 'files', 'background', 'session-info'];
