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
- [ ] Spec review: one independent review of the whole document and an adversarial buildability review of the
      execution section (Decision Log, verification entry).
- [ ] M1 — The hub: the key, its code, redemption through it, `uses`, revocation of a key, a machine's self-revoke,
      the offline sweep (MAWS).
- [ ] M2 — The web: provisioning keys on the Machines page (MAWS).
- [ ] M3 — sminos: both codes decoded, `hub enroll` through a key, `hub leave`, `hub show`'s exit code, the parity
      vectors regenerated (doperpowers).
- [ ] M4 — Acceptance across both repositories against the local hub; the record completed.
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
Bypass changes), answers `200 {revoked: <name>}` and runs the revocation (Terms) on the caller's own machine: its
stream ends with cause `revoked`, its credential is refused `403 not-enrolled` from then on, its service token is
deleted, its name is free, its machine project is retired with its log kept, and every project forgets it. A second
call with the same credential never reaches the Registry: the Worker's `resolve` finds no machine and answers `403
not-enrolled`, which the CLI reads as "already gone" (§6). Rejected: `POST /machine/leave` (a verb where the resource
is the enrollment); a Registry-side "left" state kept for the record (the revocation already leaves the enrollment
row and the retired machine project as history).

**The offline sweep.** A machine enrolled through a key whose `offline_revoke_s` is set, and which the Registry has
counted offline for that long, is revoked by the Registry's alarm through the same path as an admin's revocation,
with the same effects. Precisely, in `sweep()` beside the enrollment expiries: for each `active` machine whose
enrollment's `key` has `offline_revoke_s` not null, with `online = 0` and
`COALESCE(seen, confirmed) + offline_revoke_s <= now` — `confirmed` standing in for a machine that was never seen online,
which otherwise would never be swept — run the revocation. Pending machines are not candidates: the enrollment's 900 s
expiry already ends one that never connects. `scheduleAlarm` adds the earliest such deadline to the alarms it
considers, and `refreshOnline` schedules the alarm whenever it flipped a machine offline, so the alarm is set when the
clock starts, not only at the next unrelated wake.

**The race with a machine that comes back just after the cutoff.** The sweep's read of the machine row (`online`,
`seen`) and its call into the `Machine` object's `revoke` are one synchronous step; a project's lease report that
reaches `summary()` after that read does not save the machine. Once the fence is placed the revocation completes as
every revocation does (`revoke` re-reads the row after the object answers and deletes it; a credential minted
meanwhile is fenced too). The outcome is stated, not softened: the machine was gone for the configured time, and
returning in the same second as the sweep loses. Its daemon's next request is refused `403 not-enrolled`, its
daemon log says so (`the hub answered 403 {"error":"not-enrolled"}`), and the machine, if it still exists, is enrolled
again with a code (`sminos hub enroll --replace`). Rejected: re-checking `online` after the `Machine` object answers
and undoing the revocation (the fence is already placed; an undo would need a second credential and a second state,
for a window of one request).

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

**`sminos hub show`** prints what it prints today and **exits 0 when the machine is enrolled, 1 when not**, so the boot
skips the enrollment on a reboot without parsing prose.

**`sminos hub leave`** ends this machine's enrollment: it calls `DELETE /machine/enrollment` with the stored
credential (through the uplink's connection helpers, as `redeem_once` does). On `200`, or on `403 not-enrolled` (the
hub already revoked it, by an admin's hand or the offline sweep), it removes `daemon/hub.json` and prints one line
saying which (`left the hub as <name>` / `the hub had already revoked <name>; the stale credential is removed`), exit 0;
the daemon's `UplinkSupervisor`, which polls the credential file every 0.2 s while its child runs, stops the uplink
within a second and starts none while no credential is held, so no restart or `daemon` verb is needed. A machine that
is not enrolled here says so and exits 0: a teardown script runs `leave` on a VM whose boot may have failed before
enrolling. The hub unreachable, or any other refusal: the credential is kept, the reason is on stderr, exit 1, so the
teardown can retry. There is no `--local`: a VM the hub cannot be told about is deleted anyway, and the offline
sweep is for exactly that. Accepted edge: a Mac that enrolled under a name other than its host name and leaves writes
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
   connects (its daemon, or `curl -sN …/machine/stream` with its credential, as DX7's walk does), both read
   `enrolled`.
3. **The key's bounds hold at the hub and are told to the terminal.** `--name build-3` (no prefix) exits 2 before any
   request with `does not start with this key's prefix dc-`; redeeming by hand under `build-3` answers
   `403 {"error":"prefix-mismatch"}`; `--name dc-a-0001` again from a third home exits 3 with `another machine of this
   org is enrolled as dc-a-0001`; a key created with `max_uses: 1` enrolls one machine and answers the next
   `410 {"error":"key-exhausted"}` (exit 1); two redemptions fired at once under such a key get one `200` and one `410`.
