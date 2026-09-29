// Every sentence the panel host shows (C8a execution document, Interfaces *Copy*; the exact strings are decisions).
// M2 adds the summary's section copy here.
import { ARRIVES_WITH } from './arrives-with';

export const COPY = {
  home: 'Session overview',
  add: 'Add a tool',
  addNoSession: 'Open a session to add a tool',
  noTools: 'No tools registered yet',
  allOpen: 'Every tool is already open here', // every registered tool is single-instance and has a tab in the shown scope
  footer: 'Tools stay with this session. Pin a tab to keep it with you as you switch.',
  pin: (title: string) => `Pin ${title}`,
  unpin: (title: string) => `Unpin ${title}`,
  close: (title: string) => `Close ${title}`,
} as const;

// "Arrives with <child>" for a tool id the host has no registration for; an id outside the P0 table names no child.
export function arrivesWith(toolId: string): string {
  const child = ARRIVES_WITH[toolId];
  return child ? `Arrives with ${child}` : `${toolId} is not available`;
}
