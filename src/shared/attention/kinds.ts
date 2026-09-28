// Which attention items wait on a human, and which of them ask for an answer (charter §5.7; C5 execution document,
// Derivations). Shared because two readers of the one attention table must agree: the renderer's Needs-you rows and
// glyphs, and main's notifier and dock badge.
import type { AttentionItem } from '../graph/attention';
import type { AttentionKind } from '../graph/enums';

export const ACTIONABLE_KINDS: AttentionKind[] = ['permission', 'question', 'plan', 'dialog', 'elicitation', 'auto_mode_unavailable', 'error', 'interrupted'];   // tier 1
const ACTIONABLE = new Set<AttentionKind>(ACTIONABLE_KINDS);

// An item still waits on a human while pending or delivered (§4.6: delivered is not an alarm state, but it is not
// answered yet either).
export const isOpen = (item: AttentionItem) => item.state === 'pending' || item.state === 'delivered';
export const isActionable = (item: AttentionItem) => ACTIONABLE.has(item.kind);
