// X2 `render.*` (P5 O5 M3; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §A, §K): the render host's
// work over `mawsd`'s services front. The render host is a `machine.sock` client whose hello lists `render.client`
// (RENDER_CLIENT_CAPABILITY); `mawsd` posts it `render.request`, an event to that client alone, and the render host
// answers each once with `render.answer` (main-only, as `clientPort.answer` is: the client port's request-and-answer
// shape, inverted). `render.exit` asks it to end after its work in flight and exit 0. An event and a command, since a
// reverse request kind would be a new envelope kind, breaking within the major (src/shared/ipc/wire.ts).
//
// A request carries what the bridge or the library asked, unchanged: `maws.artifact.capture`'s and
// `maws.artifact.export`'s payloads, and `artifacts.export`'s input. The answer is the matching answer, or a failure the
// render host names (`ipcError`: a library export's refusal, so its code and issues reach the asker as the router answers
// them in the app).
import * as z from 'zod';
import { IpcErrorSchema } from '../errors';
import { commands as artifacts } from './artifacts';
import type { CommandSpec } from './common';
import { MawsArtifactCapturedResultSchema, MawsArtifactCaptureSchema, MawsArtifactExportAnswerSchema, MawsArtifactExportSchema } from './maws';

export const RENDER_KINDS = ['capture', 'export', 'libraryExport'] as const;

const RenderIdSchema = z.string().min(1).max(128);

export const RenderRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: RenderIdSchema, kind: z.literal('capture'), request: MawsArtifactCaptureSchema }),
  z.strictObject({ id: RenderIdSchema, kind: z.literal('export'), request: MawsArtifactExportSchema }),
  z.strictObject({ id: RenderIdSchema, kind: z.literal('libraryExport'), request: artifacts['artifacts.export'].input }),
]);
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

// What the render host could not do, said in a sentence; a library export's refusal also as the IPC error it was
export const RenderFailureSchema = z.strictObject({ ok: z.literal(false), error: z.string(), ipcError: IpcErrorSchema.optional() });
export type RenderFailure = z.infer<typeof RenderFailureSchema>;

export const RenderAnswerSchema = z.union([MawsArtifactCapturedResultSchema, MawsArtifactExportAnswerSchema, artifacts['artifacts.export'].output, RenderFailureSchema]);
export type RenderAnswer = z.infer<typeof RenderAnswerSchema>;

export const commands = {
  'render.answer': { input: z.strictObject({ id: RenderIdSchema, answer: RenderAnswerSchema }), output: z.void(), owner: 'machine' }, // main-only: from a render.client alone (M4's front)
} as const satisfies Record<`render.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'render.request': RenderRequestSchema, // to the one ready render.client
  'render.exit': z.strictObject({}), // to the render client alone: end after the work in flight, then exit 0
} as const satisfies Record<`render.${string}`, z.ZodType>;
