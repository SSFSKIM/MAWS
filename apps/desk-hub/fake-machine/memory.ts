// What outlives one run of a fake machine, as a daemon's state under `$SMINOS_HOME/daemon/` outlives a restart: the
// RPC ledger (DX6: a nonce claimed before any effect, its outcome recorded before the result is sent, kept a day), the
// traces its effects left (how a claim left without an outcome is reconciled), the results the hub has not
// acknowledged, and its mirror of each project's log. A plain JSON object, so a test hands the same one to the machine
// that comes back after a crash, and the command keeps it in a file.
import type { LogEvent } from '../src/protocol/log';
import type { JsonObject } from '../src/protocol/json';
import type { RpcName, RpcOutcome } from '../src/protocol/rpc';

/** A ledger entry: `claimed` before the RPC had any effect, then its outcome before the result went out. */
export type LedgerEntry = { rpc: string; session: string | null; claimed: number; outcome: RpcOutcome | null };

export type Memory = {
  ledger: Record<string, LedgerEntry>;
  /**
   * What each effect left behind, by nonce, written in the step that made it, the way a real one leaves a trace (a
   * steer's row is in the transcript, a spawned seat carries the nonce that started it): the RPC's result, and for a
   * steer its row (put back in the transcript by the machine that comes back). A claim found without an outcome is
   * answered from its trace, or `failed: interrupted` when it has none.
   */
  trace: Record<string, { rpc: RpcName; session: string | null; result: JsonObject; row?: JsonObject }>;
  /** Results sent and not yet acknowledged with `rpc-ack`, republished after every reconnect. */
  unacked: Record<string, { project: string; outcome: RpcOutcome }>;
  /** Each project's log as this machine holds it: its own writers' events and every other it imported. */
  log: Record<string, LogEvent[]>;
  /** Positions this machine refused on import, spent: its vector moves past them (DX2). */
  spent: Record<string, Array<{ writer: string; seq: number }>>;
  /** Nonces of events imported or refused, so a repeated nonce is refused (DX1's freshness). */
  nonces: string[];
  /**
   * Where each event this machine wrote landed, by what wrote it (a recorded log event's id, or an RPC's effect), so a
   * machine that comes back writes nothing twice and re-uploads the very bytes it sealed before.
   */
  written: Record<string, { writer: string; seq: number }>;
};

/** A ledger entry is kept a day, well past the freshness window and a reconnect (DX6). */
export const LEDGER_TTL_MS = 24 * 60 * 60 * 1000;

export const emptyMemory = (): Memory => ({ ledger: {}, trace: {}, unacked: {}, log: {}, spent: {}, nonces: [], written: {} });

/** Drops ledger entries older than a day. */
export function expireLedger(memory: Memory, now = Date.now()): void {
  for (const [nonce, entry] of Object.entries(memory.ledger)) if (now - entry.claimed > LEDGER_TTL_MS) delete memory.ledger[nonce];
}
