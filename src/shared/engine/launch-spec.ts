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
  gateway: z.enum(['gateway', 'direct']), // D-19 default is 'gateway'; the caller decides the fallback
  subagentModel: z.string().nullable(), // CLAUDE_CODE_SUBAGENT_MODEL; null = the captured shell/settings value
  resume: z.strictObject({ sessionId: SessionIdSchema, fork: z.boolean() }).nullable(),
  sessionId: SessionIdSchema.nullable(), // --session-id for a new session; the host mints one when null
  trust: z.strictObject({ accepted: z.literal(true), directory: z.string() }).nullable(), // initialize.workspaceTrust (C10 fills)
  mcpConfig: z.record(z.string(), z.unknown()).nullable(), // --mcp-config JSON (C10/C11 extension; the live tests' elicitation server)
  extraSettings: z.record(z.string(), z.unknown()).nullable(), // merged into --settings after the host's own keys (tests: ask rules, enableWorkflows)
  maxBudgetUsd: z.number().positive().nullable(), // --max-budget-usd (live tests; C11 may expose)
  replay: z.string().nullable(), // fixture path for ReplayTransport; refused unless MAWS_ENGINE_REPLAY=1
});
export type LaunchSpec = z.infer<typeof LaunchSpecSchema>;
