# The desk — provisioning keys (2026-10-21)

> **Composite:** `docs/doperpowers/specs/2026-10-15-desk-design.md`, of which this is a child: an extension of
> **DX7 — Identity** (its enrollment contract), under §6 (Security, phase 1). **Parent pin:** blob `f4b4afdd7` of that
> file (commit `44e4a3c5a`). Read the composite's §6 and DX7 (Enrollment, Enrollment's endpoints, The enrollment code,
> Running the local hub) before any milestone; this document restates none of it. The DX7 facts it builds on are named
> by the code that holds them: `apps/desk-hub/src/protocol/identity.ts`, `apps/desk-hub/src/objects/registry.ts`,
> `apps/desk-hub/src/worker.ts`, `apps/desk-web/src/enroll/enrollment.ts`,
> `apps/desk-web/src/views/machines/MachinesDialog.tsx`; and in doperpowers `sminos/skills/sminos/scripts/sminos_hub.py`,
> `sminos/tests/enroll_parity.py`, `sminos/tests/dx7-enroll-codes.gen.mjs`.
>
> **Two repositories.** The hub and the web are MAWS (this repository). The machine side is doperpowers'
> `sminos` plugin (`sminos/` in `github.com/SSFSKIM/doperpowers`). M1 and M2 land on a MAWS branch, M3 on a doperpowers
> branch; M4 runs the acceptance across both. Paths under `sminos/` are doperpowers'; every other path is MAWS's.

## Purpose

Today a machine joins the desk only by a human's hand: an admin presses *Machines → Enroll a machine* on the web, the
browser builds a one-time code (live 15 minutes by default, an hour at most), and the admin pastes it into
`sminos hub enroll` on the machine. The owner is building automated VM provisioning (devcloud: cloud VMs whose boot
runs numbered steps; step 11 installs the sminos daemon once the host is enrolled). A VM that boots at 03:00 has no
human, and a code that dies within the hour cannot wait in a secret store.

After this change an admin creates a **provisioning key** on the Machines page: a reusable, revocable credential with
a machine-name prefix (`dc-`), an expiry, an optional cap on uses, and an optional offline auto-revoke. Its code is shown
once, and the owner stores it in Secret Manager. Every new VM reads it at boot and runs
`printf %s "$CODE" | sminos hub enroll --name dc-build-7f3a`, and from then on it is an enrolled machine exactly as a
Mac enrolled by hand is: its own name, its own Access service token, its own machine project, revocable from the web.
When the VM is torn down it runs `sminos hub leave`, and its machine is gone from the org; one that vanishes without
saying so is revoked by the hub once it has been offline for the key's configured time. To see it working: create a key
on the web, enroll two machines through it from a terminal, watch both appear under the key in Machines, revoke the key
and see a third enrollment refused while the two stay, run `sminos hub leave` on one and see it go.

## Progress

- [x] (2026-10-21) Spec written from the owner's approved design and the devcloud session's boot-side requirements;
      decisions below. Committed on MAWS branch `desk-provisioning-keys`.
- [x] (2026-10-21) Spec review: one independent review of the whole document and an adversarial buildability review
      of the execution section, both "needs-attention"; every finding accepted and folded in (Decision Log, the fix
      wave entry): the self-revoke bound to the enrollment, Access's denial as an outcome and the stand-in's 401,
      `hub check` and the boot's rule, the security rationale corrected, the buildability fixes.
- [x] (2026-10-21) The fix wave's re-review: two findings ruled by the orchestrator and folded in by the executing
      session (Decision Log, the re-review entry): Access's 401 read through a propagation grace and a recheck; exit 4
      of `hub check` is the boot's to retry.
- [x] (2026-10-21) M1 — reviewed clean (task-reviewer and reviewer-high; commits `ccbb539b0`, fix `0602580be`). The hub: the key, its code, redemption through it, `uses`, revocation of a key, a machine's own record
      and self-revoke bound to its enrollment, the offline sweep, the stand-in's 401 (MAWS).
- [x] (2026-10-21) M2 — reviewed clean (task-reviewer; commits `be133c3a3`, fix `d6195c5ce`). The web: provisioning keys on the Machines page (MAWS).
- [x] (2026-10-21) M3 — reviewed clean (task-reviewer and reviewer-high; doperpowers commits `f3ea1a0e`, fix `7831e8ac`, the panel's fix `c30601c8`; sminos 1.4.1 after main's 1.4.0 merged in). sminos: both codes decoded, `hub enroll` through a key, `hub check`, `hub leave`, `hub show`'s exit code,
      the parity vectors regenerated (doperpowers).
- [x] (2026-10-21) M4 — Acceptance across both repositories against the local hub; the record completed: items 1–8, 10
      and 11 pass as written, no fix needed (the walk is the appendix of `2026-10-21-desk-provisioning-keys-report.md`
      beside this spec); item 9 by the gates — doperpowers `d358c760` green (run 39547860824), MAWS on the merged head.
- [ ] Whole-branch review at xhigh (each repository's branch), then merge; the hub deploy is the orchestrator's, after
      merge.

## Terms

- **One-time code** — today's enrollment code, `smns-enroll-v1.<base64url JSON {hub, org, token, machine, key}>`,
  whose `token` the hub's `enrollments` table holds as a hash and which enrolls one named machine, once.
- **Provisioning key** — the new credential: a row of the Registry's new `provisioning_keys` table (its secret kept
  as a hash), good for many enrollments under one name prefix until it expires, is revoked, or is used up.
- **Provisioning code** — the text an admin's browser builds around a provisioning key's secret and the org key,
  `smns-provision-v1.<base64url JSON {hub, org, token, prefix, key}>`, which `sminos hub enroll` reads. "Code" alone
  below means either kind.
- **Redemption** — `POST /machine/enroll {token, machine}`, the one path Access does not guard; today it spends a
  one-time token, after this change it also takes a key's secret as `token`.
- **Enrollment row** — a row of `enrollments`: the durable state machine (`open` → `pending` → `confirmed`, or
  `expired`) that `Registry.redeem`, `Registry.resolve` (confirmation), `expire` and `revoke` drive today.
- **The Registry** — the org's Durable Object (`objects/registry.ts`), one per org, holding members, machines,
  enrollments and projects in SQLite; it runs one request at a time between `await`s, which is the concurrency
  model every decision below leans on.
- **Online, `seen`** — `machines.online` and `machines.seen`, set by `Registry.refreshOnline` from the projects' lease
  reports: a machine is online while any project reports a fresh lease opened with its current credential; `seen` is
  when that last flipped.
