// C8c's code tools (C8c execution document, Interfaces *Tools, slots and the open-file seam*): the Files tool into C8a's
// panel host and the file viewer into C5's `fileTab` slot, registered once from App.tsx's C8c block. Review and the
// `diffTab` slot join in M3. Static and thin: CodeMirror loads with the first code view (O2).
import { registerSlot } from '../../app/slots';
import { registerPanelTool } from '../../panel/host';
import { filesTool } from './files/FilesTool';
import { FileViewer } from './viewer/FileViewer';

export { filesTool } from './files/FilesTool';
export { useFiles } from './files/store';
export { codeTranscriptActions, openFile } from './open-file';
export { FileViewer } from './viewer/FileViewer';
export { kindOf } from './viewer/kinds';

// Registers the tools and slots. The disposer unregisters the tools, which closes their tabs (C8a's rule), so App.tsx
// never calls it; tests and the harness may.
export function registerCodeTools(): () => void {
  const offFiles = registerPanelTool(filesTool);
  registerSlot('fileTab', FileViewer);
  return () => offFiles();
}
