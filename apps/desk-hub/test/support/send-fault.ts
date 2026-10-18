// The paths of the suites' seams (test/support/worker-under-test.ts); Node and workerd share them.
/** Where the suites' `Machine` takes an armed send fault. */
export const SEND_FAULT_PATH = '/__test/send-fault';
/** Where the suites' `Machine` takes a shortened heartbeat and lease (`?heartbeatMs=&leaseMs=`), before its stream opens. */
export const TIMING_PATH = '/__test/timing';
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
/** Where the suites' `Machine` releases a held send: answers `released`, or `none` while no send is held. */
export const SEND_RELEASE_PATH = '/__test/send-release';
/** Where the suites' `Project` holds, or releases, its lookups of the archive machine (`{hold: boolean}`). */
export const PROJECT_ARCHIVE_HOLD_PATH = '/__test/archive-hold';
/** Where the suites' `Project` lists its send queues (`<machine>#<generation>`). */
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
