// The paths of the suites' seams (test/support/worker-under-test.ts); Node and workerd share them.
/** Where the suites' `Machine` takes an armed send fault. */
export const SEND_FAULT_PATH = '/__test/send-fault';
/** Where the suites' `Machine` takes a shortened heartbeat and lease (`?heartbeatMs=&leaseMs=`), before its stream opens. */
export const TIMING_PATH = '/__test/timing';
/** Where the suites' `Project` says which instance it is. */
export const PROJECT_LIFE_PATH = '/__test/life';
/** Where the suites' `Project` takes a renewal or close of a lease, as its `Machine` would send one. */
export const PROJECT_LEASE_PATH = '/__test/lease';
/** Where the suites' `Registry` takes a member (`{email, role}`). */
export const MEMBER_PATH = '/__test/member';
