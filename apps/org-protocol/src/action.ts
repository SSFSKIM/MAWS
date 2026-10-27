// RL4's canonical action (docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md, Interfaces §C): what a device signs
// and sends as an `act`, sealed in an RL2 channel. Besides RL4's fields it binds the org, the machine (its ref) and the
// device, because a step-up signature outlives its channel as an `ownersProof` that other machines check (RL9).
//
//   signing input   signingInput('smns-action-v1', the action without `stepUp` and `webauthn`)
//   step-up         ECDSA P-256 / SHA-256 over the signing input by the device's `stepUpPub`, P1363 `r‖s`, base64url
//   digest          SHA-256 of the signing input: the WebAuthn challenge a web-cards answer signs
//   fingerprint     SHA-256 of the canonical action without `nonce`, `created`, `stepUp` and `webauthn`: what every
//                   reseal of one operation keeps, so an executing side binds an `opId` to one operation (M7)
//
// Times are ISO-8601 milliseconds, as everywhere in the package. `opCreated` is the operation's first sealing and
// `created` this sealing's: a reseal of a lost acknowledgement keeps `opId` and `opCreated` and takes a fresh `nonce`
// and `created`.
import { base64urlDecode, base64urlEncode, isBase64urlOf } from './base64url.ts';
import { canonicalize } from './canonical.ts';
import { importPublicKey, signingInput, SIGNATURE_BYTES, utf8, type B64, type SigningKey } from './keys.ts';
import { isIsoMillis, isMachineRef } from './names.ts';
import { SIGNING_DOMAINS } from './types.ts';
import { accept, refuse, type Verdict } from './verdict.ts';

/** DX6's request digest (desk-hub/protocol's `Digest`): the pending request an answer is for, as the asker drew it. */
export type RequestDigest = { session: string; request: string; tool: string; input_sha256: string };
/** Where a session's action is bound: the launch and engine session it was sealed for, rechecked at its effect. */
export type ActionContext = { lane: 'B'; launchId: string; engineSessionId: string } | { lane: 'A'; session: string; launch: string };
/** A web-cards device's WebAuthn assertion over the action's digest, each part base64url as the browser returns it. */
export type WebAuthnAssertion = { credentialId: B64; authenticatorData: B64; clientDataJSON: B64; signature: B64 };

export type Action = {
  v: 1;
  org: string;
  /** The machine's ref. */
  machine: string;
  device: string;
  opId: string;
  opCreated: string;
  /** An offered registry command (lane B, the machine), `sminos.<rpc>` (lane A), `endpoint.grant` or `endpoint.state`. */
  action: string;
  session?: string;
  /** Mandatory with `session`. */
  context?: ActionContext;
  args: Record<string, unknown>;
  requestDigest?: RequestDigest;
  /** 16 random bytes. */
  nonce: B64;
  created: string;
  stepUp?: B64;
  webauthn?: WebAuthnAssertion;
};

/** How far `created` may stand from the machine's clock, either way, and how far `opCreated` may follow `created`. */
export const FRESH_MS = 60_000;
/** How long an executing side keeps an operation's ledger entry (sminos's `KEPT_S`). */
export const KEPT_S = 86_400;
/** The oldest `opCreated` an action may carry: older ones may have left every ledger, so they are refused `expired`. */
export const OP_HORIZON_S = KEPT_S - 3600;
/** sminos's `OP_ID_RE`: a file name and an alias seed. */
const OP_ID = /^[A-Za-z0-9_-]{16,128}$/;
export const NONCE_BYTES = 16;

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
/** Exactly the `required` keys and any of `optional`. */
const exactly = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Fields =>
  isObject(value) && required.every((key) => key in value) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const isText = (value: unknown, max = 512): value is string => typeof value === 'string' && value !== '' && value.length <= max;
const isB64 = (value: unknown): value is string => typeof value === 'string' && value !== '' && isBase64urlOf(value, (value.length * 6) >> 3);

function isContext(value: unknown): value is ActionContext {
  if (!isObject(value)) return false;
  if (value.lane === 'B') return exactly(value, ['lane', 'launchId', 'engineSessionId']) && isText(value.launchId) && isText(value.engineSessionId);
  if (value.lane === 'A') return exactly(value, ['lane', 'session', 'launch']) && isText(value.session) && isText(value.launch);
  return false;
}

