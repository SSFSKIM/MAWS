// The fake machine (DC3's M4): a library for the web children's suites and a command (cli.ts), replaying a recorded
// session through DX2 under DX4's semantics with the org key. How to use both: interfaces-M4 in the DC3 plan's
// execution notes, folded into the composite's Interfaces.
import { fileURLToPath } from 'node:url';

export { FakeMachine, type FakeMachineOptions, type RpcRecord, type RpcScript } from './machine';
export { emptyMemory, type LedgerEntry, type Memory } from './memory';
export { loadRecording, type LoadOptions, type Recording, type Row, type Step } from './recording';
export { ENGINE_TMP, M0_CAPABILITIES, M0_SMINOS, M1_CAPABILITIES, M1_SMINOS, MW1_CAPABILITIES, MW1_READS, MW1_SMINOS, MW2_BTW, MW2_CAPABILITIES, MW2_SMINOS, MW3_CAPABILITIES, MW3_SCOPED, MW3_SMINOS, MW4_AGENTS, MW4_CAPABILITIES, MW4_SMINOS, MW5_CAPABILITIES, MW5_MEDIA, MW5_SMINOS, agentStopNote, producerAtLeast, SessionDepth, SNAPSHOT_ROW_BUDGET, type BridgePlugin, type Producer, type SnapshotOptions } from './session';
export { Commands, defaultOutcome, opMessages, refusalMessage, type CommandOutcome, type CommandPlan, type CommandRefusal, type CommandScript } from './commands';
export { listedOf, loadRoutes, ROUTES_2_1_307, routeOf, type CommandRefusalCode, type Listed, type RouteCheck, type RouteTable } from './routes';
export { derive, deriveFromRows, LoopIndex, TABLE, type Body, type BridgeAgent } from './jobs';
export { answerOutput } from './output';
export type { Credentials } from './link';
export { certify, endpointRecord, enrollDelegated, enrollV2, listing, machineFetch, mintRef, redeemDelegated, retirement, type DelegationKey, type V2Machine } from './org';

/** The recording committed beside the tool: a haiku session with two subagents, a permission prompt and a question
 * answered from the web, a `<message>`, and a turn interrupted mid-response (record.py made it). */
export const TWO_SUBAGENTS = fileURLToPath(new URL('./recordings/two-subagents', import.meta.url));

/** DC9's acceptance recording: `two-subagents` extended with rows synthesized in engine 2.1.300's shapes by
 * `session-view.py` (its recorded.json names where each shape came from) — older history past one snapshot, a nested
 * agent, background shells and a monitor with their notifications, a `task_status` and a `TaskStop`, an async question
 * of the ask mod answered from the web, MCP servers added and removed, the session's end, and a send recorded
 * undelivered. Replay it with `producer: 'dc8'`. */
export const SESSION_VIEW = fileURLToPath(new URL('./recordings/session-view', import.meta.url));
export { FakeEndpoint, type ChannelHandler, type EndpointDown, type FakeEndpointOptions } from './endpoint';
export { echoCheck, echoPayloads, RelayApp, type EchoCheck } from './relay-app';
