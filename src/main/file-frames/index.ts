// Main's file frames (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, Interfaces §D; M4).
// Red first: the exports name nothing yet.
import type { FileHandle } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import type { IpcError } from '@shared/ipc/errors';
import type { MachineRef } from '@shared/machine/ref';
import type { SchemeResponder } from '../../render/store-serving';
import type { registerMainHandler } from '../ipc/router';
import type { RawRead } from './source';
import { createFrameTokens, type FrameTokens } from './tokens';

export const FRAME_COPIES_DIR = 'frame-copies';

type Copied = { ok: true; value: { written: number } | 'too-large' } | { ok: false; error: IpcError };

export interface FileFramesDeps {
  local: MachineRef;
  read: RawRead;
  copy(machine: MachineRef, source: { appSessionId: AppSessionId; path: string }, sink: FileHandle, max: number, options: { label: string; seen(first: { mime: string; bytes: number }): void }): Promise<Copied | null>;
  page(client: ClientRef): { id: number; send(name: 'layout.frameFailed', payload: { token: string }): void } | null;
  userData(): string;
  register: typeof registerMainHandler;
  seam?(line: string): void;
  log(line: string): void;
}

export function startFileFrames(_deps: FileFramesDeps): { tokens: FrameTokens; responder: SchemeResponder; stop(): void } {
  return { tokens: createFrameTokens(), responder: async () => null, stop: () => {} };
}
