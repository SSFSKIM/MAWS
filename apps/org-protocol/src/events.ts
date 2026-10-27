// RL8's log event signature. The signing input is
//
//     smns-hub-log-v2\n<org>\n<project>\n<RFC 8785 canonical JSON of the covered event>
//
// where the covered event is what DX1's `covered` covers for the same writer, minus both `mac` and `sig`: everything
// else, and for a `hub/` writer also without `writer`, `seq` and `ts`, which the hub assigns after the device signed.
// The org and the project are bound outside the body, as DX1 binds the project, so a relay cannot replay a writer's
// words into another project or org.
//
// The writer-to-signer rule (RL8):
//   - `<name>/…` (DX2's grammar, kept by RL1) is signed by a key of the ref the name binds to: through `machineNames`
//     (the entry's current key, or one of the ref's retired keys), or through the signer's own uncontested certificate
//     bearing the name (live, or retired). A name is never given to another ref, so a renamed machine's old events
//     still verify as its own and never as a newcomer's;
//   - `hub/<member>` is signed by the channel key of one of that member's devices, a `web-cards` device excepted: that
//     class only answers cards (RL §5.10), and its key is used by hub-served code; or by a retired channel key of
//     theirs, which outlives their membership;
//   - `legacy/…` is v1-only and never v2-verified.
// A retired key signs only events stamped at or before its `notAfter`, by the event's signed `created`, never its `ts`,
// for machine and device events alike (RL §5.2): every v2 event carries `created`, and one without is refused. A revoked key
// signs nothing, and its events read `revoked` rather than `unknown-signer`: a key the state lists in `revoked`, or a
// certificate's under a revoked delegation.
//
// Dual coding: `signEvent` first, then DX1's `seal`, whose `mac` then covers `sig` (DX1 covers everything but the mac's
// value), so old sminos and desk-web verify the event unchanged. `signEvent` refuses an event that already has a `mac`.
import { canonicalize } from './canonical.ts';
import { isSig, keyId, signInput, utf8, verifyInput, type B64, type Sig } from './keys.ts';
import { HUB_WRITER_PREFIX, isHubPosition, isHubWriter, isIsoMillis, LEGACY_WRITER_PREFIX, writerMachine } from './names.ts';
import { machineSigners } from './records.ts';
import { isCertificates, isMachineCert, isSigned } from './shapes.ts';
import { SIGNING_DOMAINS, type Certificates, type EventContext, type LogEventV2, type OrgState, type Signer } from './types.ts';
import { accept, refuse, type Verdict } from './verdict.ts';

/** The event as the v2 signature covers it. */
export function coveredV2(event: object): Record<string, unknown> {
  const out: Record<string, unknown> = { ...event };
  delete out.mac;
  delete out.sig;
  if (typeof out.writer === 'string' && isHubWriter(out.writer)) {
    delete out.writer;
    delete out.seq;
    delete out.ts;
  }
  return out;
}

const isContext = (ctx: EventContext) => [ctx.org, ctx.project].every((part) => typeof part === 'string' && part !== '' && !part.includes('\n'));

/** The UTF-8 bytes a v2 signature is made over. Throws a TypeError for an org or project that is empty or holds `\n`. */
export function eventSigningInput(ctx: EventContext, event: object): Uint8Array<ArrayBuffer> {
  if (!isContext(ctx)) throw new TypeError('an event context is a non-empty org and project without a newline');
  return utf8(`${SIGNING_DOMAINS.log}\n${ctx.org}\n${ctx.project}\n${canonicalize(coveredV2(event))}`);
}

/**
 * Adds the writer's v2 `sig`. Made once and kept: ECDSA is randomized, so a resend reuses the stored signature (RL
 * §5.7). A device's `hub/<member>` event is signed before the hub gives it `writer`, `seq` and `ts`.
 */
