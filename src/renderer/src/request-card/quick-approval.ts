// The quick-approval policy every placement consults before it renders an approve control (C7 execution document,
// Request card; SPEC 45 §45.19.1). `none`: the request is flagged `requires_user_interaction`, so its consent surface
// is one MAWS does not have, and no placement offers Allow, a scope, Enter or a digit. `button_only`: `default_to_no`
// (a terminal prompt opens on its decline option), so Enter and digits approve nothing and the Allow button stays.
// `full`: everything the card offers. Pure. What the hover card offers is the rule for answers from outside a pane
// (UX wave U1a §H, `@shared/attention/outside-answers`), which reads the same two flags.
import type { SessionEvent } from '@shared/graph/events';

export type QuickApproval = 'full' | 'button_only' | 'none';

export const quickApproval = (ev: Extract<SessionEvent, { kind: 'permission.requested' }>): QuickApproval =>
  ev.requiresUserInteraction === true ? 'none' : ev.defaultToNo === true ? 'button_only' : 'full';
