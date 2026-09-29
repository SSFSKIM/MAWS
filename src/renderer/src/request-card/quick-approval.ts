// The quick-approval policy every placement consults before it renders an approve control (C7 execution document,
// Request card; SPEC 45 §45.19.1). `none`: the request is flagged `requires_user_interaction`, so its consent surface
// is one MAWS does not have, and no placement offers Allow, a scope, Enter or a digit. `button_only`: `default_to_no`
// (a terminal prompt opens on its decline option), so Enter and digits approve nothing and the Allow button stays.
// `full`: everything the card offers. Pure.
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import { isReadOnlyRequest } from '@shared/attention/read-only-tools';

export type QuickApproval = 'full' | 'button_only' | 'none';

export const quickApproval = (ev: Extract<SessionEvent, { kind: 'permission.requested' }>): QuickApproval =>
  ev.requiresUserInteraction === true ? 'none' : ev.defaultToNo === true ? 'button_only' : 'full';

// The hover card's Approve and Deny (§5.1): a pending permission for a read-only tool with nothing that withholds a
// quick approval; every other item shows its preview and Open session.
export const hoverApproval = (item: AttentionItem, request: SessionEvent | null): boolean =>
  item.state === 'pending' && request?.kind === 'permission.requested' && isReadOnlyRequest(request) && quickApproval(request) === 'full';
