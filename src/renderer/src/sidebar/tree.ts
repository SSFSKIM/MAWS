// The sidebar tree's keyboard model (§5.1 as amended 2026-10-01, W11; residue *Accessibility*): the visible tree items
// in order, and what a key does to them. Roving focus: one item is the tab stop; ArrowUp and ArrowDown move between
// visible items; ArrowRight expands a project or steps into it, ArrowLeft collapses it or steps out of a child to its
// project; Enter opens a session (or toggles a project); Space toggles a project; Enter or Space on a "Show more" reveals
// the rest of its project's sessions (up to the cap), or on the list's own the rest of the projects. Home and End go to
// the ends. UX wave U7, O-16: a project's Hidden row toggles on Enter and Space, opens on ArrowRight (or steps into its
// rows when open) and closes on ArrowLeft (or steps to its project when closed); its rows step out to it.
import { createContext, useContext } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ProjectKey } from './derive';

export type TreeNode =
  | { id: string; kind: 'session'; appSessionId: AppSessionId; parent: string }
  | { id: string; kind: 'listed'; appSessionId: AppSessionId; parent: string } // P5 O8 M2: its row's own Enter activates it
  | { id: string; kind: 'project'; key: ProjectKey; expanded: boolean }
  | { id: string; kind: 'more'; key: ProjectKey | null; parent: string | null } // key null: the project list's own
  | { id: string; kind: 'hidden'; key: ProjectKey; expanded: boolean; parent: string }; // UX wave U7, O-16: "Hidden · N"

export const sessionNodeId = (appSessionId: AppSessionId) => `s:${appSessionId}`;
export const projectNodeId = (key: ProjectKey) => `p:${key}`;
export const moreNodeId = (key: ProjectKey | null) => (key === null ? 'more-projects' : `more:${key}`);
export const hiddenNodeId = (key: ProjectKey) => `hidden:${key}`;

export type TreeCommand =
  | { kind: 'focus'; id: string }
  | { kind: 'open'; appSessionId: AppSessionId }
  | { kind: 'toggle'; key: ProjectKey }
  | { kind: 'more'; key: ProjectKey | null }
  | { kind: 'hidden'; key: ProjectKey };

export function treeCommand(nodes: TreeNode[], id: string, key: string): TreeCommand | null {
  const index = nodes.findIndex((n) => n.id === id);
  if (index === -1) return null;
  const node = nodes[index];
  const focus = (at: number): TreeCommand | null => (nodes[at] ? { kind: 'focus', id: nodes[at].id } : null);
  switch (key) {
    case 'ArrowDown':
      return focus(index + 1);
    case 'ArrowUp':
      return focus(index - 1);
    case 'Home':
      return focus(0);
    case 'End':
      return focus(nodes.length - 1);
    case 'ArrowRight':
      if (node.kind === 'hidden') return node.expanded ? focus(index + 1) : { kind: 'hidden', key: node.key };
      if (node.kind !== 'project') return null;
      return node.expanded ? focus(index + 1) : { kind: 'toggle', key: node.key };
    case 'ArrowLeft':
      if (node.kind === 'project') return node.expanded ? { kind: 'toggle', key: node.key } : null;
      if (node.kind === 'hidden' && node.expanded) return { kind: 'hidden', key: node.key };
      return node.parent === null ? null : { kind: 'focus', id: node.parent };
    case 'Enter':
      if (node.kind === 'session') return { kind: 'open', appSessionId: node.appSessionId };
      if (node.kind === 'listed') return null;
      if (node.kind === 'hidden') return { kind: 'hidden', key: node.key };
      return node.kind === 'project' ? { kind: 'toggle', key: node.key } : { kind: 'more', key: node.key };
    case ' ':
      if (node.kind === 'project') return { kind: 'toggle', key: node.key };
      if (node.kind === 'hidden') return { kind: 'hidden', key: node.key };
      return node.kind === 'more' ? { kind: 'more', key: node.key } : null;
    default:
      return null;
  }
}

// What a tree item needs from the sidebar: whether it is the tab stop, whether it is the selected session, and how to
// report that it took focus.
export interface TreeContextValue {
  tabStop: string | null;
  selected: AppSessionId | null;
  onFocusItem(id: string): void;
  onPick?(id: AppSessionId): void; // P5 O8 M2: a listed row selected with no opener for its lane
  // UX wave U7, O-16: a Hide or an Unhide (from a row's own control: `fromRow`); true when the sidebar then places the keyboard
  onHideAct?(id: AppSessionId, hide: boolean, fromRow: boolean): boolean;
}
export const TreeContext = createContext<TreeContextValue>({ tabStop: null, selected: null, onFocusItem: () => {} });
export const useTree = () => useContext(TreeContext);
