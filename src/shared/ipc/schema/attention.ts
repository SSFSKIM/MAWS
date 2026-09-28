// X2 `attention.*`: empty in C1; the child that owns the namespace fills it (charter §12 C1 *IPC registry composition*).
import type * as z from 'zod';
import type { CommandSpec } from './common';

export const commands = {} as const satisfies Record<`attention.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`attention.${string}`, z.ZodType>;
