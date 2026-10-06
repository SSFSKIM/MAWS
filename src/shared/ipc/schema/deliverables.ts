// X2 `deliverables.*` (P1 interface ledger §5; E2 execution document, Interfaces "IPC" and Design §2): the store's read
// side. Owner `main` for every command: main's reader reads `<userData>/deliverables/` on every call (no cache), so a
// record the engine host wrote a moment ago is found at the next read. `deliverables.changed` is the host's
// announcement of a write (an IPC event, never an X1 one, so a reload or a disk replay re-announces nothing: Decision
// Log 11); `deliverables.console` is main's, a message an HTML deliverable's frame logged in an app window.
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import { DeliverableRecordSchema } from '../../maws/deliverable';
import type { CommandSpec } from './common';

export const DELIVERABLES_LIST_ALL_DEFAULT = 200;
export const DELIVERABLES_LIST_ALL_MAX = 500;

export const DeliverablesChangedSchema = z.strictObject({ appSessionId: AppSessionIdSchema, id: z.string(), change: z.enum(['created', 'updated']) });
export type DeliverablesChanged = z.infer<typeof DeliverablesChangedSchema>;

export const DeliverableConsoleSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  deliverableId: z.string(),
  version: z.number().int().min(1),
  level: z.enum(['error', 'warning']),
  message: z.string(),
  line: z.number().int().nullable(),
  source: z.string().nullable(),
});
export type DeliverableConsole = z.infer<typeof DeliverableConsoleSchema>;

const RecordsSchema = z.strictObject({ records: z.array(DeliverableRecordSchema) });

export const commands = {
  // The session's records, newest first.
  'deliverables.list': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: RecordsSchema, owner: 'main' },
  // Every session's records, newest first, at most `limit` (DELIVERABLES_LIST_ALL_DEFAULT when absent).
  'deliverables.listAll': { input: z.strictObject({ limit: z.number().int().min(1).max(DELIVERABLES_LIST_ALL_MAX).optional() }), output: RecordsSchema, owner: 'main' },
  // One record, null when gone; `present[n-1]`: whether version n's file is still on disk.
  'deliverables.get': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, id: z.uuid() }), // a record's id: it names a file on disk
    output: z.strictObject({ record: DeliverableRecordSchema.nullable(), present: z.array(z.boolean()) }),
    owner: 'main',
  },
} as const satisfies Record<`deliverables.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'deliverables.changed': DeliverablesChangedSchema,
  'deliverables.console': DeliverableConsoleSchema,
} as const satisfies Record<`deliverables.${string}`, z.ZodType>;
