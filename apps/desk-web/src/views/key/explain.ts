// What the owner is told when an org-key step fails. The hub's `not-key-holder` means one thing during first setup — a
// key was already set up for the org elsewhere — and another during a change: this browser's key isn't the org's.
// `different-key` can only be a bug (the hub took this browser's proof of the org key, yet the copy's check is
// another's), so it is drawn as an error, not as guidance.
import { HubRequestError } from '../../hub/http';
import { PasskeyError } from '../../key/passkey';
import { KeyMethodError } from '../../key/unlock';

export type KeyStep = 'set-up' | 'unlock' | 'change' | 'enroll';

const NOT_KEY_HOLDER: Record<KeyStep, string> = {
  'set-up': 'A key was already set up for this org elsewhere. Unlock with one of its methods.',
  unlock: "This browser's key isn't the org's.",
  change: "This browser's key isn't the org's, so the hub refused the change. Lock it, and unlock with one of the org's methods.",
  enroll: "This browser's key isn't the org's.",
};

export function explainKeyFailure(failure: unknown, step: KeyStep): string {
  if (failure instanceof KeyMethodError || failure instanceof PasskeyError || failure instanceof TypeError) return failure.message;
  if (failure instanceof HubRequestError) {
    switch (failure.code) {
      case 'not-key-holder':
        return NOT_KEY_HOLDER[step];
      case 'different-key':
        return 'Error: the hub accepted this browser\'s proof of the org key but refused its copy as another key\'s (different-key). This is a bug in the desk; nothing was changed.';
      case 'last-key':
        return "This is the org key's only method, which is never removed: add another first.";
      case 'credential-taken':
        return 'That passkey already has a copy of the org key.';
      case 'not-admin':
        return "Only an admin of the org changes its key's methods.";
      case 'unknown-key':
        return 'That method was already removed.';
      default:
        return `The hub refused it (${failure.code}${failure.message !== failure.code ? `: ${failure.message}` : ''}).`;
    }
  }
  return `It failed: ${failure instanceof Error ? failure.message : String(failure)}`;
}
