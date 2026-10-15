// The fake machine (DC3's M4): a library for the web children's suites and a command (cli.ts), replaying a recorded
// session through DX2 under DX4's semantics with the org key. How to use both: interfaces-M4 in the DC3 plan's
// execution notes, folded into the composite's Interfaces.
import { fileURLToPath } from 'node:url';

export { FakeMachine, type FakeMachineOptions, type RpcRecord, type RpcScript } from './machine';
export { emptyMemory, type LedgerEntry, type Memory } from './memory';
export { loadRecording, type LoadOptions, type Recording, type Row, type Step } from './recording';
export { SNAPSHOT_ROW_BUDGET, type SnapshotOptions } from './session';
export type { Credentials } from './link';

/** The recording committed beside the tool: a haiku session with two subagents, a permission prompt and a question
 * answered from the web, a `<message>`, and a turn interrupted mid-response (record.py made it). */
export const TWO_SUBAGENTS = fileURLToPath(new URL('./recordings/two-subagents', import.meta.url));
