// A message's files to a lane B session on another machine (P5 O7 M4, "What a drop sends", "Uploads in parts"): what a
// drop becomes, which attachments of a send go inline and which go up first, the uploads themselves (batched to the
// command's bounds, progress per attachment, each attachment's path kept for a send again), and the message they make.
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { SEND_UPLOADS_MAX, SendUploadsSchema, UPLOAD_FILES_MAX, UPLOAD_KEPT_MS } from '@shared/ipc/schema/files';
import { REMOTE_INLINE_MAX_BYTES } from '@shared/ipc/schema/remote';
import { addressOf } from '@shared/machine/address';
import { fakeClient } from '../../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../../test/support/machine';
import type { Attachment } from './doc';
import type { Serialized } from './serialize';
import { classifyRemoteFile, composeRemoteSend, forgetUploads, planRemoteSend, remoteMessage, resetRemoteUploads, STALE_UPLOADS, uploadAttachments, uploadName, useRemoteUploads } from './remote-uploads';

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

// M4c fix wave 1 (review finding 4): the inline fit is judged on the message as sent, its path mentions with it
describe('a send with uploads at the channel’s bound', () => {
  it('moves the last inline image to the uploads while the message with its mentions would not fit', async () => {
    const s = { mode: 'send', text: 'look', content: 'look', display: 'look', pastedContents: {}, omitted: 0, empty: false } as Serialized;
    // an image that fits beside the text alone, with a byte or so to spare: the PDF's mention will not fit beside it
    const encodedSpare = REMOTE_INLINE_MAX_BYTES - JSON.stringify([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }, { type: 'text', text: 'look' }]).length;
    const big = { ...image('i1', 0), data: 'A'.repeat(encodedSpare - 8), bytes: Math.floor(((encodedSpare - 8) * 3) / 4) };
    const doc = pdf('p1', 1000);
    expect(planRemoteSend('look', [big, doc]).inline).toEqual([big]); // the plan alone keeps it inline
    const fake = fakeClient();
    const sending = composeRemoteSend(fake.client, R, s, [big, doc], '/work/app-r');
    await fake.reply('files.upload', { status: 'ok', paths: ['/work/app-r/.claude/desk-uploads/app-r/u.0.pdf'] });
    await fake.reply('files.upload', { status: 'ok', paths: ['/work/app-r/.claude/desk-uploads/app-r/u.1.png'] });
    const sent = await sending;
    expect(fake.invoked('files.upload').map((c) => (c as { files: { name: string }[] }).files.map((f) => f.name))).toEqual([['p1.pdf'], ['i1.png']]); // the PDF once, then the image
    expect(sent).toEqual({ ok: true, message: expect.objectContaining({ content: 'look\n\n@.claude/desk-uploads/app-r/u.0.pdf @.claude/desk-uploads/app-r/u.1.png' }), uploads: [{ uploadId: 'u.0.pdf', as: 'document' }], stale: [] }); // P5 O7 M8: the PDF also as a document
  });
});

