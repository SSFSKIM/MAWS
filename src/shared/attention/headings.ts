// The kind line of an attention item (C5's copy): the glyph, its tone and the words, so the Needs-you row, the hover
// preview and C7's request card read alike. Typed per kind, so a new kind fails typecheck until it has a line.
import type { AttentionItem } from '../graph/attention';

export type AttentionTone = 'warning' | 'info' | 'danger';

export const ATTENTION_HEADINGS: Readonly<Record<AttentionItem['kind'], { char: string; tone: AttentionTone; text: string }>> = {
  permission: { char: '◐', tone: 'warning', text: 'Approval needed' },
  question: { char: '?', tone: 'warning', text: 'Question' },
  plan: { char: '◇', tone: 'info', text: 'Plan review' },
  dialog: { char: '◐', tone: 'warning', text: 'Dialog' },
  elicitation: { char: '◐', tone: 'warning', text: 'Input requested' },
  auto_mode_unavailable: { char: '!', tone: 'danger', text: 'Auto mode unavailable' },
  error: { char: '!', tone: 'danger', text: 'Error' },
  interrupted: { char: '!', tone: 'danger', text: 'Interrupted' },
  held_peer_message: { char: '✉', tone: 'info', text: 'Held message' },
  // P2-C start (2026-10-09; the P2-C document, M6's glyphs): the owner channel's two kinds
  async_input: { char: '?', tone: 'info', text: 'Question waiting' },
  essential_unread: { char: '◆', tone: 'info', text: 'Must read' },
  // P2-C end
};
