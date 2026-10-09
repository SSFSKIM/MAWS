// The built-in mods registry (X20; the P2-C document, §9): MAWS's own default, disableable communication mods (D-21),
// injected into MAWS-owned launches only. The registry is MAWS's, never the engine's, so no `claude plugin` command can
// uninstall a mod. `mods.list` answers one row per entry with its state; the plugins surface draws them.
import * as z from 'zod';
import { TO_HUMAN_CONTRACT_VERSION } from '../owner/contract';
import { ContractSourceSchema, LaneOverrideSchema, LanePendingSchema, StyleMismatchSchema } from '../owner/state';

export const ModIdSchema = z.enum(['maws.to-human']);
export type ModId = z.infer<typeof ModIdSchema>;

export type BuiltInMod = { readonly id: ModId; readonly name: string; readonly description: string; readonly version: number };

export const BUILT_IN_MODS: readonly BuiltInMod[] = [
  {
    id: 'maws.to-human',
    name: 'To-human',
    description: 'Agents mark what is for you: messages, must-reads, insights and questions you answer in place.',
    version: TO_HUMAN_CONTRACT_VERSION,
  },
];

export const ModRowSchema = z.strictObject({
  id: ModIdSchema,
  name: z.string(),
  description: z.string(),
  version: z.number().int(),
  enabled: z.boolean(), // the app's switch
  source: ContractSourceSchema, // without a session, what a new launch would do; with one, its last applied state
  perSession: LaneOverrideSchema.optional(),
  pending: LanePendingSchema.optional(),
  mismatch: StyleMismatchSchema.optional(),
});
export type ModRow = z.infer<typeof ModRowSchema>;
