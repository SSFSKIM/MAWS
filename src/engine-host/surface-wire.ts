// R2: the remote surface's wire answers and pushes as MAWS's shapes (shared/engine/surface.ts): the pane roster,
// camelCased with its defaults, and one render answer with what a replay's empty answer leaves out filled in (no tree
// is the engine's own drawing, not hooked). Pure; the normaliser and the X2 handlers share them.
import { ENGINE_NODE, type PaneRoster, type RenderAnswer } from '@shared/engine/surface';
import type { UiPanesResponse, UiPaneWire, UiRenderResponse } from '@shared/wire/control';

const paneOf = (p: UiPaneWire) => ({
  id: p.id,
  title: p.title,
  plugin: p.plugin,
  closeOnEscape: p.close_on_escape === true,
  holdToasts: p.hold_toasts === true,
  rows: p.rows ?? null,
  columns: p.columns ?? null,
});

export function rosterOf(wire: UiPanesResponse): PaneRoster {
  return {
    panes: (wire.panes ?? []).map(paneOf),
    shownId: wire.shown_id ?? null,
    focusedId: wire.focused_id ?? null,
    focusRequestedId: wire.focus_requested_id ?? null,
  };
}

export function renderAnswerOf(wire: UiRenderResponse, asked: Record<string, unknown>): RenderAnswer {
  return {
    tree: wire.tree ?? ENGINE_NODE,
    props: wire.props ?? asked,
    rewritten: wire.rewritten ?? false,
    hooked: wire.hooked ?? false,
  };
}
