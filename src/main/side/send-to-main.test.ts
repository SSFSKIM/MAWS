// Send to main (E3 execution document, Design §8): the anchored comment to the parent itself, as the composer would
// send it: a `next` steer while a turn runs, otherwise a send through the app queue; the host's refusal verbatim.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { anchoredMessage } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../test/support/builders';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { HostDispatch } from '../ipc/router';
import { ScreenshotRefused } from './screenshot';
import { sendToMain } from './send-to-main';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('sendToMain', () => {
  let dir: ReturnType<typeof tempDir>;
  let work: ReturnType<typeof tempDir>;
  let index: Index;
  let parent: AppSessionId;
  let calls: { name: string; input: Record<string, unknown> }[];
  let turn: unknown;
  let refuse: string | null;
  const anchor: Anchor = { kind: 'file-line', locator: '/r/x.ts#L42', label: 'x.ts:42', path: '/r/x.ts', line: 42 };
  const dispatch: HostDispatch = async (_owner, name, input) => {
    calls.push({ name, input: input as Record<string, unknown> });
    if (refuse !== null && name !== 'session.status') return { ok: false, error: { code: 'internal', message: refuse } };
    if (name === 'session.status') return { ok: true, value: { ...status(parent), turn } as never };
    if (name === 'session.steer') return { ok: true, value: { messageUuid: 'm-steer' } as never };
    if (name === 'session.send') return { ok: true, value: { messageUuid: 'm-send', disposition: 'queued', queueId: 'q' } as never };
    throw new Error(`unexpected ${name}`);
  };
  beforeEach(() => {
    dir = tempDir();
    work = tempDir('maws-send-main-');
    index = new Index(join(dir.path, 'index.sqlite'));
    parent = index.sessions.upsertFromSummary(summary({ directory: work.path })).record.appId;
    calls = [];
    turn = null;
    refuse = null;
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    work.dispose();
  });
  const s = () => ({ dispatch, sessions: index.sessions });
  const text = (screenshot: boolean) => anchoredMessage({ anchor, text: 'Look here', destination: 'main', screenshot });

  it('steers with next while the parent runs a turn', async () => {
    turn = { id: 't', origin: 'human', startedAt: '', acceptedAt: null, userMessageUuids: [] };
    expect(await sendToMain(s(), dir.path, { appSessionId: parent, anchor, text: ' Look here ', screenshot: null })).toEqual({ messageUuid: 'm-steer', disposition: 'steered' });
    expect(calls.slice(1)).toEqual([{ name: 'session.steer', input: { appSessionId: parent, content: [{ type: 'text', text: text(false) }], priority: 'next' } }]);
  });

  it('sends through the app queue while it is idle, answering the queue’s disposition', async () => {
    expect(await sendToMain(s(), dir.path, { appSessionId: parent, anchor, text: 'Look here', screenshot: null })).toEqual({ messageUuid: 'm-send', disposition: 'queued' });
    expect(calls.map((c) => c.name)).toEqual(['session.status', 'session.send']);
  });

  it('puts a screenshot from the session’s directory first, and refuses one from elsewhere before calling the host', async () => {
    mkdirSync(join(work.path, 'shots'));
    writeFileSync(join(work.path, 'shots', 'a.png'), PNG);
    await sendToMain(s(), dir.path, { appSessionId: parent, anchor: { ...anchor, screenshot: { path: '/never/opened.png', width: 1, height: 1 } }, text: 'Look here', screenshot: { path: join(work.path, 'shots', 'a.png'), width: 1, height: 1 } });
    expect(calls[1]!.input.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
      { type: 'text', text: text(true) },
    ]);
    calls.length = 0;
    const elsewhere = tempDir('maws-send-elsewhere-');
    try {
      writeFileSync(join(elsewhere.path, 'b.png'), PNG);
      await expect(sendToMain(s(), dir.path, { appSessionId: parent, anchor, text: 'x', screenshot: { path: join(elsewhere.path, 'b.png'), width: 1, height: 1 } })).rejects.toBeInstanceOf(ScreenshotRefused);
      expect(calls).toEqual([]);
    } finally {
      elsewhere.dispose();
    }
  });

  it('passes the host’s refusal on verbatim, and refuses a session it does not know', async () => {
    refuse = 'session x is not ready (exited)';
    await expect(sendToMain(s(), dir.path, { appSessionId: parent, anchor, text: 'x', screenshot: null })).rejects.toThrow('session x is not ready (exited)');
    await expect(sendToMain(s(), dir.path, { appSessionId: '5d1b5a0e-1111-4222-8333-444444444444', anchor, text: 'x', screenshot: null })).rejects.toThrow('no session 5d1b5a0e-1111-4222-8333-444444444444');
  });
});
