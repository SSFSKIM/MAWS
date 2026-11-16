// A framed file's body (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5). Not yet built.
import type { ReactNode } from 'react';
import type { ViewerEntry } from './viewer-store';

export function pdfFragment(host: 'side' | 'main'): string {
  void host;
  return '';
}

export function FrameBody({ entry, host }: { entry: ViewerEntry; host: 'side' | 'main' }): ReactNode {
  void entry;
  void host;
  return null;
}