// P5 O7 M8 ("The attachment"; Interfaces §U, "The send's uploads"): an uploaded PDF reaches the model as a document block.
// The send names it by its upload id (the last component of the path files.upload answered, UPLOAD_ID_PATTERN) beside
// the mention, which stays in the text for a reader; the machine's endpoint reads it from the session's upload root.
describe('a send’s uploaded PDFs, as document blocks', () => {
  const s = { mode: 'send', text: 'read these', content: 'read these', display: 'read these', pastedContents: {}, omitted: 0, empty: false } as Serialized;
  const ROOT = '/work/app-r/.claude/desk-uploads/app-r';

  it('names each uploaded PDF by its upload id, as a document, and keeps every mention; another file is its mention alone', async () => {
    const fake = fakeClient();
    const sending = composeRemoteSend(fake.client, R, s, [pdf('p1', 10), file('f1', 'notes.txt', 3), pdf('p2', 20)], '/work/app-r');
    await fake.reply('files.upload', { status: 'ok', paths: [`${ROOT}/u.0.pdf`, `${ROOT}/u.1.txt`, `${ROOT}/u.2.pdf`] });
    await expect(sending).resolves.toEqual({
      ok: true,
      message: expect.objectContaining({ content: 'read these\n\n@.claude/desk-uploads/app-r/u.0.pdf @.claude/desk-uploads/app-r/u.1.txt @.claude/desk-uploads/app-r/u.2.pdf' }),
      uploads: [
        { uploadId: 'u.0.pdf', as: 'document' },
        { uploadId: 'u.2.pdf', as: 'document' },
      ],
      stale: [],
    });
  });

  // M8's reviewer-high review: the upload calls split a set past UPLOAD_FILES_MAX across calls, so the message's own
  // bound on the PDFs it names is SEND_UPLOADS_MAX, which the send's schema holds too
  it('names more PDFs than one upload call carries, each call within its bound, in a send its schema takes', async () => {
    const fake = fakeClient();
    const nine = Array.from({ length: UPLOAD_FILES_MAX + 1 }, (_, i) => pdf(`p${i}`, 10));
    const sending = composeRemoteSend(fake.client, R, s, nine, '/work/app-r');
    await fake.reply('files.upload', { status: 'ok', paths: nine.slice(0, UPLOAD_FILES_MAX).map((_, i) => `${ROOT}/a.${i}.pdf`) });
    await fake.reply('files.upload', { status: 'ok', paths: [`${ROOT}/b.0.pdf`] });
    const sent = await sending;
    expect(sent).toMatchObject({ ok: true });
    const uploads = (sent as { uploads: unknown[] }).uploads;
    expect(uploads).toHaveLength(UPLOAD_FILES_MAX + 1);
    expect(SendUploadsSchema.safeParse(uploads).success).toBe(true);
  });

  it('refuses a send naming more PDFs than a message takes before anything goes up', async () => {
    const fake = fakeClient();
    const many = Array.from({ length: SEND_UPLOADS_MAX + 1 }, (_, i) => pdf(`p${i}`, 10));
    await expect(composeRemoteSend(fake.client, R, s, many, '/work/app-r')).resolves.toEqual({ ok: false, error: `A message to a session on another machine can attach at most ${SEND_UPLOADS_MAX} PDFs; remove some and send again` });
    expect(fake.calls).toEqual([]);
  });

  it('names no upload whose path is no upload id (its mention alone)', async () => {
    const fake = fakeClient();
    const sending = composeRemoteSend(fake.client, R, s, [pdf('p1', 10)], '/work/app-r');
    await fake.reply('files.upload', { status: 'ok', paths: ['/work/app-r/elsewhere/../p1.pdf'] });
    await expect(sending).resolves.toMatchObject({ ok: true, uploads: [] });
  });

  it('says which uploads went up more than a day ago (the machine reads none older), and forgets uploads so they go up again', async () => {
    let now = 1_000_000;
    const fake = fakeClient({ 'files.upload': (input: { files: unknown[] }) => ({ status: 'ok', paths: input.files.map((_, i) => `${ROOT}/u${now}.${i}.pdf`) }) });
    const doc = pdf('p1', 10);
    await expect(composeRemoteSend(fake.client, R, s, [doc], '/work/app-r', () => now)).resolves.toMatchObject({ ok: true, stale: [] });
    now += UPLOAD_KEPT_MS;
    await expect(composeRemoteSend(fake.client, R, s, [doc], '/work/app-r', () => now)).resolves.toMatchObject({ ok: true, stale: [] }); // a day to the millisecond: still within it
    now += 1;
    await expect(composeRemoteSend(fake.client, R, s, [doc], '/work/app-r', () => now)).resolves.toMatchObject({ ok: true, stale: ['p1.pdf'], uploads: [{ uploadId: 'u1000000.0.pdf', as: 'document' }] });
    expect(fake.invoked('files.upload')).toHaveLength(1); // a warning, not a block: the kept upload is sent
    forgetUploads(R, [doc]);
    await expect(composeRemoteSend(fake.client, R, s, [doc], '/work/app-r', () => now)).resolves.toMatchObject({ ok: true, stale: [], uploads: [{ uploadId: `u${now}.0.pdf`, as: 'document' }] });
    expect(fake.invoked('files.upload')).toHaveLength(2);
  });

  it('words the advisory for one upload and for several', () => {
    expect(STALE_UPLOADS(['a.pdf'])).toBe('a.pdf went up more than a day ago, so the machine may no longer have it. If the message isn’t sent, attach it again.');
    expect(STALE_UPLOADS(['a.pdf', 'b.pdf'])).toBe('a.pdf and b.pdf went up more than a day ago, so the machine may no longer have them. If the message isn’t sent, attach them again.');
  });
});
