// Remote lane A's outcomes in the port's types (P5 O9 M9, "Outcomes"): an act's `ActOutcome` (which never rejects) as a
// `ControlResult`, a send's fate, and a refusal's code in words. A `failed` reaches the device with its code alone (the
// endpoint keeps the whole outcome for the sender's `query`), so the words are made here from the code; the renderer may
// re-word by `code` (M3's `words.ts`).
import type { ControlResult, LaneADelivery } from '@shared/ipc/schema/lane-a';
import type { ActOutcome } from '../machines/remote/link';

const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const refused = (code: string, message: string): ControlResult => ({ state: 'refused', code, message });

/** A refusal's code in words: the endpoint's, the link's or sminos's. */
export function refusalWords(code: string, machine: string, rpc?: string): string {
  if (rpc === 'send' && code === 'unsupported') return `${machine}’s sminos predates sends from MAWS: update sminos there`;
  switch (code) {
    case 'offline':
      return `${machine} wasn’t reachable within a minute; nothing ran`;
    case 'step-up-cancelled':
      return 'the confirmation was cancelled; nothing ran';
    case 'step-up':
      return 'it needed a confirmation that didn’t verify; nothing ran';
    case 'context':
      return 'the session restarted since it was shown; nothing ran';
    case 'unavailable':
      return `${machine} can’t reach this session’s bridge now; nothing ran`;
    case 'grade':
    case 'class':
      return 'you can’t do that on this session';
    case 'read-only':
      return `${machine} is read-only: it runs nothing sent from outside it`;
    case 'not-pending':
      return 'the request is no longer pending';
    case 'digest-mismatch':
      return 'the request changed since it was shown; nothing was decided';
    case 'refused-delivery':
      return 'the session refused the message';
    case 'duplicate':
      return 'the bridge had already taken this message';
    case 'not-sent':
      return 'not sent: nothing ran, so it can be sent again';
    case 'busy':
      return `${machine} is busy; try again`;
    case 'unsupported':
      return 'this session can’t do that';
    default:
      return `refused by ${machine} (${code})`;
  }
}

/** An act's outcome as the port's `ControlResult`. */
export function controlOf(outcome: ActOutcome, machine: string, rpc?: string): ControlResult {
  switch (outcome.state) {
    case 'done':
      return { state: 'done', result: outcome.result ?? null };
    case 'failed': {
      const code = record(outcome.error)?.code;
      return typeof code === 'string' ? refused(code, refusalWords(code, machine, rpc)) : refused('failed', refusalWords('failed', machine, rpc));
    }
    case 'refused':
      return refused(outcome.reason, refusalWords(outcome.reason, machine, rpc));
    case 'not-sent':
      return refused('not-sent', refusalWords('not-sent', machine, rpc));
    case 'unknown':
      return { state: 'unknown', why: outcome.reason === 'expired' ? 'expired' : 'gone' };
  }
}

/** A send's fate from its act's outcome (Interfaces §E): entered, refused, or unconfirmed when nothing says it entered. */
export function sendFate(outcome: ActOutcome, machine: string): Pick<LaneADelivery, 'state' | 'uuid' | 'reason'> & { code?: string } {
  if (outcome.state === 'done') {
    const result = record(outcome.result);
    if (result?.entered === true) return { state: 'entered', ...(typeof result.uuid === 'string' && { uuid: result.uuid }) };
    return { state: 'unconfirmed', reason: 'it may not have arrived: the session took it but hasn’t said it entered' };
  }
  if (outcome.state === 'unknown') return { state: 'unconfirmed', reason: 'it may not have arrived: its outcome is unknown' };
  const control = controlOf(outcome, machine, 'send') as Extract<ControlResult, { state: 'refused' }>;
  return { state: 'refused', reason: control.message, code: control.code };
}