4. **Revoking the key stops new enrollments only.** *Revoke* on `devcloud` (confirmation names the two machines that
   stay) → a third `sminos hub enroll` exits 1 with `this key was revoked`; `dc-a-0001` and `dc-a-0002` stay listed
   and connected; each can still be removed from Machines as today.
5. **A machine leaves on its own.** On `dc-a-0002`, `sminos hub leave` exits 0 with `left the hub as dc-a-0002`;
   `daemon/hub.json` is gone; `sminos hub show` exits 1; `GET /api/machines` no longer lists it at once, the grid no
   longer counts it, and the stand-in holds no service token named `desk-local-dc-a-0002` (deleted in the same call
   on the local stand-in; against Cloudflare, retried as an orphan until the API confirms). `sminos hub leave` again
   exits 0 with `not enrolled`. Removing `dc-a-0001` from the web, then `sminos hub leave` on it, exits 0 with
   `had already revoked`.
6. **A machine that vanishes is revoked after the key's offline time.** An hour is not walked by hand: the hub
   suite demonstrates it (M1's test, through the test-only path that backdates `seen`). With a key whose
   `offline_revoke_s` is 3600, a machine enrolled and connected, then its stream closed and its `seen` set an hour
   back: the Registry's alarm revokes it — `GET /api/machines` no longer lists it, its service token is gone, its
   machine project reads retired in the directory, and the next request with its credential is `403 not-enrolled`. A
   machine still online at the hour is not touched; a key with `offline_revoke_s` null never revokes.
7. **An older sminos refuses the code cleanly.** The `sminos/skills/sminos/scripts` of doperpowers `origin/main` from
   before M3, extracted whole (`git archive`), with the same piped code: stderr `sminos: enrollment code: not
   smns-enroll-v1`, exit 2, and the stand-in's log shows no request.
8. **One-time codes are untouched.** The web's *Enroll a machine* flow and `sminos hub enroll` with a
   `smns-enroll-v1.` code work as before; the regenerated `dx7-enroll-codes.json` keeps every earlier case green under
   `enroll_parity.py`, beside the provisioning cases.
9. **The suites pass:** `pnpm --filter desk-hub test`, `pnpm --filter desk-hub typecheck`, `pnpm --filter desk-web
   test`, `pnpm --filter desk-web typecheck` in MAWS; `sminos/tests/run-sminos-tests.sh` in doperpowers, its `codes
   parity` and enroll-parity lines all `ok`.

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
a machine can revoke itself; the Registry revokes machines of a key that have been offline past its time; the stand-in
hands out a provisioning code without a browser.

**What it touches.** `apps/desk-hub/src/protocol/identity.ts` (records, constants, the code's codec, `decodeCode`,
the endpoint types); `apps/desk-hub/src/objects/registry.ts` (schema and `ADDED_COLUMNS`, `createProvisioningKey`,
`provisioningKeys`, `revokeProvisioningKey`, `redeem`'s key branch, the revocation refactor into one private path with
three callers, `leave`, `sweepOffline`, `scheduleAlarm`, `refreshOnline`); `apps/desk-hub/src/worker.ts` (the three
`/api/provisioning-keys` routes in `member`, `DELETE /machine/enrollment` in `machine`, which needs the registry stub
passed in); `apps/desk-hub/local/run.ts` and `local/standin.ts` (`POST /standin/provisioning-code`);
`apps/desk-hub/test/` (a `provisioning.test.ts` beside `enrollment.test.ts`, the helpers in `test/support/clients.ts`,
and a test-only path in `test/support/send-fault.ts` + `worker-under-test.ts` that backdates a machine's `seen` or
moves the Registry's clock, since the Registry reads `Date.now()` and the sweep's deadline is an hour at least). The
composite is not edited by any milestone (a child cannot extend it; its Decision Log entry of 2026-10-21 is the
pointer here).

**Interfaces** — exposes everything under Interfaces and Dependencies; consumes DX7 as built.

**Decisions of this milestone.** The checks' order and statuses are §2's table; the enrollment row's construction is
§2's paragraph; `token_hash` for a key-made row is `key:<enrollment id>`. The revocation refactor: `revoke(member,
name)` keeps its admin check and delegates; `leave(machine)` and the sweep call the same private method by name, so
the three callers cannot drift (the pitfall seen while designing: `revoke` re-reads the row by `name` and `enrollment`
after the `Machine` object answers — keep that loop in the shared path, it is what makes a lost answer safe).
`refreshOnline` is synchronous and called from `summary()`, which is synchronous too: schedule the alarm with a
detached promise there, as `directoryChanged` detaches its sends. The sweep reads `offline_revoke_s` from the key row at
sweep time (a revoked key's value still applies, §3). The stand-in's helper takes `{prefix, ttl_s?, max_uses?,
offline_revoke_s?, key?}` and answers `{code, key, id}`, `key` reused when given, as the enrollment-code helper does.
`GET /api/provisioning-keys` is a member's; `POST` and `DELETE` an admin's (`not-admin` otherwise). `holdsAnything`
(what keeps `ensureOrg` from renaming a stored org after a deploy) counts `provisioning_keys` too: a key's code carries
the org id, so a key is built on it.

**What it does not touch.** The web. `GET /api/machines`'s answer. The `Machine` and `Project` objects (the revocation
reaches them through the calls they already take). The deployment (Access policies unchanged by design).

**What it proves.** Acceptance 3 (the hub's side), 6, and the hub halves of 2, 4 and 5. Behaviour its tests pin
beyond acceptance: the secret appears in no answer but creation's; the `uses` race (§2's last paragraph); a rotation
under the same key counts no use and refuses another key's pending name; a pending enrollment through a key expires as
a token's does (row gone, name free, token orphaned, `uses` kept); a lost mint through a key is found by name and
deleted at the next redemption; a revoked key's pending machine still confirms; `DELETE /machine/enrollment` by a
member is `404 not-found` (the route is a machine's); a second `DELETE /machine/enrollment` with the revoked credential
is `403 not-enrolled` from the Worker; the sweep leaves a machine with `seen` null and `confirmed` within the window;
the race of §4 (a lease report arriving after the sweep's read does not save the machine); every bound of §1's table
refused `400 bad-shape` with a message naming the field.

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

### M3 — sminos: both codes, enrollment through a key, `hub leave`, `hub show`, the vectors (doperpowers)

**What exists at its end.** §6 in the CLI: a provisioning code piped on stdin enrolls a prefixed machine; refusals
exit as pinned; `hub leave`; `hub show`'s exit code; the parity vectors regenerated over M1's MAWS commit; the sminos
plugin version bumped.

**What it touches.** `sminos/skills/sminos/scripts/sminos_hub.py` (`decode_code` → both prefixes and `kind`, `enroll`'s
name rule and local prefix check, `refusal`, exit codes, `leave`, `show`, `USAGE`, `cmd_hub`); the skill's
`SKILL.md`/`references/setup.md` (enrolling at provisioning time, `leave`, one paragraph each);
`sminos/tests/hub_standin.py` (keys: a configured key with prefix, cap, revoked/expired flags; `DELETE
/machine/enrollment`; a request log the tests read); `sminos/tests/test-hub.sh` (the cases below);
`sminos/tests/dx7-enroll-codes.gen.mjs` and `dx7-enroll-codes.json` (regenerated; the header's MAWS commit updated);
`sminos/tests/enroll_parity.py` (unchanged in logic; its docstring); `.version-bump.json`'s sminos files through
`scripts/bump-version.sh --plugin sminos`.

**Interfaces.** Consumes M1's `decodeCode` semantics (through the vectors), the redemption's new refusals, `DELETE
/machine/enrollment`. Exposes to the boot what Interfaces pins under "What the boot consumes".

**Decisions of this milestone.** `decode_code` answers a dict with `kind` (`"enroll"` or `"provision"`) and the kind's
fields, matching the hub's `decodeCode` field for field so the vectors compare whole dicts; `CodeRefused`'s text is the
hub's whole message (`provisioning code: no prefix`), and `enroll` prints it after `sminos: ` without adding a kind of
its own. `leave` reuses `uplink.connection`/the credential reader rather than a second HTTP client; a `200` and a
`403 not-enrolled` both end in `os.remove(hub.json)` followed by `sminos.forget_caches()`; any other outcome leaves the
file. The generator imports `decodeCode` for verdicts and `encodeProvisioningCode` for the positive provisioning cases,
and its negative cases mirror the one-time code's (another prefix, no prefix field, an empty prefix, a prefix that is
not an admitted name — `hub`, `-x`, 64 characters — a prefix that is not a string), plus one `smns-enroll-v1.` code
decoded by `decodeCode` to prove the tag. The regenerated JSON is written over the MAWS commit that closes M1, named in
the generator's header comment as the current one names `bd266073`. The version bump is the plugin's patch component
unless the SKILL.md change is more than a paragraph.

**What it does not touch.** The daemon and the uplink (the supervisor already stops the child when `hub.json`
changes). `sminos_host.py` and anything under `devcloud/` (the boot session's). `project init --hub`.

**What it proves.** Acceptance 2, 3 (the terminal's side), 4, 5, 7, 8, and the doperpowers half of 9. Its tests pin
(in `test-hub.sh` against `hub_standin.py`): a provisioning code piped with `--name dc-x` enrolls and `hub.json` is
0600 with no secret in any output; without `--name`, the host name is used when under the prefix, else exit 2 with
no request in the stand-in's log; each hub refusal's exit code and its stderr line; `name-taken` exits 3; a one-time
code still enrolls; `leave` — `200` removes the file and exits 0, `403 not-enrolled` removes it and says
`had already revoked`, a dead port keeps it and exits 1, a second `leave` exits 0 with `not enrolled`; `show`'s exit
codes; the enroll-parity lines all `ok` and the vectors file holding both kinds and both verdicts.

### M4 — Acceptance across both repositories

**What exists at its end.** Acceptance 1–9 run as written against the local hub from a MAWS worktree with M1 and M2
and a doperpowers worktree with M3, their transcripts recorded in this document's record; whatever they turned up fixed
in the milestone that owns it, with the fix's commit named in Progress. No new behaviour.

**What it touches.** This document (Progress, Surprises & Discoveries, Outcomes); fixes where found.

**What it proves.** Acceptance 1–9, and the full suites of both repositories (acceptance 9).

## Concrete Steps

From the MAWS worktree root (`/tmp/maws-provkeys` in the authoring session; any worktree of branch
`desk-provisioning-keys`):

    pnpm install                                   # once per worktree
    pnpm --filter desk-hub typecheck && pnpm --filter desk-hub test
    pnpm --filter desk-web typecheck && pnpm --filter desk-web test
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

From a doperpowers worktree of the M3 branch, one scratch home per "machine" (the tests' shape), the code on stdin:

    export SMINOS_HOME=$(mktemp -d) HOME=$(mktemp -d)
    printf %s "$CODE" | sminos/skills/sminos/scripts/sminos hub enroll --name dc-a-0001
    # enrolled this machine as dc-a-0001 at http://127.0.0.1:8747 (org local); its credential is …/daemon/hub.json (mode 600)
    sminos/skills/sminos/scripts/sminos hub show; echo "exit $?"          # machine  dc-a-0001 … / exit 0
    printf %s "$CODE" | sminos/skills/sminos/scripts/sminos hub enroll --name dc-a-0001; echo "exit $?"
    # sminos: another machine of this org is enrolled as dc-a-0001: pick another name — … / exit 3
    sminos/skills/sminos/scripts/sminos hub leave; echo "exit $?"
    # left the hub as dc-a-0001 / exit 0
    sminos/skills/sminos/scripts/sminos hub leave; echo "exit $?"
    # this machine is not enrolled at a hub: nothing to leave / exit 0

The machine's own revocation by hand (acceptance 5), and what the revoked credential gets afterwards:

    curl -s -X DELETE http://127.0.0.1:8747/machine/enrollment -H 'CF-Access-Client-Id: <client_id>' -H 'CF-Access-Client-Secret: <client_secret>'
    # {"revoked":"dc-a-0001"}
    curl -s -X DELETE http://127.0.0.1:8747/machine/enrollment -H 'CF-Access-Client-Id: <client_id>' -H 'CF-Access-Client-Secret: <client_secret>'
    # {"error":"access-denied"}   — the stand-in no longer knows the token (as Access would answer 401/403); against the Worker directly, {"error":"not-enrolled"}

The vectors (M3), from the doperpowers worktree, over the MAWS commit that closed M1:

    npx esbuild <MAWS>/apps/desk-hub/src/protocol/identity.ts --bundle --format=esm --platform=neutral --outfile=/tmp/identity.mjs
    node sminos/tests/dx7-enroll-codes.gen.mjs /tmp/identity.mjs > sminos/tests/dx7-enroll-codes.json
    python3 sminos/tests/enroll_parity.py sminos/skills/sminos/scripts sminos/tests/dx7-enroll-codes.json | grep -c '^ok '   # every line ok; exit 0
    sminos/tests/run-sminos-tests.sh                                                                                      # the whole gate

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
/** `DELETE /machine/enrollment`: the machine's own revocation. */
export const LEAVE_PATH = '/machine/enrollment';
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
| `DELETE /machine/enrollment` | the machine, with its own service token | `200 {revoked: <name>}`: the revocation (Terms) on itself | the Worker's `403 not-enrolled` for a credential the Registry no longer holds; `404 not-found` for a member |

The Worker's `machine()` gains the `DELETE`; `member()` the three routes; `GET /api/machines` is unchanged.

### Registry (`apps/desk-hub/src/objects/registry.ts`), at M1's end

```ts
createProvisioningKey(member: MemberRecord, body: unknown): Promise<Result<ProvisioningKeyIssued>>;
provisioningKeys(): ProvisioningKeyRecord[];
revokeProvisioningKey(member: MemberRecord, id: string): Result<ProvisioningKeyRevoked>;
redeem(body: unknown): Promise<Result<Redeemed>>;               // a key's secret as `token`: §2's checks 2–8
revoke(member: MemberRecord, name: string): Promise<Result<{ revoked: string }>>;   // the admin check, then the shared path
leave(machine: MachineRecord): Promise<Result<Left>>;           // the shared path on the caller's own row
// private: revokeMachine(name), the one path all three run; sweepOffline() inside sweep(); scheduleAlarm() and
// refreshOnline() aware of the offline deadlines.
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
- `sminos hub show` — today's text; exit **0** enrolled, **1** not.
- `sminos hub leave` — exit **0**: left now (`left the hub as <name>`), or the hub had already revoked it (`the hub had
  already revoked <name>; the stale credential is removed`), or not enrolled here (`this machine is not enrolled at a
  hub: nothing to leave`); in the first two `daemon/hub.json` is removed and the daemon stops its uplink within a
  second on its own. Exit **1**: the hub did not answer or refused with anything but `not-enrolled`; the credential is
  kept, the reason on stderr, retry later. Exit **2**: usage.

