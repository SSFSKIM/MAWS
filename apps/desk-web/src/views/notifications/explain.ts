// Why this device's notifications did not turn on, in the owner's words: the hub's refusal (DX7's error codes) or the
// browser's.
import { HubRequestError } from '../../hub/http';

export function explainPushFailure(error: unknown): string {
  if (error instanceof HubRequestError) {
    if (error.code === 'not-configured') return 'The hub cannot send notifications yet: it has no push key configured.';
    if (error.code === 'too-many') return 'The hub already keeps notifications for 20 of your devices. Turn them off on one you no longer use, then try again.';
    return `The hub refused this device's subscription (${error.code}).`;
  }
  return `This device could not subscribe: ${error instanceof Error ? error.message : String(error)}`;
}
