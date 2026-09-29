// C7: the send cap as the architect ruled it (C7 execution document, Decision Log "architect's ruling, 2026-09-29, on
// the send cap"): text 1 MiB, each image 5 MiB decoded, each document 32 MiB decoded, the whole content 48 MiB of JSON.
import { describe, expect, it } from 'vitest';
import { MAX_SEND_CONTENT_JSON_BYTES, MAX_SEND_DOCUMENT_BYTES, MAX_SEND_IMAGE_BYTES, MAX_SEND_TEXT_BYTES, SendContentSchema, sendContentRefusal } from './session-state-store';

const MiB = 1024 * 1024;
// unpadded base64 of at least `bytes` decoded bytes (exactly `bytes` when it is a multiple of three)
const base64Of = (bytes: number) => 'A'.repeat(Math.ceil(bytes / 3) * 4);
const image = (bytes: number) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Of(bytes) } });
const pdf = (bytes: number) => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Of(bytes) } });

describe('send content is bounded per text, image, document and whole message', () => {
  it('pins the four bounds', () => {
    expect([MAX_SEND_TEXT_BYTES, MAX_SEND_IMAGE_BYTES, MAX_SEND_DOCUMENT_BYTES, MAX_SEND_CONTENT_JSON_BYTES]).toEqual([1 * MiB, 5 * MiB, 32 * MiB, 48 * MiB]);
  });

  it('refuses text over 1 MiB, as a string or across text blocks, and names the text bound', () => {
    expect(SendContentSchema.safeParse('x'.repeat(MiB)).success).toBe(true);
    const over = SendContentSchema.safeParse('x'.repeat(MiB + 1));
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toMatch(/1 MiB/);
    expect(sendContentRefusal([{ type: 'text', text: 'x'.repeat(MiB / 2) }, { type: 'text', text: 'x'.repeat(MiB / 2 + 1) }])).toMatchObject({ bound: 'text' });
  });

  it('bounds each image at 5 MiB decoded, not by its base64 length', () => {
    expect(sendContentRefusal([image(5 * MiB - 2), { type: 'text', text: 'look' }])).toBeNull(); // ~6.7 MiB of base64
    expect(sendContentRefusal([image(5 * MiB + 3)])).toMatchObject({ bound: 'image' });
    expect(SendContentSchema.safeParse([image(5 * MiB + 3)]).error?.issues[0]?.message).toMatch(/5 MiB/);
  });

  it('bounds each document at 32 MiB decoded', () => {
    expect(sendContentRefusal([pdf(32 * MiB - 2)])).toBeNull();
    expect(sendContentRefusal([pdf(32 * MiB + 3)])).toMatchObject({ bound: 'document' });
  });

  it('bounds the whole content at 48 MiB of JSON', () => {
    const refused = sendContentRefusal([pdf(30 * MiB), pdf(30 * MiB)]);
    expect(refused).toMatchObject({ bound: 'content' });
    expect(SendContentSchema.safeParse([pdf(30 * MiB), pdf(30 * MiB)]).error?.issues[0]?.message).toMatch(/48 MiB/);
  });

  it('passes a message with two full-size screenshots and their question (the Claude Desktop bar)', () => {
    const content = [image(3 * MiB), image(3 * MiB), { type: 'text', text: 'what changed between these two?' }];
    expect(sendContentRefusal(content)).toBeNull();
    expect(SendContentSchema.safeParse(content).success).toBe(true);
  });
});