### What the boot consumes (pinned for the devcloud session's spec)

- **The code:** `smns-provision-v1.<base64url>`; `smns-enroll-v1.` stays for one-time codes. The boot never decodes
  it; it pipes it whole: `printf %s "$CODE" | sminos hub enroll --name "$DEVCLOUD_NAME"`, as the image user in a login
  shell, with `$DEVCLOUD_NAME` = `dc-<label>-<4 hex>` (e.g. `dc-build-7f3a`) under a key whose prefix is `dc-`. The
  boot keeps nothing of the secret on the host: stdin (or the hidden prompt) is the CLI's only intake, and the only
  file enrollment leaves is `daemon/hub.json` (0600), the machine's own credential.
- **Skip on reboot:** `sminos hub show` exits 0 when enrolled; the boot then does not redeem again.
- **Exit codes of `hub enroll`:** 0 enrolled; 3 `name-taken` (pick another suffix and run again, same code); 1 any
  other refusal or no answer (stderr has the hub's reason in one `sminos: ` line; `key-revoked`, `key-expired`,
  `key-exhausted` need an admin, `mint-failed`/`busy`/no answer are retried by running the same line again); 2 a
  mistake in the invocation, including a name not under the prefix.
- **`sminos hub leave`:** run over SSH before the server is deleted; exit 0 means the machine is no longer enrolled
  (left, already revoked, or never was); exit 1 means the hub could not be told (the offline sweep covers it).
