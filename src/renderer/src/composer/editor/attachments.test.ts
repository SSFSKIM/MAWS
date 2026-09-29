import { describe, expect, it } from 'vitest';
import type { Attachment } from './doc';
import { base64Bytes, encodingFor, imageRefusal, markPersisted, scaledSize, sendSizeRefusal } from './attachments';

const MiB = 1024 * 1024;
const image = (id: string, bytes: number): Attachment => ({ id, kind: 'image', name: `${id}.png`, mediaType: 'image/png', bytes, data: 'x', persisted: true });

describe('attachments downscale, cap and persist within their budgets', () => {
  it('scales the longest edge to 1568 px and leaves smaller images alone', () => {
    expect(scaledSize(3136, 1000)).toEqual({ width: 1568, height: 500 });
    expect(scaledSize(1000, 3136)).toEqual({ width: 500, height: 1568 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('re-encodes screenshots as PNG and everything else as JPEG at 0.85', () => {
    expect(encodingFor('image/png')).toEqual({ type: 'image/png' });
    expect(encodingFor('image/gif')).toEqual({ type: 'image/png' });
    expect(encodingFor('image/jpeg')).toEqual({ type: 'image/jpeg', quality: 0.85 });
    expect(encodingFor('image/webp')).toEqual({ type: 'image/jpeg', quality: 0.85 });
  });

  it('refuses an image still over 5 MiB after the downscale', () => {
    expect(imageRefusal('shot.png', 5 * MiB)).toBeNull();
    expect(imageRefusal('shot.png', 5 * MiB + 1)).toMatch(/shot\.png is over 5 MB/);
  });

  it('keeps attachment bytes in the draft up to 4 MiB in total, in order', () => {
    const marked = markPersisted([image('a', 3 * MiB), image('b', 2 * MiB), image('c', MiB)]);
    expect(marked.map((a) => [a.id, a.persisted])).toEqual([['a', true], ['b', false], ['c', true]]);
  });

  it('reads the decoded size of base64', () => {
    expect(base64Bytes('')).toBe(0);
    expect(base64Bytes('YQ==')).toBe(1);
    expect(base64Bytes('YWI=')).toBe(2);
    expect(base64Bytes('YWJj')).toBe(3);
  });

  it("pre-checks the send against C3's four bounds and names the one it hit", () => {
    const block = (type: 'image' | 'document', bytes: number) => ({ type, source: { type: 'base64', media_type: type === 'image' ? 'image/png' : 'application/pdf', data: 'A'.repeat(Math.ceil(bytes / 3) * 4) } });
    expect(sendSizeRefusal('short')).toBeNull();
    expect(sendSizeRefusal('x'.repeat(MiB + 10))).toMatch(/^Message too large \(1025 KB\); attach the text as a file instead$/);
    expect(sendSizeRefusal([block('image', 3 * MiB), block('image', 3 * MiB), { type: 'text', text: 'two screenshots' }])).toBeNull();
    expect(sendSizeRefusal([block('image', 6 * MiB)])).toBe('Image too large (6 MB); each image can be at most 5 MB');
    expect(sendSizeRefusal([block('document', 33 * MiB)])).toBe('PDF too large (33 MB); each PDF can be at most 32 MB');
    expect(sendSizeRefusal([block('document', 30 * MiB), block('document', 30 * MiB)])).toBe('Message too large (81 MB); a message can be at most 48 MB in all');
  });
});
