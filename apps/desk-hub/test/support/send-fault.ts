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
