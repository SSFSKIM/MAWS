// What a transcript's rows may ask of the desk (MAWS's `TranscriptActions`, the survey's seam). A link opens as every
// link in a message on the desk does (`views/conversation/browser-actions.ts`): a new browsing context with no opener
// and no referrer, for the schemes MAWS's Markdown gates leave; nothing from a row navigates this page. Everything that
// needs MAWS's host (a spilled result, a file, the composer, a subagent's tab) does nothing here until a later milestone
// gives it a desk meaning. A prompt the desk's mapping drops is an owner input whose turn was undone before the session
// read it (`source/off-chain.ts`: the desk's rows carry no engine cancel of their own), and says so.
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import { openExternal } from '../../views/conversation/browser-actions';
import { UNDONE } from '../source/off-chain';

export const DESK_ACTIONS: Partial<TranscriptActions> = {
  openExternal,
  loadSpill: () => Promise.reject(new Error('A spilled result is not available on the desk yet.')),
  droppedRowMark: () => UNDONE,
};