export function isRequestDigest(value: unknown): value is RequestDigest {
  return (
    exactly(value, ['session', 'request', 'tool', 'input_sha256']) &&
    isText(value.session) &&
    isText(value.request) &&
    isText(value.tool) &&
    typeof value.input_sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.input_sha256)
  );
}

function isAssertion(value: unknown): value is WebAuthnAssertion {
  return exactly(value, ['credentialId', 'authenticatorData', 'clientDataJSON', 'signature']) && [value.credentialId, value.authenticatorData, value.clientDataJSON, value.signature].every(isB64);
}

function canonicalizable(value: unknown): boolean {
  try {
    canonicalize(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * An action in its exact shape: every field by its rule, an unknown one refused (a field the signer bound must mean the
 * same to every verifier), a `context` with every `session`, and `opCreated` no later than `created` + `FRESH_MS`
 * (a later one is malformed: an operation is never first sealed after this sealing).
 */
export function isAction(value: unknown): value is Action {
  if (!exactly(value, ['v', 'org', 'machine', 'device', 'opId', 'opCreated', 'action', 'args', 'nonce', 'created'], ['session', 'context', 'requestDigest', 'stepUp', 'webauthn'])) return false;
  const shaped =
    value.v === 1 &&
    isText(value.org) &&
    isMachineRef(value.machine) &&
    isText(value.device) &&
    typeof value.opId === 'string' &&
    OP_ID.test(value.opId) &&
    isIsoMillis(value.opCreated) &&
    isText(value.action, 128) &&
    (value.session === undefined || isText(value.session)) &&
    (value.context === undefined || isContext(value.context)) &&
    (value.session === undefined || value.context !== undefined) &&
    isObject(value.args) &&
    (value.requestDigest === undefined || isRequestDigest(value.requestDigest)) &&
    isBase64urlOf(value.nonce, NONCE_BYTES) &&
    isIsoMillis(value.created) &&
    (value.stepUp === undefined || isBase64urlOf(value.stepUp, SIGNATURE_BYTES)) &&
    (value.webauthn === undefined || isAssertion(value.webauthn));
  return shaped && Date.parse(value.opCreated as string) <= Date.parse(value.created as string) + FRESH_MS && canonicalizable(value);
}

/**
 * The action's times against the machine's clock (`now`, epoch milliseconds): `stale` when `created` stands more than
 * `FRESH_MS` from it either way, `expired` when `opCreated` is older than `OP_HORIZON_S`. The shape is `isAction`'s.
 */
export function actionTimes(a: Action, now: number): { ok: true } | { ok: false; reason: 'stale' | 'expired' } {
  if (Math.abs(now - Date.parse(a.created)) > FRESH_MS) return { ok: false, reason: 'stale' };
  if (now - Date.parse(a.opCreated) > OP_HORIZON_S * 1000) return { ok: false, reason: 'expired' };
  return { ok: true };
}

function without(a: Action, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const field of fields) delete out[field];
  return out;
}

/** `signingInput('smns-action-v1', a without stepUp and webauthn)`. */
export function actionSigningInput(a: Action): Uint8Array<ArrayBuffer> {
  return signingInput(SIGNING_DOMAINS.action, without(a, ['stepUp', 'webauthn']));
}

/** SHA-256 of the signing input: the WebAuthn challenge. */
export async function actionDigest(a: Action): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', actionSigningInput(a)));
}

/** SHA-256 of the canonical action without what a reseal changes (`nonce`, `created`, `stepUp`, `webauthn`), base64url. */
export async function actionFingerprint(a: Action): Promise<B64> {
  const kept = canonicalize(without(a, ['nonce', 'created', 'stepUp', 'webauthn']));
  return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(kept))));
}

/** The action with its step-up signature by `key` (the device's step-up key). */
export async function signStepUp(a: Action, key: SigningKey): Promise<Action> {
  const value = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, actionSigningInput(a)));
  return { ...a, stepUp: base64urlEncode(value) };
}

/** Whether `a.stepUp` verifies over the action under `stepUpPub`: `malformed` without one, `bad-signature` otherwise. */
export async function verifyStepUp(a: Action, stepUpPub: B64): Promise<Verdict> {
  if (!isAction(a) || a.stepUp === undefined) return refuse('malformed');
  const key = await importPublicKey(stepUpPub);
  if (key === null) return refuse('bad-signature');
  try {
    const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64urlDecode(a.stepUp), actionSigningInput(a));
    return good ? accept() : refuse('bad-signature');
  } catch {
    return refuse('bad-signature');
  }
}
