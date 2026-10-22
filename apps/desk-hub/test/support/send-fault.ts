// The paths of the suites' seams (test/support/worker-under-test.ts); Node and workerd share them.
/** Where the suites' `Machine` takes an armed send fault. */
export const SEND_FAULT_PATH = '/__test/send-fault';
/** Where the suites' `Machine` takes a shortened heartbeat and lease (`?heartbeatMs=&leaseMs=`, and optionally
 * `&graceMs=&probeMs=&writeTimeoutMs=`), before its stream opens. */
export const TIMING_PATH = '/__test/timing';
/** Where the suites' `Machine` is armed to find itself replaced at its next probe, as an instance Cloudflare replaced
 * under its stream would. */
export const MACHINE_REPLACE_PATH = '/__test/replace';
/** Where the suites' `Machine` probes once and says its own instance and the one the probe reached. */
export const MACHINE_PROBE_PATH = '/__test/probe';
/** Where the suites' `Machine` is armed to throw from its next request to a path (`?path=`), as a reset object's call
 * fails at the Worker. */
export const MACHINE_FETCH_FAULT_PATH = '/__test/fetch-fault';
/** Where the suites' `Machine` is terminated: `ctx.abort()`, which ends the instance and its stream unannounced. */
export const MACHINE_ABORT_PATH = '/__test/abort';
/** The reason the suites' `Machine` aborts with. */
export const ABORT_REASON = 'terminated by the suite';
/** Where the suites' `Project` says which instance it is. */
export const PROJECT_LIFE_PATH = '/__test/life';
/** Where the suites' `Project` takes a renewal or close of a lease, as its `Machine` would send one. */
export const PROJECT_LEASE_PATH = '/__test/lease';
/** Where the suites' `Project` holds a `hello` at its registration (`{hold: boolean}`), as a slow Registry would. */
export const PROJECT_HOLD_PATH = '/__test/hold';
/** Consume the Project's alarm after ageing command receipts, then inspect its raw receipt table. */
export const PROJECT_RECEIPTS_PATH = '/__test/receipt-alarm';
/** Where the suites' `Project` takes a shorter window for a socket's `visibility` (`{ms}`), before the browser sends it. */
export const PROJECT_VISIBLE_PATH = '/__test/visible-window';
/** Where the suites' `Registry` takes projects straight into its table (`{count, prefix}`), for a grid of any size. */
export const PROJECTS_PATH = '/__test/projects';
/** Where the suites' `Registry` takes a member (`{email, role}`). */
export const MEMBER_PATH = '/__test/member';
/** Where the suites' `Project` says how many calls from machines it took, and how many frames they carried. */
export const PROJECT_CALLS_PATH = '/__test/calls';
/** Where the suites' `Registry` rewrites its org's stored record (`{id, name}`), as a deploy's previous version made it. */
export const ORG_ROW_PATH = '/__test/org-row';
/** Where the suites' `Machine` holds its next send of one frame kind (`?kind=`) until it is released. */
export const SEND_HOLD_PATH = '/__test/send-hold';
/** Where the suites' `Machine` stalls its next write of one frame kind (`?kind=`): the stream never takes it, as one whose
 * client stopped reading would not, so the write bound ends the stream. */
export const WRITE_STALL_PATH = '/__test/write-stall';
/** Where the suites' `Project` lists its `machines` rows (`[{name, generation}]`): the streams it fans out to. */
export const PROJECT_MACHINES_PATH = '/__test/machines';
/** Where the suites' `Machine` releases a held send: answers `released`, or `none` while no send is held. */
export const SEND_RELEASE_PATH = '/__test/send-release';
/** Where the suites' `Project` holds, or releases, its lookups of the archive machine (`{hold: boolean}`). */
export const PROJECT_ARCHIVE_HOLD_PATH = '/__test/archive-hold';
/** Where the suites' `Project` lists its send queues (`<machine>#<generation>#<lane>`). */
export const PROJECT_QUEUES_PATH = '/__test/queues';
/** Where the suites' `Project` queues a frame for a machine's stream of any generation (`{machine, generation, frame}`),
 * as a reply on a retired stream would be queued. */
