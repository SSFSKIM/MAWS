import { describe, expect, it } from 'vitest';
import { validateCommandInput, validateCommandOutput } from '../ipc/validate';
import { CAPTURED_DATA_MAX } from './image';

describe('the mark-up capture commands (P3-G §D4.1)', () => {
  const still = { mediaType: 'image/png', data: 'iVBORw0KGgo=', width: 1568, height: 980 };

  it('browser.view.capture takes a tab id and answers a still or null', () => {
    expect(validateCommandInput('browser.view.capture', { tabId: 'b_0123456789ab' }).ok).toBe(true);
    expect(validateCommandInput('browser.view.capture', { tabId: 'not-a-tab' }).ok).toBe(false);
    expect(validateCommandInput('browser.view.capture', { tabId: 'b_0123456789ab', rect: null }).ok).toBe(false);
    expect(validateCommandOutput('browser.view.capture', { image: still }).ok).toBe(true);
    expect(validateCommandOutput('browser.view.capture', { image: null }).ok).toBe(true);
  });

  it('layout.captureRegion takes a positive rect and answers a still or null', () => {
    expect(validateCommandInput('layout.captureRegion', { rect: { x: -4.5, y: 0, width: 300.5, height: 200 } }).ok).toBe(true);
    expect(validateCommandInput('layout.captureRegion', { rect: { x: 0, y: 0, width: 0, height: 200 } }).ok).toBe(false);
    expect(validateCommandInput('layout.captureRegion', { rect: { x: 0, y: 0, width: 10, height: Number.POSITIVE_INFINITY } }).ok).toBe(false);
    expect(validateCommandOutput('layout.captureRegion', { image: null }).ok).toBe(true);
  });

  it('holds a still to the crop caps: PNG or JPEG, at most 1568 px a side, at most 3.5 MiB of bytes', () => {
    expect(validateCommandOutput('layout.captureRegion', { image: { ...still, mediaType: 'image/gif' } }).ok).toBe(false);
    expect(validateCommandOutput('layout.captureRegion', { image: { ...still, width: 1569 } }).ok).toBe(false);
    expect(validateCommandOutput('layout.captureRegion', { image: { ...still, data: 'A'.repeat(CAPTURED_DATA_MAX + 1) } }).ok).toBe(false);
    expect(CAPTURED_DATA_MAX).toBe(4_893_356); // 3.5 MiB (3,670,016 bytes) in base64
  });
});
