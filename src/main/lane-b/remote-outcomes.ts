// Remote lane B's outcomes and capabilities (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Outcomes
// as results", "The capability list"; Interfaces §F, §J, §K).
//
// An act's `ActOutcome` (which never rejects) as the command's own result: `done` its output, checked with the link
// surface's codec as `dispatchOverLink` checks a call's; `failed` the error as the command's; `refused` by §F, but A4's
// `offline` ("Not sent: <machine> is offline", which the composer shows with Send again) and the channel's image bound;
// `not-sent` (the machine tombstoned it: nothing ran) and `unknown` (it may have run; its answer is lost) in words. A send
// the channel carried and whose outcome hasn't come by the pending bound answers `pendingResult`: the act goes on
// querying, and only the transcript says whether it ran.
//
// The capability list (RL7's per-session half): the link as this device sees it, and every control of the session's
// lane B port with the remote overlay. A reason (the machine refused this device, the link closed, the session isn't
// placed) closes every control; otherwise only what a session on another machine can't take yet is closed. A link that is
// down or reconnecting closes nothing: an act waits under the link's hold (A4), and a session with a record and no status
// (released, or opening) is resumed by the act that needs it.
import { ipcError, IPC_ERROR_CODES, type IpcErrorCode } from '@shared/ipc/errors';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { CONTROL_KEYS, MACHINE_RIGHTS, REMOTE_TOO_LARGE_WORDS, type ControlKey, type RemoteCapability, type RemoteLinkState } from '@shared/ipc/schema/remote';
import { codecOf } from '@shared/ipc/validate';
import { LINK_REGISTRY } from '../machines/link-surface';
import { refusalError } from '../machines/remote/dispatch';
import type { ActOutcome, RemoteLink } from '../machines/remote/link';
import type { RemoteSessionState } from './remote-session';

const codec = codecOf(LINK_REGISTRY);
const isIpcCode = (code: string): code is IpcErrorCode => (IPC_ERROR_CODES as readonly string[]).includes(code);
const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const failure = (code: IpcErrorCode, message: string, issues?: unknown): CommandResult<CommandName> => ({ ok: false, error: ipcError(code, message, issues) });

/** A person's words to the session (a send, a steer) are a message; anything else a request. */
const isMessage = (name: CommandName) => name === 'session.send' || name === 'session.steer';

/** The channel's image bound, as the composer words it (MESSAGE_MAX_BYTES less headroom, base64): one sentence, shared. */
export const TOO_LARGE_WORDS = REMOTE_TOO_LARGE_WORDS;

/** What a session on another machine can't take yet, by control: closed with these words whatever the link says. */
export const REMOTE_GAPS: Readonly<Partial<Record<ControlKey, string>>> = {
  media: 'files to a session on another machine wait for uploads',
  'take-over': 'not offered for a session on another machine',
  reopen: 'not offered for a session on another machine',
  rewind: 'rewinding a session on another machine waits for its files panel',
  'rewind-files': 'rewinding a session on another machine waits for its files panel',
  'subagent-rows': 'a subagent’s own rows aren’t carried from another machine yet',
};

/** An act's outcome as the command's result (§F, A4, the image bound, a lost answer). */
export function outcomeAsResult(name: CommandName, machine: string, outcome: ActOutcome): CommandResult<CommandName> {
  switch (outcome.state) {
    case 'done': {
      const output = codec.readCommandOutput(name, outcome.result);
      if (!output.ok) return { ok: false, error: output.error };
      return { ok: true, value: output.value } as CommandResult<CommandName>;
    }
    case 'failed': {
      const error = record(outcome.error);
      const code = typeof error?.code === 'string' ? error.code : 'failed';
      const message = typeof error?.message === 'string' ? error.message : `${name}: failed on machine ${machine}`;
      return isIpcCode(code) ? failure(code, message) : failure('internal', message, { refusal: code });
    }
    case 'refused':
      if (outcome.reason === 'offline') return failure('host_unavailable', `Not sent: ${machine} is offline`);
      if (outcome.reason === 'too-large') return failure('invalid_input', TOO_LARGE_WORDS);
      return refusalError(name, machine, { code: outcome.reason });
    case 'not-sent':
      return failure('host_unavailable', `Not sent: ${machine} never received it`);
    case 'unknown':
      return failure('timeout', isMessage(name) ? `${machine} took the message but its answer was lost; check the transcript` : `${machine} took the request but its answer was lost`);
  }
}

/** The renderer's answer at the pending bound, for an act the channel carried whose outcome hasn't come. */
export function pendingResult(name: CommandName, machine: string): CommandResult<CommandName> {
  return failure('timeout', isMessage(name) ? `${machine} took the message but hasn’t confirmed it; check the transcript` : `${machine} took the request but hasn’t confirmed it`);
}

/** The link as a remote session's state carries it (§K). */
export function remoteLinkView(link: Pick<RemoteLink, 'state' | 'carrier' | 'refusal' | 'caps'>): RemoteLinkState {
  const caps = link.caps();
  const grades = caps?.machine.grades ?? [];
  return {
    state: link.state(),
    carrier: link.carrier(),
    refusal: link.refusal(),
    member: caps?.member ?? null,
    rights: MACHINE_RIGHTS.filter((right) => grades.includes(right)),
  };
}

/** Why no control of the session acts from this device, or null when they do. */
export function sessionReason(state: Pick<RemoteSessionState, 'record' | 'stream' | 'ended'>, link: RemoteLinkState, machine: string): string | null {
  if (link.refusal === 'removed') return `This Mac is no longer allowed on ${machine}`;
  if (link.refusal !== null) return `${machine} refused this device (${link.refusal})`;
  if (state.ended === 'closed') return `the link to ${machine} closed`;
  // The session's own right withdrawn (a share or grant taken back) while the device stays allowed on the machine.
  if (state.ended === 'removed') return `${machine} no longer lets you open this session`;
  if (state.record === null) return state.stream === 'ended' ? `${machine} can’t place this session` : `Opening on ${machine}…`;
  return null;
}

/** Every control of the session's port with the remote overlay (§K's `controls`). */
export function controlsOverlay(state: Pick<RemoteSessionState, 'record' | 'stream' | 'ended'>, link: RemoteLinkState, machine: string): Record<ControlKey, RemoteCapability> {
  const reason = sessionReason(state, link, machine);
  const controls = {} as Record<ControlKey, RemoteCapability>;
  for (const key of CONTROL_KEYS) {
    const closed = reason ?? REMOTE_GAPS[key];
    controls[key] = closed === undefined ? { available: true } : { available: false, reason: closed };
  }
  return controls;
}
