// The table of file frames' tokens (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §C, "Who owns a token"; M3, decision 7). Main issues a token to one page of one app window, for one viewer
// entry, and records with it what was fixed at issue (the file's base name, the one path the token answers; its kind,
// type and policy; its source of bytes) and the page's web contents, which the request filter's owner's check compares
// with the asker's (M4). A token is released by its page, at the page's end (closed, crashed, reloaded) and at the app's
// quit; a release closes its source, which for a copy of another machine's file is the copy's end, since it has no name.
import { randomBytes } from 'node:crypto';
import { FRAME_TOKEN, type FramedKind } from '@shared/files/framed';
import type { ClientRef } from '@shared/ipc/client';
import type { ByteSource } from './source';

// Per page: the viewer keeps at most 20 entries that are not mounted, so only a fault in the window reaches it.
export const FRAME_TOKENS_MAX = 32;

// Fixed at issue: `name` is the file's base name, the one path the token answers (L3); `csp` is null for a PDF and the
// store's frame policy otherwise.
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
  // 'full': the page holds the bound; 'gone': the page has ended. Either way nothing is recorded, and the source is the
  // caller's to close.
  issue(owner: ClientRef, contentsId: number, fixed: FrameFixed): FrameToken | 'full' | 'gone';
  get(token: string): FrameToken | null;
  // undefined: no token's shape (an artifact's id); null: a token nobody holds; else the owning web contents' id
  ownerOf(host: string): number | null | undefined;
  // false: not this page's, known or not (the same answer for both)
  release(token: string, by: ClientRef): boolean;
  releaseAll(owner: ClientRef): void; // the page's end
  releaseEverything(): void; // the app's quit
}

// 16 random bytes as hex, drawn again while it holds no letter: Chromium reads a host of digits alone as an IPv4 address
// and refuses one that large (decision 10).
const drawToken = () => randomBytes(16).toString('hex');

export function createFrameTokens(random: () => string = drawToken): FrameTokens {
  const byToken = new Map<string, FrameToken>();
  // per live page: its tokens, and the unsubscribe of its end
  const pages = new Map<string, { tokens: Set<string>; off: () => void }>();

  const drop = (token: string) => {
    const held = byToken.get(token);
    if (!held) return;
    byToken.delete(token);
    pages.get(held.owner.id)?.tokens.delete(token);
    held.source.close().catch((error: unknown) => console.warn(`[file-frames] a frame's source did not close: ${error instanceof Error ? error.message : String(error)}`));
  };

  const releaseAll = (owner: ClientRef) => {
    const page = pages.get(owner.id);
    if (!page) return;
    pages.delete(owner.id);
    page.off();
    for (const token of [...page.tokens]) drop(token);
  };

  return {
    issue(owner, contentsId, fixed) {
      let page = pages.get(owner.id);
      if (!page) {
        let ended = false;
        const made = { tokens: new Set<string>(), off: () => {} };
        made.off = owner.onGone(() => {
          ended = true;
          releaseAll(owner);
        });
        if (ended) return 'gone'; // `onGone` runs at once for a page that has already ended
        pages.set(owner.id, made);
        page = made;
      }
      if (page.tokens.size >= FRAME_TOKENS_MAX) return 'full';
      let token = random();
      while (!FRAME_TOKEN.test(token) || !/[a-f]/.test(token) || byToken.has(token)) token = random();
      const issued: FrameToken = { ...fixed, token, owner, contentsId };
      byToken.set(token, issued);
      page.tokens.add(token);
      return issued;
    },
    get: (token) => byToken.get(token) ?? null,
    ownerOf(host) {
      if (!FRAME_TOKEN.test(host)) return undefined;
      return byToken.get(host)?.contentsId ?? null;
    },
    release(token, by) {
      if (byToken.get(token)?.owner.id !== by.id) return false;
      drop(token);
      return true;
    },
    releaseAll,
    releaseEverything() {
      for (const owner of [...pages.keys()]) {
        const page = pages.get(owner)!;
        pages.delete(owner);
        page.off();
        for (const token of [...page.tokens]) drop(token);
      }
    },
  };
}
