// sminos's declared channels: the one test of a channel's id (docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md,
// Interfaces §A; the design's D3: "a minted UUID, lowercase, with RFC 9562's variant bits and version nibble 8").
// It is the only test of a channel's id in the repository; vectors/channel-rule.json holds the cases it shares with
// sminos's suite.

/** A sminos declared channel's id: a lowercase UUID whose version digit is 8 and whose variant digit is 8, 9, a or b. */
export const CHANNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether `value` is a sminos declared channel's id, tested as given: never trimmed, never folded to lower case. */
export function isChannelId(value: unknown): value is string {
  return typeof value === 'string' && CHANNEL_ID.test(value);
}
