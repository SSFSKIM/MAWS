// The session status glyph (C5 execution document, Derivations, glyph table; residue *Glyphs*): one derivation for
// sidebar row, tab and card (§5.7). First matching row wins. Tones name X7 tokens; labels are the `aria-label`, and the
// character differs per state so colour is never the only signal. P5 O9 M6 (the owner's Q1): a session a terminal or a
// background job holds reads like any MAWS session while MAWS drives it through its sminos bridge (its digest then reads
// the bridge's live phase, never `foreign`), its open items first; the holder glyph stays for one with no live bridge.
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { isActionable, isOpen } from './derive';

export type Glyph = { char: string; tone: 'accent' | 'warning' | 'info' | 'danger' | 'faint'; label: string; pulse: boolean };

const glyph = (char: string, tone: Glyph['tone'], label: string, pulse = false): Glyph => ({ char, tone, label, pulse });

const TROUBLE: Partial<Record<AttentionItem['kind'], string>> = {
  error: 'Needs you: error',
  interrupted: 'Needs you: interrupted',
  auto_mode_unavailable: 'Needs you: auto mode unavailable',
};

// The owner's ruling (2026-10-30; it withdraws E11 F2b's "Ended with an error"): an error seen or dismissed leaves no
// glyph of its own; the transcript shows what happened, and the session reads as what it is now.
export function glyphFor(record: SessionRecord, digest: SessionDigest | null, pending: AttentionItem[]): Glyph {
  const { holder } = record;
  const open = pending.filter((i) => isOpen(i) && isActionable(i));
  const unbridged = open.length === 0 && (digest === null || digest.phase === 'foreign'); // P5 O9 M6
  if (holder.kind === 'terminal' && unbridged) return glyph('⌁', 'info', 'Live in terminal');
  if (holder.kind === 'background_job' && unbridged) return glyph('⌁', 'info', 'Live as background job');
  // W7: MAWS runs it and a foreign process resumed it too (contested); MAWS yields once that process writes
  if (holder.kind === 'self' && holder.contestedBy !== undefined) return glyph('⇄', 'warning', holder.contestedBy.kind === 'terminal' ? 'Contested: also live in terminal' : 'Contested: also live as background job');

  const waiting = waitingGlyph(open);
  if (waiting !== null) return waiting;

  switch (digest?.phase) {
    case 'working':
    case 'starting':
      return glyph('●', 'accent', 'Working', true);
    case 'failed':
      return glyph('✕', 'danger', 'Failed');
  }
  if (digest?.phase === 'exited') return glyph('✓', 'faint', 'Done');
  return record.unread ? glyph('●', 'faint', 'Idle, unread') : glyph('○', 'faint', 'Idle');
}

// What the open actionable items ask for, the first matching row of the table; null with none.
function waitingGlyph(open: AttentionItem[]): Glyph | null {
  if (open.some((i) => i.kind === 'question')) return glyph('?', 'warning', 'Question');
  // P2-C start (2026-10-10; the P2-C document, M6): the owner channel's question an agent can wait on, then its must-read
  if (open.some((i) => i.kind === 'async_input')) return glyph(ATTENTION_HEADINGS.async_input.char, 'info', ATTENTION_HEADINGS.async_input.text);
  if (open.some((i) => i.kind === 'essential_unread')) return glyph(ATTENTION_HEADINGS.essential_unread.char, 'accent', ATTENTION_HEADINGS.essential_unread.text);
  // P2-C end
  if (open.some((i) => i.kind === 'plan')) return glyph('◇', 'info', 'Plan review');
  const trouble = open.find((i) => TROUBLE[i.kind] !== undefined);
  if (trouble) return glyph('!', 'danger', TROUBLE[trouble.kind]!);
  if (open.length > 0) return glyph('◐', 'warning', 'Needs approval');
  return null;
}

// P5 O8 M2 ("Drawing", the state table): another machine's listed session, by its listing's state word (sminos's), drawn
// with the glyphs above. O9's Q1 (how a terminal session's glyph reads) governs lane A rows too; until it is answered they
// read these live glyphs. P5 O7 M6: its machine's attention feed, when it holds open items for it, says what it waits for
// (the record's rows above), whatever the listing's word.
export function listedGlyph(state: string, pending: AttentionItem[] = []): Glyph {
  const waiting = waitingGlyph(pending.filter((i) => isOpen(i) && isActionable(i)));
  if (waiting !== null) return waiting;
  switch (state) {
    case 'busy':
      return glyph('●', 'accent', 'Working', true);
    case 'waiting':
      return glyph('◐', 'warning', 'Needs you');
    case 'failed':
      return glyph('✕', 'danger', 'Failed');
    case 'done':
    case 'stopped':
    case 'retired':
      return glyph('✓', 'faint', 'Done');
    default:
      return glyph('○', 'faint', 'Idle');
  }
}
