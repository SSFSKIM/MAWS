// The words for what came back: an RPC's failure by its DX6 code, a result by its RPC, a delivery's outcome, a
// settlement's winner. Kept in one place so every surface says the same thing.
import type { Delivery, JsonObject, Settled } from 'desk-hub/protocol';
import type { RpcFailure } from '../hub/protocol-ahead';

export function failureText(failure: RpcFailure, machine: string): string {
  const said = failure.message ? `: ${failure.message}` : '';
  switch (failure.code) {
    case 'machine-offline':
      return `${machine} is offline; nothing was queued`;
    case 'stale':
      return 'it arrived more than 60 seconds after it was sent; nothing happened';
    case 'not-member':
    case 'bad-shape':
    case 'bad-code':
      return `${machine} could not accept it (${failure.code})${said}`;
    case 'read-only':
      return `${machine} is read-only: it runs nothing sent from outside it`;
    case 'digest-mismatch':
      return 'the request changed since it was drawn; nothing was decided';
    case 'not-pending':
      return 'the request is no longer pending';
    case 'unknown-checkout':
      return `not a known checkout of this project on ${machine}`;
    case 'above-ceiling':
      return `that permission mode is looser than ${machine}'s ceiling`;
    case 'no-session':
      return `${machine} has no such session`;
    case 'wrong-machine':
      return `the session is not on ${machine}`;
    case 'unknown-project':
      return `${machine} does not hold this project`;
    case 'unsupported':
      return `this session cannot do that${said}`;
    case 'session-live':
      return 'the session is already running somewhere';
    case 'idle':
      return 'the session is idle: Send starts a turn instead';
    case 'copy-started':
      return 'the session was reopened in a terminal meanwhile; the copy the resume started was stopped';
    case 'interrupted':
      return `${machine} stopped while running it; it did not finish`;
    default:
      return `it failed${said}`;
  }
}

const list = (items: unknown): string[] => (Array.isArray(items) ? items.map(String) : []);

/** A finished RPC's result in words, and whether it is a warning (an interrupt that left background tasks running). */
export function resultText(rpc: string, result: JsonObject): { text: string; warning: boolean } {
  switch (rpc) {
    case 'steer':
      return { text: 'steered: read at the next model request', warning: false };
    case 'interrupt': {
      const running = list(result.running);
      const stopped = list(result.stopped);
      if (running.length > 0) return { text: `interrupted, but ${running.length === 1 ? 'a background task is' : `${running.length} background tasks are`} still running: ${running.join(', ')}`, warning: true };
      if (result.turnId === null || result.turnId === undefined) return { text: 'nothing was running', warning: false };
      return { text: stopped.length > 0 ? `interrupted; stopped ${stopped.length === 1 ? 'a background task' : `${stopped.length} background tasks`}` : 'interrupted', warning: false };
    }
    case 'model': {
      const model = typeof result.model === 'string' ? result.model : "the session's own model";
      const effort = typeof result.effort === 'string' ? `${result.effort} effort` : "the session's own effort";
      return { text: `now ${model}, ${effort}`, warning: false };
    }
    case 'compact':
      return { text: result.at === 'turn-end' ? 'compacts when this turn ends' : 'compacting now', warning: false };
    case 'spawn':
      return { text: `started ${typeof result.alias === 'string' ? result.alias : 'the session'}`, warning: false };
    case 'retire':
      return { text: 'retired', warning: false };
    case 'resume':
      return { text: 'resumed; it rejoins in a moment', warning: false };
    default:
      return { text: 'done', warning: false };
  }
}

export const DELIVERY_TEXT: Record<Delivery['outcome'], string> = {
  delivered: 'delivered',
  recorded: 'recorded, not delivered',
  'refused-read-only': 'not delivered: the machine is read-only',
  failed: 'not delivered: it failed',
};

export function settledText(winner: Settled['winner'] | string, outcome: Settled['outcome'] | null, by: string, me: string): string {
  const what = outcome === 'allow' ? 'Allowed' : outcome === 'deny' ? 'Denied' : outcome === 'answered' ? 'Answered' : outcome === 'withdrawn' ? 'Withdrawn' : 'Settled';
  if (outcome === 'withdrawn') return by === 'bridge' ? 'Withdrawn: the session moved on without an answer' : 'Withdrawn';
  if (winner === 'terminal') return `${what} in the terminal`;
  if (winner === 'web') return `${what} from the web${by === me ? ' by you' : ''}`;
  if (by === 'cli') return `${what} from the command line`;
  return what;
}
