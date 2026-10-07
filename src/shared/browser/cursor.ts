// The agent's cursor channel (E4c execution document, Design §9; Interfaces "The preload"): main sends these to the
// browser preload of the tab's own page, one way; the preload draws them (`<maws-agent-cursor>`) and sends nothing back.
// Coordinates are CSS px of the page's viewport, as Playwright's `Input.dispatchMouseEvent` carries them.
export const BROWSER_CURSOR_CHANNEL = 'browser:cursor';

export interface AgentCursorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AgentCursorMessage =
  | { kind: 'move' | 'press' | 'release'; x: number; y: number } // the pointer moves, a button goes down or up
  | { kind: 'target'; x: number; y: number; box: AgentCursorBox } // the element an action resolved, outlined briefly
  | { kind: 'hide' }; // the agent let go of the tab
