// The screencast channel's host end (the stand-in for the RL2 kind O7 would carry, `browser.screencast`): one viewer on a
// unix socket (0600), frames out and input back, in lib/wire.mjs's framing. The viewer's requests carry an `id` and are
// answered `{re: id, ok, value | error}`; frames are pushed as they come.
//
// Two frame sources, so the spike can compare them: `cdp`, CDP's `Page.startScreencast` sent through the tab's one
// TabDebugger attachment (the attachment cua's leases share), each frame acked to Chromium only when the viewer acks it
// (end-to-end flow control, as a remote view over a channel would need); and `subscription`, Electron's
// `webContents.beginFrameSubscription` encoded to JPEG here, which needs no CDP session at all. Input goes back as
// `Input.dispatchMouseEvent` through the same TabDebugger, so the app's input attribution sees it as the agent's.
import { chmodSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import type { DebuggerLease } from '../../../src/main/browser/debugger';
import type { TabStore } from '../../../src/main/browser/tabs';
import { channelDecoder, encodeControl, encodeFrame } from '../lib/wire.mjs';

interface Deps {
  path: string;
  store: TabStore;
  tabId: string;
  memory(label: string): Record<string, unknown>;
  step(name: string, data?: Record<string, unknown>): void;
  fail(name: string, error: unknown): void;
  inspect(): unknown;
  exit(): void;
}

type Request = { id: number; op: string; [key: string]: unknown };

export function serveScreencast(deps: Deps): { listening: Promise<void>; close(): void } {
  let viewer: Socket | null = null;
  let seq = 0;
  let lease: DebuggerLease | null = null;
  let stopFrames: (() => void) | null = null;
  let subscribed = false;
  const entry = () => deps.store.require(deps.tabId);
  const dbg = () => {
    const d = entry().debugger;
    if (!d) throw new Error('the tab has no debugger (no view)');
    return d;
  };
  const send = (frame: Buffer) => {
    if (viewer && !viewer.destroyed) viewer.write(frame);
  };

  async function stopCast(): Promise<void> {
    stopFrames?.();
    stopFrames = null;
    if (lease) {
      await dbg().send('Page.stopScreencast').catch(() => {});
      lease.release();
      lease = null;
    }
    if (subscribed) {
      entry().view?.webContents.endFrameSubscription();
      subscribed = false;
    }
  }

  const ops: Record<string, (request: Request) => Promise<unknown> | unknown> = {
    async start(request) {
      await stopCast();
      const quality = Number(request.quality ?? 60);
      const maxWidth = Number(request.maxWidth ?? 1280);
      const maxHeight = Number(request.maxHeight ?? 800);
      if (request.source === 'subscription') {
        const wc = entry().view!.webContents;
        wc.beginFrameSubscription(false, (image) => {
          const size = image.getSize();
          const scaled = size.width > maxWidth ? image.resize({ width: maxWidth, quality: 'good' }) : image;
          const jpeg = scaled.toJPEG(quality);
          send(encodeFrame({ seq: ++seq, source: 'subscription', width: scaled.getSize().width, height: scaled.getSize().height, capturedWidth: size.width, hostAt: Date.now() }, jpeg));
        });
        subscribed = true;
        return { source: 'subscription' };
      }
      const d = dbg();
      lease = await d.lease();
      stopFrames = d.on('Page.screencastFrame', (params, sessionId) => {
        if (sessionId !== '') return;
        const p = params as { data: string; sessionId: number; metadata: { timestamp?: number; deviceWidth: number; deviceHeight: number; pageScaleFactor: number; offsetTop: number } };
        send(encodeFrame({ seq: ++seq, source: 'cdp', ackId: p.sessionId, cdpTimestamp: p.metadata.timestamp ?? null, deviceWidth: p.metadata.deviceWidth, deviceHeight: p.metadata.deviceHeight, hostAt: Date.now() }, Buffer.from(p.data, 'base64')));
      });
      await d.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame: Number(request.everyNthFrame ?? 1) });
      return { source: 'cdp' };
    },
    async ack(request) {
      if (lease) await dbg().send('Page.screencastFrameAck', { sessionId: request.ackId });
      return null;
    },
    stop: () => stopCast(),
    async click(request) {
      const d = dbg();
      const x = Number(request.x);
      const y = Number(request.y);
      const sentAt = Date.now();
      await d.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await d.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await d.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      return { sentAt, doneAt: Date.now() };
    },
    page: (request) => entry().view!.webContents.executeJavaScript(String(request.expression)),
    memory: (request) => deps.memory(String(request.label)),
    inspect: () => deps.inspect(),
    exit: () => void setTimeout(() => deps.exit(), 50),
  };

  const server = createServer((socket) => {
    if (viewer) return void socket.destroy(); // one viewer
    viewer = socket;
    deps.step('viewer connected');
    const decode = channelDecoder();
    socket.on('data', (chunk) => {
      let messages;
      try {
        messages = decode(chunk);
      } catch (error) {
        deps.fail('screencast decode', error);
        socket.destroy();
        return;
      }
      for (const message of messages) {
        if (message.kind !== 'control') continue;
        const request = message.body as Request;
        const op = ops[request.op];
        Promise.resolve()
          .then(() => {
            if (!op) throw new Error(`unknown op ${request.op}`);
            return op(request);
          })
          .then(
            (value) => request.op !== 'ack' && send(encodeControl({ re: request.id, ok: true, value: value ?? null })),
            (error: unknown) => send(encodeControl({ re: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })),
          );
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      viewer = null;
      void stopCast();
      deps.step('viewer gone');
    });
  });
  rmSync(deps.path, { force: true });
  const listening = new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.path, () => {
      chmodSync(deps.path, 0o600);
      resolve();
    });
  });
  return {
    listening,
    close() {
      void stopCast();
      viewer?.destroy();
      server.close();
      rmSync(deps.path, { force: true });
    },
  };
}
