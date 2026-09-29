// The widgets harness's automation surface, `window.__maws_widgets` (C11 execution document, M2 decisions): Playwright
// drives the `#widgets` page through it, since main blocks navigation within a launch. Types only, so the e2e project
// can import them.

// What the page shows for a session: `interactive`, C7's composer over the session with a widget picker, the reads
// answered by whatever is behind X2 (the fixture-backed widget backend under MAWS_WIDGET_BACKEND=fixtures); `passive`,
// every engine-read widget mounted at once reading only the query cache, which `read` fills (C3's strict replay).
export type WidgetsPane = { appSessionId: string; mode: 'interactive' | 'passive' } | null;

export interface WidgetsHarnessApi {
  show(pane: WidgetsPane): void;
  open(name: string, args?: string): void; // the picker: a registered widget opened directly over the composer
  // One invoke of a widget's own read under the widget's own query key, its answer landing where a mounted widget reads.
  read(command: string, input: Record<string, unknown>): Promise<unknown>;
  // A widget's control function with the arguments given verbatim: setModel, setEffort, applyFlagSettings, setPermissionMode.
  control(name: string, input: Record<string, unknown>): Promise<unknown>;
  // M4: the calls the page's stand-in for C10's `session.start` received (the route switch's restart), in order.
  starts(): { appSessionId: string; options: Record<string, unknown> }[];
}