export async function signEvent<T extends object>(ctx: EventContext, event: T, key: CryptoKey, pub: B64): Promise<T & { sig: Sig }> {
  if ('mac' in event) throw new TypeError('sign before sealing: the v1 mac covers the v2 sig');
  if ('sig' in event) throw new TypeError('the event is already signed');
  if (!isIsoMillis((event as { created?: unknown }).created)) throw new TypeError('a v2 event carries its signed `created`');
  return { ...event, sig: await signInput(eventSigningInput(ctx, event), key, pub) };
}

/**
 * The keys allowed to sign as `writer` (see the header), certificates judged at `now`. A signer with a `notAfter`
 * signs only events stamped at or before it.
 */
export async function signerFor(state: OrgState, writer: string, certs: Certificates, now: Date): Promise<Signer[]> {
  if (typeof writer !== 'string' || !isCertificates(certs)) return [];
  if (isHubWriter(writer)) {
    const id = writer.slice(HUB_WRITER_PREFIX.length);
    const devices = state.members.find((m) => m.id === id)?.devices ?? [];
    const current = devices.filter((d) => d.class !== 'web-cards').map((d) => ({ pub: d.channelPub, notAfter: null }));
    const retired = state.retired.flatMap((r) =>
      'member' in r.holder && r.holder.member === id && r.holder.key === 'channel' && r.holder.class !== 'web-cards' ? [{ pub: r.pub, notAfter: r.notAfter }] : [],
    );
    return [...current, ...retired];
  }
  if (writer.startsWith(LEGACY_WRITER_PREFIX)) return [];
  const machine = writerMachine(writer);
  return machine === null ? [] : machineSigners(state, machine, certs, now);
}

/**
 * Whether `kid` names a revoked key: one the state lists in `revoked`, or the key of a certificate in `certs` under a
 * delegation the state revoked (its id a revoked holder), which the state can no longer authenticate.
 */
async function signsRevoked(state: OrgState, certs: Certificates, kid: string): Promise<boolean> {
  if (state.revoked.some((r) => r.keyId === kid)) return true;
  const gone = new Set(state.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.delegation] : [])));
  for (const c of certs.certs) if (isSigned(c, isMachineCert) && gone.has(c.body.delegation) && (await keyId(c.body.pub)) === kid) return true;
  return false;
}


/**
 * A stored or positioned v2 event, verified for `ctx` against `state`: its `sig` names a key `signerFor` allows,
 * current or retired no earlier than the event's signed `created`, and verifies. A key `signerFor` allows more than once
 * (a certificate and its renewal) is judged by the most lenient: `expired` only when every one has ended. A `hub/`
 * event's position is checked by shape as DX1's `verify` checks it, since the signature leaves it out. The `mac` of a
 * dual-coded event is DX1's.
 */
export async function verifyEvent(ctx: EventContext, state: OrgState, event: LogEventV2, certs: Certificates, now: Date): Promise<Verdict> {
  if (typeof event !== 'object' || event === null || typeof event.writer !== 'string' || !isSig(event.sig) || !isContext(ctx) || !isCertificates(certs)) return refuse('malformed');
  // The state judges keys for its own org only: another org's state would lend its keys to this org's events.
  if (ctx.org !== state.org) return refuse('malformed');
  if (isHubWriter(event.writer) && !isHubPosition(event)) return refuse('malformed');
  // The signer's own time, inside its signature: a retired key's events are judged by it (RL §5.2).
  const created = event.created;
  if (!isIsoMillis(created)) return refuse('malformed');
  let input: Uint8Array<ArrayBuffer>;
  try {
    input = eventSigningInput(ctx, event);
  } catch {
    return refuse('malformed'); // not JSON: a value RFC 8785 cannot write
  }
  const named: Signer[] = [];
  for (const signer of await signerFor(state, event.writer, certs, now)) if ((await keyId(signer.pub)) === event.sig.kid) named.push(signer);
  if (named.length === 0) return refuse((await signsRevoked(state, certs, event.sig.kid)) ? 'revoked' : 'unknown-signer');
  const timely = named.filter((s) => s.notAfter === null || created <= s.notAfter);
  if (timely.length === 0) return refuse('expired');
  for (const signer of timely) if (await verifyInput(input, event.sig, signer.pub)) return accept();
  return refuse('bad-signature');
}
