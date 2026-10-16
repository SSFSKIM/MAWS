# DC3 xhigh panel (wf_c388e070-28b), master@5bd3d66f..645a1557: verdict incorrect, 13 confirmed

## scalpel-4#1 P1 — Preserve uncertainty when a retry cannot be delivered
File: apps/desk-hub/src/objects/project.ts lines 553-559; sources scalpel-4
In apps/desk-hub/src/objects/project.ts:551–563, retrying an uncertain record overwrites it with forwarded, and an offline send then makes it terminal failed. My probe reproduced this transition and confirmed a subsequent genuine done result was ignored and acknowledged by rpcResult. An unavailable retry transport proves nothing about the original spawn/steer effect, so this can falsely report failure and encourage repetition under another nonce.

## scalpel-5#1 P1 — Enforce the enrollment body limit during consumption
File: apps/desk-hub/src/worker.ts lines 46-48; sources scalpel-5, sweep, scalpel-1
In apps/desk-hub/src/worker.ts:45–48, the 64 KiB check follows an unbounded arrayBuffer() read. My unauthenticated enrollment probe consumed all 512 KiB before rejecting. Anonymous large or concurrent chunked requests can therefore exhaust isolate memory before token validation. apps/desk-hub/src/objects/machine.ts:122–124 similarly reads the entire POST as text before checking its 4 MiB budget.

## sweep#2 P2 — Reject the handshake when the stream ends before welcome
File: apps/desk-hub/fake-machine/link.ts lines 50-58; sources sweep
In apps/desk-hub/fake-machine/link.ts:50–58, the welcome promise has only a resolve path. My immediately closed SSE response invoked onClose but left connect() pending. If this happens inside FakeMachine.reconnectLoop(), its await never finishes and reconnecting remains true, preventing recovery.

## scalpel-1#1 P2 — Fence delayed stream opens against credential revocation
File: apps/desk-hub/src/worker.ts lines 145-148; sources scalpel-1
In apps/desk-hub/src/worker.ts:145–151, forwarded identity contains no credential/enrollment epoch. Machine.revoke() only ends the current stream, and Machine.open() records no revocation fence. An already-resolved stream request delivered after revocation therefore opens successfully; my direct lifecycle probe returned 200/welcome after revoke. An already-authorized, delayed POST naming that predictable generation can then hello and restore replication. Re-enrollment under the same name does not distinguish these old requests either.

## scalpel-2#1 P2 — Recheck the connection generation after the archive lookup
File: apps/desk-hub/src/objects/project.ts lines 286-288; sources scalpel-2
In apps/desk-hub/src/objects/project.ts:286–288, the archive lookup yields after the generation/open checks, without rechecking before mutation. My controlled lookup advanced the lease to generation 2 before releasing generation 1's upload; the retired upload appended its event and returned applied:1, stale:false. A retired reply also removes the current generation's queue at line 898; a separate probe confirmed m#2 disappeared after an m#1 reply.

## scalpel-2#2 P2 — Guard the entire route teardown against replacement ownership
File: apps/desk-hub/src/objects/project.ts lines 874-880; sources scalpel-2
In apps/desk-hub/src/objects/project.ts:874–880, only the in-memory map deletion is ownership-guarded. I held the original subscribe send, ended its lease, accepted a replacement using the same sub, then resolved the old send offline. Its callback left the replacement in memory but deleted its durable route and attachment entry. Hibernation consequently loses the accepted replacement's routing.

## scalpel-3#1 P2 — Honor the hub's vector when allocating the next sequence
File: apps/desk-hub/fake-machine/machine.ts lines 499-500; sources scalpel-3
In apps/desk-hub/fake-machine/machine.ts:198–213, connect() does not await the asynchronous import chain, while line 499 allocates solely from the local vector. With delayed bootstrap import and hub have={"m/a":100}, my probe connected and immediately allocated seq 1. The new event is persisted locally but conflicts with the existing hub position rather than extending the writer at 101.

## scalpel-3#2 P2 — Recover uploads after transport-level POST failures
File: apps/desk-hub/fake-machine/machine.ts lines 821-823; sources scalpel-3
In apps/desk-hub/fake-machine/machine.ts:818–824, flush removes frames before posting and only invokes recovery for LinkError. A rejected fetch is normally a TypeError. My failed-fetch probe left one persisted event, an empty outbox, one recorded error, and no drop/reconnect. With SSE still healthy, the final event or multipart suffix can remain unuploaded indefinitely.

## scalpel-4#2 P2 — Recheck pending ownership after digest verification
File: apps/desk-hub/fake-machine/machine.ts lines 693-695; sources scalpel-4
In apps/desk-hub/fake-machine/machine.ts:687–695, pending ownership is captured before awaiting the input hash. My controlled digest probe let a terminal deny settle first; the resumed web allow still returned done and recorded an executed trace because settle silently returned for the missing request. The RPC ledger can therefore retain success for a decision that lost the settlement race.

## scalpel-4#3 P2 — Bind a decision's digest to its target session
File: apps/desk-hub/fake-machine/machine.ts lines 687-689; sources scalpel-4
In apps/desk-hub/fake-machine/machine.ts:607 and 681–689, args.session is checked only for existence, while the pending request is selected and validated through digest.session. My signed RPC naming session A with session B's valid permission digest returned done and settled B. This contradicts the declared session target and makes the fake machine accept cross-session routing mistakes.

## scalpel-5#2 P2 — Bound aggregate retention of incomplete part sets
File: apps/desk-hub/src/protocol/parts.ts lines 75-78; sources scalpel-5
In apps/desk-hub/src/protocol/parts.ts:68–83, each new id retains a set until completion, with no aggregate budget or expiry. My probe retained 1,000 unfinished count:2 sets carrying 62.5 MiB of data. This can accumulate across machine POSTs or browser frames. The documented deferral concerns one set's count/joined-size cap, not aggregate retention of many individually small abandoned sets.

## scalpel-5#3 P2 — Bound replay work before enqueueing the entire backlog
File: apps/desk-hub/src/objects/project.ts lines 277-278; sources scalpel-5, sweep
In apps/desk-hub/src/objects/project.ts:277–278, hello queues the complete missing history without awaiting transport. My blocked-send probe exhausted 2,000 batches representing 500 MiB while only the first send had started. Closures retain those batches, so a sufficiently large history can repeatedly exhaust the Project object's memory during bootstrap. Browser resume at lines 777–781 likewise enqueues its entire suffix without an aggregate replay budget.

## scalpel-5#4 P2 — Abort outstanding writes when ending a machine stream
File: apps/desk-hub/src/objects/machine.ts lines 240-242; sources scalpel-5
In apps/desk-hub/src/objects/machine.ts:237–242, end() requests a graceful writer.close() behind outstanding writes. Using the actual Machine.write/end methods with an unread TransformStream, my probe cleared the current stream but left the write pending until the readable was canceled. A replacement or revocation therefore does not release a stalled old stream's Project send chain or POSTs waiting on it.
