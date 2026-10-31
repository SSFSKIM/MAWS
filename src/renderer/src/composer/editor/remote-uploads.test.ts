// A message's files to a lane B session on another machine (P5 O7 M4, "What a drop sends", "Uploads in parts"): what a
// drop becomes, which attachments of a send go inline and which go up first, the uploads themselves (batched to the
// command's bounds, progress per attachment, each attachment's path kept for a send again), and the message they make.
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { REMOTE_INLINE_MAX_BYTES } from '@shared/ipc/schema/remote';
import { addressOf } from '@shared/machine/address';
import { fakeClient } from '../../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../../test/support/machine';
import type { Attachment } from './doc';
import type { Serialized } from './serialize';
import { classifyRemoteFile, planRemoteSend, remoteMessage, resetRemoteUploads, uploadAttachments, uploadName, useRemoteUploads } from './remote-uploads';

const MiB = 1024 * 1024;
const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
// base64 of `bytes` zero bytes: four characters per three bytes
const b64 = (bytes: number) => 'A'.repeat(4 * Math.ceil(bytes / 3));
const image = (id: string, bytes: number): Attachment => ({ id, kind: 'image', name: `${id}.png`, mediaType: 'image/png', bytes, data: b64(bytes), persisted: true });
const pdf = (id: string, bytes: number): Attachment => ({ id, kind: 'document', name: `${id}.pdf`, mediaType: 'application/pdf', bytes, data: b64(bytes), persisted: true });
const file = (id: string, name: string, bytes: number): Attachment => ({ id, kind: 'file', name, mediaType: 'text/plain', bytes, data: b64(bytes), persisted: true });

afterEach(() => resetRemoteUploads());

