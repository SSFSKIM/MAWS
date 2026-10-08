// X2 `scm.*` (E6 execution document, Interfaces "X2 `scm.*`"; parent §3 F, P-12): the Source control panel's commands.
// Main owns every one: it resolves the session's checkout from its read model (`worktree.path ?? directory`), so no
// command takes a directory; it gates everything but `scm.status` on the engine's trust; local mutations run through
// the mutating git runner, remote commands only through a plan main recorded, the sheet showed and the run revalidated.
// What the owner can act on is a refusal value (`ScmRefusal`), never an error envelope.
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import type { CommandSpec } from './common';
import { GitStatusSchema } from './git';

const Session = z.strictObject({ appSessionId: AppSessionIdSchema });
const RelativePath = z.string().min(1).max(4096);

export const ScmGhStateSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('ready'), path: z.string(), version: z.string() }),
  z.strictObject({ state: z.literal('unauthenticated'), path: z.string(), version: z.string().nullable(), detail: z.string() }),
  z.strictObject({ state: z.literal('missing') }),
]);
export type ScmGhState = z.infer<typeof ScmGhStateSchema>;
export const ScmStatusSchema = z.strictObject({
  directory: z.string(), // the checkout (realpath)
  repository: z.boolean(),
  trusted: z.boolean(),
  trustKey: z.string(),
  remotes: z.array(z.strictObject({ name: z.string(), url: z.string().nullable() })), // fetch urls without user-info
  defaultRemote: z.string().nullable(),
  defaultBase: z.string().nullable(), // the default remote's HEAD branch, when git knows it
  gh: ScmGhStateSchema,
  checkedAt: z.string(),
});
export type ScmStatus = z.infer<typeof ScmStatusSchema>;
export const ScmRefusalCodeSchema = z.enum([
  'untrusted', 'not_repository', 'changed', 'unmerged', 'nothing_staged', 'empty_message', 'git_failed', 'busy',
  'no_remote', 'detached', 'behind', 'not_pushed', 'gh_missing', 'gh_unauthenticated', 'plan_expired',
  'unborn', // E11: a push of a branch with no commits yet
]);
export type ScmRefusalCode = z.infer<typeof ScmRefusalCodeSchema>;
export const ScmRefusalSchema = z.strictObject({ refused: ScmRefusalCodeSchema, detail: z.string(), output: z.string() });
export type ScmRefusal = z.infer<typeof ScmRefusalSchema>;
export const ScmMutationSchema = z.union([
  z.strictObject({ ok: z.literal(true), status: GitStatusSchema, output: z.string(), commit: z.strictObject({ sha: z.string(), subject: z.string() }).optional() }),
  ScmRefusalSchema,
]);
export type ScmMutation = z.infer<typeof ScmMutationSchema>;
export const ScmPathsInputSchema = z.strictObject({ appSessionId: AppSessionIdSchema, paths: z.array(RelativePath).min(1).max(1000) });
export type ScmPathsInput = z.infer<typeof ScmPathsInputSchema>;
export const ScmDiscardInputSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  entries: z.array(z.strictObject({ path: RelativePath, group: z.enum(['unstaged', 'untracked']) })).min(1).max(1000),
});
export type ScmDiscardInput = z.infer<typeof ScmDiscardInputSchema>;
export const ScmCommitInputSchema = z.strictObject({ appSessionId: AppSessionIdSchema, message: z.string().min(1).max(65536), noVerify: z.boolean() });
export type ScmCommitInput = z.infer<typeof ScmCommitInputSchema>;

