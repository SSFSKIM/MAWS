// X6 launch spec (charter §4.1, §13 X6; C3 execution document, Interfaces "X6 — launch spec and the launch function"):
// the input to `session.launch`. Shared because the renderer (C11's launch sheet, C10's trust flow) authors it and the
// engine host turns it into a process through `buildLaunch` (src/engine-host/launch.ts). Strict: an app shape.
import * as z from 'zod';
import { PermissionModeSchema } from '../graph/enums';
import { AppSessionIdSchema, SessionIdSchema } from '../graph/ids';

export const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof EffortSchema>;

export const LaunchSpecSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  cwd: z.string(), // absolute; the engine canonicalises (realpath) and reports it in system/init.cwd
  additionalDirectories: z.array(z.string()),
  model: z.string().nullable(), // --model; null = engine default
  effort: EffortSchema.nullable(), // via --settings { effortLevel }; null = settings
  permissionMode: PermissionModeSchema.nullable(), // --permission-mode; null = settings (auto for the owner, D-18)
  // W3 (additive X6; charter D-18 as amended 2026-10-01): the mode the host sets with `set_permission_mode` when the
  // spec asks for auto and the engine's initialize answers another mode (the engine refuses auto at launch silently,
  // pass2/auto-haiku.jsonl seq 4); absent or null: the refusal stands as the engine left it.
  permissionFallback: PermissionModeSchema.nullable().optional(),
  gateway: z.enum(['gateway', 'direct']), // D-19 default is 'gateway'; the caller decides the fallback
  subagentModel: z.string().nullable(), // CLAUDE_CODE_SUBAGENT_MODEL; null = the captured shell/settings value
  resume: z.strictObject({ sessionId: SessionIdSchema, fork: z.boolean() }).nullable(),
  sessionId: SessionIdSchema.nullable(), // --session-id for a new session; the host mints one when null
  trust: z.strictObject({ accepted: z.literal(true), directory: z.string() }).nullable(), // initialize.workspaceTrust (C10 fills)
  mcpConfig: z.record(z.string(), z.unknown()).nullable(), // --mcp-config JSON (C10/C11 extension; the live tests' elicitation server)
  extraSettings: z.record(z.string(), z.unknown()).nullable(), // merged into --settings after the host's own keys (tests: ask rules, enableWorkflows)
  maxBudgetUsd: z.number().positive().nullable(), // --max-budget-usd (live tests only; cumulative for the conversation, a resume's restored cost included; C11 M6)
  replay: z.string().nullable(), // fixture path for ReplayTransport; refused unless MAWS_ENGINE_REPLAY=1
  // C10 start (additive X6, flagged to the coordinator): a fork carries the grants the human issued for the conversation
  // it copies. When set and the session's own snapshot is empty, start() loads the named session's snapshot, saves it
  // as this session's, and re-applies it in the resume rung (C10 execution document, Interfaces "X6 extensions").
  inheritGrantsFrom: AppSessionIdSchema.nullable(),
  // C10 end
  // C3 corrective start (additive X6, flagged to the architect; 2026-09-30 ledger): the one automatic retry of a resume
  // whose engine wrote nothing (`init_failed { no_output }`). The host journals the launch's reconnect rows as this
  // attempt of `maxAttempts` with the reason, and a notice saying MAWS is trying once more. Absent on every other launch.
  retry: z.strictObject({ attempt: z.number().int().positive(), maxAttempts: z.number().int().positive(), reason: z.string() }).optional(),
  // C3 corrective end
  // P2-C start (2026-10-09; additive X6, the P2-C document, Design §2 and Interfaces X6): the to-human contract MAWS
  // appends to the engine's system prompt (`--append-system-prompt`), and `--system-prompt-snapshot off`, which makes
  // the launch render its system prompt live rather than reuse the one the transcript recorded; `buildLaunch` passes
  // "off" only when the binary declares the flag. Main's launch decision (src/main/owner/launch.ts) sets both. Neither
  // is saved with the host's stored spec, so the state file an older build reads gains no key.
  appendSystemPrompt: z.string().min(1).max(16_384).nullable().optional(),
  systemPromptSnapshot: z.literal('off').nullable().optional(),
  // P2-C end
});
export type LaunchSpec = z.infer<typeof LaunchSpecSchema>;
