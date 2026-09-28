// The main ↔ utility-process wire (C1 execution document, Interfaces "Host protocol"). Main posts `hello` on the
// child's parent port with the MessagePort that carries everything after it; requests go main → host, responses and
// events host → main. Each end validates what it receives with these schemas and then checks names, inputs, outputs
// and payloads against the X2 registries. The envelope is host-agnostic: a host serves whichever X2 entries it owns.
import * as z from 'zod';
import { IpcErrorSchema, type IpcError } from './errors';
import type { CommandName, EventName } from './schema';

export type HostMessage =
  | { t: 'hello' } // main → host, carries the MessagePort in `ports`
  | { t: 'req'; id: string; name: CommandName; input: unknown } // main → host
  | { t: 'res'; id: string; ok: true; value: unknown } // host → main
  | { t: 'res'; id: string; ok: false; error: IpcError }
  | { t: 'evt'; name: EventName; payload: unknown }; // host → main, re-emitted to the renderer after validation

// On the wire a name is any string: a request naming a command outside the registry must still be parseable far
// enough to be answered by its id (`unknown_command`), and an event outside the registry is logged by name. The
// receiver checks names against the registry after the envelope passes, which is what narrows them to `HostMessage`.
const id = z.string().min(1);

export const HostHelloSchema = z.strictObject({ t: z.literal('hello') });
export const HostRequestSchema = z.strictObject({ t: z.literal('req'), id, name: z.string(), input: z.unknown() });
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
