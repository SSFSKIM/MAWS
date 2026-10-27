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
//                       a delegation signing for a name outside its prefix or a ref outside its id, a `legacy/` writer)
//   expired             a delegation past its `expires`, a certificate past its `maxUses`, or an event stamped after
//                       its retired key's `notAfter` (or its certificate's delegation's `expires`)
//   not-listed          the machine, delegation or member the record names is not in the state
//   stale-listing       a listing whose revision is not above the stored one (the hub's own check, beside these)
//   contested           a machine's identity claimed twice: a certificate for a ref a state entry holds, a ref two
//                       live certificates claim with different keys, or a name two live certificates claim under
//                       different refs; refused for every claimant (`contestedRefs` names the refs)
//   revoked             a key the state lists in `revoked` (RL DL 24): a successor holding one as current, or a record
//                       or event it signed, a certificate's under a revoked delegation included
//   name-retired        a machine name some version gave another ref, given again, or a successor that drops a name
//                       from `machineNames`
//   not-owner           an attested owner neither the sending machine's owner nor proven by a proof, or a proof that
//                       proves no ownership (another member's spawn; an owner-add by a member not yet an owner)
//   other-machine       an ownership proof that names another machine than the one whose event it attests
//   challenge           a WebAuthn assertion over another challenge than the action's digest
//   origin              a WebAuthn assertion from another origin than the verifier expects
//   rp-id               a WebAuthn assertion whose authenticator data names another relying party
//   user-presence       a WebAuthn assertion without the user-present flag
//   user-verification   a WebAuthn assertion without the user-verified flag
//   counter             a WebAuthn assertion whose signature counter did not rise where either side keeps one
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
  | 'stale-listing'
  | 'contested'
  | 'name-retired'
  | 'revoked'
  | 'not-owner'
  | 'other-machine'
  | 'challenge'
  | 'origin'
  | 'rp-id'
  | 'user-presence'
  | 'user-verification'
  | 'counter';

export type Verdict = { ok: true } | { ok: false; code: VerdictCode };

export const accept = (): Verdict => ({ ok: true });
export const refuse = (code: VerdictCode): Verdict => ({ ok: false, code });