- **Revocation** — `Registry.revoke`'s path: the `Machine` object fences the credential and ends its stream, the
  machine row goes, its Access service token is deleted (retried as an orphan until Cloudflare confirms), its name is
  released, its archive designation is cleared, every project is told (`Project.forget`, retried through
  `revocations`), and its machine project is retired. Three callers after this change: an admin's `DELETE
  /api/machines/<name>`, the machine's own `DELETE /machine/enrollment`, and the offline sweep.
- **Access's denial** — what a request with a service token Access no longer holds gets, from Access itself, before
  anything reaches the Worker: **401** with Access's own HTML page (the deployment's `service_auth_401_redirect:
  true` in `apps/desk-hub/deploy/access.ts`; the deploy probe's case A4 in `deploy/probe.ts` pins the status and that
  the body names `Cloudflare Access`). Distinct from the Worker's **`403 {"error":"not-enrolled"}`**, which a
  credential Access still admits gets while the Registry no longer holds it: the window between a revocation's row
  deletion and the orphan sweep's confirmed deletion of the token, or a lost mint. To the machine both say the same
  thing — it is no longer enrolled — and §6 treats them as one outcome, with one caveat: Access answers the same 401
  to a token it **does** hold but whose creation has not yet reached its edge (the deploy probe's case A3 waits up to
  60 s for a freshly minted token to stop drawing 401), so a 401 is read as a denial only for a credential past a
  propagation grace and only when it holds on a recheck (§6, "How the CLI knows").
- **The boot** — devcloud's VM provisioning (`devcloud/boot/devcloudlib/sminos_host.py` in doperpowers), owned by
  another session; this spec fixes only the interface it consumes (Interfaces, "What the boot consumes").
- **The local hub and the stand-in** — `pnpm --filter desk-hub local`: the Worker on workerd behind a stand-in for
  Access and for Cloudflare's service-token API (`apps/desk-hub/local/`), which the suites also run in-process
  (`test/support/local.ts`). doperpowers' CLI tests use their own hermetic hub, `sminos/tests/hub_standin.py`.

## Design

### 1. The key and its code

A provisioning key is created by an admin and carries:

| field | meaning | bounds |
| --- | --- | --- |
| `label` | the owner's name for it, as the list shows it | 1 to 100 characters, like a wrapped key's |
| `prefix` | every machine enrolled through it is named `<prefix>…`, compared without case as DX7 compares names | passes `isMachineName` (DX7's grammar, 1 to 63 characters, not `hub` or `legacy`): one grammar, one check, and a name that starts with an admitted prefix is itself grammatical in its first character. Rejected: a grammar of its own for prefixes (a second rule to keep in two decoders) |
| `ttl_s` | how long the key enrolls machines, from its creation | 3600 to 31 536 000 (an hour to a year); default 7 776 000 (90 days) |
| `max_uses` | at most this many enrollments, ever | null (unbounded) or 1 to 10 000 |
| `offline_revoke_s` | a machine enrolled through it is revoked once offline this long (§4) | null (never) or 3600 to 2 592 000 (an hour to 30 days) |

**Why a key expires at all, and why a year at most.** A key is a standing credential that mints machines; the
one-time code was designed so that no such thing exists. Expiry is the backstop for the key nobody remembers to
revoke, and a year bounds a forgotten one while leaving the fleet's rotation cadence to the owner. Rejected: no
maximum (the backstop would be optional), and a 30-day maximum (rotating a Secret Manager entry monthly is a chore the
owner did not ask for; they can choose 30 days).

**Why an hour is the floor of `offline_revoke_s`.** Online state comes from leases that lapse three heartbeats
(45 s) after the last renewal and from the uplink's reconnect backoff; a machine rebooting, or a hub deploy that
restarts every stream, is offline for minutes. An hour is well clear of that; the boot side asked for 6 to 24.

**Two keys with one prefix are allowed.** Rotation is "create the next key, move the secret, revoke the old one", and
during the overlap both carry `dc-`.

**The secret.** 256 random bits as base64url, drawn by the hub at creation and answered once (`token` in the
creation's answer, the same shape and place as a one-time token's); the hub keeps SHA-256 of it (`secret_hash`), as
`enrollments.token_hash` keeps a token's. A stolen admin session can create a key record, but a code needs the org
key, which the hub never holds: the browser builds the code, as it builds a one-time code today. Revocation and
creation take an admin's Access session and nothing more, as `POST /api/enrollments` and `DELETE /api/machines/<name>`
do today; the wrapped-key endpoints' `auth` proves possession of the org key where the records themselves are at
stake, which a key record is not.

**The code's shape: a new prefix, `smns-provision-v1.`**, over `{hub, org, token, prefix, key}` — `hub`, `org` and
`key` as DX7's code has them, `token` the key's secret, `prefix` the key's. Rejected: `smns-enroll-v1.` with a flag
field. An older sminos ignores fields it does not know and reads `machine` for a meaning the code does not have: it
would redeem under its host name, and on a devcloud VM whose host name happens to start with the prefix it would
succeed by accident, otherwise fail after a network round trip with a message about a code kind it never heard of.
With a new prefix an older sminos refuses the code at once, before anything leaves the machine, in words it already
has: `sminos: enrollment code: not smns-enroll-v1` (§6).

The hub's protocol module exports `encodeProvisioningCode` and `decodeProvisioningCode` beside the one-time code's
pair, and `decodeCode`, which reads either prefix and answers a tagged union; refusals are worded by the kind the
prefix named (`provisioning code: no prefix`, `enrollment code: no machine`), and an unknown prefix as
`enrollment code: not smns-enroll-v1 or smns-provision-v1` (Interfaces). The checks on `hub`, `org`, `token` and `key`
are the one-time code's; `prefix` passes `isMachineName`.

### 2. Redemption through a key

**The same endpoint.** `POST /machine/enroll {token, machine}`, body and shape unchanged, `token` being a one-time
token or a key's secret. The hub hashes `token`, looks in `enrollments.token_hash`, then in
`provisioning_keys.secret_hash`; found in neither, it answers `404 unknown-token` as today. Rejected: a second path
(`POST /machine/provision`). Access's Bypass policy, `desk-hub public paths` in the deployment, names `/machine/enroll`
exactly; a second unguarded path is an Access application edit at deploy and a second unauthenticated surface to
reason about, to do the same lookup. sminos's `redeem_once` and its retry (`ATTEMPTS`) stay as they are.

**The checks, in order**, all before the first `await` after the lookup (the Registry's "from here to the first await
below, nothing else runs in this object" step), each answering DX7's `{error, message}`:

| order | refusal | status | when |
| --- | --- | --- | --- |
| 1 | `bad-shape`, `bad-name` | 400 | as today, before any lookup |
| 2 | `key-revoked` | 410 | the key's `revoked` is set; told before anything about the name, since the key is dead whatever the name |
| 3 | `key-expired` | 410 | the key's `expires` has passed |
| 4 | `prefix-mismatch` | 403 | `machineNameKey(machine)` does not start with `machineNameKey(prefix)`: this key does not authorize that name |
| 5 | `busy` | 409 | the name is held by a pending machine whose enrollment's mint is in flight (`busy`), as today |
| 6 | rotation (no refusal) | 200 | the name is held by a **pending** machine whose enrollment row carries **this key's id**: the lost-answer retry (sminos redeems the same code and name up to three times). The credential rotates exactly as a one-time token's second redemption does: `expires` moved on, `client_id` nulled, the old token deleted by name, a fresh one minted. No use is counted |
| 7 | `name-taken` | 409 | the name is held by an active machine, or by a pending one of a one-time token or of another key: nothing is bound; the caller picks another name. (A pending one whose time was up is already gone: `redeem` runs `sweep()` before this step, as today, so a lapsed name is free) |
| 8 | `key-exhausted` | 410 | a new enrollment would be made and `uses >= max_uses`; checked last so a rotation under an exhausted key still completes a VM's retry |
| — | `mint-failed` | 502 | Cloudflare's API failed, as today; the same redemption retried rotates |

**Why rotation is bound to the key, not the name alone.** A VM whose redemption answer was lost must retry without a
human, and `name-taken` on its own name would strand it for the pending window. Binding the retry to the same key
keeps the holder of one key from taking over another key's pending enrollment; a one-time token's pending name is
never a key's to rotate, nor the reverse.

**How a redemption becomes an enrollment row.** A key redemption that passes check 7 inserts, in one
`transactionSync` with everything else it reserves: an `enrollments` row already in state `pending` with `machine`
set, `created_by` the key's creator, `ttl_s` = `ENROLLMENT_TTL_S` (900) and `expires` 900 s on, `key` the key's id, and
`token_hash` = `key:<enrollment id>` (a value no SHA-256 hex ever equals, so the token lookup never finds it; chosen
over making the column nullable, which SQLite cannot do without rebuilding the table); the `machines` row in `pending`
naming that enrollment, as a token's redemption inserts it; `uses + 1` on the key; and the `orphans` deletion for the
token name. From that step on the row is an ordinary pending enrollment and nothing downstream knows how it was made:
`resolve` confirms it at the machine's first authenticated request and registers its machine project, `expire`
deletes the machine row and orphans its token when 900 s pass unconfirmed, `revoke` and the orphan sweep treat its
token name as any other, and `scheduleAlarm` already wakes for its `expires`. Rejected: a second table for key-made
enrollments (every lifecycle function would branch on it); refunding a use when a pending enrollment expires (`uses`
would move both ways under a race, and the cap is a blast-radius bound, not a quota).

**Why 900 s for the pending window.** The VM's daemon connects within a minute of enrollment (boot step 11 follows at
once); the one-time code's default is proven and already the alarm's unit.

**Concurrency on `uses`.** The check `uses < max_uses` and the increment are in the same synchronous step and the same
`transactionSync` as the name's reservation; the Registry runs one request at a time between awaits, so two
redemptions racing under one key serialize there, and the second reads the first's increment. No lock, no
`UPDATE … WHERE uses < ?`: the Durable Object is the lock. Two redemptions under one key and **different** names both
proceed (each mints on its own token-name queue); two under the **same** name meet check 5 or 6. Pinned by a test: two
redemptions at once under a key with `max_uses` 1 — one `200`, one `410 key-exhausted`, one machine row.

### 3. The key's life and its list

**Expiry** is read at redemption (`key-expired`) and shown in the list; no sweep touches a key. **Revocation**
(`DELETE /api/provisioning-keys/<id>`, an admin) sets `revoked` to now and stops new enrollments only, as the owner
ruled: machines enrolled through the key stay, pending ones confirm when they connect, and each is revoked as any
machine is. A pending enrollment made through a revoked key cannot rotate (check 2 refuses before check 6), so a VM
whose answer was lost after the revocation expires out in 900 s and its name is released. Revoking a revoked key
answers `200` again with the first `revoked` kept. Its `offline_revoke_s` goes on applying to the machines it enrolled
(§4): the teardown problem does not end when the key rotates. Keys are never deleted; the list is the history of how
machines came to be enrolled.

**The list**, `GET /api/provisioning-keys` (a member, as `GET /api/machines` is): every key, with `uses` (enrollments
ever made through it, including those since expired or revoked) and `machines` — the machines enrolled through it now,
pending or active, each `{name, state}`, read by joining `machines` to `enrollments` on `key`. The secret is in no
answer.

### 4. Leaving: the machine's self-revoke and the offline sweep

**`DELETE /machine/enrollment`**, by a machine with its own credential (Access's service-auth policy admits it, so no
Bypass changes), answers `200 {revoked: <name>}` and runs the revocation (Terms) on the caller's own enrollment: its
stream ends with cause `revoked`, its service token is deleted, its name is free, its machine project is retired with
its log kept, and every project forgets it.

**Bound to the enrollment, never to the name.** The Worker resolves the credential in one Registry call
(`resolve`) and asks for the revocation in a second; between the two, an admin can revoke the name and enroll it
anew — another enrollment, another credential, the same name. A revoker that took a name would then revoke the
replacement. So the Worker passes the principal's `MachineRecord` — its `enrollment` id and `client_id` — into the
shared revoker, which reads the row by name and, **before the first fence** (the `Machine` object's `revoke`), checks
that the row still carries that enrollment; a row that does not (gone, or another enrollment's) is answered `200
{revoked: <name>}` as "already gone" and nothing of the name's is touched, so the replacement survives. The admin's
path binds the same way from its own first read (today's loop, kept), and the offline sweep binds each candidate to
the enrollment id it read, since it holds its candidate list across the awaits of the revocations before it (below).

**What the credential gets afterwards.** The Worker refuses it `403 not-enrolled` (the Registry no longer holds it)
until the orphan sweep's deletion of its Access service token is confirmed — in the same call on the local stand-in,
within the retry against Cloudflare — and from then on Access's denial (Terms) answers it, 401, and the request never
reaches the Worker. A machine reads the first as "no longer enrolled" at once and the second once its credential is
past the propagation grace and the 401 holds on a recheck (§6).

**`GET /machine/enrollment`**, by a machine with its own credential, answers `200 {org, machine, state, confirmed}`,
its own record as the Registry holds it, and changes nothing: it is the cheap authenticated request a machine checks
itself with (`sminos hub check`, §6) and the one acceptance confirms a machine with. Like any authenticated request it
confirms a pending enrollment (DX7's rule). Rejected: checking through `GET /machine/stream` (a new stream ends the
daemon's current one — a check must not), and through `POST /machine/frames` (it needs a stream generation).

Rejected for the self-revoke: `POST /machine/leave` (a verb where the resource is the enrollment); a Registry-side
"left" state kept for the record (the revocation already leaves the enrollment row and the retired machine project as
history).

**The offline sweep.** A machine enrolled through a key whose `offline_revoke_s` is set, and which the Registry has
counted offline for that long, is revoked by the Registry's alarm through the same path as an admin's revocation,
with the same effects. Precisely, in `sweep()` beside the enrollment expiries: for each `active` machine whose
enrollment's `key` has `offline_revoke_s` not null, with `online = 0` and
`COALESCE(seen, confirmed) + offline_revoke_s <= now` — `confirmed` standing in for a machine that was never seen online,
which otherwise would never be swept — run the revocation. Pending machines are not candidates: the enrollment's 900 s
expiry already ends one that never connects. `scheduleAlarm` adds the earliest such deadline to the alarms it
considers, and `refreshOnline` schedules the alarm whenever it flipped a machine offline, so the alarm is set when the
clock starts, not only at the next unrelated wake.

**The sweep's candidates are bound, and the race with a machine that comes back just after the cutoff.** The sweep
reads its candidates — name, enrollment id, `online`, `seen` — in one synchronous step, then revokes each in turn
through the shared revoker, bound to the enrollment id it read: while an earlier candidate's revocation awaits the
`Machine` object, a later candidate's name can be revoked by an admin and enrolled anew, and the revoker's check
before the fence leaves that replacement alone (it is another enrollment). For the candidate being revoked, the check
and the fence call are one synchronous step; a project's lease report that reaches `summary()` after that read does
not save the machine. Once the fence is placed the revocation completes as every revocation does (the row is re-read
after the object answers and deleted; a credential minted meanwhile is fenced too). The outcome is stated, not
softened: the machine was gone for the configured time, and returning in the same second as the sweep loses. Its
daemon's next stream open is refused — `403 not-enrolled` by the Worker until the token's deletion is confirmed, then
401 by Access — its daemon log says `the hub answered 401 …` (or `… 403 … not-enrolled …`), its uplink retries with
backoff and never rejoins on its own; the machine, if it still exists, is enrolled again with a code (`sminos hub
enroll --replace`), which the boot does at its next start after `sminos hub check` says the credential is rejected
(§6). Rejected: re-checking `online` after the `Machine` object answers and undoing the revocation (the fence is
already placed; an undo would need a second credential and a second state, for a window of one request).

**What an auto-revoke does to the machine's projects and sessions** is what any revocation does: each `Project`
takes `forget` with the stream generation the `Machine` object answered, ends that stream's lease, stops counting the
machine on the grid and reports; the machine's sessions keep their history and read as on a machine that is offline;
its machine project is retired (off the grid, log kept), and is active again if the name is enrolled anew.

**Rejected: an admin-side revoke callable without a browser.** The boot side offered it as the alternative to the
sweep. A member credential outside Access's browser flow is a new principal class — a secret to store, rotate and
steal, with a member's authority — for a case the sweep covers (ungraceful teardown) and `hub leave` covers (graceful).
Deferred, with its shape should a scripted admin ever be needed: an Access service token admitted as a *member*
principal by the Worker's `resolve`, so Access's policies and Cloudflare's token lifecycle govern it, not a new secret
of the hub's.

### 5. The web

The Machines dialog (`views/machines/MachinesDialog.tsx`) gains a **Provisioning keys** section under the machine list.
Every member sees it; an admin creates and revokes. The machine list's rows gain `via <label>` for a machine whose name
appears under a key in the keys list (the keys query the dialog already loads, so `GET /api/machines` is unchanged).

**Creating a key** is a form (label; prefix; expires in: 7, 30, 90 or 365 days; max uses: optional; revoke when
offline for: never, 6 h, 12 h, 24 h, 7 days), checked in the browser as the name step checks a name (`prefixProblem`,
the grammar in words), then the confirm step of today's enrollment reused as it is: one of the org key's methods opens
the key's bytes, `POST /api/provisioning-keys` is asked for the record and its secret, `provisioningCode` builds the
code and wipes the bytes. The code step shows the code once, with the exact line the boot runs
(`printf %s "$CODE" | sminos hub enroll --name <prefix>…`) and the words that it holds the org key and is to be kept
in a secret store the VMs read, nowhere else. The *Create a key* button is disabled while the org key is locked, with
today's "Unlock the org key first: the code carries it."

**Each key's row:** label, prefix, `uses` over `max_uses` (`3 / ∞`), when it expires, the machines enrolled through it
(names, each with `enrolling…` while pending), and *Revoke*; a revoked key is drawn after the active ones with
`revoked <date>` and no button. **Revoking** confirms on a step that says what it does: no new machine enrolls through
it; the N machines enrolled through it stay and are removed one by one from the list above. Refusals are explained as
removal's are (`not-admin`, `unknown-key`).

**Rejected:** a page of its own (keys are about machines, and the dialog already holds the org key's unlock state and
the confirm step); storing the code anywhere in the browser (shown once, as the one-time code is).

### 6. sminos: the machine side

`sminos hub enroll` reads a code from its hidden prompt or stdin as today and decodes **either** prefix, in the hub's
words (`decode_code` ports `decodeCode`; the parity vectors pin it, §M3). That is the only way a code reaches the
machine: no file holds a provisioning key on a host, and there is no option to read one from a file (the owner's
ruling, Decision Log 2026-10-21). The one file enrollment leaves is the per-machine credential, `daemon/hub.json`,
which the daemon reads; the reusable key is used once, by the CLI, and kept nowhere. With a **provisioning code**:

- The name is `--name`, else the machine's current name (`host_name()`), and the CLI refuses locally, before any
  request, a name that does not start with the code's prefix compared without case: `the name <n> does not start with
  this key's prefix <p>: pass --name <p>…` (exit 2). The hub checks the same (`prefix-mismatch`), so a hand-built code is
  no bypass.
- Redemption, the lost-answer retry, the answer's checks (`org` the code's, `machine` the name asked), and
  `daemon/hub.json` (mode 0600: hub, org, machine, client id and secret, the org key, `former`, `enrolled`) are
  unchanged: nothing after the decode knows which kind of code it was, as nothing in the hub does after the
  reservation.
- `refusal()` gains `key-revoked` ("this key was revoked at the hub: ask an admin for a new key"), `key-expired`,
  `key-exhausted` ("this key has enrolled all the machines it may: ask an admin for a new key or a higher cap") and
  `prefix-mismatch` (names the prefix and says `--name <prefix>…`). Every refusal is one `sminos: …` line on stderr and
  a nonzero exit; **`name-taken` exits 3** so the boot's driver can tell it apart and retry with another suffix, every
  other refusal and a hub that never answered exit 1 as today.