describe('what a drop on a session on another machine becomes', () => {
  it('keeps images and PDFs as attachments, takes any other file as one to upload, and refuses one past the upload bound', () => {
    expect(classifyRemoteFile({ name: 'shot.png', type: 'image/png', size: MiB }, 'mini')).toEqual({ kind: 'image' });
    expect(classifyRemoteFile({ name: 'doc.pdf', type: 'application/pdf', size: 30 * MiB }, 'mini')).toEqual({ kind: 'pdf' });
    expect(classifyRemoteFile({ name: 'notes.txt', type: 'text/plain', size: 10 }, 'mini')).toEqual({ kind: 'upload' });
    expect(classifyRemoteFile({ name: 'photo.heic', type: 'image/heic', size: MiB }, 'mini')).toEqual({ kind: 'upload' }); // never bytes inline
    expect(classifyRemoteFile({ name: 'huge.png', type: 'image/png', size: 25 * MiB }, 'mini')).toEqual({ kind: 'upload' }); // past the decode cap
    expect(classifyRemoteFile({ name: 'big.zip', type: 'application/zip', size: 33 * MiB }, 'mini')).toEqual({ kind: 'refused', reason: 'big.zip is over 32 MB, the most a file to mini can be' });
    expect(classifyRemoteFile({ name: 'big.pdf', type: 'application/pdf', size: 33 * MiB }, 'mini')).toEqual({ kind: 'refused', reason: 'big.pdf is over 32 MB, the most a file to mini can be' });
  });

  it('names an upload by what its bytes are', () => {
    expect(uploadName('anim.gif', 'image/png')).toBe('anim.png'); // re-encoded by the downscale
    expect(uploadName('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
    expect(uploadName('notes', 'text/plain')).toBe('notes');
    expect(uploadName('doc.pdf', 'application/pdf')).toBe('doc.pdf');
  });
});

describe('which attachments of a send go inline', () => {
  it('sends images inline while the message fits the channel, in order; the rest, PDFs and files go up first', () => {
    const small = image('a', MiB);
    const large = image('b', 3 * MiB); // fits alone, not beside the first
    const smaller = image('c', 100_000); // fits after the first
    expect(planRemoteSend('hi', [small, large, smaller, pdf('d', 10), file('e', 'x.txt', 10)])).toEqual({ inline: [small, smaller], upload: [large, pdf('d', 10), file('e', 'x.txt', 10)] });
    expect(planRemoteSend('x'.repeat(REMOTE_INLINE_MAX_BYTES), [small])).toEqual({ inline: [], upload: [small] });
  });
});

describe('uploading a send’s files', () => {
  const ok = (paths: string[]) => ({ status: 'ok', paths });

  it('calls files.upload once for what fits one call, answers the paths in order, and keeps each attachment’s path for a send again', async () => {
    const fake = fakeClient();
    const files = [file('f1', 'a.txt', 10), pdf('f2', 20)];
    const done = uploadAttachments(fake.client, R, files);
    await Promise.resolve();
    expect(fake.invoked('files.upload')).toEqual([{ appSessionId: R, files: [{ name: 'a.txt', bytes: files[0]!.data }, { name: 'f2.pdf', bytes: files[1]!.data }] }]);
    await fake.reply('files.upload', ok(['/w/.claude/desk-uploads/r/u.0.txt', '/w/.claude/desk-uploads/r/u.1.pdf']));
    await expect(done).resolves.toEqual({ ok: true, paths: ['/w/.claude/desk-uploads/r/u.0.txt', '/w/.claude/desk-uploads/r/u.1.pdf'] });
    // a send again after a send that failed past the upload: nothing goes up twice
    await expect(uploadAttachments(fake.client, R, files)).resolves.toEqual({ ok: true, paths: ['/w/.claude/desk-uploads/r/u.0.txt', '/w/.claude/desk-uploads/r/u.1.pdf'] });
    expect(fake.invoked('files.upload')).toHaveLength(1);
  });

  it('splits the files into calls within the command’s bounds: 32 MB and 8 files a call', async () => {
    const fake = fakeClient({ 'files.upload': (input: { files: unknown[] }) => ok(input.files.map((_, i) => `/p/${i}`)) });
    const big = [file('b1', 'one.bin', 20 * MiB), file('b2', 'two.bin', 20 * MiB)];
    await expect(uploadAttachments(fake.client, R, big)).resolves.toMatchObject({ ok: true });
    expect(fake.invoked('files.upload').map((input) => (input as { files: { name: string }[] }).files.map((f) => f.name))).toEqual([['one.bin'], ['two.bin']]);
    const many = Array.from({ length: 9 }, (_, i) => file(`m${i}`, `${i}.txt`, 1));
    await uploadAttachments(fake.client, R, many);
    expect(fake.invoked('files.upload').slice(2).map((input) => (input as { files: unknown[] }).files.length)).toEqual([8, 1]);
  });

  it('shows each attachment’s parts as main sends them, and forgets them once the upload ends', async () => {
    const fake = fakeClient();
    const files = [file('f1', 'a.txt', 10), file('f2', 'b.txt', 5 * MiB)];
    const done = uploadAttachments(fake.client, R, files);
    await Promise.resolve();
    fake.event('remote.upload', { appSessionId: R, file: 1, name: 'b.txt', sent: 1, parts: 3 }, OTHER_MACHINE);
    fake.event('remote.upload', { appSessionId: addressOf(OTHER_MACHINE, 'other' as AppSessionId), file: 0, name: 'x', sent: 1, parts: 9 }, OTHER_MACHINE); // another session's
    expect(useRemoteUploads.getState().progress.get('f2')).toEqual({ sent: 1, parts: 3 });
    expect(useRemoteUploads.getState().progress.has('f1')).toBe(true); // waiting its turn
    await fake.reply('files.upload', ok(['/p/a', '/p/b']));
    await done;
    expect(useRemoteUploads.getState().progress.size).toBe(0);
  });

  it('answers a refusal or an error in words, keeping nothing of the call', async () => {
    const fake = fakeClient();
    const files = [file('f1', 'a.txt', 10)];
    const refused = uploadAttachments(fake.client, R, files);
    await Promise.resolve();
    await fake.reply('files.upload', { status: 'refused', reason: 'the session has no working directory' });
    await expect(refused).resolves.toEqual({ ok: false, error: 'a.txt didn’t go up: the session has no working directory' });
    const failed = uploadAttachments(fake.client, R, files);
    await Promise.resolve();
    await fake.fail('files.upload', 'Not sent: mini is offline', 'host_unavailable');
    await expect(failed).resolves.toEqual({ ok: false, error: 'Not sent: mini is offline' });
    expect(fake.invoked('files.upload')).toHaveLength(2); // nothing was kept, so the second went up again
  });
});

describe('the message a send with uploads makes', () => {
  const s: Serialized = { mode: 'send', text: 'look', content: [], display: 'look [Image #1] [PDF #2]', pastedContents: {}, omitted: 0, empty: false };

  it('carries the inline images, then the text with each uploaded path as a mention relative to the working directory', () => {
    const shot = image('a', 10);
    const message = remoteMessage(s, [shot], ['/w/.claude/desk-uploads/r/u.0.pdf', '/elsewhere/x y.txt'], '/w');
    expect(message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot.data } },
      { type: 'text', text: 'look\n\n@.claude/desk-uploads/r/u.0.pdf @"/elsewhere/x y.txt"' },
    ]);
    expect(message.text).toBe('look\n\n@.claude/desk-uploads/r/u.0.pdf @"/elsewhere/x y.txt"');
    expect(message.empty).toBe(false);
  });

  it('is the mentions alone when there is no text, and a string when nothing is inline', () => {
    const message = remoteMessage({ ...s, text: '', display: '' }, [], ['/w/.claude/desk-uploads/r/u.0.txt'], '/w');
    expect(message.content).toBe('@.claude/desk-uploads/r/u.0.txt');
    expect(message.display).toBe('@.claude/desk-uploads/r/u.0.txt');
  });
});
