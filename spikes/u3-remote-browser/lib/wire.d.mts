// Types for lib/wire.mjs, for the host's typecheck.
export type ChannelMessage = { kind: 'control'; body: Record<string, unknown> } | { kind: 'frame'; meta: Record<string, unknown>; data: Buffer };
export function encodeControl(message: unknown): Buffer;
export function encodeFrame(meta: Record<string, unknown>, data: Buffer): Buffer;
export function channelDecoder(): (chunk: Buffer) => ChannelMessage[];