export const PROJECT_SEND_PATH = '/__test/send';
/** Where the suites' `Project` says how many pages of a `hello`'s backlog it has read. */
export const PROJECT_BACKLOG_PATH = '/__test/backlog-pages';
/** Where the suites' `Project` is armed to fail its next `forget`, as a failed RPC from the Registry would. */
export const PROJECT_FORGET_FAULT_PATH = '/__test/forget-fault';
/** Where the suites' `Machine` is armed (`?mode=hold`) to hold its next revocation's answer until it is released, as a
 * slow RPC would, or (`?mode=lose`) to lose it once the revocation is stored, as an RPC whose answer never came back. */
export const REVOKE_FAULT_PATH = '/__test/revoke-fault';
/** Where the suites' `Machine` says whether a revocation's answer is held: `held` or `none`. */
export const REVOKE_HELD_PATH = '/__test/revoke-held';
/** Where the suites' `Machine` releases a held revocation's answer: answers `released`, or `none` while none is held. */
export const REVOKE_RELEASE_PATH = '/__test/revoke-release';
/** Where the suites' `Registry` drops a project's row (`{id}`), as a hub from before machine projects never held one. */
export const UNREGISTER_PATH = '/__test/unregister';
/** Where the suites' `Registry` takes a project's summary report (`{project, report}`), as one delivered late would
 * arrive, and answers the org's directory after it. */
export const REPORT_PATH = '/__test/report';
/** Where the suites' `Registry` drops `live` from its `summaries`, as a registry stored before that column had it; its
 * next construction adds the column again. */
export const SUMMARIES_BEFORE_LIVE_PATH = '/__test/summaries-before-live';
/** Where the suites' `Registry` is armed to take its next summary report as the version before `live` took it: the
 * counts stored without `live`, nothing answered. */
export const SUMMARY_AS_PREVIOUS_PATH = '/__test/summary-as-previous';
/** Where the suites' `Registry` moves times back (`{machines?: [{name, seen?, confirmed?}], key?: {id, expires},
 * enrollment?: {machine, expires}}`, all in one step), as an hour or a pending window having passed would leave them, schedules its alarm as its own
 * changes do, and answers the alarm (`{alarm}`, ms or null). The Registry reads `Date.now()`, and a key's offline time is
 * an hour at least. */
export const BACKDATE_PATH = '/__test/backdate';
/** Where the suites' `Registry` answers its alarm (`{alarm}`, ms or null); a POST of `{clear: true}` deletes it first. */
export const ALARM_PATH = '/__test/alarm';
/** Where the suites' `Registry` is armed to hold its next `leave` until it is released, as the Worker would be held
 * between resolving a machine's credential and asking for its revocation. */
export const LEAVE_HOLD_PATH = '/__test/leave-hold';
/** Where the suites' `Registry` takes how long an unfinished offline revocation waits before it is tried again
 * (`{ms}`, or `{ms: null}` for the deployed minute), and wakes its alarm. */
export const OFFLINE_RETRY_PATH = '/__test/offline-retry';
/** Where the suites' `Machine` is armed (`{times}`) to throw from its next `times` calls of `directory`, as the
 * Registry's push to an object a code update reset fails (0 disarms); every request there (`{}` arms nothing) answers
 * `{remaining, calls}`: the throws still armed, and the calls taken since it was last armed. */
export const DIRECTORY_FAULT_PATH = '/__test/directory-fault';
/** Where the suites' `Registry` is armed (`{project, times}`) to throw from its next `times` summary reports of the
 * project, as a project's report to a Registry a code update reset fails (0 disarms); every request there answers
 * `{remaining, calls}` for the project. */
export const SUMMARY_FAULT_PATH = '/__test/summary-fault';
/** Where the suites' `Registry` or `Project` takes how long the first retry of a failed push or report waits (`{ms}`),
 * over the deployed second. */
export const RETRY_BASE_PATH = '/__test/retry-base';
/** Where the suites' `Project` says whether a retry of a failed summary report waits for its time (`{waiting}`). */
export const REPORT_RETRY_PATH = '/__test/report-retry';
/** Where the suites' `Registry` says whether a `leave` is held: `held` or `none`. */
export const LEAVE_HELD_PATH = '/__test/leave-held';
/** Where the suites' `Registry` releases a held `leave`: answers `released`, or `none` while none is held. */
export const LEAVE_RELEASE_PATH = '/__test/leave-release';
