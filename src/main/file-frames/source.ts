// Red first: the names exist, their bodies are built next.
import type { FileHandle } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandResult } from '@shared/ipc/schema';
import type { FilesReadInput } from '@shared/ipc/schema/files';

export const FRAME_PAGE_BYTES = 1024 * 1024;
export interface Page {
  bytes: Uint8Array;
  size: number;
  identity: string;
}
export interface ByteSource {
  read(offset: number, length: number): Promise<Page>;
  close(): Promise<void>;
}
export class FrameReadError extends Error {
  constructor(
    readonly why: 'unserved' | 'refused',
    message: string,
  ) {
    super(message);
  }
}
export interface FrameAsk {
  named: true;
}
export type RawRead = (input: FilesReadInput, as: ClientRef) => Promise<CommandResult<'files.read'>>;
export function localSource(_read: RawRead, _as: ClientRef, _target: { appSessionId: AppSessionId; path: string }, _ask: FrameAsk): ByteSource {
  return { read: () => Promise.reject(new Error('not built')), close: async () => {} };
}
export function copySource(_handle: FileHandle, _size: number): ByteSource {
  return { read: () => Promise.reject(new Error('not built')), close: async () => {} };
}