- A one-time code works exactly as before (the vectors' existing cases stay green).
- A credential the hub no longer accepts (`hub check` exit 3, below) is replaced under the same name by
  `sminos hub enroll --replace` with the key piped as at first boot: the revocation freed the name, so this is a new
  enrollment (a new use). A name an admin has meanwhile given to another machine is `name-taken`, exit 3, and the
  driver picks another suffix as at first boot.

**`sminos hub show`** prints what it prints today and **exits 0 when the machine holds a credential, 1 when not**;
it reads `hub.json` and asks the hub nothing, so it is instant and never wrong about the file — and says nothing
about whether the hub still accepts the credential. That is `check`'s question.

**How the CLI knows Access's denial from the Worker's refusal.** Production Access answers a service token it does
not hold with **401** and its own HTML page (Terms, Access's denial: `service_auth_401_redirect`, the probe's A4);
the Worker answers 401 only to a request carrying no assertion at all, which no request through Access is. The
stand-in answers the same from M1 on (a 401 whose body names `Cloudflare Access`), so the rule is one in every
environment. A **`403` whose JSON `error` is `not-enrolled`** is the Worker refusing the credential (Access still
admits it: the orphan window, or a lost mint): **rejected** at once — only a credential Access holds reaches the
Worker, and the Registry's answer is authoritative. A **401 whose body contains `Cloudflare Access`** is Access not
admitting it, which is either a deleted token or a minted one that has not yet reached Access's edge (Terms; the
probe's A3 allows 60 s for that). So it is **rejected** only when both hold:

- the credential is past the **propagation grace**: 600 s after `hub.json`'s `enrolled` (written and read by the
  machine's own clock) — ten times the probe's bound, and short beside a boot's other waits; and
- the marked 401 **holds on a recheck**: the same request sent once more 90 s after the first 401 — one and a half
  times the probe's bound, so a credential whose `enrolled` reads old because the clock jumped at boot is still given
  the whole propagation window. The recheck's answer is the answer: a `200` is acceptance, a `403 not-enrolled` or
  the marked 401 again rejection, anything else *other*.

Inside the grace a marked 401 is **indeterminate**, read as *other* in words of its own (`Access answered 401 to a
credential enrolled <n> s ago, which may not have reached Access's edge yet`). Everything else is not a rejection and
is never read as one — no answer, a connection or TLS error, a 5xx, a redirect, a 404, a 403 of another error, a 401
without the mark (reported as "401 without Access's page"), a 200 whose body is not what was asked — because a
teardown or a boot that mistook an outage, or a credential still propagating, for a revocation would throw away a
live credential (and a `--replace` after it would spend a key use, or meet `name-taken` on the machine's own name).
The recheck's interval is read from `SMINOS_ACCESS_RECHECK_S` when set (the tests and the acceptance walk set it to
1); nothing else is configurable, and tests and the walk move a credential past the grace by writing an older
`enrolled` into its `hub.json`.

**`sminos hub check`** asks the hub whether this machine's credential is still accepted, and changes nothing: `GET
/machine/enrollment` with the stored credential (through the uplink's connection helpers, as `redeem_once` reaches the
hub). Exit **0**: enrolled and accepted — the hub answered `200` naming the stored org and machine (stdout `enrolled
as <name> at <hub> (org <org>): accepted`). Exit **1**: not enrolled here (no `hub.json`; stdout says so). Exit **3**:
present but rejected (by the rule above), one stderr line saying which (`the hub no longer accepts this machine's
credential: Access answered 401` / `… the hub answered not-enrolled`); the credential is kept, since a check destroys
nothing and what follows — `enroll --replace`, or `leave` — is the caller's. Exit **4**: undecided — the hub could not
be asked, or answered something that is neither acceptance nor rejection (the *other* above, a marked 401 inside the
grace among it); the credential is kept, the answer on stderr. Exit 4 is never an end state for a caller: it means
"ask again later", and the boot runs `check` again with backoff until it answers 0, 1 or 3 (Interfaces, "What the
boot consumes"), since a VM revoked while it was stopped and booted into a brief hub outage would otherwise never
learn it — its daemon cannot re-enroll, never holding the key. Exit **2**: usage. Why a verb of its own rather than a remote `show`: `show` is local and instant,
which a boot's skip and `daemon status` rely on, while a remote check can wait `TIMEOUT` (30 s) on a dead hub and has
four answers, not two; a verb named for what it does keeps both honest. Rejected: having the daemon mark `hub.json`
when its uplink is refused (the daemon never validates enrollment today, and a flag in the credential file would be a
second state every reader of the file must learn).

**`sminos hub leave`** ends this machine's enrollment: `DELETE /machine/enrollment` with the stored credential. On
`200`, or on a rejection by the rule above (the hub already revoked it, by an admin's hand or the offline sweep; or
this machine's own earlier `leave` whose `200` was lost, after which the token is gone and Access answers 401 — read
as a rejection once past the grace and the recheck, so a `leave` within ten minutes of enrolling whose `200` was lost
exits 1 until then, and the teardown's retry or the offline sweep finishes it), it removes
`daemon/hub.json` and prints one line saying which (`left the hub as <name>` / `the hub had already revoked <name>; the
stale credential is removed`), exit 0; the daemon's `UplinkSupervisor`, which polls the credential file every 0.2 s
while its child runs, stops the uplink within a second and starts none while no credential is held, so no restart or
`daemon` verb is needed. A machine that is not enrolled here says so and exits 0: a teardown script runs `leave` on a
VM whose boot may have failed before enrolling. The hub unreachable, a 5xx, a marked 401 inside the grace, or any
answer that is not acceptance or rejection: the credential is kept, the reason is on stderr, exit 1, so the teardown
can retry. A credential `enroll --replace` installed while `leave` ran is kept and named, exit 1 (Decision Log). There is no `--local`:
a VM the hub cannot be told about is deleted anyway, and the offline sweep is for exactly that. Accepted edge: a Mac that enrolled under a name other than its host name and leaves writes
as its host name afterwards, and the sessions it held under the enrolled name read as another machine's until it
enrolls again (`former` is in `hub.json`, which `leave` removes); a VM about to be deleted has no such history, and a
Mac that leaves re-enrolls by hand. Rejected: keeping a credential-less `hub.json` for `former` (every reader of the
file takes its presence for an enrollment: `enroll`'s `--replace` guard, `daemon status`, the supervisor).

**Older sminos.** A sminos from before M3 refuses a provisioning code at its decoder — `sminos: enrollment code: not
smns-enroll-v1`, exit 2 — and nothing reaches the hub. The devcloud image carries sminos from the doperpowers
marketplace clone (`sminos_host.py`'s `CLI_PATHS`), so the boot side pins the sminos plugin version that M3 bumps as
its minimum; the hub needs no compatibility path, since it never sees a code. A newer sminos against a hub from before
M1 is told `unknown-token` for a provisioning code's secret and says what it says today for that code.

### 7. Security: where the org key now lives

The code carries the org key, as every code does, because a machine cannot verify or sign anything without it (§6 of
the composite). Keeping a provisioning code in Secret Manager puts a copy of the org key there. The boot reads the
secret (descriptor `DEVCLOUD_SMINOS_SECRET`, default id `sminos-provisioning-key`) as the owner's `cli-owner` service
account, which is a project owner; the org's policy blocks creating keys for a narrower account, so the reader
cannot be narrowed to the VMs today. **The real exposure, stated plainly:** anyone who can read as a project owner of
that GCP project can read the org key — the same class as everyone who can read any enrolled machine's
`$SMINOS_HOME/daemon/hub.json`, which holds it too. Nothing here promises a narrower reader. What the key's own
properties bound is the *enrollment* side: who can mint machines, under which names, how many, until when
(expiry, `max_uses`, `prefix`, revocation); none of them protects the org key, whose rotation means enrolling every
machine again and is out of phase 1 as DX7 says. A VM that stays enrolled after it is gone is bounded by the sweep.

**What stdin-only buys, and what it does not.** The key reaches a host through `hub enroll`'s stdin or hidden
prompt only, and no file holds it (the owner's ruling, Decision Log). That keeps the key out of the host's **disk
artifacts** — images, snapshots, backups, and anyone who reads the disk — and out of `hub.json`, which holds one
machine's credential and nothing that mints another. It does **not** keep the key out of the VM's reach: a devcloud VM
runs with the owner's `cli-owner` ADC, a project owner (`devcloud/boot/devcloudlib/steps.py` installs the seed key as
ADC, or the host takes the metadata server's identity), so a compromised VM reads Secret Manager again whenever it
likes, and with it the key and the org key inside it. **Accepted:** devcloud hosts already carry project-owner
credentials; a VM is inside the owner's trust domain as a Mac is, and the composite's §6 already accepts that a
compromised enrolled machine can forge any writer and execute as the owner. **Recovery from a compromised VM or a
leaked key:** revoke the key on the web — new enrollments stop at once — then revoke, one by one, the machines its
row lists as enrolled through it, because every machine confirmed before the revocation survives it by design (§3),
an attacker's among them; then move to a new key. The org key itself is as exposed as it was, on every enrolled
machine, and its rotation stays out of phase 1.

### 8. Out of scope

The boot step itself (reading the secret, the `--name` it passes, the skip on reboot, `leave` over SSH, the TTL
reaper) is the devcloud session's; its interface is pinned under Interfaces. Org-key rotation. Per-key Access
policies. A member credential for scripts (§4, deferred). Keys that enroll without a prefix.

## Acceptance

Observable by a person at a terminal against the local hub (`pnpm --filter desk-hub local`, the stand-in on
`http://127.0.0.1:8747`, org `local`, admin `owner@example.com`) and at the web it serves; `sminos` is doperpowers'
CLI from the M3 branch (`SMINOS_HOME` pointed at a scratch directory per "machine", as its tests do). The commands
are quoted in Concrete Steps; the behaviour:

1. **A key is created on the web and its code shown once.** With the org key set up and unlocked (DX7's first
   steps), in Machines → Provisioning keys, *Create a key* with label `devcloud`, prefix `dc-`, 90 days, no cap,
   offline revoke 6 h, confirmed with the org key's passphrase, shows
   a code beginning `smns-provision-v1.` and the boot line; after *Done* the key is listed `devcloud · dc- · 0 / ∞`
   and the code appears nowhere again. The same through the stand-in's helper for a terminal walk:
   `POST /standin/provisioning-code {"prefix": "dc-"}` answers `{code, key, id}`.
2. **Two VMs enroll through one key with no human step.**
   `printf %s "$CODE" | sminos hub enroll --name dc-a-0001` exits 0 and prints `enrolled this machine as dc-a-0001 …`;
   the same with `dc-a-0002` from a second `SMINOS_HOME`. `GET /api/machines` lists both; `GET /api/provisioning-keys`
   lists the key with `uses: 2` and both names under `machines`; the web shows each machine `via devcloud`. Once each
   has made an authenticated request (`sminos hub check` from its home, exit 0; or `curl …/machine/enrollment` with
   its credential), both read `enrolled` (`state: "active"`).
3. **The key's bounds hold at the hub and are told to the terminal.** `--name build-3` (no prefix) exits 2 before any
   request with `does not start with this key's prefix dc-`; redeeming by hand under `build-3` answers
   `403 {"error":"prefix-mismatch"}`; with `dc-a-0001` confirmed (item 2), `--name dc-a-0001` from a third, empty
   home exits 3 with `another machine of this org is enrolled as dc-a-0001` (from `dc-a-0001`'s own home the
   already-enrolled guard answers first, exit 1, and sends nothing); a key created with `max_uses: 1` enrolls one
   machine and answers the next `410 {"error":"key-exhausted"}` (exit 1); two redemptions fired at once under such a
   key get one `200` and one `410`.
4. **Revoking the key stops new enrollments only.** *Revoke* on `devcloud` (confirmation names the two machines that
   stay) → a third `sminos hub enroll` exits 1 with `this key was revoked`; `dc-a-0001` and `dc-a-0002` stay listed
   and connected; each can still be removed from Machines as today.
5. **A machine leaves on its own, and a machine already revoked learns it through Access.** On `dc-a-0002`,
   `sminos hub leave` exits 0 with `left the hub as dc-a-0002`; `daemon/hub.json` is gone; `sminos hub show` exits 1;
   `GET /api/machines` no longer lists it at once, the grid no longer counts it, and the stand-in holds no service
   token named `desk-local-dc-a-0002` (deleted in the same call on the local stand-in; against Cloudflare, retried as
   an orphan until the API confirms). `sminos hub leave` again exits 0 with `not enrolled`. Then two ways a
   credential is already dead, both through the Access stand-in, which now answers a token it no longer holds as
   production does (401, a page naming `Cloudflare Access`): **admin-revoked** — remove `dc-a-0001` from the web;
   first, minutes after its enrollment, `sminos hub check` in its home exits 4 (`… enrolled <n> s ago, which may not
   have reached Access's edge yet`) and `sminos hub leave` exits 1 with `hub.json` kept: inside the propagation grace
   a 401 decides nothing; then, with that `hub.json`'s `enrolled` written 700 s back and `SMINOS_ACCESS_RECHECK_S=1`
   (the walk does not wait ten minutes and a half), `check` exits 3 with `Access answered 401`, and `leave` exits 0
   with `had already revoked`, `hub.json` gone; **a lost 200** — enroll `dc-a-0003`, revoke it by hand with its own
   credential (`curl -X DELETE …/machine/enrollment`, standing in for a `leave` whose answer never arrived), then,
   past the grace as above, `sminos hub leave` exits 0 with `had already revoked`. The other kind of refusal, the
   Worker's `403 not-enrolled` while a token's deletion is still owed, which is a rejection at once whatever the
   credential's age, is proved by the hub suite with a faulted deletion (M1) and by the CLI suite against its own
   stand-in (M3); so is a credential Access has not admitted yet (the CLI suite's stand-in answers a freshly minted
   token 401 for its first requests, then accepts it: `check` exits 4 and `leave` exits 1 inside the grace, the
   credential kept, and the next `check` exits 0).
6. **A machine that vanishes is revoked after the key's offline time.** An hour is not walked by hand: the hub
   suite demonstrates it (M1's test, through the test-only path that backdates `seen`). With a key whose
   `offline_revoke_s` is 3600, a machine enrolled and connected, then its stream closed and its `seen` set an hour
   back: the Registry's alarm revokes it — `GET /api/machines` no longer lists it, its service token is gone, its
   machine project reads retired in the directory, and the next request with its credential is refused (`403
   not-enrolled` while the token's deletion is faulted, Access's 401 once it is through). A machine still online at the
   hour is not touched; a key with `offline_revoke_s` null never revokes; a candidate whose name was revoked and
   enrolled anew while the sweep revoked an earlier one is left alone (the replacement survives).
7. **An older sminos refuses the code cleanly.** The `sminos/skills/sminos/scripts` of doperpowers `origin/main` from
   before M3, extracted whole (`git archive`), with the same piped code: stderr `sminos: enrollment code: not
   smns-enroll-v1`, exit 2, and the stand-in's log shows no request.
8. **One-time codes are untouched.** The web's *Enroll a machine* flow and `sminos hub enroll` with a
   `smns-enroll-v1.` code work as before; the regenerated `dx7-enroll-codes.json` keeps every earlier case green under
   `enroll_parity.py`, beside the provisioning cases.
9. **The suites pass:** `pnpm --filter desk-hub test`, `pnpm --filter desk-hub typecheck`, `pnpm --filter desk-web
   test`, `pnpm --filter desk-web typecheck` in MAWS; `sminos/tests/run-sminos-tests.sh` in doperpowers, its `codes
   parity` and enroll-parity lines all `ok`.
10. **Stop, revoke, reboot, re-enroll unattended.** The boot's rule, walked by hand with `dc-a-0001` enrolled and
    its home intact: (a) `sminos hub check` exits 0 — a reboot skips the enrollment; (b) the hub stopped: `check`
    exits 4 with the connection error on stderr, `hub.json` kept, `show` still exits 0 — a reboot keeps the
    credential and goes on, the daemon retrying, and the boot runs `check` again later; (c) revoked while down, then
    an outage at the check: with the hub back, `dc-a-0001` removed (from the web, or by the sweep as item 6's suite
    shows) and its `hub.json` past the grace (`enrolled` 700 s back, `SMINOS_ACCESS_RECHECK_S=1`), the hub stopped
    again: `check` exits 4 (the connection error), `hub.json` kept; the hub started again, the same home, no reboot:
    `check` exits 3 with `Access answered 401`, then `printf %s "$CODE" | sminos hub enroll --name dc-a-0001
    --replace` exits 0, the machine is listed again under the key (`uses` one more), its new credential's `check`
    exits 0, and `hub.json` holds the new client id — no human step anywhere in (a)–(c), the boot's retry of exit 4
    being the only loop.
11. **A revoke-and-replace between resolve and leave touches nothing but the caller.** The hub suite (M1) holds
    the Worker between resolving `dc-x`'s credential and the Registry's revocation, revokes `dc-x` as an admin and
    enrolls another machine as `dc-x` meanwhile, then releases: the first machine's `leave` answers `200 {revoked:
    "dc-x"}`, and the replacement's credential still opens a stream.

## Plan of Work

**Constraints that bind every milestone.** DX7's error envelope `{error, message?}` for every refusal, and DX7's
status conventions (`400` a malformed or inadmissible request, `403` a refused authority, `404` unknown, `409` a
conflict with state, `410` gone). Base64url is canonical (the composite's rule for DX1–DX7). The hub never sees the
org key; no answer carries a key's secret after creation; no CLI output or `daemon.log` line carries a secret or the
org key (doperpowers' `test-hub.sh` searches every output for them). Storage changes are `CREATE TABLE IF NOT EXISTS`
and `ADDED_COLUMNS`, as the Registry's schema is today — the owner approved exactly this. The composite's §6 and DX7
bind as written; this document extends, never contradicts, DX7. Doperpowers' version bump goes in the same commit as
the change (`scripts/bump-version.sh --plugin sminos`), per its CLAUDE.md.

**How the milestones depend.** M1 produces every interface M2 and M3 consume (the records, the endpoints, the code's
encoder and `decodeCode`, the stand-in's helper); M2 and M3 are independent of each other and may run in parallel once
M1 is reviewed; M4 needs both.

### M1 — The hub: keys, their codes, redemption, leaving, the sweep (MAWS)

**What exists at its end.** An admin can create, list and revoke provisioning keys over the API; a machine can enroll
by redeeming a key's secret under a prefixed name and is then an ordinary pending machine; `uses` counts under a race;
a machine can read its own record and revoke itself, bound to its own enrollment; the Registry revokes machines of a
key that have been offline past its time; the stand-in hands out a provisioning code without a browser and refuses a
service token it does not hold as production Access does.

**What it touches.** `apps/desk-hub/src/protocol/identity.ts` (records, constants, the code's codec, `decodeCode`,
the endpoint types); `apps/desk-hub/src/objects/registry.ts` (schema and `ADDED_COLUMNS`, `createProvisioningKey`,
`provisioningKeys`, `revokeProvisioningKey`, `redeem`'s key branch, the revocation refactor into one private path with
three callers, `leave`, `sweepOffline`, `scheduleAlarm`, `refreshOnline`); `apps/desk-hub/src/worker.ts` (the three
`/api/provisioning-keys` routes in `member`; `GET` and `DELETE /machine/enrollment` in `machine`, which needs the
registry stub passed in for the `DELETE` and answers the `GET` from the principal it already resolved);
`apps/desk-hub/local/run.ts` (`POST /standin/provisioning-code`) and `local/standin.ts` (the refusal of a service
token it does not hold becomes production's: 401, `text/html`, a body naming `Cloudflare Access`); `apps/desk-hub/test/`
(a `provisioning.test.ts` beside `enrollment.test.ts`, the helpers in `test/support/clients.ts`, and test-only paths in
`test/support/send-fault.ts` + `worker-under-test.ts`: one that backdates a machine's `seen` or moves the Registry's
clock, since the Registry reads `Date.now()` and the sweep's deadline is an hour at least; one that holds the Worker
between `resolve` and `leave`; one that holds the sweep between two candidates' revocations). The composite is not
edited by any milestone (a child cannot extend it; its Decision Log entry of 2026-10-21 is the pointer here).

**Interfaces** — exposes everything under Interfaces and Dependencies; consumes DX7 as built.

**Decisions of this milestone.** The checks' order and statuses are §2's table; the enrollment row's construction is
§2's paragraph; `token_hash` for a key-made row is `key:<enrollment id>`. The revocation refactor: one private
`revokeMachine(name, expected?)` (Interfaces) that reads the row by name, checks it against `expected` — the
enrollment id the caller resolved or read — **before** calling the `Machine` object, answers "already gone" on a
mismatch, and keeps today's loop after the object answers (the pitfall seen while designing: `revoke` re-reads the
row by `name` and `enrollment` after the `Machine` object answers — that loop is what makes a lost answer safe; the
check before the fence is what makes a name reused between two Registry calls safe). `revoke(member, name)` keeps its
admin check and passes no expectation (an admin revokes what holds the name now, as today); `leave(machine)` passes the
principal's `enrollment`; the sweep passes each candidate's. `refreshOnline` is synchronous and called from
`summary()`, which is synchronous too: schedule the alarm with a detached promise there, as `directoryChanged`
detaches its sends. The sweep reads `offline_revoke_s` from the key row at sweep time (a revoked key's value still
applies, §3). The stand-in's helper takes `{prefix, ttl_s?, max_uses?, offline_revoke_s?, key?}` and answers `{code,
key, id}`, `key` reused when given, as the enrollment-code helper does. The stand-in's refusal of a service token it
does not hold changes from `403 {"error":"access-denied"}` to production's 401 with a body naming `Cloudflare Access`
(§6's rule, the probe's A4); its refusal of a person with no identity (`--user ''`) stays `403 access-denied`,
deliberately unlike production's 302 to the team login, since the local runtime has no login page and nothing here
reads it. Pitfall: `test/enrollment.test.ts` and `test/standin.test.ts` assert 403 where the stand-in refuses a
service token (a revoked machine's stream, a bogus token) — those move to 401; the ones asserting the Worker's
`not-enrolled` stay 403, and the suite must show both. `GET /api/provisioning-keys` is a member's; `POST` and `DELETE`
an admin's (`not-admin` otherwise). `holdsAnything` (what keeps `ensureOrg` from renaming a stored org after a deploy)
counts `provisioning_keys` too: a key's code carries the org id, so a key is built on it.

**What it does not touch.** The web. `GET /api/machines`'s answer. The `Machine` and `Project` objects (the revocation
reaches them through the calls they already take). The deployment (Access policies unchanged by design).

**What it proves.** Acceptance 3 (the hub's side), 6, 11, and the hub halves of 2, 4, 5 and 10. Behaviour its tests
pin beyond acceptance: the secret appears in no answer but creation's; the `uses` race (§2's last paragraph); a
rotation under the same key counts no use and refuses another key's pending name; a pending enrollment through a key
expires as a token's does (row gone, name free, token orphaned, `uses` kept); a lost mint through a key is found by
name and deleted at the next redemption; a revoked key's pending machine still confirms; `GET /machine/enrollment`
answers the caller's own record and confirms a pending machine; `GET` and `DELETE /machine/enrollment` by a member are
`404 not-found` (the route is a machine's); after `DELETE /machine/enrollment` the same credential gets `403
not-enrolled` from the Worker while the token's deletion is faulted, and the stand-in's 401 once it is through; the
leave race (acceptance 11: the first machine's `leave` is "already gone", the replacement's stream still opens); the
sweep race (two candidates, the second's name revoked and enrolled anew while the first's revocation is held: the
replacement survives, the first is revoked); the sweep leaves a machine with `seen` null and `confirmed` within the
window; the lease-report race of §4 (a report arriving after the sweep's read does not save the machine); every bound
of §1's table refused `400 bad-shape` with a message naming the field.

### M2 — The web: provisioning keys on the Machines page (MAWS)

**What exists at its end.** §5, visible in the browser against the local hub: the keys section, creation through the
org key's confirm step with the code shown once, revocation with its confirmation, `via <label>` on machine rows.

**What it touches.** `apps/desk-web/src/enroll/enrollment.ts` (`createProvisioningKey`, `listProvisioningKeys`,
`revokeProvisioningKey`, `provisioningCode`, `prefixProblem`, the boot line constant);
`apps/desk-web/src/views/machines/MachinesDialog.tsx` (the section and its steps; `ConfirmStep` generalized to take
what to ask the hub for and how to build the code, rather than copied); `apps/desk-web/src/views/machines/
MachinesDialog.test.tsx` and `apps/desk-web/test/double/machines.ts` (the double learns the three endpoints).

**Interfaces.** Consumes M1's `ProvisioningKeyRecord`, `ProvisioningKeyRequest`, `ProvisioningKeyIssued`,
`encodeProvisioningCode`, the endpoints. Exposes nothing to later milestones.

**Decisions of this milestone.** The expiry and offline choices are selects over the fixed values in §5 (free seconds
invite mistakes in a credential's lifetime; the API's bounds stay the API's). The code step's copy says the code holds
the org key and is for a secret store the VMs read; it reuses `CodeStep` with the boot line in place of the "run
`sminos hub enroll`, paste before <time>" sentence. The keys query is `['provisioning-keys']`, invalidated with
`['machines']` on every `back()`. A member who is not an admin sees the list and the sentence "An admin of the org
creates and revokes keys."

**What it does not touch.** The grid, the org view, the key dialog. The hub.

**What it proves.** Acceptance 1 and the web halves of 2 and 4. Its tests pin: the section lists keys with uses over
cap, prefix, expiry and machine names, revoked ones after active ones; the create flow refuses a bad prefix in the
browser with the grammar in words; the code shown decodes with the hub's `decodeCode` to the posted prefix and the
org key the test unlocked, and is gone after *Done*; the create button is disabled while locked; a non-admin has no
create or revoke; the revoke confirmation names the machines that stay and the list updates.

### M3 — sminos: both codes, enrollment through a key, `hub check`, `hub leave`, `hub show`, the vectors (doperpowers)

**What exists at its end.** §6 in the CLI: a provisioning code piped on stdin enrolls a prefixed machine; refusals
exit as pinned; `hub check`; `hub leave`, reading Access's denial and the Worker's refusal as one outcome; `hub
show`'s exit code; the parity vectors regenerated over M1's MAWS commit; the sminos plugin version bumped.

**What it touches.** `sminos/skills/sminos/scripts/sminos_hub.py` (`decode_code` → both prefixes and `kind`, `enroll`'s
name rule and local prefix check, `refusal`, exit codes, `check`, `leave`, `show`, the shared reading of an
authenticated answer, `USAGE`, `cmd_hub`); the skill's `SKILL.md`/`references/setup.md` (enrolling at provisioning
time, `check` and the boot's rule, `leave`, one paragraph each); `sminos/tests/hub_standin.py` (keys: a configured key
with prefix, cap, revoked/expired flags; `GET` and `DELETE /machine/enrollment`; the two refusals of a dead credential
— a token it deleted answered as Access does, 401 with a body naming `Cloudflare Access`, and a knob that answers a
held token `403 {"error":"not-enrolled"}` as the Worker does in the orphan window; a knob that answers a token it
holds with Access's 401 for its first N requests, as a token not yet at Access's edge, then admits it; a request log
the tests read);
`sminos/tests/test-hub.sh` (the cases below); `sminos/tests/dx7-enroll-codes.gen.mjs` and `dx7-enroll-codes.json`
(regenerated; the header's MAWS commit updated); `sminos/tests/enroll_parity.py` (its adapter and its "both kinds"
check, below); `.version-bump.json`'s sminos files through `scripts/bump-version.sh --plugin sminos`.

**Interfaces.** Consumes M1's `decodeCode` semantics (through the vectors), the redemption's new refusals, `GET` and
`DELETE /machine/enrollment`, and the stand-in's 401 (the same rule the CLI applies to production). Exposes to the boot
what Interfaces pins under "What the boot consumes".

**Decisions of this milestone.** `decode_code` answers a dict with `kind` (`"enroll"` or `"provision"`) and the kind's
fields, matching the hub's `decodeCode` field for field so the vectors compare whole dicts; `CodeRefused`'s text is the
hub's whole message (`provisioning code: no prefix`), and `enroll` prints it after `sminos: ` without adding a kind of
its own — so `enroll_parity.py`'s adapter (`verdict`) compares `str(e)` whole and no longer prefixes `enrollment
code: ` itself, and its "both kinds" check asserts one decoded case of kind `enroll` and one of kind `provision`
(not merely a decoded and a refused case). `check` and `leave` share one reading of an authenticated answer
(`accepted` / `rejected` with which refusal / `other` with what came), the rule of §6, over `uplink.connection` and
the credential reader rather than a second HTTP client; the reading owns the grace (`ACCESS_GRACE_S = 600`, against
`hub.json`'s `enrolled`) and the one recheck (`ACCESS_RECHECK_S = 90`, `SMINOS_ACCESS_RECHECK_S` overriding it), so
`check` and `leave` cannot differ on what a 401 means, and a `hub.json` whose `enrolled` is missing or unreadable is
treated as inside the grace (a 401 then decides nothing); `leave` on `200` or `rejected` ends in `os.remove(hub.json)`
followed by `sminos.forget_caches()`, on `other` leaves the file; `check` never touches the file. The generator imports
`decodeCode` for verdicts and `encodeProvisioningCode` for the positive provisioning cases,
and its negative cases mirror the one-time code's (another prefix, no prefix field, an empty prefix, a prefix that is
not an admitted name — `hub`, `-x`, 64 characters — a prefix that is not a string), plus one `smns-enroll-v1.` code
decoded by `decodeCode` to prove the tag. The regenerated JSON is written over the MAWS commit that closes M1, named in
the generator's header comment as the current one names `bd266073`. The version bump is the plugin's patch component
unless the SKILL.md change is more than a paragraph.

**What it does not touch.** The daemon and the uplink (the supervisor already stops the child when `hub.json`
changes). `sminos_host.py` and anything under `devcloud/` (the boot session's). `project init --hub`.

**What it proves.** Acceptance 2, 3 (the terminal's side), 4, 5, 7, 8, 10 (the terminal's side), and the doperpowers
half of 9. Its tests pin (in `test-hub.sh` against `hub_standin.py`): a provisioning code piped with `--name dc-x`
enrolls and `hub.json` is 0600 with no secret in any output; without `--name`, the host name is used when under the
prefix, else exit 2 with no request in the stand-in's log; each hub refusal's exit code and its stderr line;
`name-taken` exits 3; a one-time code still enrolls; `check` — 0 on a `200` naming the stored org and machine, 3 on
`403 not-enrolled` whatever the credential's age, 3 on the stand-in's 401 with the mark past the grace when the
recheck answers it again (two requests in the log), 0 when past the grace the recheck is admitted, 4 on the marked
401 inside the grace (one request, no recheck), 4 on a dead port, on a 5xx, on a 401 without the mark and on a `200`
naming another machine, 1 with no `hub.json`, and the file byte-identical after every one; `leave` — `200` removes
the file and exits 0, the marked 401 past the grace and its recheck and the `403 not-enrolled` each remove it and say
`had already revoked`, the marked 401 inside the grace, a dead port and a 5xx keep it and exit 1, a second `leave`
exits 0 with `not enrolled`; **a token not yet at Access's edge** (the stand-in's knob: 401 with the mark for its first
requests, then admitted), freshly enrolled: `check` exits 4 and `leave` exits 1, the file byte-identical, then `check`
exits 0 and `leave` exits 0 with `left the hub`; **an outage at the boot's check**: a credential the stand-in revoked,
past the grace, `check` against the stand-in stopped exits 4, the stand-in restarted on the same port and state,
`check` exits 3, and `enroll --replace` with the same piped code enrolls anew and its `check` exits 0, all in one
home; `enroll --replace` under the same name after a rejection, with the same piped code, enrolls anew; `show`'s exit
codes; the enroll-parity run exits 0 with every line `ok`, and the vectors file holding a decoded case of each kind
and refused cases of each.

### M4 — Acceptance across both repositories

**What exists at its end.** Acceptance 1–11 run as written against the local hub from a MAWS worktree with M1 and M2
and a doperpowers worktree with M3, their transcripts recorded in this document's record; whatever they turned up fixed
in the milestone that owns it, with the fix's commit named in Progress. No new behaviour. The local hub serves the
web from `apps/desk-web/dist`, so `pnpm --filter desk-web build` runs before `pnpm --filter desk-hub local` and again
after any M2 fix made here, or the walk looks at a stale web.

**What it touches.** This document (Progress, Surprises & Discoveries, Outcomes); fixes where found.

**What it proves.** Acceptance 1–11, and the full suites of both repositories (acceptance 9).

## Concrete Steps

From the MAWS worktree root (`/tmp/maws-provkeys` in the authoring session; any worktree of branch
`desk-provisioning-keys`):

    pnpm install                                   # once per worktree
    pnpm --filter desk-hub typecheck && pnpm --filter desk-hub test
    pnpm --filter desk-web typecheck && pnpm --filter desk-web test
    pnpm --filter desk-web build                   # the local hub serves apps/desk-web/dist: build first, and again after a web fix
    pnpm --filter desk-hub local                   # the local hub: prints http://127.0.0.1:8747 and what follows

A provisioning code without a browser (the stand-in plays the browser; the hub never sees `key`):

    curl -s -X POST http://127.0.0.1:8747/standin/provisioning-code -d '{"prefix": "dc-", "offline_revoke_s": 3600}'
    # {"code": "smns-provision-v1.…", "key": "<the org key, base64url>", "id": "<the key's id>"}

Redeeming by hand, and the refusals (acceptance 3):

    curl -s -X POST http://127.0.0.1:8747/machine/enroll -H 'content-type: application/json' -d '{"token": "<the key's secret>", "machine": "dc-a-0001"}'
    # {"org":"local","machine":"dc-a-0001","client_id":"…","client_secret":"…"}
    curl -s -X POST http://127.0.0.1:8747/machine/enroll -H 'content-type: application/json' -d '{"token": "<the key's secret>", "machine": "build-3"}'
    # {"error":"prefix-mismatch","message":"…dc-…"}            (HTTP 403)
    curl -s http://127.0.0.1:8747/api/provisioning-keys            # as the admin (the stand-in signs you in as owner@example.com)
    # {"keys":[{"id":"…","label":"…","prefix":"dc-","uses":1,"max_uses":null,"machines":[{"name":"dc-a-0001","state":"pending"}],…}]}
    curl -s -X DELETE http://127.0.0.1:8747/api/provisioning-keys/<id>
    # {"revoked":"<id>"}

From a doperpowers worktree of the M3 branch, one scratch home per "machine" (the tests' shape; `S` is the CLI), the
code on stdin. The first machine's home is kept, since the conflict must come from another:

    S=sminos/skills/sminos/scripts/sminos
    export HOME_A=$(mktemp -d); export SMINOS_HOME=$HOME_A/sminos HOME=$HOME_A
    printf %s "$CODE" | $S hub enroll --name dc-a-0001; echo "exit $?"
    # enrolled this machine as dc-a-0001 at http://127.0.0.1:8747 (org local); its credential is …/daemon/hub.json (mode 600) / exit 0
    $S hub show; echo "exit $?"                      # machine  dc-a-0001 … / exit 0
    $S hub check; echo "exit $?"                     # enrolled as dc-a-0001 at http://127.0.0.1:8747 (org local): accepted / exit 0   — this confirms it (state active)
    printf %s "$CODE" | $S hub enroll --name dc-a-0001; echo "exit $?"
    # sminos: this machine is already enrolled at … as dc-a-0001 …: pass --replace … / exit 1   — the local guard, nothing sent
    export HOME_B=$(mktemp -d); export SMINOS_HOME=$HOME_B/sminos HOME=$HOME_B     # an empty home: another machine
    printf %s "$CODE" | $S hub enroll --name dc-a-0001; echo "exit $?"
    # sminos: another machine of this org is enrolled as dc-a-0001: pick another name — … / exit 3
    export SMINOS_HOME=$HOME_A/sminos HOME=$HOME_A                                  # back to the first machine
    $S hub leave; echo "exit $?"                     # left the hub as dc-a-0001 / exit 0
    $S hub leave; echo "exit $?"                     # this machine is not enrolled at a hub: nothing to leave / exit 0
    $S hub show; echo "exit $?"                      # this machine is not enrolled at a hub … / exit 1

The machine's own record and revocation by hand (acceptance 5), and what the revoked credential gets afterwards
through the Access stand-in (production's answer, from M1):

    curl -s http://127.0.0.1:8747/machine/enrollment -H 'CF-Access-Client-Id: <client_id>' -H 'CF-Access-Client-Secret: <client_secret>'
    # {"org":"local","machine":"dc-a-0003","state":"active","confirmed":"…"}
    curl -s -X DELETE http://127.0.0.1:8747/machine/enrollment -H 'CF-Access-Client-Id: <client_id>' -H 'CF-Access-Client-Secret: <client_secret>'
    # {"revoked":"dc-a-0003"}
    curl -si -X DELETE http://127.0.0.1:8747/machine/enrollment -H 'CF-Access-Client-Id: <client_id>' -H 'CF-Access-Client-Secret: <client_secret>' | head -c 300
    # HTTP/1.1 401 … content-type: text/html … Cloudflare Access …   — the stand-in no longer holds the token, as Access would not
    $S hub check; echo "exit $?"                     # sminos: … Access answered 401 to a credential enrolled <n> s ago, which may not have reached Access's edge yet / exit 4   (inside the grace; hub.json kept)
    $S hub leave; echo "exit $?"                     # the same reason / exit 1   (hub.json kept)
    # past the grace, without waiting ten minutes: enrolled written 700 s back, the recheck a second after the first 401
    python3 -c 'import json,os,sys,datetime as d; p=os.path.join(os.environ["SMINOS_HOME"],"daemon","hub.json"); j=json.load(open(p)); j["enrolled"]=(d.datetime.now(d.timezone.utc)-d.timedelta(seconds=700)).strftime("%Y-%m-%dT%H:%M:%SZ"); open(p,"w").write(json.dumps(j)); os.chmod(p,0o600)'
    export SMINOS_ACCESS_RECHECK_S=1
    $S hub check; echo "exit $?"                     # sminos: the hub no longer accepts this machine's credential: Access answered 401 / exit 3   (hub.json kept)
    $S hub leave; echo "exit $?"                     # the hub had already revoked dc-a-0003; the stale credential is removed / exit 0

The reboot rule by hand (acceptance 10), in `dc-a-0001`'s home after it is removed from the web, its `enrolled`
written 700 s back as above and `SMINOS_ACCESS_RECHECK_S=1`:

    # with the local hub stopped (revoked while the VM was down, and the hub unreachable at the boot's check):
    $S hub check; echo "exit $?"                     # sminos: the hub did not answer: [Errno 61] Connection refused / exit 4   (hub.json kept; show still exits 0)
    # the local hub started again; the same home, no reboot — the boot's retry of exit 4:
    $S hub check; echo "exit $?"                     # … Access answered 401 / exit 3
    printf %s "$CODE" | $S hub enroll --name dc-a-0001 --replace; echo "exit $?"   # enrolled this machine as dc-a-0001 … / exit 0
    $S hub check; echo "exit $?"                     # … accepted / exit 0

The vectors (M3), from the doperpowers worktree, over the MAWS commit that closed M1; the proof keeps Python's exit
status (a pipe into `grep -c` would hide a failure):

    npx esbuild <MAWS>/apps/desk-hub/src/protocol/identity.ts --bundle --format=esm --platform=neutral --outfile=/tmp/identity.mjs
    node sminos/tests/dx7-enroll-codes.gen.mjs /tmp/identity.mjs > sminos/tests/dx7-enroll-codes.json
    python3 sminos/tests/enroll_parity.py sminos/skills/sminos/scripts sminos/tests/dx7-enroll-codes.json > /tmp/parity.out; echo "exit $?"   # exit 0
    grep -c '^ok ' /tmp/parity.out; grep '^FAIL' /tmp/parity.out                                                                           # N, and no FAIL line
    sminos/tests/run-sminos-tests.sh                                                                                                       # the whole gate

Older sminos (acceptance 7), from any checkout, against the same `$CODE`:

    mkdir -p /tmp/old && git -C <doperpowers> archive origin/main sminos/skills/sminos/scripts | tar -x -C /tmp/old
    printf %s "$CODE" | python3 /tmp/old/sminos/skills/sminos/scripts/sminos.py hub enroll --name dc-a-0009; echo "exit $?"
    # sminos: enrollment code: not smns-enroll-v1 / exit 2

## Interfaces and Dependencies

### Storage (the Registry's SQLite; `CREATE TABLE IF NOT EXISTS`, and `ADDED_COLUMNS` for the column)

```sql
CREATE TABLE IF NOT EXISTS provisioning_keys (
  id TEXT PRIMARY KEY,              -- 128 random bits as 32 lowercase hex (newId)
  secret_hash TEXT NOT NULL UNIQUE, -- SHA-256 hex of the secret; the secret itself is never stored
  label TEXT NOT NULL, prefix TEXT NOT NULL,
  created_by TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL,
  max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0,
  offline_revoke_s INTEGER, revoked TEXT);
-- ADDED_COLUMNS.enrollments gains 'key TEXT': the provisioning key an enrollment was made through, null for a token's.
```

A key-made enrollment row: `state 'pending'`, `machine` set, `created_by` the key's creator, `ttl_s 900`, `expires`
900 s on, `key` the key's id, `token_hash` = `key:<id>`.

### Records and constants (`apps/desk-hub/src/protocol/identity.ts`)

```ts
export type ProvisioningKeyRecord = {
  id: string; label: string; prefix: string;
  created_by: MemberId; created: string; expires: string;
  max_uses: number | null; uses: number;
  offline_revoke_s: number | null;
  revoked: string | null;                       // when it was revoked; null while it enrolls
  machines: Array<{ name: string; state: MachineState }>;  // enrolled through it now, pending or active
};
export type ProvisioningKeyRequest = { label: string; prefix: string; ttl_s?: number; max_uses?: number | null; offline_revoke_s?: number | null };
export type ProvisioningKeyIssued = { key: ProvisioningKeyRecord; token: string };   // token: the secret, shown this once
export type ProvisioningKeys = { keys: ProvisioningKeyRecord[] };
export type ProvisioningKeyRevoked = { revoked: string };
export type ProvisioningKeyError = 'bad-shape' | 'not-admin' | 'unknown-key';
export const PROVISIONING_KEYS_PATH = '/api/provisioning-keys';
export const PROVISIONING_KEY_TTL_S = 7_776_000;      // 90 days
export const MIN_PROVISIONING_KEY_TTL_S = 3600;
export const MAX_PROVISIONING_KEY_TTL_S = 31_536_000;  // a year
export const MAX_PROVISIONING_KEY_USES = 10_000;
export const MIN_OFFLINE_REVOKE_S = 3600;
export const MAX_OFFLINE_REVOKE_S = 2_592_000;         // 30 days
/** `GET /machine/enrollment`: the machine's own record; `DELETE`: its own revocation. */
export const MACHINE_ENROLLMENT_PATH = '/machine/enrollment';
export type MachineSelf = { org: string; machine: string; state: MachineState; confirmed: string | null };
export type Left = { revoked: string };
export type RedeemError = /* today's nine, and */ 'key-revoked' | 'key-expired' | 'key-exhausted' | 'prefix-mismatch';

export type ProvisioningCode = { hub: string; org: string; token: string; prefix: string; key: string };
export type DecodedCode = ({ kind: 'enroll' } & EnrollmentCode) | ({ kind: 'provision' } & ProvisioningCode);
export function encodeProvisioningCode(code: ProvisioningCode): string;   // 'smns-provision-v1.' + base64url(UTF-8 JSON)
export function decodeProvisioningCode(text: string): ProvisioningCode;   // TypeError 'provisioning code: <reason>'
export function decodeCode(text: string): DecodedCode;                    // either prefix; unknown: 'enrollment code: not smns-enroll-v1 or smns-provision-v1'
```

`decodeProvisioningCode`'s refusals, in order and in these words: `not smns-provision-v1`, `damaged`, `no <field>`
for `hub`, `org`, `token`, `prefix`, `key` (a missing, empty or non-string field), `the hub is not a URL`, `the hub is
not https`, `the prefix is not admitted`, `the key is not base64url`, `the key is not 256 bits`. `decodeCode` on a
`smns-enroll-v1.` text answers `decodeEnrollmentCode`'s result tagged `enroll`, with its refusals as they are.

### Endpoints (DX7's envelope; bodies JSON at most 64 KiB)

| Request | Who | Answer | Errors |
| --- | --- | --- | --- |
| `POST /api/provisioning-keys` `{label, prefix, ttl_s?, max_uses?, offline_revoke_s?}` | an admin | `201 {key: ProvisioningKeyRecord, token}`; `token` 256 random bits base64url, shown once | `403 not-admin`; `400 bad-shape` naming the field: `label` 1–100 chars, `prefix` an admitted machine name, `ttl_s` a whole number 3600–31536000 (default 7776000), `max_uses` null or 1–10000, `offline_revoke_s` null or 3600–2592000 |
| `GET /api/provisioning-keys` | a member | `200 {keys: ProvisioningKeyRecord[]}`, revoked ones included, ordered by `created` | |
| `DELETE /api/provisioning-keys/<id>` | an admin | `200 {revoked: <id>}`; new enrollments refused from now; machines stay; a second call answers the same | `403 not-admin`, `404 unknown-key` |
| `POST /machine/enroll` `{token, machine}` with a key's secret as `token` | anyone holding the secret (Access bypasses the path) | `200 {org, machine, client_id, client_secret}`, as a token's redemption | today's, and `410 key-revoked`, `410 key-expired`, `403 prefix-mismatch`, `410 key-exhausted`; `409 name-taken` for a name an active machine or another credential's pending machine holds; a pending name of this key rotates (200) |
| `GET /machine/enrollment` | the machine, with its own service token | `200 {org, machine, state, confirmed}` (`MachineSelf`): its own record, answered by the Worker from the principal it resolved; a pending machine is confirmed by it, as by any authenticated request | `404 not-found` for a member; for a credential the Registry no longer holds, the Worker's `403 not-enrolled`, and once its token is deleted, Access's 401 before the Worker |
| `DELETE /machine/enrollment` | the machine, with its own service token | `200 {revoked: <name>}`: the revocation (Terms) on the caller's own enrollment, bound to it (§4); the same answer when the row no longer carries that enrollment ("already gone"), and then nothing is touched | as the `GET`'s |

The Worker's `machine()` gains the `GET` and the `DELETE`; `member()` the three routes; `GET /api/machines` is
unchanged. The stand-in (`local/standin.ts`) refuses a service token it does not hold as production Access does:
**401**, `content-type: text/html`, a body naming `Cloudflare Access` — the mark §6's rule and the deploy probe's A4
read. Its refusal of a person with no identity stays `403 {"error":"access-denied"}`.

### Registry (`apps/desk-hub/src/objects/registry.ts`), at M1's end

```ts
createProvisioningKey(member: MemberRecord, body: unknown): Promise<Result<ProvisioningKeyIssued>>;
provisioningKeys(): ProvisioningKeyRecord[];
revokeProvisioningKey(member: MemberRecord, id: string): Result<ProvisioningKeyRevoked>;
redeem(body: unknown): Promise<Result<Redeemed>>;               // a key's secret as `token`: §2's checks 2–8
revoke(member: MemberRecord, name: string): Promise<Result<{ revoked: string }>>;   // the admin check, then revokeMachine(name)
leave(machine: MachineRecord): Promise<Result<Left>>;           // revokeMachine(machine.name, { enrollment: machine.enrollment })
// private:
//   revokeMachine(name: string, expected?: { enrollment: string }): Promise<{ revoked: string }>
//     — the one path all three callers run. Reads the row by name; with `expected`, a row that is absent or carries
//     another enrollment is answered { revoked: name } at once and nothing of the name's is touched (the check is
//     before the Machine object's `revoke`, the first fence). Then today's loop: fence, re-read by name and
//     enrollment after the object answers, delete, orphan, revocations, retire.
//   sweepOffline(): reads its candidates {name, enrollment} in one synchronous step, then revokeMachine(name,
//     { enrollment }) for each in turn.
//   scheduleAlarm() and refreshOnline() aware of the offline deadlines.
```

### The stand-in (`apps/desk-hub/local/run.ts`)

`POST /standin/provisioning-code {prefix, ttl_s?, max_uses?, offline_revoke_s?, key?}` → `{code, key, id}`: a key
created as the admin, the code built around it with a fresh org key (or `key` when given), as the enrollment-code
helper does; printed in the local command's help beside it.

### The web (`apps/desk-web/src/enroll/enrollment.ts`)

```ts
export function createProvisioningKey(request: ProvisioningKeyRequest): Promise<ProvisioningKeyIssued>;
export function listProvisioningKeys(): Promise<ProvisioningKeyRecord[]>;
export function revokeProvisioningKey(id: string): Promise<ProvisioningKeyRevoked>;
export function prefixProblem(prefix: string): string | null;        // the grammar in words, or null
export function provisioningCode(parts: { hub: string; org: string; token: string; prefix: string; key: Uint8Array }): string;  // wipes `key`
export const BOOT_COMMAND = (prefix: string) => `printf %s "$CODE" | sminos hub enroll --name ${prefix}<machine>`;
```

### sminos (`sminos/skills/sminos/scripts/sminos_hub.py`), at M3's end

- `decode_code(text)` → `{"kind": "enroll", hub, org, token, machine, key}` or
  `{"kind": "provision", hub, org, token, prefix, key}`; `CodeRefused` with the hub's whole message.
- `sminos hub enroll [--name N] [--replace]` — the code on stdin or at the hidden prompt, never argv. Exit **0**
  enrolled (stdout `enrolled this machine as <name> at <hub> (org <org>); …`); **1** the hub refused or did not
  answer (one `sminos: …` line on stderr naming the refusal and what to do), except **3** for `name-taken`; **2**
  usage, a code on the command line, a `--name` that is not admitted, a name not under the code's prefix (refused
  before any request), or no code; already enrolled without `--replace` stays **1** as today.
- `sminos hub show` — today's text, local only; exit **0** a credential is held here, **1** none.
- **Reading an authenticated answer** (shared by `check` and `leave`): *accepted* — `200` with a JSON object naming
  the stored `org` and `machine`; *rejected* — **`403` whose JSON `error` is `not-enrolled`** (the Worker's), at
  once; or a **401 whose body contains `Cloudflare Access`** (Access's denial) when the credential is past the
  propagation grace (`ACCESS_GRACE_S` = 600 s after `hub.json`'s `enrolled`) **and** the same request, sent once more
  `ACCESS_RECHECK_S` = 90 s later (`SMINOS_ACCESS_RECHECK_S` overriding it), is answered the marked 401 again (the
  recheck's answer is read by the same rule, without a further recheck); *other* — everything else (no answer, a
  connection or TLS error, a 5xx, a redirect, a 404, a 403 of another error, a 401 without the mark, a marked 401
  inside the grace or a missing/unreadable `enrolled`, a 200 that is not the record), reported as what it was. The
  recheck is the only repeat; nothing else is retried.
- `sminos hub check` — `GET /machine/enrollment`; never writes. Exit **0** accepted (stdout `enrolled as <name> at
  <hub> (org <org>): accepted`); **1** not enrolled here (stdout `this machine is not enrolled at a hub`); **3**
  rejected (stderr `sminos: the hub no longer accepts this machine's credential: Access answered 401` or `…: the hub
  answered not-enrolled`); **4** other — undecided, ask again later (stderr `sminos: the hub did not answer: <error>`,
  `sminos: the hub answered <status> <body>`, or `sminos: Access answered 401 to a credential enrolled <n> s ago,
  which may not have reached Access's edge yet`; credential kept); **2** usage. At most 30 s on a dead hub; up to
  about 150 s (two requests and the recheck's wait) when Access refuses a credential past the grace.
- `sminos hub leave` — `DELETE /machine/enrollment`. Exit **0**: left now (`left the hub as <name>`), or rejected —
  the hub had already revoked it, or an earlier `leave`'s `200` was lost (`the hub had already revoked <name>; the
  stale credential is removed`), or not enrolled here (`this machine is not enrolled at a hub: nothing to leave`); in
  the first two `daemon/hub.json` is removed and the daemon stops its uplink within a second on its own. Exit **1**:
  other (a marked 401 inside the grace among it); the credential is kept, the reason on stderr, retry later. Exit
  **2**: usage.

### What the boot consumes (pinned for the devcloud session's spec)

- **The code:** `smns-provision-v1.<base64url>`; `smns-enroll-v1.` stays for one-time codes. The boot never decodes
  it; it pipes it whole: `printf %s "$CODE" | sminos hub enroll --name "$DEVCLOUD_NAME"`, as the image user in a login
  shell, with `$DEVCLOUD_NAME` = `dc-<label>-<4 hex>` (e.g. `dc-build-7f3a`) under a key whose prefix is `dc-`. The
  boot keeps nothing of the secret on the host: stdin (or the hidden prompt) is the CLI's only intake, and the only
  file enrollment leaves is `daemon/hub.json` (0600), the machine's own credential.
- **Every boot, before step 11:** `sminos hub check` (nothing written; at most 30 s on a dead hub, about 150 s when
  Access refuses a credential past the grace, since that 401 is confirmed by a second request 90 s later):
  - exit **0** — enrolled and accepted: skip the enrollment;
  - exit **1** — not enrolled here: `printf %s "$CODE" | sminos hub enroll --name "$DEVCLOUD_NAME"`;
  - exit **3** — the credential is present but rejected (revoked by an admin, by the offline sweep, or by an earlier
    `leave` whose answer was lost): `printf %s "$CODE" | sminos hub enroll --name "$DEVCLOUD_NAME" --replace`, the
    same key and the same name (the revocation freed it; this counts as a new use);
  - exit **4** — **undecided**: the hub could not be asked (unreachable, a 5xx, an answer that is neither), or Access
    refused a credential still inside its propagation grace (enrolled less than 600 s ago). Keep the credential; the
    boot may go on to start the daemon meanwhile, but it **owns the open decision**: run `sminos hub check` again
    later, with backoff, until it answers 0, 1 or 3, then act on that answer as above. Never re-enroll or remove
    anything on 4: an outage, or a credential still reaching Access's edge, is not a revocation; and never stop
    asking, since a VM revoked while it was stopped that booted into a brief hub outage learns it only from a later
    check — its daemon cannot re-enroll, never holding the key.
  - (`sminos hub show`, exit 0/1, says only whether a credential file is held; it asks the hub nothing.)
- **Exit codes of `hub enroll`:** 0 enrolled; 3 `name-taken` (pick another suffix and run again, same code); 1 any
  other refusal or no answer (stderr has the hub's reason in one `sminos: ` line; `key-revoked`, `key-expired`,
  `key-exhausted` need an admin, `mint-failed`/`busy`/no answer are retried by running the same line again; "already
  enrolled" without `--replace` is 1 too, which the `check` above avoids); 2 a mistake in the invocation, including a
  name not under the prefix.
- **`sminos hub leave`:** run over SSH before the server is deleted; exit 0 means the machine is no longer enrolled
  (left now, already revoked — the hub's `not-enrolled`, or Access's 401 past the grace and held on its recheck — or
  never was) and `hub.json` is gone; exit 1 means the hub could not be told (unreachable, a 5xx, or Access's 401
  inside the first 600 s after enrolling; the credential stays, a retry or the offline sweep covers it).
- **Offline auto-revoke:** per key, `offline_revoke_s`, null = never, 3600 to 2 592 000; the hub revokes a machine of
  the key once it has been offline that long (the hub's view: no project reports a fresh lease of its credential).
  After it, the VM's `sminos hub show` still exits 0 (its `hub.json` is stale), `sminos hub check` exits 3, and its
  daemon log says the hub answered 401 (or `403 … not-enrolled` in the minute before the token's deletion is
  confirmed); the boot's rule above re-enrolls it at the next start. The boot side chooses the value (6–24 h
  suggested) when it creates the key on the web.
- **The secret's reader** is the boot's own concern and exposure (§7): a project owner can read the org key.
- **sminos version floor:** **1.4.1**, the sminos plugin version M3 ships (doperpowers branch `desk-provisioning-keys`,
  head `0b0b324c`); an older sminos exits 2 with `enrollment code: not
  smns-enroll-v1`.

### Dependencies

No new library on any side. The hub: WebCrypto (`crypto.getRandomValues`, SHA-256) as today. The web: `desk-hub/
protocol`'s new exports. sminos: stdlib Python as today. The vectors' generator: esbuild and node, as today.

## Surprises & Discoveries

- Redemptions run the offline sweep, since it sits in `sweep()` and `redeem` runs `sweep()` first (as it already ran
  the revocations' and orphans' network work there): a redemption can wait on another machine's revocation. Kept, as
  the spec places it; a failed offline revocation backs off a minute so it does not slow every redemption.
- No suite starts from a Registry stored before M1, so the `enrollments.key` column's `ADDED_COLUMNS` path is not run
  on workerd by the suite (the executor checked the statement against the system `sqlite3`). Worth a deploy-time look.
- The full desk-hub suite under load once failed `session-plane.test.ts:746` (MAWS #88's presence assertion), a file
  M1 does not touch; it passed alone twice. Fixed on this branch at the orchestrator's request (`c2c4344cc`, a wait for the presence
  frame before asserting it, a fix to #91's test).
- `apps/desk-web/e2e-hub/session-plane.spec.ts` (outside the gate) failed five cases on M2's runs — the grid's
  offline-latency bound (3845 ms against 2500 ms) and four session-view cases — none opening the Machines dialog;
  whether they predate the branch is settled in M4. Settled: all five fail the same way on MAWS master (`82a0967ff`; the grid's offline
  latency 3844 ms there, 3861 ms on the branch), so they predate the branch; the other six cases pass on both
  (evidence: the SDE workspace's `e2e-hub-baseline.md`, logs `/tmp/dsk-scripts/pe-e2e-{master1,branch1}.log`).
- The one-time code's padding vector (`dx7-enroll-codes`) also ends its JSON in `x`, so it does not refuse on the
  padding alone; left as it was (the provisioning case, fixed, exercises the shared decoder's padding refusal).

## Decision Log

- Decision: Verification. The spec gets one independent review of the whole document
  (`doperpowers:adversarial-reviewer`) and, in the same round, an adversarial buildability review of the execution
  section (Plan of Work, Concrete Steps, Interfaces) by a second `doperpowers:adversarial-reviewer`. Each milestone is
  reviewed at its boundary by the SDE loop's `task-reviewer`; M1 and M3 at `reviewer-high` if the controller judges the
  credential paths warrant it. The whole-branch review at the end runs at **xhigh** (the `review-code` panel) on each
  repository's branch, because the change mints credentials from a stored secret and adds an unauthenticated-path
  branch to the hub.
  Rationale: a security-boundary change across two repositories, with a Durable Object concurrency argument (`uses`,
  the sweep's race) that a reviewer should try to break.
  Date/Author: 2026-10-21, the spec's author (subagent `smns-erb-71`, for the orchestrator).
- Decision: Deploy. The hub deploy happens after merge, by the orchestrator; the storage change (a new table and the
  `enrollments.key` column, through `CREATE TABLE IF NOT EXISTS` and `ADDED_COLUMNS`) is approved by the owner. No
  Access policy changes (the redemption keeps its path).
  Rationale: the owner's ruling of 2026-10-21; §2's endpoint decision keeps the deployment unchanged.
  Date/Author: 2026-10-21, the owner (via the orchestrator); recorded by the spec's author.
- Decision: The devcloud session's boot-side requirements (relayed 2026-10-21) are folded in as §7 (the real reader of
  the secret), §6 and Interfaces (`dc-` names, the piped `--name` line, the skip through `hub show`, exit codes with
  `name-taken` distinct), and §4 (ungraceful teardown as a per-key `offline_revoke_s`; the browserless admin revoke
  rejected and deferred with its future shape).
  Rationale: the boot consumes these; a fork the two specs disagree on would surface only at the first VM.
  Date/Author: 2026-10-21, the spec's author.
- Decision: The provisioning key reaches a host through `sminos hub enroll`'s stdin or hidden prompt only. No file
  holds the key on a host, and the CLI has no option to read a code from a file; the one file enrollment leaves is the
  per-machine credential, `daemon/hub.json` (0600), which the daemon reads. Devcloud's boot pipes the secret from
  Secret Manager into `hub enroll` and keeps nothing.
  Rationale: the owner's ruling (Korean, 2026-10-21 ~03:05Z): a key file for the daemon is not needed. Enrollment is
  a one-shot CLI step, not the daemon's; the daemon needs only the machine's own credential.
  Rejected: a 0600 key file the daemon reads (and a `--code-file` option to point at it), offered in case the owner
  wanted it — a key file is a disk artifact: it would travel in images, snapshots and backups and be read by anyone
  who reads the disk, where stdin leaves nothing. What it would not change is the VM's own reach, which already
  extends to Secret Manager (§7; this clause was corrected on review, the entry below).
  Date/Author: 2026-10-21, the owner; recorded by the spec's author.
- Decision: Spec review's fix wave (the technical review `ad84855e` and the buildability review `ad701d31`, both
  "needs-attention", checked against MAWS `7053a99f2` and doperpowers `e835d96b`; every finding accepted by the
  orchestrator). One line per change, each ruled by the orchestrator within the owner's authorization and recorded
  by the spec's author:
  1. **The self-revoke and the sweep bind to the enrollment, not the name** (§4, M1, Interfaces `revokeMachine`).
     The Worker resolves a credential in one Registry call and revokes in another; a revoke-and-re-enroll of the name
     between them would have revoked the replacement, since `revoke`'s loop protects only after its own first read.
     Rejected: resolving and revoking in one Registry call (`resolve` serves every route; a second RPC shape for one
     of them) — a check before the first fence is smaller and covers the sweep's held candidates too.
  2. **Access's denial is an explicit outcome** (Terms, §4, §6, M1, M3). A completed revocation deletes the token;
     production Access then answers 401 and the Worker never sees the request, so the first draft's "remove
     `hub.json` on `403 not-enrolled`" would never have fired for an admin-revoked machine or a lost `200`. The
     stand-in now answers what production answers (401, a page naming `Cloudflare Access`), the CLI reads that and
     the Worker's `not-enrolled` as one "rejected" outcome, and keeps every other failure distinct. Rejected: keeping
     the stand-in's 403 and teaching the CLI both (tests through it would prove a shape production never shows);
     reading any 401 or 403 as a revocation (an outage or an unrelated refusal would throw away a live credential).
  3. **`sminos hub check`, `GET /machine/enrollment`, and the boot's rule** (§4, §6, Interfaces, acceptance 10).
     `show` reads a file, the daemon never validates its enrollment, and the log line is unreliable once the token
     is gone; a reboot after a revocation would never have rejoined. Rejected: a remote `hub show` (its instant,
     local answer is relied on); `enroll` replacing a revoked identity without `--replace` (the guard against
     overwriting a live identity stays; `check` tells the boot when `--replace` is right); the daemon marking
     `hub.json` when refused (a second state in the credential file for every reader to learn); checking through
     `/machine/stream` (a check must not end the daemon's stream).
  4. **The security rationale corrected** (§7, and the stdin-only entry's rejected clause above). A devcloud VM runs
     with `cli-owner` ADC, a project owner, and can read Secret Manager again at any time: stdin-only keeps the key out
     of disk artifacts, not out of the VM's reach. The broader VM trust is recorded as accepted (devcloud hosts
     already carry project-owner credentials); the recovery path is written (revoke the key, then the machines its
     row lists); machines confirmed before a revocation survive by design. The owner's ruling is unchanged.
  5. **Buildability**: `enroll_parity.py`'s adapter compares the whole exception text and its "both kinds" check
     asserts one decoded case of each kind; the proof keeps Python's exit status; `pnpm --filter desk-web build`
     before the local hub and after a web fix; the name-taken walk confirms the first machine with an authenticated
     request and attempts the conflict from a separate empty home (the same home's already-enrolled guard answers
     first), then returns to the first home for `leave`.
  Date/Author: 2026-10-21, the orchestrator (rulings) and the spec's author.
- Decision: The four forks the spec's author raised are settled as the orchestrator's decisions within the owner's
  authorization, as written: a key's lifetime is a year at most and 90 days by default; `hub show` is local and exits
  0 or 1 on the credential file alone; `hub leave` removes `hub.json` (the `former` edge accepted); a revoked key's
  `offline_revoke_s` goes on applying to the machines it enrolled.
  Date/Author: 2026-10-21, the orchestrator; recorded by the spec's author.
- Decision: The fix wave's re-review (2026-10-21), two findings, both accepted and ruled by the orchestrator; numbers
  and placement chosen by the executing session (the plan-executor) and recorded here:
  1. **[P1] A single Access 401 does not mean revoked.** Access answers a freshly minted, valid token 401 until it
     reaches the edge (the deploy probe's A3 allows 60 s), so a quick check or `leave` after enrolling would have read
     a good credential as rejected — `check` exit 3, then `--replace` spending a key use or meeting `name-taken`, or
     `leave` deleting a live credential and revoking nothing. Now a marked 401 is a rejection only past a
     **propagation grace of 600 s** after `hub.json`'s `enrolled` (ten times the probe's bound) **and** when it holds on
     **one recheck 90 s later** (one and a half times the bound, so a clock that jumped at boot and made `enrolled` read
     old still leaves the whole window). Inside the grace it is indeterminate: `check` 4, `leave` 1, the credential
     kept. The Worker's `403 not-enrolled` stays a rejection at once. `SMINOS_ACCESS_RECHECK_S` overrides the recheck's
     interval for tests and the acceptance walk; the grace has no override (tests write an older `enrolled`). The
     propagating-token case lives in doperpowers' `hub_standin.py` (a knob: 401 for a held token's first requests, then
     admitted), where the CLI tests prove `check` and `leave` keep it; MAWS's local stand-in is not given the case
     (M1's scope unchanged), and the M4 walk shows the in-grace reading on a revoked credential instead.
     Rejected: retrying the 401 for the whole 60 s inside one call (a `leave` over SSH would hang a minute on every
     revoked machine, and a reboot within the minute would still misread it without the grace).
  2. **[P2] Exit 4 must not end recovery.** A VM revoked while stopped that boots into a brief hub outage checks 4,
     and nothing would check again: its daemon never holds the key and cannot re-enroll. The boot owns the open
     decision: exit 4 means "undecided — run `hub check` again later, with backoff, until it answers 0, 1 or 3, then
     act" ("What the boot consumes"); 4 itself stays non-destructive. The CLI half is proved in M3 (an outage at the
     check: 4 with the stand-in down, 3 once it is back, `--replace` through, in one home) and in M4's walk
     (acceptance 10 (c)). The boot's retry loop is devcloud's; the orchestrator tells that session.
  Date/Author: 2026-10-21, the orchestrator (rulings); recorded by the executing session.
- Decision: M1's executor's choices within the spec (commit `ccbb539b0`), kept by the controller: a rotation (§2
  check 6) needs the exact stored name, as the one-time path's match is exact — a case twin gets `name-taken`; `busy`
  answers any pending holder whose mint is in flight, as the table reads; the keys' SQL lives in
  `src/objects/provisioning-keys.ts` beside `org-keys.ts`, the Registry calling it; each `bad-shape` message starts
  with the first field that fails, and `ttl_s: null` is refused (only absence takes the default); a failed offline
  revocation is logged and retried a minute later (an in-memory `offlineRetry`), rather than re-arming the alarm at
  250 ms, since `sweep()` also runs before every redemption; candidates are swept in name order; the test hooks sit on
  the Registry (backdate `seen` for several machines, read/clear the alarm, hold/release `leave`; the sweep race reuses
  `faultNextRevoke`), and tests backdate `seen` rather than skew `Date.now()`, which would set a real alarm an hour
  ahead; the sweep has its own suite file and hub (`provisioning-sweep.test.ts`); the code helpers moved to
  `local/helpers.ts`, served by `run.ts` and the suites' proxy, and the provisioning helper also takes `label`; the
  stand-in's 401 page is small HTML whose contract is the status and the words `Cloudflare Access`.
  Date/Author: 2026-10-21, M1's executor; folded by the controller.
- Decision: M1's review fixes (`0602580be`): `mint` marks the enrollment busy, then persists its alarm, then calls
  Cloudflare, on both redemption paths, so a key-made pending row (which no `createEnrollment` scheduled) has a wakeup
  even if the object resets mid-mint; the offline revocation's retry wait is kept per enrollment and enforced in
  `sweepOffline` (one failing candidate does not hold back the others); one `reserve()` helper inserts the pending
  machine and clears its orphan for both paths, each inside its own transaction.
  Date/Author: 2026-10-21, M1's executor on review findings; folded by the controller.
- Decision: M2's executor's choices within the spec (commits `be133c3a3`, `d6195c5ce`), kept by the controller: the
  dialog splits into `MachinesDialog.tsx`, `CodeSteps.tsx` (the confirm and code steps both kinds share) and
  `ProvisioningKeys.tsx`; `ConfirmStep` takes `{question, meaning, issue, explain}` and keeps its test ids; the form's
  defaults are 90 days, offline revoke never, max uses empty for no cap (else 1–10000), label and prefix trimmed,
  `ttl_s` always sent; revoked keys list last, and an expired key never revoked stays among the active ones reading
  `expired <date>`; a revoke answered `unknown-key` shows a notice as a removal's `unknown-machine` does;
  `e2e-hub/session-plane.spec.ts`'s machine-removal case moved from 403 to 401 with M1's stand-in; a browser test of
  the key flow against the real local hub joins `e2e-hub/local-hub.spec.ts`. On review, a confirmation left before
  its code arrives asks the hub for nothing, for both kinds: the step tracks whether the owner is still on it, checks
  that before the request and before publishing the answer, wipes the key bytes on every path, and disables Cancel
  once the hub has been asked (a key the hub made cannot be unmade from the browser); closing the dialog during that
  request leaves the key listed unused (`0 / ∞`), revocable, which a test pins.
  Date/Author: 2026-10-21, M2's executor; folded by the controller.
- Decision: `leave` and a concurrent `enroll --replace` (M3's review, both reviewers): enroll's write of `hub.json` and
  `leave`'s removal take one lock, and `leave` removes the file only if it still holds the credential it checked. A
  replacement installed while `leave` waited (its 90 s recheck, or a slow `DELETE` answer) is kept and reported on
  stderr, and `leave` exits **1** — retry `leave` to end the new enrollment too. Rejected: exit 0, since the checked
  enrollment is gone — `leave`'s 0 means "this machine is no longer enrolled", which does not hold with a replacement
  installed; the caller runs `leave` to make the machine gone (usually before deleting the server), and devcloud's
  teardown proceeds on either exit with the offline sweep covering the rest, so 1 costs it nothing.
  Date/Author: 2026-10-21, the orchestrator (ruling); recorded by the controller.
- Decision: M3's executor's choices within the spec (doperpowers `f3ea1a0e`, `7831e8ac`), kept by the controller: a
  `hub.json` that cannot be used (unreadable or incomplete) gives `check` 4 and `leave` 1 and nothing is removed (3
  means the hub rejected it); `show` exits 0 whenever `hub.json` exists, readable or not, the test the `--replace`
  guard and the daemon's supervisor use; a missing `enrolled` reads as inside the grace, in words of its own; a
  provisioning code with no `--name` on a host whose name is not admitted exits 2 naming `--name <prefix>…`; the
  `prefix-mismatch` line keeps the hub's message, so a hand-built code shows the key's real prefix; `leave` writes a
  `daemon.log` line; `hub_standin.py` answers any token it does not hold with Access's 401 page on every `/machine/`
  path, ends a simulated outage when a file appears (no timer to race), and serves from a thread; the vectors were
  generated from copies of the hub's sources at `0602580be`, not the working tree M2 was changing;
  `SMINOS_ACCESS_RECHECK_S` is read as a float. On review: the lock is an `flock` on `daemon/hub.lock` (0600) held
  around enroll's write and `leave`'s check-and-remove, never across a request; `leave` compares client id and
  secret; an unreadable file at removal counts as a replacement and is kept; a file another `leave` already removed is
  reported as usual, exit 0. The provisioning padding vector now carries `=` on valid JSON.
  Date/Author: 2026-10-21, M3's executor; folded by the controller.
- Decision: M4's walk order and stand-ins (no code changed): item 10 was walked before items 4 and 5, since its
  `--replace` needs the `devcloud` key live (item 4 revokes it) and item 5 ends both machines item 10 relies on; item
  5's lost-200 machine enrolled through the stand-in helper's `dc-` key for the same reason; "no request" was read
  as the count of requests the Worker served in wrangler's captured traces (the local hub keeps no request log); the
  browser ran at `localhost:8747` as the e2e suites do. the controller's dispatch's `pnpm --filter desk-hub local -- --state …`
  fails: pnpm passes the `--` through and `run.ts`'s `parseArgs` refuses it; flags follow `local` directly
  (Concrete Steps passes none).
  Date/Author: 2026-10-21, M4's executor; folded by the controller.
- Decision: The whole-branch xhigh panels' fix wave (2026-10-21), one confirmed P2 per repository, both accepted by
  the orchestrator:
  1. **MAWS: a fenced offline revocation completes.** The sweep's revocation could place the `Machine` object's fence
     and lose its answer; a reconnect's lease report then made the next sweep drop or defer the retry (it read the
     machine online, or a new offline deadline), leaving a fenced credential whose name and token stayed held and
     which `GET /machine/enrollment` still called active — against §4's "once the fence is placed the revocation
     completes". Now a started revocation is recorded as unfinished (per enrollment, in memory) before its first
     await and retried after its minute until it completes, whatever the machine reads, with the alarm scheduled for
     it (`44a1909e4`); the sweep re-reads that record at dispatch, so overlapping sweeps keep the per-enrollment wait
     (`f992aeb81`, a reviewer-medium finding on the first fix). Accepted limit: a Registry restart between the lost
     answer and the retry forgets the record; the machine then takes the ordinary path, bounded because the fence
     refuses new streams — its lease lapses and the sweep completes the revocation one `offline_revoke_s` later.
     Rejected: a durable record (a kv key or column, storage the owner has not approved, for a window this rare).
  2. **doperpowers: only a complete answer is a rejection.** `ask()` took `bool(resp.length)` as proof of a whole
     body, which a chunked or close-delimited answer cannot give: a chunked `403 not-enrolled` missing its last chunk
     read as complete, and `leave` deleted the credential (`check` exited 3). Now an answer authorizes *rejected* only
     once its body is known complete (read to EOF or to a declared length without `IncompleteRead`); anything less is
     *other* — `check` 4, `leave` 1, the credential kept.
  Date/Author: 2026-10-21, the orchestrator (rulings); recorded by the controller.

## Outcomes & Retrospective

**What shipped** (MAWS branch `desk-provisioning-keys`, doperpowers branch `desk-provisioning-keys`, sminos 1.4.1).
An admin creates a provisioning key on the web (label, `dc-` prefix, expiry, optional cap, optional offline
auto-revoke) and sees its `smns-provision-v1.` code once; a VM pipes it into `sminos hub enroll --name dc-…` and is an
ordinary enrolled machine. The hub counts uses under a race, refuses a revoked, expired, exhausted or off-prefix
redemption in §2's order, rotates a lost answer's retry under the same key, binds every revocation (admin, the
machine's own `DELETE /machine/enrollment`, the offline sweep) to the enrollment it read, and sweeps a key's machines
once offline past its time. The machine side reads the hub's two refusals of a dead credential as one outcome, Access's
401 only past a 600 s propagation grace and a 90 s recheck; `hub check` answers 0/1/3/4 for the boot, `hub leave`
removes only the credential it checked. Acceptance 1–11 hold (M4's walk; items 6 and 11 through the hub suite).

**Against the purpose.** The unattended VM loop the Purpose names — create a key, enroll two machines with no human
step, revoke the key and see a third refused while the two stay, `leave` one, and a revoked VM re-enrolling on its own
through `check` 3 and `--replace` — was walked end to end against the local hub. What remains outside this change is
the boot's own loop (devcloud's, including its retry of `check` exit 4) and the deploy.

**What the reviews changed.** The spec's re-review moved Access's 401 from "revoked" to "revoked once past the grace and
held on a recheck" and made exit 4 the boot's to retry — the one design correction after approval. The milestone
reviews found four real defects, each fixed and re-reviewed: a key-made pending enrollment with no alarm until its mint
returned (M1), an offline-revocation backoff that redemptions bypassed (M1), a confirmation that could still mint a key
after Cancel (M2), and `leave` deleting a credential `enroll --replace` installed while it waited (M3). The first CI
gate caught a render-purity lint error M2's local checks missed.

**Lessons.** A reusable credential turns every "who acts on the file, when" question into a race worth a test: three of
the four review defects were interleavings across an await. Reading a refusal from an edge service needs that service's
propagation behaviour, not only its steady state — the deploy probe already held the 60 s fact the first draft missed.
The worktree guard cost every worker in this run a re-plan (friction tracker entry 11); script files run as
`zsh <file>` were the reliable route into a second worktree.

**After the panels.** Each repository's xhigh panel confirmed one P2 — a fenced offline revocation that a
reconnect could strand, and an incomplete body read as a rejection — both fixed and reviewed (Decision Log). Both are
the same lesson as the milestone reviews': a state read across an await, or a byte stream read as whole, decides
something irreversible.

**Left open** (in the PR bodies): a Registry restart between a lost revocation answer and its retry (bounded by the
key's `offline_revoke_s`); no suite starts from a Registry stored before M1 (`ADDED_COLUMNS` for
`enrollments.key`, checked at deploy); five `e2e-hub/session-plane.spec.ts` cases fail on master too (not this branch);
the one-time code's padding vector does not refuse on padding alone; the key row's `expired` label follows the day
clock, not the second.
