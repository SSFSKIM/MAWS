// DX1's vectors (apps/desk-hub/src/protocol/vectors/codes.json) as the web app's suites use them: the org key every case
// is sealed under, the project they name, and the log-event cases, positive and negative.
import codes from '../../desk-hub/src/protocol/vectors/codes.json' with { type: 'json' };
import { base64urlDecode, type LogEvent } from 'desk-hub/protocol';

type Vector = { name: string; domain: string; org_key: string; project: string; input: Record<string, unknown> };

export const VECTOR_KEY_TEXT: string = codes.vectors[0].org_key;
/** The 32 bytes 0x00 to 0x1f. */
export const VECTOR_KEY: Uint8Array = base64urlDecode(VECTOR_KEY_TEXT);
export const VECTOR_PROJECT: string = codes.vectors[0].project;

const LOG_DOMAIN = 'smns-hub-log-v1';
export const LOG_VECTORS = (codes.vectors as Vector[]).filter((v) => v.domain === LOG_DOMAIN).map((v) => ({ name: v.name, project: v.project, event: v.input as LogEvent }));
export const LOG_NEGATIVES = (codes.negatives as Vector[]).filter((v) => v.domain === LOG_DOMAIN).map((v) => ({ name: v.name, project: v.project, event: v.input as LogEvent }));
