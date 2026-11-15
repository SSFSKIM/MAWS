// A file frame's source of bytes (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §C; M3, decision 6). Two kinds, behind one face the responder reads range by range:
//
// - A file of this Mac (`localSource`): every range is a raw `files.read` of this Mac's daemon, asked as the page that
//   owns the token, with the session and the path the command gave and the frame's keys, so the daemon admits or refuses
//   each read on those same values (constraint 4). An answer with no `identity`, or in a text encoding, is a daemon that
//   does not know `raw` (it dropped the key and answered the plain read): `unserved`, nothing of it is served.
// - A copy of another machine's file (`copySource`): the descriptor main holds for the copy, which has no name (M4,
//   decision 3), read at a position. A copy cannot change once written, so its identity is fixed.
import type { FileHandle } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandResult } from '@shared/ipc/schema';
import type { FilesReadInput } from '@shared/ipc/schema/files';

// The most a read for a frame asks at once: a page of the response's body.
export const FRAME_PAGE_BYTES = 1024 * 1024;

export interface Page {
  bytes: Uint8Array;
  size: number; // the file's
  identity: string;
}

export interface ByteSource {
  read(offset: number, length: number): Promise<Page>;
  close(): Promise<void>;
}

// `unserved`: the daemon cannot serve a frame (an answer with no identity, or text); `refused`: the read's own failure,
// its words kept as the message.
export class FrameReadError extends Error {
  constructor(
    readonly why: 'unserved' | 'refused',
    message: string,
  ) {
    super(message);
    this.name = 'FrameReadError';
  }
}

// The keys every read of the frame carries; U6e adds `agent?: true` ("What this document assumes of landings in flight").
export interface FrameAsk {
  named: true;
}

export type RawRead = (input: FilesReadInput, as: ClientRef) => Promise<CommandResult<'files.read'>>;

export function localSource(read: RawRead, as: ClientRef, target: { appSessionId: AppSessionId; path: string }, ask: FrameAsk): ByteSource {
  return {
    async read(offset, length) {
      let answer: Awaited<ReturnType<RawRead>>;
      try {
        answer = await read({ appSessionId: target.appSessionId, path: target.path, offset, length, raw: true, ...ask }, as);
      } catch (error) {
        throw new FrameReadError('refused', error instanceof Error ? error.message : String(error));
      }
      if (!answer.ok) throw new FrameReadError('refused', answer.error.message);
      const { identity, encoding, content, bytes } = answer.value;
      if (identity === undefined || encoding !== 'base64') throw new FrameReadError('unserved', 'files.read: this daemon answers no raw read');
      return { bytes: Buffer.from(content, 'base64'), size: bytes, identity };
    },
    close: async () => {},
  };
}

export function copySource(handle: FileHandle, size: number): ByteSource {
  let closed: Promise<void> | null = null;
  return {
    async read(offset, length) {
      const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
      for (let filled = 0; filled < buffer.length; ) {
        const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, offset + filled);
        if (bytesRead === 0) throw new FrameReadError('refused', `the copy ends at byte ${offset + filled} of ${size}`);
        filled += bytesRead;
      }
      return { bytes: buffer, size, identity: `copy:${size}` };
    },
    close: () => (closed ??= handle.close()),
  };
}
