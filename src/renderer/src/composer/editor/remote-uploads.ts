// A message's files to a lane B session on another machine (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "What a drop sends", "Uploads in parts"; the M4b report's contract). The engine runs there and reads a file by its path
// on that machine, and the channel carries at most one message of MESSAGE_MAX_BYTES, so:
//
// - A drop keeps an image (PNG, JPEG, GIF, WebP within the decode cap) and a PDF as attachments, as locally, and takes
//   any other file, with a path or without, as a file to upload (`kind: 'file'`, its bytes held as a PDF's are), up to
//   UPLOAD_FILE_MAX_BYTES. A local path is never mentioned: it names nothing on the machine.
// - At the send, images go inline in order while the message still fits the channel (M2's bound); every other image,
//   every PDF and every file goes up first, through `files.upload` with the session's address (main's adapter splits each
//   file into parts, one act each, and says each part as `remote.upload`), in calls within the command's bounds (8 files,
//   32 MiB together). Each attachment's path is kept, so a send again after a send that failed past its uploads sends
//   nothing twice.
// - The message carries the inline images and the text, with each uploaded path as a mention relative to the session's
//   working directory, as a dropped local file's is.
import { create } from 'zustand';
import type { ContentBlock } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { UPLOAD_CALL_MAX_BYTES, UPLOAD_FILE_MAX_BYTES, UPLOAD_FILES_MAX } from '@shared/ipc/schema/files';
import { REMOTE_INLINE_MAX_BYTES } from '@shared/ipc/schema/remote';
import type { Attachment } from './doc';
import { IMAGE_BYTE_TYPES, MAX_SOURCE_IMAGE_BYTES, mentionPath } from './paste';
import { mentionText } from './schema';
import type { Serialized } from './serialize';

const MiB = 1024 * 1024;

export type RemoteFileAction = { kind: 'image' } | { kind: 'pdf' } | { kind: 'upload' } | { kind: 'refused'; reason: string };

/** What a file dropped, pasted or picked for a session on `machine` becomes. */
export function classifyRemoteFile(file: { name: string; type: string; size: number }, machine: string): RemoteFileAction {
  if (file.size > UPLOAD_FILE_MAX_BYTES) return { kind: 'refused', reason: `${file.name} is over ${UPLOAD_FILE_MAX_BYTES / MiB} MB, the most a file to ${machine} can be` };
  if (IMAGE_BYTE_TYPES.has(file.type) && file.size <= MAX_SOURCE_IMAGE_BYTES) return { kind: 'image' };
  if (file.type === 'application/pdf') return { kind: 'pdf' };
  return { kind: 'upload' };
}

/** Words for a file the + menu answered by its path alone (no bytes read): nothing of it can reach the machine. */
export const PICKED_BY_PATH = (name: string, machine: string): string => `${name} can’t be sent to ${machine} from here; drag it into the message instead`;

// An image the downscale re-encoded (a GIF as PNG) goes up named by what its bytes are, so the engine reads it as such.
const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp' };
export function uploadName(name: string, mediaType: string): string {
  const extension = EXTENSION[mediaType];
  if (extension === undefined) return name;
  const dot = name.lastIndexOf('.');
  const current = dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
  if (current === extension || (current === 'jpg' && extension === 'jpeg')) return name;
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}

