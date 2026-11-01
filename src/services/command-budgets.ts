// The spine's commands whose own waits run past a host request's 10 s (REQUEST_TIMEOUT_MS), each with the budget that
// covers them (the panel's sweep#3 on P5 O3-D). On the daemon shape main reaches these commands through its `machine`
// host, whose spec carries this table (src/main/hosts/daemon.ts), so a take-over whose `claude stop` takes 11 s is
// answered as mawsd finishes it rather than `timeout` while mawsd goes on; in the embedded shape they run in main
// with no deadline of their own. A command not named here answers within the default: its own work is short, and
// only stalled inner host calls (each bounded at 10 s) take it past that.
import { CONNECTOR_OPERATION_DEADLINE_MS } from '@shared/artifacts/connectors';
import { REQUEST_TIMEOUT_MS } from '@shared/host/host-supervisor';
import type { CommandName } from '@shared/ipc/schema';
// P5 O4 M2 (acceptance 9): the connectors' and delivery's bounds from their constants modules alone, never their services
import { CONNECT_CALLBACK_TIMEOUT_MS, DIRECT_OPERATION_DEADLINE_MS, DIRECT_RESOLVE_DEADLINE_MS, OAUTH_HOST_CLOSE_TIMEOUT_MS, OAUTH_REQUEST_TIMEOUT_MS, OWNER_QUERY_DEADLINE_MS } from './connectors/deadlines';
import { DELIVERY_STATUS_DEADLINE_MS, GONE_WAIT_MS, GWS_LOGIN_DEADLINE_MS, GWS_STATUS_TIMEOUT_MS, GWS_UPLOAD_TIMEOUT_MS, KILL_GRACE_MS } from './delivery/deadlines';
import { GIT_TIMEOUT_MS } from './git/runner';
import { GH_READ_TIMEOUT_MS } from './scm/pr-state';
import { COMMIT_TIMEOUT_MS, LOCAL_TIMEOUT_MS, SCM_ADMIT_MS } from './scm/service';
import { BRIDGE_SLACK_MS, LANE_A_TIMING } from './lane-a/driver';
import { CONFIGURE_WAIT_MS } from './settings/engine-configure';
import { EXIT_WAIT_MS, STOP_WAIT_MS, WATCHDOG_MS } from './sessions/context';
import { CLEAR_WAIT_MS, PAUSE_WAIT_MS } from './sessions/pause-take-over';
import { PAUSED_READY_MS } from './sessions/resume';
import { STOP_TIMEOUT_MS, TAKE_OVER_WAIT_MS } from './sessions/take-over';

// Over a command's named waits: the inner host calls around them (milliseconds each while the hosts answer), a git
// kill's grace, and the answer's way back to main.
const MARGIN_MS = 10_000;
// A bridge command lane A posts: the bridge's own wait, and its socket's slack past it.
const BRIDGE_MS = LANE_A_TIMING.commandWaitMs + BRIDGE_SLACK_MS;
// A pane take-over (W14): the CLI's pause, the resume (the configure gate, a launch and its one retry, each ready within
// PAUSED_READY_MS), the old row's clearing, and a rollback's stop wait.
const PANE_TAKE_OVER_MS = PAUSE_WAIT_MS + CONFIGURE_WAIT_MS + 2 * PAUSED_READY_MS + CLEAR_WAIT_MS + STOP_WAIT_MS;

