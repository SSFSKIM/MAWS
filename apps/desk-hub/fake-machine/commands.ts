// A `command` as the fake machine runs it (the desk control surface spec, 2026-10-22, §2–§3 and §6, M0): the bridge's
// route check over the vendored table, then the op answered at once (`{queued, route, id}`) and its outcome reported as
// DX4 `op` messages under the RPC's nonce — `start` as the call is made, `end` with the engine's settled value and the
// readback once the session is idle (a command waits for the running turn, H-queue). What each command prints is a
// script keyed by its name (`CommandScript`); the five rows M0 enables have defaults with the engine's own lines, and
// `reload-plugins` ends as the daemon finishes it, by effect.
import { randomUUID } from 'node:crypto';
import type { JsonObject } from '../src/protocol/json';
import type { Catalog, OpBody, Readback, SessionMessage } from '../src/protocol/session';
import { listedOf, loadRoutes, routeOf, type CommandRefusalCode, type RouteTable } from './routes';

/** A command's outcome: the engine's settled value (absent when the daemon finished it, by effect), the readback, and
 * the title a `/rename` gave the session (the machine publishes it as `titled`). */
export type CommandOutcome = { settled?: { ok: true; text?: string } | { ok: false; error: string }; readback: Readback; title?: string };

/** A refusal the session makes after the route check passed (the Esc refusal, `stopped`, the engine's words). */
export type CommandRefusal = { refuse: { code: CommandRefusalCode; reason: string } };

/** What a command prints, by its name: an outcome, a refusal, or undefined for the default. */
export type CommandScript = Record<string, (args: string, session: string) => CommandOutcome | CommandRefusal | undefined>;

/** The engine's own lines for the five rows M0 enables (S7, the probe), read back as the bridge reads them. */
export function defaultOutcome(name: string, args: string): CommandOutcome {
  const row = (text: string): Readback => ({ how: 'row', text, uuid: randomUUID() });
  const trimmed = args.trim();
  switch (name) {
    case 'rename':
      return { settled: { ok: true }, readback: row(`Session renamed to: ${trimmed}`), title: trimmed };
    case 'color':
      return { settled: { ok: true }, readback: row(`Session color set to: ${trimmed}`) };
    case 'reload-skills': {
      const text = 'Reloaded skills: 14 skills';
      return { settled: { ok: true, text }, readback: { how: 'text', text } };
    }
    case 'reload-plugins':
      // The module that ran it is replaced and never posts its end: the daemon finishes it when the bridge answers again.
      return { readback: { how: 'effect' } };
    case 'mcp': {
      const [verb, server] = trimmed.split(/\s+/);
      const text = verb === 'reconnect' ? `Reconnected to ${server}.` : `MCP server "${server}" ${verb === 'enable' ? 'enabled' : 'disabled'}`;
      return { settled: { ok: true }, readback: row(text) };
    }
    default:
      return { settled: { ok: true }, readback: { how: 'none' } };
  }
}

/** The bridge's answer to a `command` op: refused with its code and reason, or queued under an id with its outcome. */
export type CommandPlan = { ok: false; code: CommandRefusalCode; reason: string } | { ok: true; route: string; id: string; name: string; args: string; outcome: CommandOutcome };

export class Commands {
  constructor(
    private readonly script: CommandScript = {},
    private readonly table: RouteTable = loadRoutes(),
    private readonly m1 = false,
  ) {}

  plan(name: string, args: string, session: string, machine: string, catalog: Catalog | null = this.table.catalog ?? null): CommandPlan {
    const listed = this.m1 ? (catalog?.commands.find((c) => c.name === name) ?? null) : listedOf(this.table, name);
    const checked = routeOf(this.table, listed, name, args, machine);
    if (!checked.ok) return checked;
    if (!this.m1 && !['rename', 'color', 'reload-plugins', 'reload-skills', 'mcp'].includes(name)) return { ok: false, code: 'disabled', reason: 'comes with M1' };
    const scripted = this.script[name]?.(args, session);
    if (scripted && 'refuse' in scripted) return { ok: false, ...scripted.refuse };
    return { ok: true, route: checked.route.class, id: `cmd-${randomUUID()}`, name, args, outcome: scripted ?? defaultOutcome(name, args) };
  }
}

/** A refusal as the daemon fails the RPC: `failed`, the bridge's code the message's first word and its reason after. */
export const refusalMessage = (plan: Extract<CommandPlan, { ok: false }>): string => `${plan.code}: ${plan.reason}`;

/** The op's DX4 `start` and `end`, session-wide, under the RPC's nonce. */
export function opMessages(where: { project: string; machine: string }, session: string, rpc: string | null, plan: Extract<CommandPlan, { ok: true }>): { start: SessionMessage<'op'>; end: SessionMessage<'op'> } {
  const base = { project: where.project, machine: where.machine, session, kind: 'op', sub: null, n: null } as const;
  const head = { rpc, op: 'command', id: plan.id, name: plan.name, args: plan.args, route: plan.route } as const;
  const { settled, readback } = plan.outcome;
  const end: OpBody = { ...head, phase: 'end', ...(settled && { settled: settled as unknown as JsonObject }), readback: readback as unknown as JsonObject, t: Date.now() };
  return { start: { ...base, body: { ...head, phase: 'start', t: Date.now() } }, end: { ...base, body: end } };
}
