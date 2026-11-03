// What a viewer reads of an agent's tabs on a machine (P5 O17; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// Interfaces §G): the inventory of a session's tabs as its tab engine holds them, stamped with `mawsd`'s epoch for the
// session's route (§B). M4: the inventory. M6: the frames, the input, the subscription, the feed and the limits, with
// the validators the feed seam applies (`mawsd`'s DaemonServices.browser is the boundary: a viewer is a test's stand-in
// in the local stage, the endpoint serving a remote app in the remote stage).
//
// Every page string here (a title, a URL) is the page's own data, shown as text, never as markup. An engine bounds what it
// sends (BROWSER_SUMMARY_BOUNDS): a longer title or URL is cut at the bound, so one page cannot make the inventory's line
// unbounded; the summary is for showing, never for navigating.
import * as z from 'zod';
import type { AppSessionId } from '../graph/ids';
import { BrowserControlSchema, BrowserTabIdSchema } from './tab';

export type BrowserEpoch = string; // `mawsd`'s, opaque: minted each time a session's tab engine changes (§B)

export const BROWSER_SUMMARY_BOUNDS = { title: 4_096, url: 8_192, tabs: 256 } as const; // characters; tabs per inventory

export const BrowserTabSummarySchema = z.strictObject({
  tabId: BrowserTabIdSchema,
  title: z.string().max(BROWSER_SUMMARY_BOUNDS.title),
  url: z.string().max(BROWSER_SUMMARY_BOUNDS.url),
  control: BrowserControlSchema,
});
export type BrowserTabSummary = z.infer<typeof BrowserTabSummarySchema>;

export interface BrowserInventory {
  epoch: BrowserEpoch;
  tabs: BrowserTabSummary[];
  selected: string | null;
  state: 'ready' | 'unavailable';
  reason?: string;
}

// ---- M6: frames, input, subscriptions and the feed (§G) ---------------------------------------------------------------

export const BROWSER_LIMITS = { inventoryTabs: 256, viewers: { session: 4, total: 32 }, frameBytes: 1_048_576,
  frameWidth: 1280, frameHeight: 800, fps: 10, inputQueue: 32, textBytes: 16_384 } as const;

export interface BrowserFrame {
  epoch: BrowserEpoch; tabId: string; seq: number;
  capturedAt: number;                              // the source's monotonic ms, comparable to nothing on another machine
  width: number; height: number;                   // JPEG pixels
  viewport: { width: number; height: number };     // the tab's input coordinates (DIP)
  jpeg: Uint8Array;
}

export type BrowserInput =
  | { kind: 'pointer'; type: 'move' | 'down' | 'up'; x: number; y: number; button: 'left' | 'middle' | 'right'; buttons: number; clickCount: number; modifiers: string[] }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers: string[] }
  | { kind: 'key'; type: 'down' | 'up'; key: string; code: string; repeat: boolean; modifiers: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'blur' };

export interface BrowserSubscription { ack(seq: number): void; input(seq: number, event: BrowserInput): Promise<void>; close(): void }

export interface BrowserFeed {
  inventory(appSessionId: AppSessionId): BrowserInventory;                              // from the route's cache; starts and loads nothing
  watchInventory(appSessionId: AppSessionId, changed: (inventory: BrowserInventory) => void): () => void; // the current snapshot at once
  open(input: { appSessionId: AppSessionId; epoch: BrowserEpoch; tabId: string; control: boolean },
       sink: { frame(frame: BrowserFrame): void; closed(reason: string): void }): Promise<BrowserSubscription>;
}

// Why a subscription could not open, or ended: §F's engine reasons, `mawsd`'s route reasons (§B), and the feed's own.
// A string on the wire, so a new reason stays additive; these are the ones this build gives.
export type BrowserEndReason =
  | 'tab_closed' | 'view_gone' | 'frame_too_large' | 'producer_failed' // the engine's (browserEngine.ended)
  | 'engine_changed' | 'control_busy' // the route's epoch moved, or another viewer controls the tab
  | 'input_overflow'; // the controlling viewer's input queue overflowed: control closes, held keys and buttons released
export type BrowserRefusalReason = BrowserEndReason | 'unavailable' | 'viewers' | 'invalid' | 'read_only' | 'closed';

