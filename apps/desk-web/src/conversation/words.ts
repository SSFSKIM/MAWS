// The words for what came back: an RPC's failure by its DX6 code, a result by its RPC, a delivery's outcome, a
// settlement's winner. Kept in one place so every surface says the same thing.
import type { Delivery, JsonObject, OpBody, Readback, RpcError, Settled } from 'desk-hub/protocol';

export function failureText(failure: RpcError, machine: string): string {
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
    case 'unknown-task':
      return `${machine} does not hold that job as running`;
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
      // Null when the session has no bridge: the steer went out as a `--bg` seat's reply or as a send, with no row of its
      // own to point at.
      return { text: typeof result.row === 'string' ? 'steered: read at the next model request' : 'sent: the session has no bridge, so there is no row to point at', warning: false };
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
    case 'stop':
      return { text: 'stopped; the job reads so in a moment', warning: false };
    case 'command':
      // Answered at once: what the command did comes on its `op` (`commandOutcomeText`).
      return { text: 'queued', warning: false };
    default:
      return { text: 'done', warning: false };
  }
}

/** The bridge's refusal codes for a command (DX5's `command` op), which a `failed` RPC's message starts with. */
const BRIDGE_CODES = new Set(['unknown-builtin', 'panel', 'routed', 'follow', 'drop', 'local', 'bad-args', 'disabled', 'self', 'stopped', 'turn-unknown']);

/** After an Esc at the terminal the engine refuses every mod's run until someone types there (H-esc): no cure from here. */
export const STOPPED_AT_TERMINAL = 'stopped at the terminal: commands resume after input is typed there';

/**
 * A command's failure: a refusal of the bridge's (`failed`, its code the message's first word) by its reason alone,
 * the Esc refusal as the terminal's; any other failure as `failureText` says it.
 */
export function commandFailureText(failure: RpcError, machine: string): string {
  if (failure.code === 'failed') {
    const refused = /^([a-z-]+):?\s+([\s\S]*)$/.exec(failure.message);
    if (refused && BRIDGE_CODES.has(refused[1])) return refused[1] === 'stopped' ? STOPPED_AT_TERMINAL : refused[2];
  }
  return failureText(failure, machine);
}

/**
 * A command's `op` end in words (the desk control surface spec, §6): what ran is confirmed by the transcript row the
 * bridge linked, the text the engine settled with, or the effect the daemon checked; nothing linkable is *ran,
 * unconfirmed*, never success; a settled failure is the engine's error, but a queued run the engine refused after an
 * Esc (`code: "stopped"`) is said as the RPC's own Esc refusal is, the terminal's to cure.
 */
export function commandOutcomeText(body: OpBody): { state: 'ran' | 'unconfirmed' | 'failed'; text: string; mark: string | null } {
  const settled = body.settled as { ok?: boolean; error?: string; code?: string } | undefined;
  if (settled?.ok === false && settled.code === 'stopped') return { state: 'failed', text: STOPPED_AT_TERMINAL, mark: null };
  if (settled?.ok === false) return { state: 'failed', text: `failed: ${settled.error ?? 'the engine refused it'}`, mark: null };
  if (body.route === 'run-prompt') return { state: 'ran', text: 'started a turn', mark: null };
  const readback = (body.readback ?? { how: 'none' }) as Readback;
  switch (readback.how) {
    case 'row':
      return { state: 'ran', text: readback.text ?? 'ran', mark: 'confirmed by its row' };
    case 'text':
      return { state: 'ran', text: readback.text ?? 'ran', mark: 'confirmed by text' };
    case 'effect':
      return { state: 'ran', text: body.name === 'reload-plugins' ? 'ran: the plugins reloaded' : 'ran', mark: 'confirmed by effect' };
    default:
      return { state: 'unconfirmed', text: 'ran, unconfirmed', mark: null };
  }
}

export const DELIVERY_TEXT: Record<Delivery['outcome'], string> = {
  delivered: 'delivered',
  // The frame was taken but never answered: neither delivered nor not.
  uncertain: 'possibly delivered',
  recorded: 'recorded, not delivered',
  'refused-read-only': 'not delivered: the machine is read-only',
  failed: 'not delivered: it failed',
};

/**
 * Who decided, and how. `winner` is the side the bridge names; a late decision's refusal may name only `by` (a member
 * id, `"terminal"`, `"cli"`, or `"bridge"`), which then says the side.
 */
export function settledText(winner: Settled['winner'] | null, outcome: Settled['outcome'] | null, by: string, me: string): string {
  const what = outcome === 'allow' ? 'Allowed' : outcome === 'deny' ? 'Denied' : outcome === 'answered' ? 'Answered' : outcome === 'withdrawn' ? 'Withdrawn' : 'Settled';
  if (outcome === 'withdrawn' || by === 'bridge') return by === 'bridge' ? 'Withdrawn: the session moved on without an answer' : 'Withdrawn';
  const side = winner ?? (by === 'terminal' ? 'terminal' : by === 'cli' ? 'other' : by ? 'web' : null);
  if (side === 'terminal') return `${what} in the terminal`;
  if (side === 'web') return `${what} from the web${by === me ? ' by you' : ''}`;
  if (by === 'cli') return `${what} from the command line`;
  return what;
}
