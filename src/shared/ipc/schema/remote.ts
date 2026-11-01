// X2 `remote.*` (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §K): main's remote lane B
// adapter (src/main/lane-b/remote.ts) telling the renderer about a lane B session on another machine that it streams over
// that machine's RL2 link. Owned by main and outside the wire manifest, as `machines.*` and `org.*`: main-to-renderer
// traffic between one build's halves. Ids are bare here and lifted to addresses by the IPC boundary, as every event's.
//
// - `remote.session`: one subscribed session's state at each change: the link as this device sees it (`link`), the
//   session's stream (`stream`), and every control of the session's port with the remote overlay (`controls`), closed with
//   a reason where the session on another machine can't take it yet; `reason`, when set, closes every control (the
//   machine refused this device, the link closed, the session isn't placed yet or can't be).
// - `remote.gap`: the stream went on past events it could not deliver (a relaunch's snapshot, a range the machine's
//   journal lost, an event too large to carry): the transcript draws "Earlier history isn't available" here.
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import { MachineRefSchema } from '../../machine/ref';
import type { CommandSpec } from './common';

// Every control a session's port names (the renderer's `session/controls/types.ts` keeps the same list), so main can say
// each one's state for a session on another machine.
export const CONTROL_KEYS = [
  'send', 'interrupt', 'answer', 'decide', 'decide.scope', 'decide.interrupt', 'decide.addDirectory',
  'model', 'mode', 'command', 'btw', 'compact', 'mcp.enable', 'mcp.disable', 'mcp.reconnect',
  'stop-agent', 'tell', 'stop-task', 'media', 'queue', 'rewind', 'forget', 'rewind-files',
  'elicitation.answer', 'subagent-rows', 'take-over', 'reopen',
] as const;
export type ControlKey = (typeof CONTROL_KEYS)[number];

export const RemoteCapabilitySchema = z.union([z.strictObject({ available: z.literal(true) }), z.strictObject({ available: z.literal(false), reason: z.string() })]);
export type RemoteCapability = z.infer<typeof RemoteCapabilitySchema>;

export const MACHINE_RIGHTS = ['spawn', 'shell', 'machine-admin'] as const;

// The channel's bound on a message to a session on another machine, as the composer checks it before sending (M2,
// "Images"): a sealed act is at most org-protocol's MESSAGE_MAX_BYTES (4 MiB), less 64 KiB for the action's own fields, so
// the content's UTF-8 JSON stays under this. And the words for an image past it, the composer's and main's alike (main
// answers them for the link's own `too-large` refusal).
export const REMOTE_INLINE_MAX_BYTES = 4 * 1024 * 1024 - 64 * 1024;
export const REMOTE_TOO_LARGE_WORDS = 'an image larger than 2.5 MiB goes to a session on another machine as a file';

// The link as a remote session's state carries it: its reported state, its carrier while up, the permanent verdict holding
// it down, this device's member there (null before the first `caps`) and the member's machine rights.
export const RemoteLinkStateSchema = z.strictObject({
  state: z.enum(['up', 'down', 'connecting']),
  carrier: z.enum(['direct', 'relay']).nullable(),
  refusal: z.string().nullable(),
  member: z.string().nullable(),
  rights: z.array(z.enum(MACHINE_RIGHTS)),
});
export type RemoteLinkState = z.infer<typeof RemoteLinkStateSchema>;

// opening: placing the session and starting its stream; idle: placed, not live (released, or parked); live; paused (the
// link offline past its grace, or the machine's `no-app`); gap: a discontinuity just told (`remote.gap`), until the next
// state; ended: no stream will come (the device removed, the link closed, the session not placed).
export const REMOTE_STREAM_STATES = ['opening', 'idle', 'live', 'paused', 'gap', 'ended'] as const;
export type RemoteStreamState = (typeof REMOTE_STREAM_STATES)[number];

export const RemoteSessionSchema = z.strictObject({
  address: AppSessionIdSchema,
  link: RemoteLinkStateSchema,
  stream: z.enum(REMOTE_STREAM_STATES),
  controls: z.record(z.enum(CONTROL_KEYS), RemoteCapabilitySchema),
  reason: z.string().nullable(),
});
export type RemoteSession = z.infer<typeof RemoteSessionSchema>;

// P5 O7 M3 ("Forwarding", Interfaces §K): a port of a machine's loopback forwarded to a listener on this Mac's
// (`127.0.0.1:<localPort>`), over the machine's link, for the in-app browser to load a loopback link of a session there.
// Open is idempotent per machine and port (the listener and its forward are kept); close ends the listener and its
// connections. The renderer names the machine in the input and invokes it on this app (a `client` command).
const ForwardTargetSchema = z.strictObject({ machine: MachineRefSchema, port: z.number().int().min(1).max(65535) });

export const commands = {
  'remote.forward.open': { input: ForwardTargetSchema, output: z.strictObject({ localPort: z.number().int().min(1).max(65535) }), owner: 'main' },
  'remote.forward.close': { input: ForwardTargetSchema, output: z.void(), owner: 'main' },
} as const satisfies Record<`remote.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'remote.session': RemoteSessionSchema,
  // `at`: where in the launch the gap ends, its next event the first at or after it (a lost range's `missing`, an event
  // too large to carry); absent, before the launch's first event (a relaunch's `snapshot`) or where it was told
  'remote.gap': z.strictObject({ appSessionId: AppSessionIdSchema, launchId: z.string(), at: z.strictObject({ seq: z.number().int(), idx: z.number().int().optional() }).optional() }),
  // M2's milestone review: a remote session's history window too large for the channel, which main's read can't page
  // until M4 (acceptance 12), said just before main answers that read `historyUnavailable`: `newest`, a parked session's
  // newest window (the engine host's disk read); `older`, an older page (or a seek, a subagent's slice). The renderer's
  // bar for that answer says the history can't be shown here yet (new messages still appear), not that it is lost.
  'remote.historyTooLarge': z.strictObject({ appSessionId: AppSessionIdSchema, window: z.enum(['newest', 'older']) }),
  // P5 O7 M4 ("Uploads in parts"): a `files.upload` to a session on another machine crosses as parts, each its own act;
  // after each lands (and once before the first), how far one file of the call has come: `file`, its index in the call's
  // `files`; `sent` of `parts` landed. The composer's chip for that file shows it.
  'remote.upload': z.strictObject({ appSessionId: AppSessionIdSchema, file: z.number().int().nonnegative(), name: z.string(), sent: z.number().int().nonnegative(), parts: z.number().int().positive() }),
} as const satisfies Record<`remote.${string}`, z.ZodType>;
