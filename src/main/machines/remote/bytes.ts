// The device's half of RL2's bytes (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "What crosses,
// as what"; §M's `rl2.bytes`). RL2 writes a message with plain JSON.stringify, which turns a Uint8Array into an object the
// schema refuses, so a call's `input` and an act's `args` cross in json-bytes' tagged form (`{"$bytes": "<base64>"}`, a
// look-alike escaped as `{"$plain": …}`), and a call's `output` and an act's `result` arrive in it, to and from a peer
// that listed `rl2.bytes` (the endpoint tags nothing for a device that didn't, and decodes nothing from one). The tagged
// form is a JSON value, so an act is sealed, signed and fingerprinted over it, the same bytes on both sides.
//
// A value that needs the codec (bytes, or a look-alike the endpoint would read as bytes) goes only to a peer that listed
// `rl2.bytes`; to any other it is refused locally `not-offered` (json-bytes' `needsCodec` tells which). So is a call
// whose answer carries bytes (`ANSWERS_BYTES`): a peer that doesn't tag would answer it as an object no schema reads.

export const BYTES_CAPABILITY = 'rl2.bytes';

/** The calls whose answer is bytes (`{bytes: Uint8Array}`): offered as calls, read only from a peer that tags them. */
export const ANSWERS_BYTES: ReadonlySet<string> = new Set(['artifacts.versionState', 'artifacts.attributions']);
