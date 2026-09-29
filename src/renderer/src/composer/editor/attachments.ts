// Attachments (C7 execution document, "Sizes and caps"): an image is downscaled to at most 1568 px on its longest edge
// (the vision model's working size) and re-encoded, PNG for screenshots (PNG or GIF sources) and JPEG at 0.85 otherwise,
// then refused when still over 5 MiB (the API's per-image limit); a draft keeps attachment bytes up to 4 MiB in total,
// in order, the rest marked `persisted: false`; a send is pre-checked against C3's 1 MiB content cap.
import { MAX_SEND_CONTENT_BYTES } from '@shared/engine/session-state-store';
import type { ContentBlock } from '@shared/graph/events';
import type { Attachment } from './doc';

const MiB = 1024 * 1024;
export const MAX_IMAGE_EDGE = 1568;
export const MAX_IMAGE_BYTES = 5 * MiB;
export const DRAFT_ATTACHMENT_BUDGET = 4 * MiB;

export function scaledSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_IMAGE_EDGE) return { width, height };
  const scale = MAX_IMAGE_EDGE / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function encodingFor(mediaType: string): { type: 'image/png' } | { type: 'image/jpeg'; quality: number } {
  return mediaType === 'image/png' || mediaType === 'image/gif' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.85 };
}

export function imageRefusal(name: string, bytes: number): string | null {
  return bytes > MAX_IMAGE_BYTES ? `${name} is over 5 MB after resizing and can't be attached` : null;
}

export function base64Bytes(data: string): number {
  if (data === '') return 0;
  return Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}

// Each attachment's `persisted`: whether its bytes fit the draft's budget, taken in order (a later small one may fit).
export function markPersisted(attachments: Attachment[]): Attachment[] {
  let left = DRAFT_ATTACHMENT_BUDGET;
  return attachments.map((attachment) => {
    const fits = attachment.bytes <= left;
    if (fits) left -= attachment.bytes;
    return attachment.persisted === fits ? attachment : { ...attachment, persisted: fits };
  });
}

const encoder = new TextEncoder();
// The composer's pre-check of C3's cap on a `user` frame's content (1 MiB of JSON), in the words it reports.
export function sendSizeRefusal(content: string | ContentBlock[]): string | null {
  const bytes = encoder.encode(JSON.stringify(content)).length;
  return bytes > MAX_SEND_CONTENT_BYTES ? `Message too large (${Math.ceil(bytes / 1024)} KB); attach the text as a file instead` : null;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// Decodes, downscales and re-encodes an image off the main thread's paint (createImageBitmap and an OffscreenCanvas).
// A GIF keeps its first frame. Browser only.
export async function downscaleImage(blob: Blob, mediaType: string): Promise<{ mediaType: string; data: string; bytes: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const size = scaledSize(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const encoding = encodingFor(mediaType);
    const out = await canvas.convertToBlob(encoding);
    const bytes = new Uint8Array(await out.arrayBuffer());
    return { mediaType: encoding.type, data: toBase64(bytes), bytes: bytes.length };
  } finally {
    bitmap.close();
  }
}

// A file's bytes as base64 (a PDF, which is sent as is).
export async function fileBase64(file: Blob): Promise<string> {
  return toBase64(new Uint8Array(await file.arrayBuffer()));
}
