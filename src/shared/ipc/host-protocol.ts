// The main ↔ utility-process wire (C1 execution document, Interfaces "Host protocol"). Main posts `hello` on the
// child's parent port with the MessagePort that carries everything after it; requests go main → host, responses and
// events host → main. Each end validates what it receives with these schemas and then checks names, inputs, outputs
// and payloads against the X2 registries. The envelope is host-agnostic: a host serves whichever X2 entries it owns.
import * as z from 'zod';
import { ActorSchema, type Actor } from '../artifacts/actor'; // P3-A M4
import { IpcErrorSchema, type IpcError } from './errors';
import type { CommandName, EventName } from './schema';

export type HostMessage =
  | { t: 'hello' } // main → host, carries the MessagePort in `ports`
  | { t: 'ready' } // main → host, on the port (E10): main has pulled what it needs; the host emits no event before it
  // main → host; P5 O1 M5: `client` names the asking ClientRef, set by main only on a `machine`-owned command's request,
  // so the engine host (whose pre-O1 supervisor reads this envelope strictly) never receives it
  | { t: 'req'; id: string; name: CommandName; input: unknown; client?: string }
  // P5 O1 M5: main → host, once per client a request carried on this link, the first time that client ends
  | { t: 'clientGone'; client: string }
  | { t: 'res'; id: string; ok: true; value: unknown } // host → main
  | { t: 'res'; id: string; ok: false; error: IpcError }
  | { t: 'evt'; name: EventName; payload: unknown } // host → main, re-emitted to the renderer after validation
  // P3-A M4 (its Decision Log 13): main → a utility host on the parent port, carrying one end of a document's
  // MessageChannelMain in `ports`; the host attaches it to the document service under `actor`
  | { t: 'doc'; channel: number; artifactId: string; actor: Actor };

// On the wire a name is any string: a request naming a command outside the registry must still be parseable far
// enough to be answered by its id (`unknown_command`), and an event outside the registry is logged by name. The
// receiver checks names against the registry after the envelope passes, which is what narrows them to `HostMessage`.
const id = z.string().min(1);

export const HostHelloSchema = z.strictObject({ t: z.literal('hello') });
export const HostReadySchema = z.strictObject({ t: z.literal('ready') }); // E10 (A-29 (3)): additive to C1's envelope
// P3-A M4: a document's port (the channel is main's u32 key for it, never a Yjs clientID); P3-A M8: `doc: 'suggestions'`
// for the artifact's suggestion doc
export const HostDocSchema = z.strictObject({ t: z.literal('doc'), channel: z.number().int().nonnegative().max(0xffff_ffff), artifactId: z.uuid(), actor: ActorSchema, doc: z.enum(['suggestions']).optional() });
export type HostDoc = z.infer<typeof HostDocSchema>;
export const HostRequestSchema = z.strictObject({ t: z.literal('req'), id, name: z.string(), input: z.unknown(), client: z.string().min(1).optional() });
// P5 O1 M6: a request as a pre-O1 supervisor reads it, the protocol-2 window's form (wire.ts freezes it): no `client`
export const HostRequestV2Schema = z.strictObject({ t: z.literal('req'), id, name: z.string(), input: z.unknown() });
export const HostClientGoneSchema = z.strictObject({ t: z.literal('clientGone'), client: z.string().min(1) }); // P5 O1 M5
export const HostResponseSchema = z.union([
  z.strictObject({ t: z.literal('res'), id, ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ t: z.literal('res'), id, ok: z.literal(false), error: IpcErrorSchema }),
]);
export const HostEventSchema = z.strictObject({ t: z.literal('evt'), name: z.string(), payload: z.unknown() });
// Everything a host may post to main.
export const HostToMainSchema = z.union([HostResponseSchema, HostEventSchema]);

export type HostRequest = z.infer<typeof HostRequestSchema>;
export type HostResponse = z.infer<typeof HostResponseSchema>;
export type HostToMain = z.infer<typeof HostToMainSchema>;