// P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §H; D11): the checkouts' commands, each
// the sum of its longest sequential chain of bounded phases as the code runs it (a git call GIT_TIMEOUT_MS, a gh read
// GH_READ_TIMEOUT_MS; calls made in parallel count once), and for a mutation its admission (SCM_ADMIT_MS, which covers
// the checkout's key resolution and the repository's chain). A budget short of a legitimate wait would answer `timeout`
// for a commit mawsd then finishes, inviting a retry.
const GIT = GIT_TIMEOUT_MS;
const GH = GH_READ_TIMEOUT_MS;
const STATUS = 3 * GIT; // GitService.status: rev-parse, then status beside stash list, then the remote's URL
const TRUST = GIT; // trustedKeyOf's rev-parse (the store read is a file's)
const KEYS = GIT; // ScmService.keysOf's rev-parse
const PROBE = GH; // gh --version beside gh auth status
const MUTATION = (commands: number, timeoutMs: number) => SCM_ADMIT_MS + TRUST + STATUS + commands * timeoutMs + STATUS;
const CHECKOUTS_BUDGETS_MS = {
  'git.status': STATUS + MARGIN_MS,
  'git.watch': STATUS + MARGIN_MS, // the first status; the projection's and the nested checkouts' reads are the filesystem's
  'git.branches': GIT + MARGIN_MS,
  'git.diff': STATUS + GIT + MARGIN_MS, // the untracked scope: the status that confines it, then the diff (the others: one round)
  'git.log': GIT + MARGIN_MS,
  'git.lsFiles': GIT + MARGIN_MS, // ls-files, or a walk bounded by its entries
  // trust beside the gh probe, then the remotes, the default remote and its HEAD
  'scm.status': Math.max(TRUST, PROBE) + 3 * GIT + MARGIN_MS,
  'scm.stage': MUTATION(1, LOCAL_TIMEOUT_MS) + MARGIN_MS,
  'scm.unstage': MUTATION(1, LOCAL_TIMEOUT_MS) + MARGIN_MS,
  'scm.discard': MUTATION(2, LOCAL_TIMEOUT_MS) + MARGIN_MS, // restore, then clean
  'scm.commit': MUTATION(1, COMMIT_TIMEOUT_MS) + GIT + MARGIN_MS, // the hooks, then the new commit's log read
  // trust and status, the upstream, the remotes, the push URLs and the fetch URL, the branch's name, the checkout's keys
  'scm.push.plan': TRUST + STATUS + 5 * GIT + KEYS + MARGIN_MS,
  // trust and status, the gh probe, the upstream, gh repo view, the base's name, the push URLs and the fetch URL, the keys
  'scm.pr.plan': TRUST + STATUS + PROBE + GIT + GH + 3 * GIT + KEYS + MARGIN_MS,
  // admitted, then the revalidation (trust, status, the push URLs); the run answers at its start
  'scm.push': SCM_ADMIT_MS + TRUST + STATUS + GIT + MARGIN_MS,
  'scm.pr.create': SCM_ADMIT_MS + TRUST + STATUS + GIT + MARGIN_MS,
  'scm.remote.cancel': KEYS + MARGIN_MS,
  'scm.remote.last': KEYS + MARGIN_MS,
  // trust beside the probe, status, the remotes, the keys, then gh pr view and gh pr checks
  'scm.pr.state': Math.max(TRUST, PROBE) + STATUS + GIT + KEYS + 2 * GH + MARGIN_MS,
  'files.upload': GIT + MARGIN_MS, // the exclude's git read (M3's write)
} as const satisfies Partial<Record<CommandName, number>>;

// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §H): the connectors' and delivery's
// commands whose chains pass the default, by the same rule. A host read is REQUEST_TIMEOUT_MS; a gws run that times out
// is signalled, given KILL_GRACE_MS to SIGKILL and GONE_WAIT_MS to leave; a credential for route D is a refresh, then
// the old epoch's close in the host. Owner actions (Connect, Reconnect, Disconnect, sign-in) answer at once and run on.
const HOST = REQUEST_TIMEOUT_MS;
const GWS_RUN = (timeoutMs: number) => timeoutMs + KILL_GRACE_MS + GONE_WAIT_MS;
const CREDENTIAL = OAUTH_REQUEST_TIMEOUT_MS + OAUTH_HOST_CLOSE_TIMEOUT_MS;
// Route D: the resolution, the credential, then the operation to its outcome
const DIRECT = DIRECT_RESOLVE_DEADLINE_MS + CREDENTIAL + DIRECT_OPERATION_DEADLINE_MS;
// The grant's check, then the engine route (the artifact's entry, its space, the live sessions, a session's resolve,
// the start; the operation to its outcome; the take) or route D, the longer
const CONNECTOR_CALL = HOST + Math.max(5 * HOST + CONNECTOR_OPERATION_DEADLINE_MS + HOST, DIRECT);
// Notion's source found: the live sessions, the artifact's links, their observations (in parallel), then route D's locate
const NOTION_FIND = 3 * HOST + DIRECT_RESOLVE_DEADLINE_MS;
const CONNECTORS_BUDGETS_MS = {
  'connectors.call': CONNECTOR_CALL + MARGIN_MS,
  'connectors.refresh': CONNECTOR_CALL + MARGIN_MS, // a watch's refresh runs a call under the same budget
  'connectors.servers': OWNER_QUERY_DEADLINE_MS + MARGIN_MS, // the query answers with what it has at its deadline
  // Drive: gws's state; Notion: the find, under the sheet's deadline
  'delivery.status': Math.max(GWS_RUN(GWS_STATUS_TIMEOUT_MS), DELIVERY_STATUS_DEADLINE_MS) + MARGIN_MS,
  // Drive: gws's state, then its login; Notion: the find, then MAWS's OAuth flow (the metadata, the registration, the
  // owner's consent to its callback, the token exchange)
  'delivery.connect': Math.max(GWS_RUN(GWS_STATUS_TIMEOUT_MS) + GWS_RUN(GWS_LOGIN_DEADLINE_MS), NOTION_FIND + 3 * OAUTH_REQUEST_TIMEOUT_MS + CONNECT_CALLBACK_TIMEOUT_MS + OAUTH_REQUEST_TIMEOUT_MS) + MARGIN_MS,
  // `artifacts.get`, then Drive's state and upload, or Notion's find and route D's send
  'delivery.deliver': HOST + Math.max(GWS_RUN(GWS_STATUS_TIMEOUT_MS) + GWS_RUN(GWS_UPLOAD_TIMEOUT_MS), NOTION_FIND + DIRECT) + MARGIN_MS,
} as const satisfies Partial<Record<CommandName, number>>;

