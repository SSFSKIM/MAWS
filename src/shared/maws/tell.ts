// The direct tell (the charter's Decision Log, 2026-11-24; spikes/protocol-probe/findings-uxwave-tell-direct.txt): MAWS's
// engine host tells one of a session's agents what the person wrote through the engine's own send, `$.session.send`,
// which only a mod can make. The built-in mod `maws-tell` (mods/maws-tell, passed with --plugin-dir to every session the
// engine host runs) registers one tool the host calls by a checked `mcp_call`. The engine answers that call with an
// error whatever happens, so the answer is read by its words: the engine's own sentence when the mod's hook answered
// (the message went), the mod's marker and the engine's reason when it did not. Pure: the engine host, the renderer and
// the tests read it.
import type { EngineSessionStatus } from '../engine/status';

/** The mod's name: its plugin's, and the MCP server its tool is served on. */
export const TELL_MOD = 'maws-tell';
/** The tool's qualified name, as the engine names a plugin's registered tool. */
export const TELL_TOOL = `mcp__${TELL_MOD}__tell`;
/** What the mod writes before the engine's reason when the message did not go (mods/maws-tell/hooks/register.mjs). */
export const TELL_REFUSED = 'TELL_REFUSED ';
/** The engine's answer to a checked mcp_call whose tool a hook answered: the mod's own answer, the message went. */
export const TELL_DELIVERED = 'The tool did not run: The result went to the host that asked for this call.';
const NOT_RUN = 'The tool did not run: ';

/**
 * The first line of what the agent reads. The engine's envelope credits a plugin's send to the agent's coordinator, so
 * the message says who wrote it (as the sminos bridge's tell does).
 */
export const TELL_LINE = 'From the person supervising this session, not from your coordinator:';
export const tellText = (text: string): string => `${TELL_LINE}\n${text}`;

/**
 * The shape of an agent id the engine mints (`a` and 16 hex digits, or a named agent's `a<name>-` before them), the one
 * destination a tell takes: the engine's send resolves any other string as a name or an address, which could reach
 * another session. The mod checks it again (mods/maws-tell/hooks/register.mjs).
 */
export const TELL_AGENT_ID = /^a(?:[a-z0-9]+-)?[0-9a-f]{16}$/;
/** The engine's word that it runs a checked mcp_call (its initialize answer's and system/init's `capabilities`). */
export const CHECKED_CALL_CAPABILITY = 'mcp_call_check_permissions_v1';

/** The longest text a tell carries (the command's bound). */
export const TELL_TEXT_MAX = 100_000;

export type TellAnswer = { delivered: true } | { delivered: false; reason: string };

/**
 * The engine's answer to the host's call, read: delivered, refused with the engine's reason, or null when it is neither
 * (the call itself failed: refused by the session's mode, the mod not loaded, the process gone), which the caller
 * reports as the error it got.
 */
export function readTellAnswer(message: string): TellAnswer | null {
  if (message === TELL_DELIVERED) return { delivered: true };
  if (message.startsWith(NOT_RUN + TELL_REFUSED)) return { delivered: false, reason: message.slice(NOT_RUN.length + TELL_REFUSED.length) };
  return null;
}

/** The mod's tool server, as system/init, reload_plugins and mcp_status list it. */
export const isTellServer = (server: { name: string; source?: string | null }): boolean => server.name === TELL_MOD && server.source === 'plugin';
/** The mod's plugin, as system/init and reload_plugins list a --plugin-dir folder's. */
export const isTellPlugin = (plugin: { name: string; source: string | null }): boolean => plugin.name === TELL_MOD && plugin.source === `${TELL_MOD}@inline`;

/**
 * Whether the session's engine took the mod: its tool's server listed connected and a checked mcp_call offered (an
 * engine can serve mods with that call turned off), which the engine host says as the status's `tell`. Not so where the engine runs no mods (a rollout that serves function hooks off), on a host of an
 * earlier build, or before the session's servers were first read.
 */
export const tellPresent = (status: Pick<EngineSessionStatus, 'tell'> | null): boolean => status?.tell === true;
