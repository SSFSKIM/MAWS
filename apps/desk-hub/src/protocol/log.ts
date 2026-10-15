// DX1 — log events (docs/doperpowers/specs/2026-10-15-desk-design.md): smns §3's events, carried by the hub exactly as
// received. The hub reads `writer`, `seq`, `kind`, `to`, and `member`; every other field passes through, which is why an
// event is typed as an open object.
import type { JsonObject } from './json';

/** The authentication code: a 128-bit random nonce and HMAC-SHA256 with the org key, both base64url. */
export type Mac = { nonce: string; value: string };

export type Recipient = { session: string; alias: string };

export type LogEvent = JsonObject & {
  ts: string;
  writer: string;
  seq: number;
  kind: string;
  mac: Mac;
};

/**
 * A web `human` before the hub sequences it: the browser seals this (DX1 leaves `writer`, `seq`, and `ts` out of a
 * `hub/` event's code), and the hub stores it with those three added and nothing else changed.
 */
export type HumanDraft = {
  kind: 'human';
  from: 'human';
  member: string;
  to: '*' | Recipient[];
  text: string;
  created: string;
  wake?: boolean;
};

export type HumanEvent = HumanDraft & { mac: Mac };

/** `{writer: max seq}` for one project: the version vector of the log handshake (DX2). */
export type Vector = Record<string, number>;

export const HUB_WRITER_PREFIX = 'hub/';
export const LEGACY_WRITER_PREFIX = 'legacy/';

export const hubWriter = (member: string) => `${HUB_WRITER_PREFIX}${member}`;
export const isHubWriter = (writer: string) => writer.startsWith(HUB_WRITER_PREFIX);

/** The machine a writer belongs to (`<machine>/<session uuid>` or `<machine>/human`), or null for `hub/` and `legacy/`. */
export function writerMachine(writer: string): string | null {
  if (isHubWriter(writer) || writer.startsWith(LEGACY_WRITER_PREFIX)) return null;
  const slash = writer.indexOf('/');
  return slash > 0 ? writer.slice(0, slash) : null;
}
