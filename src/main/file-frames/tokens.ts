// Red first: the names exist, their bodies are built next.
import type { FramedKind } from '@shared/files/framed';
import type { ClientRef } from '@shared/ipc/client';
import type { ByteSource } from './source';

export const FRAME_TOKENS_MAX = 32;
export interface FrameFixed {
  name: string;
  framed: FramedKind;
  mime: string;
  csp: string | null;
  source: ByteSource;
}
export interface FrameToken extends FrameFixed {
  token: string;
  owner: ClientRef;
  contentsId: number;
}
export interface FrameTokens {
  issue(owner: ClientRef, contentsId: number, fixed: FrameFixed): FrameToken | 'full' | 'gone';
  get(token: string): FrameToken | null;
  ownerOf(host: string): number | null | undefined;
  release(token: string, by: ClientRef): boolean;
  releaseAll(owner: ClientRef): void;
  releaseEverything(): void;
}
export function createFrameTokens(_random?: () => string): FrameTokens {
  const none = () => {
    throw new Error('not built');
  };
  return { issue: none, get: none, ownerOf: none, release: none, releaseAll: none, releaseEverything: none };
}