// P5 O4 M3 (Interfaces §H): the catalog's machine half. One cwd's view as EngineReads.snapshot reads it: the engine's
// configuration (`plugins.env`, the first read of a load), then the cwd's listings and its inventory beside the configured
// servers (one round), then the installed directory entries' provenance beside each marketplace's manifest (one round),
// each a host read. The library's reads (a host read, then a file or the client's answer) stay within the default.
const CATALOG_BUDGETS_MS = {
  'catalog.engine': 3 * HOST + MARGIN_MS,
} as const satisfies Partial<Record<CommandName, number>>;

// P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md): the library's Export, answered by mawsd's render seam:
// the render host's start (the seam's deadline for it, src/mawsd/render-seam.ts's START_DEADLINE_MS.libraryExport),
// then the export within the library's own budget (src/render/export.ts's EXPORT_BUDGET_MS); neither module is this
// chunk's to load, so their values are restated here.
const RENDER_START_MS = 55_000;
const RENDER_EXPORT_MS = 55_000;

export const COMMAND_BUDGETS_MS: Readonly<Partial<Record<CommandName, number>>> = {
  ...CHECKOUTS_BUDGETS_MS,
  ...CONNECTORS_BUDGETS_MS,
  ...CATALOG_BUDGETS_MS,
  'artifacts.export': RENDER_START_MS + RENDER_EXPORT_MS + MARGIN_MS, // P5 O5 M4
  'daemon.e2eRender': RENDER_START_MS + RENDER_EXPORT_MS + MARGIN_MS, // P5 O5 M4: the e2e's capture, within the same bounds
  // a background job's `claude stop` and the registry's clearing after it, or a terminal pane's pause and resume
  'session.takeOver': Math.max(STOP_TIMEOUT_MS + TAKE_OVER_WAIT_MS, PANE_TAKE_OVER_MS) + MARGIN_MS,
  // a process still exiting, the configure gate, and the launch to ready (the watch fails one silent for WATCHDOG_MS;
  // a launch whose SessionStart hooks keep it reporting for longer answers `timeout` here and still becomes ready)
  'session.acquire': EXIT_WAIT_MS + CONFIGURE_WAIT_MS + WATCHDOG_MS + MARGIN_MS,
  // P5 O7 M4: a spawn answers at its setup's `launching`: the configure gate, a new worktree's git, and the trust
  // bootstrap's launch (watched for WATCHDOG_MS) before the record
  'session.spawn': CONFIGURE_WAIT_MS + GIT_TIMEOUT_MS + WATCHDOG_MS + MARGIN_MS,
  'settings.engineApplied': CONFIGURE_WAIT_MS + MARGIN_MS, // the engine host's verdict on the settings
  'laneA.interrupt': BRIDGE_MS + MARGIN_MS,
  'laneA.command': BRIDGE_MS + MARGIN_MS,
  'laneA.btw': BRIDGE_MS + MARGIN_MS,
  'laneA.compact': BRIDGE_MS + MARGIN_MS,
  'laneA.stopAgent': BRIDGE_MS + MARGIN_MS,
  'laneA.tell': BRIDGE_MS + MARGIN_MS,
  'laneA.read': BRIDGE_MS + MARGIN_MS,
  'laneA.stopTask': BRIDGE_MS + MARGIN_MS, // after the transcript's catch-up, which reads the jobs it holds
  'laneA.answer': LANE_A_TIMING.requestMs + LANE_A_TIMING.decisionMs + MARGIN_MS, // the request read again, then the decision
  'laneA.model': 2 * BRIDGE_MS + MARGIN_MS, // the status read, then the change (one change at a time per session)
  // the status read, the uploads' git exclude, and the post with its retries
  'laneA.media': BRIDGE_MS + GIT_TIMEOUT_MS + 3 * BRIDGE_MS + LANE_A_TIMING.lane.retryDelaysMs.reduce((sum, ms) => sum + ms, 0) + MARGIN_MS,
};
