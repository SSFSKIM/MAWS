// The sidebar tree's keyboard model (C5 execution document, M3; residue *Accessibility*): the visible tree items in
// order, and what a key does to them. Roving focus: one item is the tab stop; ArrowUp and ArrowDown move between visible
// items (across Pinned, Projects and Other sessions); ArrowRight expands a project or steps into it, ArrowLeft collapses
// it or steps out of a session to its project; Enter opens a session (or toggles a project); Space toggles a project;
// Enter or Space on "Show N more" reveals the rest. Home and End go to the ends.
import { createContext, useContext } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';

export type TreeNode =
  | { id: string; kind: 'session'; appSessionId: AppSessionId; parent: string | null }
  | { id: string; kind: 'project'; projectId: ProjectId; expanded: boolean }
  | { id: string; kind: 'more'; projectId: ProjectId; parent: string };

export const sessionNodeId = (appSessionId: AppSessionId) => `s:${appSessionId}`;
export const projectNodeId = (projectId: ProjectId) => `p:${projectId}`;
export const moreNodeId = (projectId: ProjectId) => `more:${projectId}`;

export type TreeCommand =
  | { kind: 'focus'; id: string }
  | { kind: 'open'; appSessionId: AppSessionId }
  | { kind: 'toggle'; projectId: ProjectId }
  | { kind: 'more'; projectId: ProjectId };

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
      if (node.kind !== 'project') return null;
      return node.expanded ? focus(index + 1) : { kind: 'toggle', projectId: node.projectId };
    case 'ArrowLeft':
      if (node.kind === 'project') return node.expanded ? { kind: 'toggle', projectId: node.projectId } : null;
      return node.parent === null ? null : { kind: 'focus', id: node.parent };
    case 'Enter':
      if (node.kind === 'session') return { kind: 'open', appSessionId: node.appSessionId };
      return node.kind === 'project' ? { kind: 'toggle', projectId: node.projectId } : { kind: 'more', projectId: node.projectId };
    case ' ':
      if (node.kind === 'project') return { kind: 'toggle', projectId: node.projectId };
      return node.kind === 'more' ? { kind: 'more', projectId: node.projectId } : null;
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
}
export const TreeContext = createContext<TreeContextValue>({ tabStop: null, selected: null, onFocusItem: () => {} });
export const useTree = () => useContext(TreeContext);
