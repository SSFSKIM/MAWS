// X2 `presentations.*` (P3-C, docs/doperpowers/plans/2026-10-12-p3-c-presentations.md M6, D13; H1's IPC line): main's
// presenter. `presentations.present` opens a deck's audience window (frameless, full screen on an external display when
// there is one, else on the asking window's) and, with a second display, a presenter window on the primary one; each
// loads the renderer's `present` route (`?present=1&artifact=<id>&role=audience|presenter&slide=<id>`), which opens the
// deck as a replica it never writes. A presentation already showing is ended first: one at a time.
import * as z from 'zod';
import type { CommandSpec } from './common';

const main = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'main' as const });

/** A slide's id as the dialect writes it (`project/slides/<id>.html`). */
export const PresentSlideIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const PresentInputSchema = z.strictObject({ artifactId: z.uuid(), slideId: PresentSlideIdSchema.optional() });
export const PresentOutputSchema = z.strictObject({ opened: z.enum(['audience', 'audience+presenter']) });
export type PresentInput = z.infer<typeof PresentInputSchema>;
export type PresentOutput = z.infer<typeof PresentOutputSchema>;

export const commands = {
  'presentations.present': main(PresentInputSchema, PresentOutputSchema),
} as const satisfies Record<`presentations.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`presentations.${string}`, z.ZodType>;
