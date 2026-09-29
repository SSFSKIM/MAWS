// C8c's code tools (C8c execution document, Interfaces *Tools, slots and the open-file seam*): Review and Files into
// C8a's panel host, the file viewer into C5's `fileTab` slot and Review for a ref into its `diffTab` slot, registered
// once from App.tsx's C8c block. Static and thin: CodeMirror loads with the first code view, the diff view with the
// first diff body (O2).
import { registerSlot } from '../../app/slots';
import { registerPanelTool } from '../../panel/host';
import { filesTool } from './files/FilesTool';
import { DiffTab } from './review/DiffTab';
import { reviewTool } from './review/ReviewTool';
import { FileViewer } from './viewer/FileViewer';

export { filesTool } from './files/FilesTool';
export { useFiles } from './files/store';
export { codeTranscriptActions, openFile } from './open-file';
export { DiffTab } from './review/DiffTab';
export { defaultScope, firstChangedLine, formatRef, parseRef, splitPatch, tooLarge, type ReviewParams, type ReviewScope } from './review/review-model';
export { useReview } from './review/review-store';
export { ReviewSummary } from './review/ReviewSummary';
export { reviewTool } from './review/ReviewTool';
export { FileViewer } from './viewer/FileViewer';
export { kindOf } from './viewer/kinds';

// Registers the tools and slots. The disposer unregisters the tools, which closes their tabs (C8a's rule), so App.tsx
// never calls it; tests and the harness may.
export function registerCodeTools(): () => void {
  const offs = [registerPanelTool(reviewTool), registerPanelTool(filesTool)];
  registerSlot('fileTab', FileViewer);
  registerSlot('diffTab', DiffTab);
  return () => offs.forEach((off) => off());
}
