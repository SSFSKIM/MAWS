// P4-A2 G2.2 (X35, the editors' provisional layer; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R6):
// where a board new to the design is drawn while a publish streams, React-free and DOM-free. A board has no place until
// canvas.json's entry for it parses whole; then it stands where the publish will put it: the entry's frame, a size it
// lacks from its file's `data-size` or the slide's, a place it lacks after the right-most board (publish.ts's rules).
// A board's file draws through the slides' core (../slides/provisional.ts), boards being C's slides.
import { isWhole, openPath, readPartialJson } from '@shared/maws/partial-json';
import type { Doc } from '../yjs';
import { FRAME_KEYS, frameProblems, type BoardFrame } from './canvas';
import { DEFAULT_SIZE, placementAfter } from './model';
import { dataSize } from './publish';

/**
 * The frame of board `boardId` as the publish's `canvasText` (canvas.json's text, whole or, when `open`, streaming)
 * places it in `live`, with its file's text so far (`boardText`) for a size the entry lacks; null until the entry parses
 * whole, and for a frame the publish would refuse.
 */
export function provisionalBoardFrame(live: Doc, boardId: string, canvasText: string, open: boolean, boardText?: string): BoardFrame | null {
  const manifest = readPartialJson(canvasText);
  const boards = isRecord(manifest) ? manifest.boards : undefined;
  const entry = isRecord(boards) && Object.hasOwn(boards, boardId) ? boards[boardId] : undefined;
  if (!isRecord(entry) || (open && !isWhole(openPath(canvasText), ['boards', boardId]))) return null;
  const given: Partial<Record<keyof BoardFrame, unknown>> = {};
  for (const key of FRAME_KEYS) if (entry[key] !== undefined) given[key] = entry[key];
  if (frameProblems(boardId, given).length > 0) return null;
  let size: { w: number; h: number } = DEFAULT_SIZE;
  if (given.w === undefined || given.h === undefined) {
    const sized = boardText === undefined ? null : dataSize(boardId, boardText);
    if (sized && 'problem' in sized) return null;
    if (sized) size = sized;
  }
  const place = given.x === undefined || given.y === undefined ? placementAfter(live, [boardId]) : null;
  const frame: BoardFrame = {
    x: (given.x as number | undefined) ?? place!.x,
    y: (given.y as number | undefined) ?? place!.y,
    w: (given.w as number | undefined) ?? size.w,
    h: (given.h as number | undefined) ?? size.h,
  };
  return frameProblems(boardId, frame).length > 0 ? null : frame;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
