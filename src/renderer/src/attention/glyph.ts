// The session status glyph (C5 execution document, Derivations, glyph table; residue *Glyphs*): one derivation for
// sidebar row, tab and card (§5.7). First matching row wins. Tones name X7 tokens; labels are the `aria-label`, and the
// character differs per state so colour is never the only signal.
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { relativeAge } from '../app/relative-age';
import { isActionable, isOpen } from './derive';

export type Glyph = { char: string; tone: 'accent' | 'warning' | 'info' | 'danger' | 'faint'; label: string; pulse: boolean };

const glyph = (char: string, tone: Glyph['tone'], label: string, pulse = false): Glyph => ({ char, tone, label, pulse });

const TROUBLE: Partial<Record<AttentionItem['kind'], string>> = {
  error: 'Needs you: error',
  interrupted: 'Needs you: interrupted',
  auto_mode_unavailable: 'Needs you: auto mode unavailable',
};

// `ended` (E11 F2b, plan 2.4; owner decision 1): the session's error seen or dismissed (`selectEndedWithErrorOf`), which
// it keeps saying, with its time, until its next turn retires it; `now` dates it.
export function glyphFor(record: SessionRecord, digest: SessionDigest | null, pending: AttentionItem[], ended: AttentionItem | null = null, now = Date.now()): Glyph {
  const { holder } = record;
  if (holder.kind === 'terminal') return glyph('⌁', 'info', 'Live in terminal');
  if (holder.kind === 'background_job') return glyph('⌁', 'info', 'Live as background job');
  // W7: MAWS runs it and a foreign process resumed it too (contested); MAWS yields once that process writes
  if (holder.kind === 'self' && holder.contestedBy !== undefined) return glyph('⇄', 'warning', holder.contestedBy.kind === 'terminal' ? 'Contested: also live in terminal' : 'Contested: also live as background job');

  const open = pending.filter((i) => isOpen(i) && isActionable(i));
  if (open.some((i) => i.kind === 'question')) return glyph('?', 'warning', 'Question');
  // P2-C start (2026-10-10; the P2-C document, M6): the owner channel's question an agent can wait on, then its must-read
  if (open.some((i) => i.kind === 'async_input')) return glyph(ATTENTION_HEADINGS.async_input.char, 'info', ATTENTION_HEADINGS.async_input.text);
  if (open.some((i) => i.kind === 'essential_unread')) return glyph(ATTENTION_HEADINGS.essential_unread.char, 'accent', ATTENTION_HEADINGS.essential_unread.text);
  // P2-C end
  if (open.some((i) => i.kind === 'plan')) return glyph('◇', 'info', 'Plan review');
  const trouble = open.find((i) => TROUBLE[i.kind] !== undefined);
  if (trouble) return glyph('!', 'danger', TROUBLE[trouble.kind]!);
  if (open.length > 0) return glyph('◐', 'warning', 'Needs approval');

  switch (digest?.phase) {
    case 'working':
    case 'starting':
      return glyph('●', 'accent', 'Working', true);
    case 'failed':
      return glyph('✕', 'danger', 'Failed');
  }
  if (ended !== null) return glyph('✕', 'danger', `Ended with an error ${relativeAge(now - Date.parse(ended.createdAt))}`);
  switch (digest?.phase) {
    case 'exited':
      return glyph('✓', 'faint', 'Done');
  }
  return record.unread ? glyph('●', 'faint', 'Idle, unread') : glyph('○', 'faint', 'Idle');
}
