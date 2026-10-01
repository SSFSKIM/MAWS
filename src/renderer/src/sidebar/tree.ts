// The sidebar's keyboard model (§5.1 as amended 2026-10-01, W5; residue *Accessibility*): the visible items of the level
// on screen, in order, and what a key does to them. Roving focus: one item per level is the tab stop; ArrowUp and
// ArrowDown move between items, Home and End go to the ends. On the project list Enter or ArrowRight opens a project's
// page; on a page Enter opens a session, and Backspace or ArrowLeft goes back to the list.
import { createContext, useContext } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ProjectKey } from './derive';

export type TreeNode = { id: string; kind: 'session'; appSessionId: AppSessionId } | { id: string; kind: 'project'; key: ProjectKey };

export const sessionNodeId = (appSessionId: AppSessionId) => `s:${appSessionId}`;
export const projectNodeId = (key: ProjectKey) => `p:${key}`;

export type TreeCommand =
  | { kind: 'focus'; id: string }
  | { kind: 'open'; appSessionId: AppSessionId }
  | { kind: 'drill'; key: ProjectKey }
  | { kind: 'back' };

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
    case 'Enter':
      return node.kind === 'project' ? { kind: 'drill', key: node.key } : { kind: 'open', appSessionId: node.appSessionId };
    case 'ArrowRight':
      return node.kind === 'project' ? { kind: 'drill', key: node.key } : null;
    case 'ArrowLeft':
    case 'Backspace':
      return node.kind === 'session' ? { kind: 'back' } : null;
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
