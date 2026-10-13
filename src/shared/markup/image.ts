// P3-G (§D4.1): the still a mark-up session draws over, as main answers `browser.view.capture` and `layout.captureRegion`:
// the capture under the comment crop's caps (the longer edge at most CROP_MAX_EDGE, PNG then JPEG, at most CROP_MAX_BYTES),
// its bytes as base64 and its pixel size. A capture main could not take answers `null` rather than an image.
import * as z from 'zod';
import { CROP_MAX_BYTES, CROP_MAX_EDGE } from '../browser/comment';

// What base64 makes of CROP_MAX_BYTES (four characters per three bytes, padded).
export const CAPTURED_DATA_MAX = Math.ceil(CROP_MAX_BYTES / 3) * 4;

export const CapturedImageSchema = z.strictObject({
  mediaType: z.enum(['image/png', 'image/jpeg']),
  data: z.string().min(1).max(CAPTURED_DATA_MAX),
  width: z.number().int().min(1).max(CROP_MAX_EDGE),
  height: z.number().int().min(1).max(CROP_MAX_EDGE),
});
export type CapturedImage = z.infer<typeof CapturedImageSchema>;

export const CaptureAnswerSchema = z.strictObject({ image: CapturedImageSchema.nullable() });

// `layout.captureRegion`'s rect: CSS px of the window's content area, as a renderer measures an element.
export const CaptureRectSchema = z.strictObject({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() });
export type CaptureRect = z.infer<typeof CaptureRectSchema>;
