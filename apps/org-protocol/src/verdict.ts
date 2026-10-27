// A verification's answer. The hub refuses with the code (`409 <code>`); a machine or an app refuses the same way.
//
//   malformed           a shape or an invariant fails: an unknown or missing field, a bad encoding, a value that is
//                       not JSON, duplicate ids, a root key that is not an admin device's step-up key, a changed
//                       recovery key, a clock that runs backwards, a successor after a root transition that does not
//                       take its root set, a record of another org
//   bad-signature       the signature does not verify under the key its kid names (the event or record was changed,
//                       or was signed for another org, project or domain)
//   not-root-signed     no signature on a state is by a root key (the head's, or a root transition's after one)
//   not-head            the state, or the transition, does not follow the verifier's head: a fork at its version, a
//                       gap, or a `prev` that is not the head's hash
//   rollback            the state, or the transition's `fromVersion`, is older than the verifier's head
//   bad-link            the link is broken outright: another org, or a genesis with a `prev`
//   endorsement-missing a device new to a member who had devices carries no endorsement
//   unknown-signer      the kid names no key allowed to sign this (a device of another member, a key not in the state,
//                       a delegation signing for a name outside its prefix or a listed machine's, a `legacy/` writer)
//   expired             a delegation past its `expires`, or a certificate past its `maxUses`
//   not-listed          the machine, delegation or member the record names is not in the state
//   stale-listing       a listing whose revision is not above the stored one (the hub's own check, beside these)
export type VerdictCode =
  | 'malformed'
  | 'bad-signature'
  | 'not-root-signed'
  | 'not-head'
  | 'rollback'
  | 'bad-link'
  | 'endorsement-missing'
  | 'unknown-signer'
  | 'expired'
  | 'not-listed'
  | 'stale-listing';

export type Verdict = { ok: true } | { ok: false; code: VerdictCode };

export const accept = (): Verdict => ({ ok: true });
export const refuse = (code: VerdictCode): Verdict => ({ ok: false, code });
