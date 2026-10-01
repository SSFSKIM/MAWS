// `appearance.transcriptWidth` (W2; charter §6 as amended 2026-10-01, Claude Desktop's width setting): the column the
// transcript's rows and the composer frame share is `--measure` at the document root, so one property moves both. The
// default leaves the token as tokens.css declares it (768px); 960 and 1280 override it there.
import type { TranscriptWidth } from '@shared/ipc/schema';
import { useSettings } from '../stores/settings';

export const DEFAULT_TRANSCRIPT_WIDTH: TranscriptWidth = 768;

export function applyTranscriptWidth(width: TranscriptWidth, root: HTMLElement = document.documentElement): void {
  if (width === DEFAULT_TRANSCRIPT_WIDTH) root.style.removeProperty('--measure');
  else root.style.setProperty('--measure', `${width}px`);
}

// Keeps the root's column on the settings' value, from App.tsx.
export function connectTranscriptWidth(settings: typeof useSettings = useSettings, root: HTMLElement = document.documentElement): () => void {
  let applied: TranscriptWidth | undefined;
  const follow = () => {
    const width = settings.getState().state?.settings.appearance.transcriptWidth ?? DEFAULT_TRANSCRIPT_WIDTH;
    if (width === applied) return;
    applied = width;
    applyTranscriptWidth(width, root);
  };
  follow();
  return settings.subscribe(follow);
}
