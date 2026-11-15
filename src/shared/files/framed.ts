// The framed kinds and a file frame's URL (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §A). Red first: the names exist, their bodies are built next.
export type FramedKind = 'pdf' | 'html' | 'video' | 'audio';
export function framedKindOf(_mime: string): FramedKind | null {
  return null;
}
export const FRAME_TOKEN = /^[0-9a-f]{32}$/;
export function frameUrl(_token: string, _name: string): string {
  return '';
}
export function frameTokenOf(_url: string): string | null {
  return null;
}
