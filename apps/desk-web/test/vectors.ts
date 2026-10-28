// DX1's vectors (apps/desk-hub/src/protocol/vectors/codes.json) as the web app's suites use them: the org key every case
// is sealed under, the project they name, and the log-event cases, positive and negative.
import codes from '../../desk-hub/src/protocol/vectors/codes.json' with { type: 'json' };
import orgProtocol from '../../org-protocol/vectors/vectors.json' with { type: 'json' };
import { base64urlDecode, type LogEvent } from 'desk-hub/protocol';

type Vector = { name: string; domain: string; org_key: string; project: string; input: Record<string, unknown> };

export const VECTOR_KEY_TEXT: string = codes.vectors[0].org_key;
/** The 32 bytes 0x00 to 0x1f. */
export const VECTOR_KEY: Uint8Array = base64urlDecode(VECTOR_KEY_TEXT);
export const VECTOR_PROJECT: string = codes.vectors[0].project;

const LOG_DOMAIN = 'smns-hub-log-v1';
export const LOG_VECTORS = (codes.vectors as Vector[]).filter((v) => v.domain === LOG_DOMAIN).map((v) => ({ name: v.name, project: v.project, event: v.input as LogEvent }));
export const LOG_NEGATIVES = (codes.negatives as Vector[]).filter((v) => v.domain === LOG_DOMAIN).map((v) => ({ name: v.name, project: v.project, event: v.input as LogEvent }));

/**
 * The protocol package's dual-coded events (apps/org-protocol/vectors, O11 M1): RL8's `sig` made first, then DX1's
 * `mac` over the event with the sig in it, each under the org key and project it names. The hub stores and serves them
 * as they are (O11 M5), so the web app's reader meets them.
 */
export const DUAL_VECTORS = orgProtocol.dual.map((d) => ({ name: d.name, project: d.project, orgKey: base64urlDecode(d.orgKey), event: d.event as unknown as LogEvent }));

/**
 * The protocol package's pairing vector (O13 §A, its M2): a code and its decoded form, a `web-cards` entry with its MAC
 * under the code's `k` and its fingerprint, and the same entry with its passkey swapped and its channel key kept, whose
 * fingerprint differs. The phone makes each of these (src/cards/register.ts) and the owner's Mac checks them, so the
 * web app replays them in its own runtime.
 */
export const PAIRING_VECTOR = orgProtocol.pairing;
