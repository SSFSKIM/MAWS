// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4; G518, G539): a board edit the model
// refuses, in a person's words. The model's own words (`BoardError`'s problems, `frameProblems`) name the board by its id
// and the key by its letter, for the agents and the loader that read them; the workbench says what could not be done,
// read against the design as it stands at the refusal, never by parsing those words. A refusal no case here covers says
// what was asked and keeps the model's words as its reason (the toolbar notice's tooltip, as the deck's refusals do).
import { heldOf } from '../../slides/model';
import type { Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { CANVAS_LIMITS, FRAME_KEYS, type BoardFrame } from '../canvas';
import { isMissingSource } from '../model';
import { BoardError } from '../writers';
import { DESIGN_COPY } from './copy';

const R = DESIGN_COPY.refused;
const NUMBER = new Intl.NumberFormat('en-US');

/** What was asked of a board when the model refused it. */
export type BoardAct = 'add' | 'duplicate' | 'rename' | 'delete' | 'resize' | 'move';

/** Why a frame (whole or partial) is not one the model holds, each limit once: `frameProblems`'s checks in words. */
export function frameRefusals(frame: Partial<Record<keyof BoardFrame, unknown>>): string[] {
  const out = new Set<string>();
  for (const key of FRAME_KEYS) {
    if (!(key in frame)) continue;
    const v = frame[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) out.add(R.notNumber);
    else if ((key === 'w' || key === 'h') && v <= 0) out.add(R.empty);
    else if ((key === 'w' || key === 'h') && v > CANVAS_LIMITS.side) out.add(R.side(NUMBER.format(CANVAS_LIMITS.side)));
  }
  const { w, h } = frame;
  if (out.size === 0 && typeof w === 'number' && typeof h === 'number' && w * h > CANVAS_LIMITS.area) out.add(R.area(NUMBER.format(CANVAS_LIMITS.area)));
  return [...out];
}

/**
 * A refused board edit as the toolbar says it: `text`, and the model's words as `why` only where no case here reads the
 * refusal. `frame` is the frame the edit asked for, where it asked one. An error that is no `BoardError` (the session
 * stopped taking writes) keeps its message, as before the cut.
 */
export function boardRefusal(doc: Doc, error: unknown, act: BoardAct, frame?: Partial<BoardFrame>): { text: string; why: string | null } {
  if (!(error instanceof BoardError)) return { text: error instanceof Error ? error.message : String(error), why: null };
  const board = error.board;
  const move = act === 'move';
  if (Y.hasSlide(doc, board) && heldOf(doc, board) !== null) return { text: move ? R.moveHeld : R.held(act), why: null };
  if (Y.hasSlide(doc, board) && isMissingSource(doc, board)) return { text: move ? R.moveMissing : R.missing(act), why: null };
  if ((act === 'add' || act === 'duplicate') && Y.slideIds(doc).length >= CANVAS_LIMITS.boards) return { text: R.full(act, CANVAS_LIMITS.boards), why: null };
  const limits = frame ? frameRefusals(frame) : [];
  if (limits.length > 0) return { text: limits.join('; '), why: null };
  if (act !== 'add' && !Y.hasSlide(doc, board)) return { text: R.gone, why: null };
  return { text: move ? R.moveOther : R.other(act), why: error.problems.join('; ') };
}