export const RemotePlanSchema = z.strictObject({
  token: z.uuid(),
  kind: z.enum(['push', 'pr']),
  cwd: z.string(),
  program: z.string(), // the resolved absolute path main will spawn
  argv: z.array(z.string()), // exactly what main will pass; no shell
  remote: z.string(),
  remoteUrl: z.string().nullable(), // the fetch url (the GitHub link)
  pushUrls: z.array(z.string()), // `remote get-url --push --all`, without user-info: the destinations
  repository: z.string().nullable(), // a PR plan: gh's resolved `[HOST/]OWNER/REPO`, bound with --repo
  branch: z.string(),
  head: z.string(), // the commit the sheet showed; the run refuses when it moved
  upstream: z.string().nullable(), // after a push: `<remote>/<branch>`
  expiresAt: z.string(),
});
export type RemotePlan = z.infer<typeof RemotePlanSchema>;
export const ScmPlanResultSchema = z.union([RemotePlanSchema, ScmRefusalSchema]);
export type ScmPlanResult = z.infer<typeof ScmPlanResultSchema>;
export const ScmPushPlanInputSchema = z.strictObject({ appSessionId: AppSessionIdSchema, remote: z.string().min(1).max(256).optional() });
export type ScmPushPlanInput = z.infer<typeof ScmPushPlanInputSchema>;
export const ScmPrPlanInputSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  title: z.string().min(1).max(256),
  body: z.string().max(65536),
  base: z.string().min(1).max(256),
  draft: z.boolean(),
});
export type ScmPrPlanInput = z.infer<typeof ScmPrPlanInputSchema>;
export const ScmRunInputSchema = z.strictObject({ appSessionId: AppSessionIdSchema, token: z.uuid() });
export type ScmRunInput = z.infer<typeof ScmRunInputSchema>;
export const ScmRunStartedSchema = z.union([z.strictObject({ started: z.literal(true), token: z.uuid() }), ScmRefusalSchema]);
export type ScmRunStarted = z.infer<typeof ScmRunStartedSchema>;
export const ScmRemoteOutputSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  token: z.uuid(),
  seq: z.number().int().positive(), // per run, from 1; the latest-run snapshot carries the seq of its last chunk
  kind: z.enum(['stdout', 'stderr', 'exit']),
  text: z.string().optional(), // stdout and stderr chunks
  truncated: z.boolean().optional(), // the one chunk past the 1 MiB cap
  exitCode: z.number().int().nullable().optional(), // exit
  signal: z.string().nullable().optional(), // exit
});
export type ScmRemoteOutput = z.infer<typeof ScmRemoteOutputSchema>;
export const ScmRemoteLastSchema = z.strictObject({
  token: z.uuid(),
  kind: z.enum(['push', 'pr']),
  plan: RemotePlanSchema,
  running: z.boolean(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  output: z.string(), // both streams interleaved as they arrived, capped
  truncated: z.boolean(),
  seq: z.number().int(), // the last chunk folded into `output` (0 when none yet)
  startedAt: z.string(),
}).nullable();
export type ScmRemoteLast = z.infer<typeof ScmRemoteLastSchema>;

export const ScmCheckSchema = z.strictObject({
  name: z.string(),
  bucket: z.enum(['pass', 'fail', 'pending', 'skipping', 'cancel']),
  state: z.string(),
  link: z.string().nullable(),
  workflow: z.string().nullable(),
});
export type ScmCheck = z.infer<typeof ScmCheckSchema>;
export const ScmPrStateSchema = z.strictObject({
  checkedAt: z.string(),
  branch: z.string().nullable(),
  gh: ScmGhStateSchema,
  pr: z.strictObject({
    number: z.number().int(),
    url: z.string(),
    title: z.string(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    isDraft: z.boolean(),
    reviewDecision: z.string().nullable(),
    baseRefName: z.string(),
    headRefName: z.string(),
    mergeStateStatus: z.string().nullable(),
    checks: z.strictObject({ summary: z.enum(['pass', 'fail', 'pending', 'none', 'unknown']), items: z.array(ScmCheckSchema) }),
  }).nullable(),
  error: z.string().nullable(), // why there is no answer (not "no PR")
});
export type ScmPrState = z.infer<typeof ScmPrStateSchema>;
export const ScmPrStateInputSchema = z.strictObject({ appSessionId: AppSessionIdSchema, refresh: z.boolean() });
export type ScmPrStateInput = z.infer<typeof ScmPrStateInputSchema>;

export const commands = {
  'scm.status': { input: Session, output: ScmStatusSchema, owner: 'main' },
  'scm.stage': { input: ScmPathsInputSchema, output: ScmMutationSchema, owner: 'main' },
  'scm.unstage': { input: ScmPathsInputSchema, output: ScmMutationSchema, owner: 'main' },
  'scm.discard': { input: ScmDiscardInputSchema, output: ScmMutationSchema, owner: 'main' },
  'scm.commit': { input: ScmCommitInputSchema, output: ScmMutationSchema, owner: 'main' },
  'scm.push.plan': { input: ScmPushPlanInputSchema, output: ScmPlanResultSchema, owner: 'main' },
  'scm.push': { input: ScmRunInputSchema, output: ScmRunStartedSchema, owner: 'main' },
  'scm.pr.plan': { input: ScmPrPlanInputSchema, output: ScmPlanResultSchema, owner: 'main' },
  'scm.pr.create': { input: ScmRunInputSchema, output: ScmRunStartedSchema, owner: 'main' },
  'scm.remote.cancel': { input: ScmRunInputSchema, output: z.void(), owner: 'main' },
  'scm.remote.last': { input: Session, output: ScmRemoteLastSchema, owner: 'main' },
  'scm.pr.state': { input: ScmPrStateInputSchema, output: ScmPrStateSchema, owner: 'main' },
} as const satisfies Record<`scm.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
export const events = { 'scm.remote.output': ScmRemoteOutputSchema } as const satisfies Record<`scm.${string}`, z.ZodType>;
