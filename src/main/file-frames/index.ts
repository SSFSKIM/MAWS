// Main's file frames (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, Interfaces §D; M4,
// decisions 1 to 9; "Who owns a token"). A PDF, an HTML page, a video or a sound a session's path names is drawn in a
// frame at `maws-artifact://<token>/<the file's base name>`; this module issues those tokens, releases them, tells the
// owning page when a read for one failed, and holds the responder main's default partition asks first.
//
// - `layout.frameFile` on this Mac: one raw read of the file's head (`FRAME_HEAD_BYTES`), asked as the asking page with
//   the frame's keys; its type decides the frame, the `Content-Type` and the policy, fixed with the token. The token's
//   source reads every later range the same way, so the daemon admits or refuses each read on the session and the path
//   the command gave (constraint 4). A refusal is the command's failure with the service's words; an answer with no
//   `identity` is a daemon that cannot serve a frame (`unserved`); a type no frame draws is `unframed`.
// - On another machine: the file is copied here, up to `REMOTE_COPY_MAX_BYTES`, into a descriptor whose name is removed
//   before the first page is asked (A5, A6), and the frame is served from that descriptor until the token goes. No byte
//   of a copy ever exists under a name: no part file, no rename, nothing to sweep, and the folder is the profile's own.
// - A token is recorded only once the admission read or the copy has completed, in one step that first checks the asking
//   page still lives (sequence 7). It is released by its page, at the page's end and at the app's quit; a copy's release
//   closes its descriptor, which is the copy's end.
// - Every failed read of a live token is told to its page alone (`layout.frameFailed`), never broadcast: a token told to
//   another window would be a token another window holds.
//
// - An HTML file's ready answer also says whether its head names files beside it (`neighbours`, M5 decision 14; the
//   owner's answer to card 2), read from the same head as its `Content-Type`, so the tab can say the page is shown without
//   them. Never for another kind.
//
// Main writes no token to a log and names a frame by its session, never by its path; the one exception is the e2e seam
// (`seam`, under MAWS_E2E=1), whose `frame-entry` lines the request filter's `frame-decision` lines are walked against.
import { randomBytes } from 'node:crypto';
import { mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { framedKindOf, frameUrl, type FramedKind } from '@shared/files/framed';
import type { AppSessionId } from '@shared/graph/ids';
import { HostCommandError } from '@shared/host/runtime';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import type { CommandOutput } from '@shared/ipc/schema';
import { REMOTE_COPY_MAX_BYTES } from '@shared/ipc/schema/remote';
import type { MachineRef } from '@shared/machine/ref';
import { STORE_FRAME_CSP, type SchemeResponder } from '../../render/store-serving';
import type { registerMainHandler } from '../ipc/router';
import { FRAME_HEAD_BYTES, htmlContentType } from './charset';
import { neighboursOf } from './neighbours';
import { fileFrameResponder } from './responder';
import { copySource, localSource, type ByteSource, type FrameAsk, type RawRead } from './source';
import { createFrameTokens, type FrameTokens } from './tokens';

// Under the profile's data folder; holds a name only for the instant between a sink's creation and its unlink.
export const FRAME_COPIES_DIR = 'frame-copies';

type Copied = { ok: true; value: { written: number } | 'too-large' } | { ok: false; error: IpcError };

export interface FileFramesDeps {
  local: MachineRef;
  read: RawRead; // invokeOwn('files.read', input, { client, target: local })
  // a session's file of `machine` paged into `sink` (remote lane B's `copyInto`, `fetchInto` beneath); null: no link reaches it
  copy(machine: MachineRef, source: { appSessionId: AppSessionId; path: string }, sink: FileHandle, max: number, options: { label: string; seen(first: { mime: string; bytes: number }): void }): Promise<Copied | null>;
  page(client: ClientRef): { id: number; send(name: 'layout.frameFailed', payload: { token: string }): void } | null; // pageOf, emitTo
  userData(): string;
  register: typeof registerMainHandler;
  seam?(line: string): void; // under MAWS_E2E=1: the policies' ordered writer
  log(line: string): void;
}

type FrameAnswer = CommandOutput<'layout.frameFile'>;

// The keys every read of a frame carries: `named`, and U6e's `agent` for a tab that holds the agent's mark ("What this
// document assumes of landings in flight").
const frameAskOf = (agent: true | undefined): FrameAsk => ({ named: true, ...(agent && { agent }) });

const fail = (code: IpcError['code'], message: string): never => {
  throw new HostCommandError(ipcError(code, message));
};

export function startFileFrames(deps: FileFramesDeps): { tokens: FrameTokens; responder: SchemeResponder; stop(): void } {
  const tokens = createFrameTokens();
  const entered = deps.seam && ((request: Request) => deps.seam!(`frame-entry ${request.method} ${request.headers.get('Range') ?? '-'} ${request.url}`));
  const responder = fileFrameResponder(tokens, (token) => deps.page(token.owner)?.send('layout.frameFailed', { token: token.token }), entered);

  // What a head fixes with the token: the type (an HTML file's settled from its head, decision 18) and, for an HTML file
  // alone, whether it names files beside it (M5, decision 14).
  const fixedBy = (framed: FramedKind, mime: string, head: Uint8Array): { type: string; neighbours?: boolean } =>
    framed === 'html' ? { type: htmlContentType(head), neighbours: neighboursOf(head) } : { type: mime };

  // The token recorded for the asking page, if it still lives and holds fewer than the bound; else `source` is closed.
  async function issue(client: ClientRef, path: string, framed: FramedKind, { type: mime, neighbours }: { type: string; neighbours?: boolean }, source: ByteSource): Promise<FrameAnswer> {
    const name = posix.basename(path);
    const page = deps.page(client);
    const issued = page === null ? 'gone' : tokens.issue(client, page.id, { name, framed, mime, csp: framed === 'pdf' ? null : STORE_FRAME_CSP, source });
    if (issued === 'full' || issued === 'gone') {
      await source.close();
      return issued === 'full' ? fail('invalid_input', 'layout.frameFile: too many file frames in this window') : fail('internal', 'layout.frameFile: the window that asked has gone');
    }
    return { status: 'ready', token: issued.token, url: frameUrl(issued.token, name), framed, ...(neighbours !== undefined && { neighbours }) };
  }

  // On this Mac: the head, read raw as the asking page; its type fixes the frame.
  async function onThisMac(client: ClientRef, appSessionId: AppSessionId, path: string, ask: FrameAsk): Promise<FrameAnswer> {
    const head = await deps.read({ appSessionId, path, offset: 0, length: FRAME_HEAD_BYTES, raw: true, ...ask }, client);
    if (!head.ok) throw new HostCommandError(head.error);
    const { identity, encoding, content, mime } = head.value;
    if (identity === undefined || encoding !== 'base64') return { status: 'row', why: 'unserved' }; // a daemon that dropped `raw`
    const framed = framedKindOf(mime);
    if (framed === null) return { status: 'row', why: 'unframed' };
    return issue(client, path, framed, fixedBy(framed, mime, Buffer.from(content, 'base64')), localSource(deps.read, client, { appSessionId, path }, ask));
  }

  // A sink for a copy: created exclusively, owner-only, in the profile's own folder, and its name removed at once.
  async function namelessSink(): Promise<FileHandle> {
    const dir = join(deps.userData(), FRAME_COPIES_DIR);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const named = join(dir, randomBytes(16).toString('hex'));
    const sink = await open(named, 'wx+', 0o600);
    try {
      await unlink(named);
    } catch (error) {
      await sink.close();
      throw error;
    }
    return sink;
  }

  // On another machine: the file copied into a nameless descriptor, then served from it.
  async function fromMachine(client: ClientRef, machine: MachineRef, appSessionId: AppSessionId, path: string): Promise<FrameAnswer> {
    const sink = await namelessSink();
    let handedOn = false;
    try {
      let mime = '';
      const copied = await deps.copy(machine, { appSessionId, path }, sink, REMOTE_COPY_MAX_BYTES, { label: `a file frame of ${appSessionId}`, seen: (first) => void (mime = first.mime) });
      if (copied === null) return fail('host_unavailable', `layout.frameFile: machine ${machine} is not connected`);
      if (!copied.ok) throw new HostCommandError(copied.error);
      if (copied.value === 'too-large') {
        deps.log(`[file-frames] a file of ${appSessionId} on ${machine} is past the copy's bound`);
        return { status: 'row', why: 'too-large' };
      }
      const framed = framedKindOf(mime); // the type the pass that was written answered
      if (framed === null) return { status: 'row', why: 'unframed' };
      const { written } = copied.value;
      let head = new Uint8Array();
      if (framed === 'html') {
        const read = Buffer.alloc(Math.min(FRAME_HEAD_BYTES, written));
        const { bytesRead } = await sink.read(read, 0, read.length, 0);
        head = read.subarray(0, bytesRead);
      }
      handedOn = true; // the copy's source holds the descriptor from here, and `issue` closes it if nothing is recorded
      return await issue(client, path, framed, fixedBy(framed, mime, head), copySource(sink, written));
    } finally {
      if (!handedOn) await sink.close();
    }
  }

  deps.register('layout.frameFile', ({ appSessionId, path, agent }, { client, target }) => {
    const session = appSessionId as AppSessionId; // the router validated it against AppSessionIdSchema
    // another machine's copy asks as "Open externally"'s does, with neither key (the entry's own reads there carry none)
    return target === deps.local ? onThisMac(client, session, path, frameAskOf(agent)) : fromMachine(client, target, session, path);
  });
  deps.register('layout.releaseFrame', ({ token }, { client }) => {
    if (!tokens.release(token, client)) fail('invalid_input', 'layout.releaseFrame: no frame of this window');
  });

  return { tokens, responder, stop: () => tokens.releaseEverything() };
}
