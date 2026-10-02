// The engine's remote surface as MAWS speaks it (R2; charter D-9 as amended 2026-10-01, the waves plan's R2 rulings):
// MAWS attaches once per session as surface "desktop" and draws the plain-data trees the engine's `ui.render` hooks
// answer. The shapes both sides of X2 share: the pane roster, the answer to one render ask, and the renderer's answers
// to the engine's requests (`ui_copy`, `ui_prompt_read`, `ui_prompt_fill`, `ui_prompt_suggest`). Typed from
// pass3/mods-surface-* (2.1.287) and the engine's schema text (r6 §3.7). The trees themselves stay `unknown` across X2:
// the renderer validates them node by node, as Claude Desktop does, so one malformed node draws nothing and never
// fails the whole answer.
import * as z from 'zod';

// MAWS has one window (`window.main`); the host attaches for it before any window asks, so the client is named for it.
export const SURFACE_CLIENT_ID = 'maws-main';
// The four requests MAWS answers (`answers` on the attach): the clipboard, and the composer's read, fill and suggest.
export const SURFACE_ANSWERS = ['ui_copy', 'ui_prompt_read', 'ui_prompt_fill', 'ui_prompt_suggest'] as const;
// The attach's viewport until a render reports the drawn one: character cells of the code font, and `isFullscreen`,
// which says the surface docks a pane beside the transcript (MAWS's panel). 2.1.287 places panes only for a client whose
// viewport carries the key (pass3/mods-surface-render-sites, the first try's `isPlaced:false`).
export const DEFAULT_SURFACE_VIEWPORT = { columns: 100, rows: 30, isFullscreen: true } as const;

export const SurfaceViewportSchema = z.strictObject({ columns: z.number().int().positive(), rows: z.number().int().positive(), isFullscreen: z.boolean().optional() });
export type SurfaceViewport = z.infer<typeof SurfaceViewportSchema>;

// The render sites R2 draws (transcript sites are R3's).
export const SURFACE_SITES = ['AbovePrompt', 'SessionMode', 'PromptHint', 'Spinner', 'Pane'] as const;
export type SurfaceSite = (typeof SURFACE_SITES)[number];
// The two sites that scroll and hold the keyboard.
export const ScrollSiteSchema = z.enum(['Pane', 'AbovePrompt']);
export type ScrollSite = z.infer<typeof ScrollSiteSchema>;

// One placed pane (the push's and the read's `panes[]`), camelCased: `closeOnEscape`, `holdToasts` default false;
// `rows` (inline) and `columns` (docked) are the sizes its content asked for, when it did.
export const SurfacePaneSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  plugin: z.string(),
  closeOnEscape: z.boolean(),
  holdToasts: z.boolean(),
  rows: z.number().int().nullable(),
  columns: z.number().int().nullable(),
});
export type SurfacePane = z.infer<typeof SurfacePaneSchema>;

export const PaneRosterSchema = z.strictObject({
  panes: z.array(SurfacePaneSchema),
  shownId: z.string().nullable(),
  focusedId: z.string().nullable(),
  focusRequestedId: z.string().nullable(), // a standing `$.ui.open({ focus: true })` the surface has yet to honour or refuse
});
export type PaneRoster = z.infer<typeof PaneRosterSchema>;
export const EMPTY_ROSTER: PaneRoster = { panes: [], shownId: null, focusedId: null, focusRequestedId: null };

// One render ask's answer: the tree (validated by the renderer), the props core was handed, whether a hook rewrote them,
// and whether any plugin hooks the site at all (false: draw MAWS's own and stop asking until the next invalidate).
export const ENGINE_NODE = { type: 'engine', ref: 0 } as const;
export const RenderAnswerSchema = z.strictObject({
  tree: z.unknown(),
  props: z.record(z.string(), z.unknown()),
  rewritten: z.boolean(),
  hooked: z.boolean(),
});
export type RenderAnswer = z.infer<typeof RenderAnswerSchema>;

// An element a plugin drew, by its plugin and key (a focus ring's target).
export const SurfaceElementSchema = z.strictObject({ plugin: z.string(), key: z.string() });
export type SurfaceElement = z.infer<typeof SurfaceElementSchema>;

// The engine's requests a surface answers, as X1 `plugin.ask` names them, and the renderer's answer to each.
export const SURFACE_ASKS = ['copy', 'prompt_read', 'prompt_fill', 'prompt_suggest'] as const;
export type SurfaceAsk = (typeof SURFACE_ASKS)[number];
export const PromptFillModeSchema = z.enum(['replace', 'append', 'insert']);
export type PromptFillMode = z.infer<typeof PromptFillModeSchema>;
// The engine resolves a request no client answered after 5 s; the host refuses one at 4 s, so the refusal is the
// answer the engine reads, and the renderer acts on none older than that (its answer would come after the refusal).
export const SURFACE_ANSWER_MS = 4_000;

export const SurfaceAnswerSchema = z.discriminatedUnion('ask', [
  z.strictObject({ ask: z.literal('copy'), copied: z.boolean() }),
  z.strictObject({ ask: z.literal('prompt_read'), text: z.string(), cursor: z.number().int().nonnegative() }),
  z.strictObject({ ask: z.literal('prompt_fill'), filled: z.boolean() }),
  z.strictObject({ ask: z.literal('prompt_suggest'), shown: z.boolean() }),
]);
export type SurfaceAnswer = z.infer<typeof SurfaceAnswerSchema>;