const encoder = new TextEncoder();
const imageBlock = (a: Attachment): ContentBlock => ({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
// The message's size as main's link measures it (its UTF-8 JSON), as `session.send`'s content.
const contentBytes = (blocks: ContentBlock[], text: string) => encoder.encode(JSON.stringify([...blocks, { type: 'text', text }])).length;

/** Which attachments of a send go inline (images, in order, while the message fits the channel) and which go up first. */
export function planRemoteSend(text: string, attachments: readonly Attachment[]): { inline: Attachment[]; upload: Attachment[] } {
  const inline: Attachment[] = [];
  const upload: Attachment[] = [];
  for (const attachment of attachments) {
    const fits = attachment.kind === 'image' && contentBytes([...inline, attachment].map(imageBlock), text) <= REMOTE_INLINE_MAX_BYTES;
    (fits ? inline : upload).push(attachment);
  }
  return { inline, upload };
}

// ---- the uploads -------------------------------------------------------------------------------------------------

export interface UploadProgress {
  sent: number;
  parts: number;
}
export interface RemoteUploadsStore {
  progress: ReadonlyMap<string, UploadProgress | null>; // by attachment id, while its send's uploads run; null: waiting its turn
}
export const useRemoteUploads = create<RemoteUploadsStore>()(() => ({ progress: new Map() }));
export const useUploadProgress = (attachmentId: string): UploadProgress | null | undefined => useRemoteUploads((s) => s.progress.get(attachmentId));

// Each attachment's path on its session's machine, once uploaded (by attachment id: a drop's id is its own).
const uploaded = new Map<string, { session: AppSessionId; path: string }>();
export function resetRemoteUploads(): void {
  uploaded.clear();
  useRemoteUploads.setState({ progress: new Map() });
}

const setProgress = (change: (progress: Map<string, UploadProgress | null>) => void) =>
  useRemoteUploads.setState((s) => {
    const progress = new Map(s.progress);
    change(progress);
    return { progress };
  });

// The files in calls within the command's bounds, in order.
function batches(files: readonly Attachment[]): Attachment[][] {
  const out: Attachment[][] = [];
  let current: Attachment[] = [];
  let bytes = 0;
  for (const file of files) {
    if (current.length > 0 && (current.length === UPLOAD_FILES_MAX || bytes + file.bytes > UPLOAD_CALL_MAX_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.bytes;
  }
  if (current.length > 0) out.push(current);
  return out;
}

export type UploadOutcome = { ok: true; paths: string[] } | { ok: false; error: string };

/** Uploads the attachments to the session's machine (none twice), each one's path in order; the progress meanwhile. */
export async function uploadAttachments(client: MawsBridge, appSessionId: AppSessionId, attachments: readonly Attachment[]): Promise<UploadOutcome> {
  const known = (a: Attachment) => {
    const kept = uploaded.get(a.id);
    return kept !== undefined && kept.session === appSessionId ? kept.path : null;
  };
  const left = attachments.filter((a) => known(a) === null);
  if (left.length > 0) {
    setProgress((progress) => left.forEach((a) => progress.set(a.id, null)));
    try {
      for (const batch of batches(left)) {
        const off = client.on('remote.upload', (event) => {
          const attachment = event.appSessionId === appSessionId ? batch[event.file] : undefined;
          if (attachment) setProgress((progress) => progress.set(attachment.id, { sent: event.sent, parts: event.parts }));
        });
        try {
          const result = await client.invoke('files.upload', { appSessionId, files: batch.map((a) => ({ name: uploadName(a.name, a.mediaType), bytes: a.data })) });
          if (!result.ok) return { ok: false, error: result.error.message };
          if (result.value.status !== 'ok') return { ok: false, error: `${batch.map((a) => a.name).join(', ')} didn’t go up: ${result.value.reason}` };
          const paths = result.value.paths;
          batch.forEach((a, i) => {
            const path = paths[i];
            if (path !== undefined) uploaded.set(a.id, { session: appSessionId, path });
          });
        } finally {
          off();
        }
      }
    } finally {
      setProgress((progress) => left.forEach((a) => progress.delete(a.id)));
    }
  }
  const paths = attachments.map(known);
  return paths.every((path): path is string => path !== null) ? { ok: true, paths } : { ok: false, error: 'the machine answered no path for an upload' };
}

/** The message a send with uploads makes: the inline images, then the text with each path as a mention. */
export function remoteMessage(s: Serialized, inline: readonly Attachment[], paths: readonly string[], cwd: string): Serialized {
  const mentions = paths.map((path) => mentionText({ id: mentionPath(path, cwd), kind: 'file' })).join(' ');
  const join = (head: string) => (mentions === '' ? head : head.trim() === '' ? mentions : `${head}\n\n${mentions}`);
  const text = join(s.text);
  const blocks = inline.map(imageBlock);
  const content: string | ContentBlock[] = blocks.length === 0 ? text : text.trim() === '' ? blocks : [...blocks, { type: 'text', text }];
  const { attachmentNames: _names, ...rest } = s;
  return {
    ...rest,
    text,
    content,
    display: join(s.display),
    empty: text.trim() === '' && blocks.length === 0,
    ...(inline.length > 0 && { attachmentNames: inline.map((a) => a.name) }),
  };
}
