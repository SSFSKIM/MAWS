// `side.comment.content` (UX wave U5a, docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, decision 2 and
// Interfaces §B.2): the content a send to the main conversation carries, built in the app's main process from the
// comments alone. The screenshots in the comments' order, then one text; the only root a screenshot may lie under is
// `<userData>`; a refused screenshot names its comment; one comment is today's content for the main conversation, to
// the byte.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { commentsMessage } from '@shared/anchor/message';
import { HostCommandError } from '@shared/host/runtime';
import { tempDir } from '../../../test/support/index-fixture';
import { commentContent as todaysContent } from '../../services/side/content'; // the one-comment content `side.sendToMain` sends
import type { MainHandler } from '../ipc/router';
import { commentContent, registerCommentContent } from './comment-content';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const GIF = Buffer.from('GIF89a, an invented frame');
const save: Anchor = { kind: 'browser-element', locator: '#save', label: 'button “Save”', pageUrl: 'http://127.0.0.1:4321/form.html', css: '#save' };
const cancel: Anchor = { kind: 'browser-element', locator: '#cancel', label: 'button “Cancel”', pageUrl: 'http://127.0.0.1:4321/form.html', css: '#cancel' };

describe('side.comment.content', () => {
  let userData: ReturnType<typeof tempDir>;
  let elsewhere: ReturnType<typeof tempDir>;
  let crops: string;
  beforeEach(() => {
    userData = tempDir('maws-user-data-');
    elsewhere = tempDir('maws-session-dir-');
    crops = join(userData.path, 'browser', 'crops');
    mkdirSync(crops, { recursive: true });
  });
  afterEach(() => {
    userData.dispose();
    elsewhere.dispose();
  });
  const shot = (dir: string, name: string, bytes: Buffer) => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return { path, width: 1, height: 1 };
  };

  it('answers the comments’ screenshots in order before one text, the message of them all to the main conversation', async () => {
    const comments = [
      { anchor: save, text: 'Primary, please.', screenshot: shot(crops, 'a.gif', GIF) },
      { anchor: cancel, text: 'Grey.', screenshot: null },
      { anchor: save, text: 'And wider.', screenshot: shot(crops, 'c.png', PNG) },
    ];
    expect(await commentContent({ comments }, userData.path)).toEqual({
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/gif', data: GIF.toString('base64') } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
        { type: 'text', text: commentsMessage(comments.map((comment) => ({ ...comment, screenshot: comment.screenshot !== null })), 'main') },
      ],
    });
  });

  it('answers for one comment what a send to the main conversation carried before, to the byte', async () => {
    for (const screenshot of [null, shot(crops, 'one.png', PNG)]) {
      const comment = { anchor: { ...save, screenshot: { path: '/a/stray/field.png', width: 2, height: 2 } }, text: '  Primary, please.\n', screenshot };
      const before = await todaysContent({ ...comment, destination: 'main' }, async () => [userData.path]);
      expect(await commentContent({ comments: [comment] }, userData.path)).toEqual({ content: before });
    }
  });

  it('refuses a screenshot outside <userData>, a session’s own directory included, naming its comment, and reads nothing else', async () => {
    const comments = [
      { anchor: save, text: 'Primary, please.', screenshot: shot(crops, 'a.png', PNG) },
      { anchor: cancel, text: 'Grey.', screenshot: shot(elsewhere.path, 'b.png', PNG) },
    ];
    const refused = commentContent({ comments }, userData.path);
    await expect(refused).rejects.toBeInstanceOf(HostCommandError);
    await expect(refused).rejects.toMatchObject({
      ipcError: { code: 'invalid_input', message: 'screenshot: not under an allowed root', issues: [{ path: ['comments', 1, 'screenshot'], message: 'screenshot: not under an allowed root' }] },
    });
    const missing = commentContent({ comments: [{ anchor: save, text: 'x', screenshot: { path: join(crops, 'gone.png'), width: 1, height: 1 } }] }, userData.path);
    await expect(missing).rejects.toMatchObject({ ipcError: { code: 'invalid_input', issues: [{ path: ['comments', 0, 'screenshot'], message: 'screenshot: not found' }] } });
  });

  it('is registered under its name, with no session in its input', async () => {
    const handlers: [string, MainHandler<'side.comment.content'>][] = [];
    registerCommentContent((name, handler) => handlers.push([name, handler]), userData.path);
    expect(handlers.map(([name]) => name)).toEqual(['side.comment.content']);
    const answer = await handlers[0]![1]({ comments: [{ anchor: save, text: 'Primary, please.', screenshot: null }] }, {} as never);
    expect(answer).toEqual({ content: [{ type: 'text', text: commentsMessage([{ anchor: save, text: 'Primary, please.', screenshot: false }], 'main') }] });
  });
});