// The feed's refusal (an open, an ack or an input it does not take, or the subscription's end reaching what was pending),
// its reason readable by the caller (the endpoint maps it to RL2's `streamRefused` and `streamClose` reasons): one of
// BrowserRefusalReason, or an engine's newer reason passed on as it came
export class BrowserRefused extends Error {
  constructor(
    readonly reason: string,
    message: string = reason,
  ) {
    super(message);
    this.name = 'BrowserRefused';
  }
}

// ---- the validators (§G: "validation at this boundary") ---------------------------------------------------------------

export const BROWSER_MODIFIERS = ['Alt', 'Control', 'Meta', 'Shift'] as const;
const MAX_VIEWPORT = 16_384; // DIP: a tab's input coordinates are within its viewport, which no display exceeds
const MAX_WHEEL_DELTA = 10_000; // DIP per event

export const BrowserSeqSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER); // a positive safe integer
const Coordinate = z.number().min(0).max(MAX_VIEWPORT); // finite: zod refuses NaN and the infinities
const Modifiers = z.array(z.enum(BROWSER_MODIFIERS)).max(BROWSER_MODIFIERS.length);
const textBytes = (text: string) => new TextEncoder().encode(text).byteLength;

export const BrowserInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pointer'),
    type: z.enum(['move', 'down', 'up']),
    x: Coordinate,
    y: Coordinate,
    button: z.enum(['left', 'middle', 'right']),
    buttons: z.number().int().min(0).max(7), // the three buttons' bits
    clickCount: z.number().int().min(0).max(3),
    modifiers: Modifiers,
  }),
  z.strictObject({
    kind: z.literal('wheel'),
    x: Coordinate,
    y: Coordinate,
    deltaX: z.number().min(-MAX_WHEEL_DELTA).max(MAX_WHEEL_DELTA), // the DOM's sense: positive scrolls right and down
    deltaY: z.number().min(-MAX_WHEEL_DELTA).max(MAX_WHEEL_DELTA),
    modifiers: Modifiers,
  }),
  z.strictObject({ kind: z.literal('key'), type: z.enum(['down', 'up']), key: z.string().min(1).max(64), code: z.string().max(64), repeat: z.boolean(), modifiers: Modifiers }),
  z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(BROWSER_LIMITS.textBytes).refine((text) => textBytes(text) <= BROWSER_LIMITS.textBytes, `at most ${BROWSER_LIMITS.textBytes} bytes`) }),
  z.strictObject({ kind: z.literal('blur') }),
]);
const Viewport = z.strictObject({ width: z.number().int().min(1).max(MAX_VIEWPORT), height: z.number().int().min(1).max(MAX_VIEWPORT) });

// A frame as an engine sends it (§F's `browserEngine.frame`: `mawsd` stamps the epoch; the bytes are base64 on the line)
export const BrowserFrameMetaSchema = z.strictObject({
  tabId: BrowserTabIdSchema,
  seq: BrowserSeqSchema,
  capturedAt: z.number().min(0),
  width: z.number().int().min(1).max(BROWSER_LIMITS.frameWidth),
  height: z.number().int().min(1).max(BROWSER_LIMITS.frameHeight),
  viewport: Viewport,
});
export const JPEG_BASE64_MAX = Math.ceil(BROWSER_LIMITS.frameBytes / 3) * 4; // base64 of a frame at the byte bound

// `event` read against the viewport of the frame the viewer last saw: a pointer or a wheel names a point within it (a
// viewer that has seen no frame has no point to name); keys, text and blur name none. The reading is a BrowserInput, its
// modifiers narrowed to the four names.
export function readBrowserInput(event: unknown, viewport: { width: number; height: number } | null): { input: z.infer<typeof BrowserInputSchema> } | { refusal: string } {
  const read = BrowserInputSchema.safeParse(event);
  if (!read.success) return { refusal: `not a browser input: ${read.error.issues[0]?.message ?? 'malformed'}` };
  const input: BrowserInput = read.data;
  if (input.kind !== 'pointer' && input.kind !== 'wheel') return { input: read.data };
  if (viewport === null) return { refusal: 'no frame has been seen to point into' };
  if (input.x > viewport.width || input.y > viewport.height) return { refusal: `(${input.x}, ${input.y}) is outside the ${viewport.width}×${viewport.height} viewport` };
  return { input: read.data };
}
