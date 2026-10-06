// A comment's screenshot as the image block the agent receives (E3 execution document, Design §9): the one path main
// opens for an anchored comment. It is realpath-resolved (so a symlink is judged by where it points), must lie under an
// allowed root (`<userData>/`, where E2's and E4's captures live, or the parent session's own directories, by E5's
// containment check), be a regular file of at most 5 MiB (the API's per-image bound), and is typed by its magic bytes,
// never by its name. Every refusal names its reason, which the composer's sheet shows.
import { open, realpath } from 'node:fs/promises';
import type { ContentBlock } from '@shared/graph/events';
import { MAX_SEND_IMAGE_BYTES } from '@shared/engine/session-state-store';
import { under } from '../files/allowlist';

export class ScreenshotRefused extends Error {
  constructor(readonly reason: string) {
    super(`screenshot: ${reason}`);
    this.name = 'ScreenshotRefused';
  }
}

export async function readScreenshotBlock(path: string, roots: readonly string[]): Promise<ContentBlock> {
  const real = await realpath(path).catch(() => null);
  if (real === null) throw new ScreenshotRefused('not found');
  const allowed = await Promise.all(roots.map((root) => realpath(root).catch(() => null)));
  if (!allowed.some((root) => root !== null && under(root, real))) throw new ScreenshotRefused('not under an allowed root');
  const handle = await open(real, 'r').catch(() => null);
  if (handle === null) throw new ScreenshotRefused('not found');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ScreenshotRefused('not a regular file');
    if (stat.size > MAX_SEND_IMAGE_BYTES) throw new ScreenshotRefused('larger than 5 MiB');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_SEND_IMAGE_BYTES) throw new ScreenshotRefused('larger than 5 MiB'); // grew since the stat
    const mediaType = imageTypeOf(bytes);
    if (mediaType === null) throw new ScreenshotRefused('not a PNG, JPEG, GIF or WebP');
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') } };
  } finally {
    await handle.close();
  }
}

const startsWith = (bytes: Buffer, prefix: readonly number[], at = 0) => prefix.every((byte, i) => bytes[at + i] === byte);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

function imageTypeOf(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}
