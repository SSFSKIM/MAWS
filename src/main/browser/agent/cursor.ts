// The agent's cursor, main's side (E4c execution document, Design §9; Decision Log 10, 20, 23): what the person sees of
// the agent's pointer in the page. Main observes the tab's TabDebugger (`onCommand`) for the mouse commands Playwright
// sends on the page's own session while the agent holds the tab, and before each action aims at the resolved element
// (`aim`: `move` to its box's centre, then `target` with the box, so `fill` and `press`, which move no mouse, still show
// where the agent is); `hide` follows the agent letting go. Messages go to the tab's own webContents on
// BROWSER_CURSOR_CHANNEL only, never anywhere else; the preload (Task 3.3) draws them and the page learns nothing it could
// not see. A screenshot sends none (its capture hides the overlay itself, Design §7). Another holder's CDP use (E4b's
// import, E4d's crop) draws nothing: only commands sent while `control === 'agent'` are the agent's.
import { BROWSER_CURSOR_CHANNEL, type AgentCursorBox, type AgentCursorMessage } from '@shared/browser/cursor';
import type { CommandPhase, TabDebugger } from '../debugger';
import type { TabEntry, TabStore } from '../tabs';
import type { TabControls } from './control';

const MOUSE: Record<string, 'move' | 'press' | 'release'> = { mouseMoved: 'move', mousePressed: 'press', mouseReleased: 'release' };

export interface AgentCursorDeps {
  store: Pick<TabStore, 'all' | 'onViewCreated' | 'onViewDestroying'>;
  controls: Pick<TabControls, 'onChange'>;
}

export class AgentCursor {
  private readonly watched = new Map<TabDebugger, () => void>(); // each live view's debugger: its observer's unhook
  private readonly counts = new WeakMap<TabEntry, number>();
  private readonly unhook: (() => void)[];

  constructor(deps: AgentCursorDeps) {
    for (const entry of deps.store.all()) this.watch(entry);
    this.unhook = [
      deps.store.onViewCreated((entry) => this.watch(entry)),
      deps.store.onViewDestroying((entry) => this.unwatch(entry.debugger)), // the view goes: nothing keeps it
      deps.controls.onChange((entry, from) => {
        if (from === 'agent' && entry.tab.control !== 'agent') this.hide(entry);
      }),
    ];
  }

  // Before an action: the pointer to the element's centre, then the element outlined.
  aim(entry: TabEntry, box: AgentCursorBox): void {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    this.send(entry, { kind: 'move', x, y });
    this.send(entry, { kind: 'target', x, y, box });
  }

  // The in-app browser spec of 2026-10-08 ("Cursor"): the vendor's moveMouse through cua's `cursor.move`, the pointer where
  // the agent aims before a locator click.
  move(entry: TabEntry, x: number, y: number): void {
    this.send(entry, { kind: 'move', x, y });
  }

  hide(entry: TabEntry): void {
    this.send(entry, { kind: 'hide' });
  }

  // How many messages the tab's pages were sent (the e2e seam's `cursorMessages`).
  messages(entry: TabEntry): number {
    return this.counts.get(entry) ?? 0;
  }

  dispose(): void {
    for (const unhook of this.unhook.splice(0)) unhook();
    for (const tabDebugger of [...this.watched.keys()]) this.unwatch(tabDebugger);
  }

  // Each view has its own TabDebugger: followed once, for as long as it lives (a later view of the tab is followed anew).
  private watch(entry: TabEntry): void {
    const tabDebugger = entry.debugger;
    if (!tabDebugger || this.watched.has(tabDebugger)) return;
    this.watched.set(tabDebugger, tabDebugger.onCommand((phase) => this.observe(entry, tabDebugger, phase)));
  }

  private unwatch(tabDebugger: TabDebugger | null): void {
    if (!tabDebugger) return;
    this.watched.get(tabDebugger)?.();
    this.watched.delete(tabDebugger);
  }

  private observe(entry: TabEntry, tabDebugger: TabDebugger, phase: CommandPhase): void {
    if (phase.phase !== 'send' || phase.method !== 'Input.dispatchMouseEvent' || phase.sessionId !== '') return;
    if (entry.debugger !== tabDebugger || entry.tab.control !== 'agent') return;
    const kind = MOUSE[String(phase.params?.type)];
    const { x, y } = phase.params ?? {};
    if (kind && typeof x === 'number' && typeof y === 'number') this.send(entry, { kind, x, y });
  }

  private send(entry: TabEntry, message: AgentCursorMessage): void {
    const contents = entry.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    contents.send(BROWSER_CURSOR_CHANNEL, message);
    this.counts.set(entry, this.messages(entry) + 1);
  }
}
