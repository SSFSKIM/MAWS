// Which attention items wait on a human, and which of them ask for an answer (charter §5.7; C5 execution document,
// Derivations). Shared because two readers of the one attention table must agree: the renderer's Needs-you rows and
// glyphs, and main's notifier and dock badge.
import type { AttentionItem } from '../graph/attention';
import type { AttentionKind } from '../graph/enums';

export const ACTIONABLE_KINDS: AttentionKind[] = ['permission', 'question', 'plan', 'dialog', 'elicitation', 'auto_mode_unavailable', 'error', 'interrupted',
  'async_input', 'essential_unread', // P2-C (2026-10-09): the owner channel's question and must-read count in the badge and stand in tier 1
];   // tier 1
const ACTIONABLE = new Set<AttentionKind>(ACTIONABLE_KINDS);

// An item still waits on a human while pending or delivered (§4.6: delivered is not an alarm state, but it is not
// answered yet either).
export const isOpen = (item: Pick<AttentionItem, 'state'>) => item.state === 'pending' || item.state === 'delivered';
// P5 O10: an open item standing for a request, which waits on its answer: what a remote `cards` view shows, and the
// count `notify` tells of a lane B session (the engine host's `engine.pendingItems` and the endpoint's live events alike).
export const waitsOnAnswer = (item: Pick<AttentionItem, 'state'> & { request: Pick<AttentionItem['request'], 'requestId'> }) => isOpen(item) && item.request.requestId !== null;
export const isActionable = (item: AttentionItem) => ACTIONABLE.has(item.kind);