- **Offline auto-revoke:** per key, `offline_revoke_s`, null = never, 3600 to 2 592 000; the hub revokes a machine of
  the key once it has been offline that long (the hub's view: no project reports a fresh lease of its credential).
  After it, the VM's `sminos hub show` still exits 0 (its `hub.json` is stale) while its daemon log says the hub
  answered `403 not-enrolled`; re-enrolling is `sminos hub enroll --replace` with a code. The boot side chooses the
  value (6–24 h suggested) when it creates the key on the web.
- **The secret's reader** is the boot's own concern and exposure (§7): a project owner can read the org key.
- **sminos version floor:** the sminos plugin version M3 bumps; an older sminos exits 2 with `enrollment code: not
  smns-enroll-v1`.

### Dependencies

No new library on any side. The hub: WebCrypto (`crypto.getRandomValues`, SHA-256) as today. The web: `desk-hub/
protocol`'s new exports. sminos: stdlib Python as today. The vectors' generator: esbuild and node, as today.

## Surprises & Discoveries

(None yet; filled by the executors and M4.)

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
  wanted it — a reusable key left on every VM's disk widens what a compromised VM yields, from one machine's
  credential to the power to mint machines until the key expires or is revoked.
  Date/Author: 2026-10-21, the owner; recorded by the spec's author.

## Outcomes & Retrospective

Pending — written at finish.
