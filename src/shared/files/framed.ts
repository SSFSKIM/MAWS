// The framed kinds and a file frame's URL (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §A). A PDF, an HTML page, a video or a sound that a session's path names is drawn in a frame whose URL is
// `maws-artifact://<token>/<the file's base name>`: the token, 32 lower-case hexadecimal characters drawn by main, is the
// host, and the name is there so that Chromium's PDF viewer, which titles itself with the URL's last part, reads the
// file's name (L3). No folder's name ever enters the URL, and main answers a token at that one path alone. Shared by main
// and the window; no Node import, since the window bundles it.

export type FramedKind = 'pdf' | 'html' | 'video' | 'audio';

// The kind of frame a file's type is drawn in, from the type the files service answered; null for every other type.
export function framedKindOf(mime: string): FramedKind | null {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/html') return 'html';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

export const FRAME_TOKEN = /^[0-9a-f]{32}$/;

// `name` is a base name, never a path: encoded whole, so it is one path segment.
export function frameUrl(token: string, name: string): string {
  return `maws-artifact://${token}/${encodeURIComponent(name)}`;
}

const HOST = /^maws-artifact:\/\/([^/?#]*)/;

// The URL's host when it has a token's shape, whatever follows it; null for an artifact's id and for another scheme. The
// host is taken as written: Chromium lowercases a standard scheme's host, and a token is lower case.
export function frameTokenOf(url: string): string | null {
  const host = HOST.exec(url)?.[1];
  return host !== undefined && FRAME_TOKEN.test(host) ? host : null;
}
