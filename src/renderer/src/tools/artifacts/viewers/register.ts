// App.tsx's P3-L block (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b; Decision Log 7): the store's byte
// kinds' viewers into the editor mount registry, and main's attribution of an artifact frame's console into the viewers'
// console store. Answers the undo.
import { registerArtifactEditor } from '../../../artifacts/registry';
import { byteViewer } from './ByteViewer';
import { startArtifactConsole } from './console';

export function registerByteViewers(): () => void {
  const undo = [registerArtifactEditor('html', byteViewer('html')), registerArtifactEditor('file', byteViewer('file')), startArtifactConsole()];
  return () => undo.forEach((off) => off());
}
