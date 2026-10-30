# The long-transcript window: opening a long session answers its newest window, older history pages in

Spec: this document (a bug fix the architect diagnosed and ruled on 2026-10-30; root spec `docs/charter.md`, children C3
`session.events`, C4 the fs follow, C6 the transcript's hydration protocol, contracts X2 and X13).
Branch `fix/long-transcript-load`, cut from master 8a8a9feaa.

## The bug

Opening an older Claude Code session in MAWS showed "Could not load this transcript · engine-host did not answer
session.events within 10 s" with Retry, and the transcript stayed empty. The owner's sessions are long:
`~/.claude/projects` on the MacBook holds 516 transcripts over 20 MB (median 32 MB, p90 62 MB, the largest 655 MB) and
1,945 over 5 MB, and subagent transcripts reach 191 MB.

## Diagnosis

The engine host's loop was never blocked by reading a transcript. Its longest stall during a 625 MB backfill was 30 ms,
because the reads go in 1 MB pages through the fs promises. The failure was the volume the backfill shipped.

A follow sent the whole history twice over the host's single ordered socket:
- once as `session.eventBatch` lines while it backfilled;
- again as one JSON line in the `session.events` answer.

That second answer held whatever had been delivered after a 2 s wait, so the *oldest* records came first.

Three failures follow from that:
1. **Line cap.** For transcripts from about 100 MB, the answer was one line of 60–190 MB, over the 64 MiB line cap
   (`LINE_CAP`). The reader closed the connection: mawsd in the daemon shape, main in the embedded one. Every request in
   flight on that host failed, and every session resynced.
2. **Write cap.** The engine host closed the connection itself once its socket queue passed 256 MB (`WRITABLE_CAP`).
3. **Head-of-line blocking.** Below the caps, every answer for every session waited behind 100+ MB of event lines.

On the owner's daemon run of 2026-10-30, mawsd logged 20 "dropped engine-host's response to unknown request" lines,
16 of them between 18:48:52Z and 18:49:06Z. Those are answers that arrived after the 10 s deadline.

### Measurements before the fix (M-series MacBook, real transcripts timed read-only, named by size only)

| JSONL | events | event JSON | backfill | longest loop stall | answer line (at 2 s / complete) | heap kept while followed |
|---|---|---|---|---|---|---|
| 625 MB | 54,695 | 122 MB | 4.25 s | 30 ms | 60 MB / 122 MB | 158 MB |
| 621 MB | 55,700 | 121 MB | 3.86 s | 19 ms | 26 MB / 121 MB | |
| 383 MB | 50,297 | 139 MB | 1.95 s | 28 ms | 139 MB | 170 MB |
| 255 MB | 38,212 | 85 MB | 2.01 s | 11 ms | 85 MB | 116 MB |
| 247 MB | 43,091 | 170 MB | 1.43 s | 14 ms | 170 MB | |
| 148 MB (image-heavy) | 3,127 | 80 MB | 0.89 s | 15 ms | 80 MB | 84 MB |
| 119 MB | 32,497 | 83 MB | 1.10 s | 24 ms | 83 MB | 124 MB |

**Where the time went** (625 MB transcript):

| step | cost |
|---|---|
| Reading the file | 0.28 s |
| JSON.parse | 2.9 s. 66% of the bytes are `api-request` and `file-history-snapshot` lines, which map to nothing. |
| Record schema | 0.14 s |
| Chain and mapping | about 1 s |
| The full answer, per hop | Engine host: validate and encode 0.54 s, one synchronous block. Main: decode, read, re-validate and clone toward the renderer 0.98 s. Renderer: validate and apply 0.43 s. |

**The round trip across real processes and sockets** (engine host → mawsd-like relay → main, with a 250 ms ping
beside it):

| transcript | outcome |
|---|---|
| 625 MB | Answered at 5.7 s; pings waited up to 3.7 s. |
| 255 MB, 148 MB, 119 MB | The relay closed the connection on "a line over 67108864 bytes". |
| 247 MB | The engine host closed the connection: "the peer stalled 345 MB behind". |

**The "Error · The turn ended with an error · 3 weeks ago" row under the failed load.** This is main's attention
service, not the transcript:
- It derives an `error` item from every disk-backfill `turn.ended` whose `isError` is set (a `turn_duration` after an
  `isApiErrorMessage` assistant record). Its time is that record's.
- Only a later human `turn.started` reaching main retires it.
- So a flood the connection cut short, or a session whose last turn really ended so, left a weeks-old item.

The fix removes the first case: only the newest window reaches main. Whether the second case should raise an item is
the owner's call.

## The design

The direction matches the reference apps:
- **Claude Desktop** reads a byte tail of 1, then 5, then 50 MiB, never more than the last 50 MiB, and pages 200 rows at
  a time by uuid.
- **Codex** takes 5 turns at a time with an opaque cursor.
- **T3 Code** takes 10 user turns, then 20 per page.

MAWS keeps its full forward read, because the chain needs every record (rewinds, compactions, branch flips, W7). It
changes what it delivers.

1. **The engine host holds the backfill** (`src/engine-host/fs/follow.ts`):
   - A follow logs what its backfill delivers and emits nothing until it first reaches `following`.
   - It then sends only the newest window as batches; appended records go out as they come.
   - A read before the backfill is done answers an empty, incomplete page, never partial history.
   - A *quiet* follow (a live session's transcript, read only for older pages) emits nothing at all.
2. **Every disk-backed answer is one window** (`src/shared/graph/history-window.ts`):
   - It holds whole turns ending before a cursor or at the newest event, within the soft budget, and at least the newest
     turn within the hard cap.
   - A turn larger than the cap is cut at the cap.
   - It never starts inside a rewind it carries: a `boundary.rewind` in it pulls the start back to the rewound turn,
     which the reducer needs on the same page to hide the abandoned branch.
3. **`session.events` and `fs.agentEvents`** answer the newest window with an `earlier` cursor, or the page `before`
   one. For `session.events` from disk:
   - `limit` N is the first N events, matching the live path;
   - `agentId` is that agent's events plus its parent's reports on it, so a child's drill-in finds its end in a long
     parent;
   - `before` always reads the transcript (through a quiet follow when a live process writes it).
4. **The renderer pages older history in** (`src/renderer/src/transcript/source/older.ts`, `view/source-pages.ts`):
   - A disk-backed source keeps what it handed the store while older history remains.
   - A page goes before all of it, and the source rebuilds: the store hydrates the key again, staged, from the whole
     history in order. Rewinds, compactions and agents straddling a page edge therefore land as a full load lands them.
   - Lane A's rules ask for the pages and keep the reader's place, from inside `Transcript`. A failed page says so in
     lane A's bar with Retry.
   - A snapshot answered empty while the engine host still reads waits for the window's batch or the follow's next
     state.
5. **Lines are skipped unparsed.** A line opening `{"type":"api-request"` or `{"type":"file-history-snapshot"` is known
   by that prefix and never parsed (`src/engine-host/fs/chain-follower.ts`).
6. **Follows are released** two minutes after their session leaves every client's interest (`host.interest`, which the
   idle release already keeps; `src/engine-host/fs/service.ts`).
7. **No line over the cap is ever written** (`src/shared/host/socket-port.ts`, added after the owner hit the bug on
   O3-D's daemon shape):
   - There, one oversized answer closed mawsd's shared link to the engine host and the app's connection with it. Every
     request in flight failed, and events were lost for every session.
   - Every socket writer now checks a line's size against the cap its reader takes (both ends read by `LINE_CAP`).
   - An answer over it goes as its request's error instead: `internal` with `issues.tooLarge {bytes, cap}`, since a new
     error code would take a wire major.
   - Any other message over it is dropped.
   - Both are logged, and the connection stays. This holds for any command, present or future.

### Budgets

Each is one named constant:

| constant | value | basis |
|---|---|---|
| `HISTORY_WINDOW_BYTES` (soft) | 2 MiB of event JSON | The last 50 turns of the largest transcripts measured come to about 2 MB. |
| `HISTORY_WINDOW_MAX_BYTES` (hard) | 16 MiB | A quarter of the 64 MiB line cap, so a page stays one line even when non-ASCII text triples its UTF-8. |
| `FOLLOW_RELEASE_MS` | 2 min | A followed transcript keeps 0.25–1 MB of heap per MB of JSONL. |

### How each shape's consumers see the window

The hold is in the engine host, so it reads the same in every shape.

**Embedded** (utility, or the detached supervisor):
- main's consumers of `session.eventBatch` see a disk-backed session's newest window, then its appends. That covers the
  attention service, the sessions read model's digest, the owner channel and side threads.
- They no longer see weeks of history replayed through them.

**Daemon:**
- mawsd relays the same batches. Since P5 O3-D the attention and digest consumers run in mawsd's spine, subscribed to
  the engine host's `session.eventBatch` through its supervisor, and they see exactly that window there.
- The endpoint's lane B ignores disk events, as before, and now receives bounded answers.

The renderer sees the same in both shapes.

### Contracts this touches

- **X2.** `session.events` input gains optional `before` and `agentId`, and its output (`EventsSnapshotSchema`) an
  optional `earlier`. `fs.agentEvents` input gains `before`, its output `earlier`. All are additive: `WIRE_MINOR` 8,
  the next past P5 O3-D's 7, which landed first.
  - An older engine host ignores the new fields and answers the whole history, as before.
  - An older renderer shows the newest window only.
- **`complete`** keeps its meaning: the follow has read its transcript through.
- **The hydration protocol** (charter §12, the X2 overlap for C6; X13) is unchanged: subscribe and buffer, apply the
  snapshot, drain with deduplication by id.
  - What changes is what a disk-backed snapshot holds (a window, not everything).
  - Older pages arrive as a rebuild of the same key (`TranscriptSource.onRebuild`, `older`; additive).
- **Decision Log entry** (draft for the architect to write at landing):

  > 2026-10-30 (architect, the long-transcript window): a disk-backed `session.events` or `fs.agentEvents` answer is
  > one bounded window of the transcript's history: whole turns within 2 MiB of event JSON, at least the newest within
  > 16 MiB. It carries an `earlier` cursor while older history remains, and `before` asks for the page before it. A
  > follow's backfill is held, not broadcast; only its newest window goes out as `session.eventBatch`. A follow is
  > released two minutes after its session leaves every client's interest. C3's snapshot now holds a window, C6
  > hydrates older pages as a staged rebuild of the key, and X13's `session.events {afterSeq, limit}` reads disk as
  > `limit` = the first N events, `before` = a page back. The hydration protocol is unchanged.

## Progress

- [x] **M1** (dcae77cbf). The engine host holds the backfill and answers windows. Cursors and `before`, `limit` and
  `agentId` on disk, quiet follows, a new `WIRE_MINOR` (8 after the merge of master at P5 O3-D, dec6647f9).
- [x] **The unparsed skip** (6ccc2da4d). The two silent record types are never parsed: the 625 MB backfill drops from
  4.25 s to 3.36 s on its own.
- [x] **M2** (c0ae2d7f5). The renderer shows the newest window first and pages older history in as the reader reaches
  the top. The child asks its parent for its own slice.
- [x] **M3a** (7665599b0). A follow is released two minutes after its session leaves every client's interest.
- [x] **Tests** (60dda896e, with the milestones):
  - The window rule (`history-window.test.ts`, shared).
  - Paging through the fs service: no gap, no overlap; the rewind pull-back; compaction; limit, agentId, unknown
    cursor; quiet follow; release; the unparsed skip.
  - The renderer equivalence across page edges (`transcript/source/older.test.tsx`: rewinds, a compaction, a background
    agent and main's notice straddling pages end in exactly the rows a whole load draws).
  - The transport regression over C1's runtime and a real socket with lowered caps (class 1a, facts only).
  - The same on the daemon shape (`src/mawsd/long-transcript.test.ts`). It runs through mawsd's `[hosts]` link to the
    engine host and the app's `engine-host.sock` relay, with every line cap lowered:
    - the window crosses both hops under the cap;
    - neither connection closes;
    - a request for another session is answered beside it;
    - an answer forced over the cap comes back as its request's error, with the next request answered.
  - The writer guard at the socket (`socket-port.test.ts`).
- [x] **One event past the hard cap** goes alone, so a page always moves the cursor back (4d83129a5).
- [x] **Review fixes** (reviewer-high over the range; one commit each):
  - 5da6810ca: a child's lifecycle evidence is never cut from its slice; the live path's slice is uncapped.
  - c4bc40bd9: only the current subscription's snapshot starts the source's pager over.
  - 8d29eaeab: held batches drop disk events from before the window the snapshot answered, which appends can move on
    during the round trip.
  - 9a403c75c: a child waits out a parent the engine host still reads through before deciding its lifecycle.
  - 3eaaee924: a released follow says so, and a source still attached reads the engine host again at its session's
    next change.
- [x] **M3b** (incremental `fs.sessionText` indexing) is out of this branch by ruling, dispatched separately after
  O3-D.

## Measured after (the same Mac and tools; the relay run is the daemon shape)

| transcript | answered at | answer | window batches | longest ping wait | connection |
|---|---|---|---|---|---|
| 625 MB | 1.87 s | 1,136 events, 2.0 MB | 2.0 MB | 116 ms | up |
| 621 MB | 1.65 s | 1,179 events, 2.0 MB | 2.0 MB | 138 ms | up |
| 255 MB | 1.44 s | 999 events, 1.9 MB | 1.9 MB | 7 ms | up |
| 247 MB | 1.48 s | 1,103 events, 2.0 MB | 2.0 MB | 5 ms | up |
| 148 MB | 0.41 s | 398 events, 1.3 MB | 1.3 MB | 3 ms | up |
| 119 MB | 0.97 s | 526 events, 1.9 MB | 1.9 MB | 10 ms | up |
| synthetic 655 MB | 1.07 s | 464 events, 1.95 MB | 1.9 MB | 68 ms | up |

On the 625 MB transcript:
- The backfill takes 1.74 s, down from 4.25 s: nothing is emitted while it runs, and the silent lines are not parsed.
- The longest loop stall is 8 ms.
- The engine host validates and encodes each answer in 8 ms, down from 543 ms.

## Residue

1. **Memory per open follow.** A follow still keeps its whole event log while its session is open: 0.25–1 MB of heap
   per MB of JSONL. A per-follow history budget (the newest N MiB kept, older pages re-read) is the next step if
   open-session memory matters.
2. **Jumps into history.** A jump to a row older than what is loaded (a search hit, an attention item in history) finds
   nothing until that page is in. Claude Desktop's "find" pages back until found, bounded; that is a follow-up.
3. **Refresh after a release.** A source still attached when its follow was released reads the newest window again
   at its session's next change, keeping what the reader opened. The older pages it had loaded go; the reader pages
   them in again.
4. **Two follows of one transcript.** A session whose live stream was dropped while a quiet follow existed gets a
   normal follow beside the quiet one until the release. Rare, bounded by the release.
5. **First paint on the very largest transcripts.** Sub-second first paint above about 300 MB would take a tail-first
   read (Claude Desktop's ladder) or a persisted follow checkpoint.
