# Deploying the hub

The hub runs on the owner's Cloudflare account behind Cloudflare Access (DC3's
plan, M5; the composite's DX7), as two deployments. Each has a configuration
naming its account, Worker, host, owner and org:

| Configuration | Worker | Host | Org | What it is |
| --- | --- | --- | --- | --- |
| `config.json` (the default) | `desk-hub` | `desk-hub.opencognita-platform.workers.dev` | `ssfskim` | Production: the owner's machines and phone |
| `staging.json` | `desk-hub-staging` | `desk-hub-staging.opencognita-platform.workers.dev` | `staging-ssfskim` | Staging, for live tests (P5 O11's M2); agents deploy here and nowhere else |

Everything here goes through one command, run from the MAWS worktree root:

    pnpm --filter desk-hub deployment <deploy|probe|fake-check|redeploy-check|measure|frame-cost|counts|access-sync|relay-measure|acceptance|endpoint-acceptance|admin> [--config deploy/<file>.json] [options]

Each command acts on the deployment `--config` names, `config.json` when it
names none (the path resolves from `apps/desk-hub`, where pnpm runs the
command). Below, `$HUB` stands for that deployment's `https://<host>`.

## The target

Every wrangler call the tool makes names its Worker with `--name <worker>`
and its account with `CLOUDFLARE_ACCOUNT_ID`, both from the configuration;
wrangler.jsonc's own `name` (`desk-hub`) is never relied on. Wrangler also
takes its Worker, account, API and logging from its environment
(`WRANGLER_CI_OVERRIDE_NAME` renames the Worker outright) and from `.env`
files beside wrangler.jsonc, so it runs with an allow-listed environment
(what locates the system, the login and the network; no inherited
`WRANGLER_*` or `CLOUDFLARE_*`), `--env-file /dev/null`, wrangler.jsonc named
by path, sanitized logs and no log written to disk (a `secret put` carries a
credential). Before anything changes, `deploy` refuses:
- a configuration whose `host` is not its `worker`'s (`<worker>.<subdomain>.workers.dev`);
- a wrangler.jsonc whose `account_id` is another account, and a build tool's redirect (`.wrangler/deploy/config.json`);
- any call that would pick its Worker, configuration or login another way (`--name`, `--env`, `--config`, `--cwd`, `--env-file`, `--profile`);
- `--config` given twice (the last would win).

Each call prints the target it checked, as `wrangler target <worker> (config
worker <worker>, account <id>): <command>`. `redeploy-check`'s redeploy is
`deploy`'s own and takes the same check.

Staging is its own Worker, so its own Durable Objects, Access applications,
policies and secrets (its own `VAPID_KEY`; `CF_API_TOKEN` is the same
service-token API token as production's). Its org id is `staging-ssfskim`:
a machine's service token is named `desk-<org>-<machine>` in the account-wide
namespace, and redemption deletes every token of that name first. A staging org
named `ssfskim` would delete production machines' credentials, and so would one
that extends it (`ssfskim-staging` with machine `x` is `desk-ssfskim-staging-x`,
production's name for a machine `staging-x`). No production token name starts
`desk-staging-`.

## Credentials

Every command reads its credentials from the environment or as `NAME=value`
lines on stdin, so they reach no process's arguments and no file of the
repository:

| Name | What it is | Used by |
| --- | --- | --- |
| `CF_ACCESS_SETUP_TOKEN` | An API token with Access: Apps and Policies Edit, Service Tokens Edit, Organizations Read | `deploy`, `redeploy-check`, `access-sync` |
| `DESK_MACHINE_CLIENT_ID`, `DESK_MACHINE_CLIENT_SECRET` | The service token of a machine enrolled in the deployment's org | `access-sync` |
| `CF_DESK_HUB_SERVICE_TOKENS` | An API token with Access: Service Tokens Edit only. It becomes the Worker's `CF_API_TOKEN` secret, with which the hub mints and deletes machines' service tokens | `deploy`, `probe`, `redeploy-check` |
| `DESK_ACCESS_TOKEN` | A person's Access session as an app token for one deployment: `cloudflared access login $HUB` once (a browser sign-in), then `cloudflared access token -app=$HUB` | `probe`, `fake-check`, `redeploy-check`, `measure`, `counts`, `relay-measure`, `acceptance` |

The owner keeps the two API tokens under
`~/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers/`.
For example:

    S=~/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers
    printf '%s\n' "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)" "CF_DESK_HUB_SERVICE_TOKENS=$(cat $S/CF_DESK_HUB_SERVICE_TOKENS)" \
      | pnpm --filter desk-hub deployment deploy --config deploy/staging.json --assets "$PWD/apps/desk-web/dist"

(without `--config`, the same deploys production.)

The logged-in wrangler (`wrangler login`) does the Worker's own upload. Its
OAuth token carries no Access scopes, which is why the setup token exists.

## `deploy`

`deploy` runs in an order that never leaves anything reachable unguarded:

1. **Access.** It reads the team domain (`GET /accounts/<id>/access/organizations`,
   `auth_domain`), then creates or updates by name, in place:
   three reusable policies and two self-hosted applications, each named after
   the Worker (`<worker>` below: `desk-hub` or `desk-hub-staging`), so the two
   deployments' Access objects never meet:
   - three reusable policies:
     - `<worker> owner`: Allow, the owner's email. Created so when absent and never rewritten after: its email list is `access-sync`'s (below), and a deploy that reset it would shut out every member the org state admitted;
     - `<worker> machines`: Service Auth, any Access service token;
     - `<worker> public paths`: Bypass, everyone;
   - two self-hosted applications:
     - `<worker>`: the whole workers.dev host, with owner and machines, a 30-day session (`720h`, the owner's choice of 2026-10-18: a 24 h session left the phone signed out each day), and 401 for a failed service token in place of a redirect;
     - `<worker> public paths`: `/machine/enroll`, `/manifest.webmanifest`, and `/icons/*` on the same host, Bypass. It is more specific, so it takes precedence.

   A hostname-level application is used, not the Worker's own Access toggle, which refuses WebSocket upgrades. Access admits any service token of the account; the hub's Registry refuses a client id it never enrolled (`403 not-enrolled`).
2. **The Worker** (`wrangler deploy --name <worker>`), with its variables on the command line (`--var`): `ORG_ID`, `ORG_NAME`, `ORG_ADMIN_EMAIL`, `ACCESS_ISSUER`, `ACCESS_AUD` (the `<worker>` application's AUD), `ACCESS_CERTS_URL`, `CF_API_URL`, `CF_ACCOUNT_ID`. `wrangler.jsonc` keeps them empty on purpose. A deploy made any other way (a plain `wrangler deploy`) resets them, and the hub then answers `503 not-configured` to everything until `deploy` runs again. `--assets <dir>` serves the web app's build from `<dir>` (default `apps/desk-web/dist`). Pass it on every deploy once the web app is live: a deploy without it uploads whatever `apps/desk-web/dist` holds, possibly nothing. Give it absolute: pnpm runs the command in `apps/desk-hub`, where a relative `<dir>` would resolve.
3. **The secrets**, each put only when the Worker lacks it:
   - `CF_API_TOKEN`, from `CF_DESK_HUB_SERVICE_TOKENS` (`--put-api-token` rotates it);
   - `VAPID_KEY`, generated once. Browsers' push subscriptions are bound to it, so it is never regenerated, and it exists nowhere but the Worker.

Every answer the Worker makes, except a WebSocket upgrade, carries
`X-Desk-Build`. The value names the build:
- `hub@<commit>`, where the commit is the hub's, with `+dirty` when its tree differed;
- `web@<label>` when `--web <label>` named the web build (`--web smns-erb-web.0fa05392`, say).

So `curl -sI -X POST $HUB/machine/enroll` shows what is deployed, without
credentials.

Options:
- `--config <file>`: the deployment (default `config.json`).
- `--org-id`, `--org-name`: override the configuration's org. The proofs ran under a throwaway org, `dc3-m5-test`.
- `--web <label>`: what the web build is, for `X-Desk-Build`.
- `--access-only`: set up Access and stop.

The org id is written into every project's `.smns` (`hub.org`) and into each
machine's service-token name (`desk-<org>-<machine>`), so changing it later
means enrolling every machine again.

## `access-sync` (an Access change)

Access fronts the whole host, so a person reaches the hub only if the people
policy `<worker> owner` lists their email. Once the org has a signed state
(O11's Registry), members are added, removed and have their emails changed by
signed successors, and `access-sync` makes the policy's list exactly the
head's member emails; before any state, the owner alone. It refuses a
configuration whose `host` is not its `worker`'s before it reads or writes
anything.

It reads the state as a machine, through `GET /machine/org/state` with an
enrolled machine's service token, never as a person: once a successor changes
the only member's email, the Registry refuses the old email at once and Access
refuses the new one until this runs, so no person could read the head. The hub
is then its only witness, so the tool reads the chain from its genesis (which
must be this deployment's org) and verifies every step with the protocol
package before it uses the head. It upserts the policy by name, reads it back
through the Access API and prints what Access now admits.

Being the only witness, the hub is trusted no further than two anchors the
operator holds:
- **`orgGenesis`** in the deployment's configuration: the org's genesis hash
  (`stateHash` of the genesis OrgState, the `prev` its version 2 carries), as
  the admin's device that signed it holds it. Add it once the org is set up.
  Without it only "no state yet" is taken; with it, a chain whose genesis is
  another is refused, however well it verifies.
- **A checkpoint** of the last head a run accepted, `{org, version, hash}`, in
  `~/.local/state/desk-hub/<worker>.json` (`DESK_HUB_STATE_DIR` moves the
  directory). Each run's chain must hold that version under that hash, so an
  older state served as the head, or "no state" once the org is set up, is
  refused. It moves to the new head before Access is touched, so a run whose
  Access write lands but whose answer or read-back is lost still refuses the
  older state next time; a run that cannot write it touches no Access. Delete
  it only on purpose, after checking the head another way.
- **A lock**, `<worker>.json.lock` beside the checkpoint, held for the whole
  run, so two runs (a retry beside a slow run, in another terminal) never
  overlap: the second is refused before it reads anything, naming the lock's
  pid, host and start time (and, when that pid is gone from this host, saying
  so). A run ended by Ctrl-C, a closed terminal or a SIGTERM removes its own
  lock as it exits (130, 129, 143). A lock is never taken over, even one whose
  run died: remove it by hand once you have checked that no run is going. A member the state
admits, or an email it changes, reaches the hub only after this runs; one it
removes is refused by the Registry at once, and by Access once this runs.

    printf '%s\n' "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)" "DESK_MACHINE_CLIENT_ID=<id>" "DESK_MACHINE_CLIENT_SECRET=<secret>" \
      | pnpm --filter desk-hub deployment access-sync --config deploy/staging.json

(the machine's credentials from its enrollment, read inside a script and never
printed). On production it changes production's Access, which waits for the
owner.

## After the first deploy (the owner)

1. Open `$HUB` in a browser and sign in ("Sign in with Cloudflare"; the team allows account members, and the policy the owner's email).
2. Set up the org key first (the web app's first unlock method, DX7). An org whose key someone else set up first cannot be unlocked by the owner.
3. Enroll machines from the web app's "Enroll a machine" (`sminos hub enroll` on each, the code pasted at its hidden prompt).
4. Run `cloudflared access login $HUB` once, so the commands that need `DESK_ACCESS_TOKEN` can be given one.

## `counts` (read-only; the owner's org)

The composite's Parent-Level Acceptance 10 compares, writer by writer, each
machine's log files with the hub's log. `counts` reads the hub's half through a
project socket as the person whose `DESK_ACCESS_TOKEN` it is given: it resumes
the log from offset 0 to `caught-up` and sends nothing else (no visibility, no
`human`, no RPC, no subscription), so it runs against the configuration's own org.
`machine-counts.py` reads a machine's half from its log files
(`$SMINOS_HOME/projects/<id>/log/`) and its enrolled and former names (from
`daemon/hub.json`, nothing else of it), standard library only, so a machine with
no MAWS checkout runs it over ssh:

    python3 apps/desk-hub/deploy/machine-counts.py --dir <checkout> > /tmp/sk.json
    ssh mini python3 - --dir <checkout on the mini> < apps/desk-hub/deploy/machine-counts.py > /tmp/mini.json
    printf 'DESK_ACCESS_TOKEN=%s\n' "$(cloudflared access token -app=$HUB)" \
      | pnpm --filter desk-hub deployment counts --project <id> --machine /tmp/sk.json --machine /tmp/mini.json [--audit]

Per writer it prints the count and last seq on each side and a verdict:
`agrees`; `explained`, for a position that machine refused (the audit's
`rejected`, or its own `spent` list in the project's `uplink.json`) or a writer
under one of the machine's own former names (`former` in its `hub.json`, the
names it wrote under before it enrolled), which stays local; or `differs`. The
comparison goes position by position: every position both sides hold must carry
the same event (kind and ts), so a refusal never hides a change elsewhere, and a
writer of another machine missing at the hub differs. A log line that is not an
event makes its machine differ too: `machine-counts.py` still writes the
snapshot, names the lines on stderr, and exits 1. `counts` exits 1 when anything
differs, and refuses a snapshot taken by an older `machine-counts.py`. The audit
is the hub's replay after `caught-up`, its latest 100 rows. `--audit` also prints
those rows (`decided` carries who settled each request); `--json` prints the
hub's half alone.

## The org-state commands (O11): `relay-measure`, `acceptance`

These act as the org's admin, through a test device's keys: `--device-keys <file>`, a JSON file
`{"keys": {"a1.channel": <JWK>, "a1.stepUp": <JWK>, "recovery": <JWK>}}` of private keys (keep it 0600; it is read and
never printed, nor quoted when it does not parse). The device's step-up key signs the successors they post, so it must
be a root key of the head. They act only on staging, by its exact names (`config.ts`: the Worker `desk-hub-staging`
at `https://desk-hub-staging.opencognita-platform.workers.dev`), or the suites' loopback hub; no pattern, since wrangler
names a version's preview alias `<alias>-<worker>.<subdomain>.workers.dev` and `desk-hub-staging-desk-hub.…` would be
one of production's. Production's host, its Worker and a preview alias of it are refused by name first, before a
credential is read or the hub asked anything, whatever the
configuration's org, its `orgGenesis` or `--test-org` say (`redeploy-check`, whose RL1 leg writes the state, likewise).
Within that, they write the state only where an operator's anchor allows:
- in the configuration's own org, only when it serves a chain whose genesis is the configuration's `orgGenesis`
  (staging's is pinned, and a configuration that pins none is refused; production's, pinned since its rollout, never
  gets this far, refused by name above), and never a genesis;
- in a throwaway org named with `--test-org` (proof.ts's rule), where they post the genesis when it has none.

Each machine they enroll is listed by a signed successor, owned by the device's member, and taken out again by another (its key retired, an honest departure, so what it signed keeps verifying), and
revoked, which deletes its service token. A service token Access has just minted is refused for up to about a minute,
so they wait it out.

They undo what they made however they end, an operator's Ctrl-C (SIGINT) or a timeout's kill (SIGTERM) included: the
signal stops the run, gives a request in flight 5 s to land, runs the cleanup (each step within 30 s) and exits 130 or
143. A second signal exits at once, printing the cleanup steps not yet done — what may be left on the deployment.

- `relay-measure` (U2): a machine `m8-rm-<tag>` whose endpoint echoes, and the reference client's Machine socket to it,
  both run here. Every frame is synthetic and RL2-sized: a 64-bit sequence number, random bytes for the ciphertext and a
  16-byte tag, which the hub cannot tell from a sealed frame. It prints a channel's opening, the round trip app → Machine
  DO → endpoint → back at 1 KiB and 64 KiB of plaintext (p50, p95, p99, one frame in flight, `--samples`, default 200), and
  the sustained throughput of 256 KiB frames (`--seconds`, default 10, `--window` in flight, default 4), every echo
  checked byte for byte; then the tailnet verdict (over 150 ms of p95 at 1 KiB, the direct tailnet carrier becomes
  O10's default).
- `acceptance`: O11's acceptance items 2 (delegation), 3, 4, 5 and 6 (`--items`, default all), one line per check:
  - 2: a successor off the head refused `not-head` and the genesis posted again `rollback`; a member
    `o11-m8-<tag>@staging.invalid` added with a device b1, and a second device b2 refused unendorsed
    (`endorsement-missing`) and endorsed but signed by the member's devices alone (`not-root-signed`), then admitted
    endorsed by b1 and admin-signed; a provisioning key re-issued as a delegation, a VM `m8-vm-<tag>-1` redeeming it and
    posting its certificate, which `GET /api/org/state` serves and which verifies against the head;
  - 3: `--frames` (default 1 000) frames of 1 B to 256 KiB through a channel to the machine `m8-ep-<tag>`, byte-identical
    and in order, then a message over 1 MiB closing the socket 1009;
  - 4: in a project the machine opens, its v2-only, dual-coded and v1 events stored; a broken signature and a key the
    state does not list for the writer refused `bad-signature`; a byte-identical resend taken as a duplicate, a
    re-signed one refused `conflict`; and the same for the device's own v2 `human`;
  - 5: a push subscription bound to the device at a sink this command runs, then a notify for a session listed for the
    device's member and one listed for another member: exactly one notice arrives, decrypted with the subscription's
    keys as `{project, machine, session, kind}`. The hub must reach the sink over https: `--push-url <https base>`
    forwarded to `127.0.0.1:<--push-port>` (a tunnel the operator runs); without them the item is skipped. Every other
    subscription the member holds on the deployment gets the same notice;
  - 6: the reference client's run (`org-protocol` `referenceCheck`) with the device's channel key, the project and the
    machine.

  Its cleanup posts the successors that take the member out (their device keys revoked), the machine and the delegation out (the delegation's key revoked: its id
  and prefix stay reserved for good, RL DL 26), retires the VM's certificate, revokes both machines and the provisioning
  key and deletes the push subscription; it then reads the head and the hub's lists back and prints `LEFT …` for
  anything of its own still current. What outlives a run, by design: the state's new versions, the machines' names in
  `machineNames`, their retired keys and the delegation's revoked one, the certificate and its retirement, the
  machine's listings, and the project with its events (a project outlives its machines).

    printf 'DESK_ACCESS_TOKEN=%s\n' "$(cloudflared access token -app=$HUB)" \
      | pnpm --filter desk-hub deployment acceptance --config deploy/staging.json --device-keys <file> [--push-url <https> --push-port <port>]

## `endpoint-acceptance`: MAWS's endpoint on a real machine (P5 O10 M11)

O10's acceptance items 2-5, 8 and 9 against a real `mawsd` (`endpoint-acceptance.ts`, its items in
`endpoint-items.ts`, its verdicts in `endpoint-verdicts.ts`). The machine is a scratch scene on the devcloud acceptance
VM (`vm/`): the user `o10acc`, a `mawsd` built from the branch on a scratch profile with the direct listener on 47831,
a sminos cut over to it and one terminal `claude` session under that sminos whose model is a stub (`vm/stub-model.mjs`),
and, for item 2's lane B half, a session in that `mawsd`'s own engine host started over `machine.sock` with no app
(`vm/lane-b.mjs`: `session.create`, then `session.start` on the gateway route, which `MAWS_RELAY_URL` points at the
same stub, the engine on a config dir of `mawsd`'s holding the sminos plugin from the scene's own directory
marketplace), its delivery judged against the engine host's own numbering read over `machine.sock`; all in a private
mount namespace that hides the VM's managed settings; every step on the VM is a 0600 script handed to
`devcloud vm ssh <vm> --root` on its stdin and unlinked at once (`endpoint-machine.ts`). The run enrolls the scratch
`mawsd` by a code the staging admin mints and lists it, adds a second member, drives each item over the relay and over
the tailnet (`TamperRelay` and the run's own relays in the path for item 3), and undoes all of it, the policy included.
One `PASS <item>`, `FAIL <item>` or `NOT SHOWN <item>: <why>` per item, the suites' and other children's clauses named
under it; then `LEFT …` for anything still there. `staging-run.sh endpoint` runs it (production compared before and
after), `staging-run.sh endpoint-vm setup <base> | teardown` sets the scene up or removes it. Production (item 7) is a
mode of its own, refused unless asked for by `--production --confirm-production <production's host>` with production's
config (`endpoint-production.ts`), and driven by `vm/production.sh` against the VM's own `mawsd` and sminos. Its
machine is pinned (`PRODUCTION_MACHINE`: the VM `dc-acceptance-7f80`, its name and its ref), checked before the owner
is asked for anything, and dialled directly on 47830 unless `--direct-url` names another address. It runs items 2–5
(its default; `--items` naming 8 or 9 is refused, their probes being staging's), and of them only the clauses its
allowlist names (`PRODUCTION_CLAUSES` in `endpoint-items.ts`): VM-local work, reads, and at most five
events marked `o10 m11 acceptance` posted in the machine's own project (`HubWrites`, which refuses a sixth or any other
project itself); never a hub deploy, an org-state change, or a spawn the daemon is asked to refuse (a broken refusal
would launch a seat), which it reports `NOT SHOWN`. Its lane A session runs as the owner's user, since that sminos
does, against the stub model under `env -i`, with a scratch `CLAUDE_CONFIG_DIR` holding the sminos plugin alone and
`/etc/claude-code` hidden by a private mount namespace; the run names the session (`--session-id`) and checks its
engine is that one before using it, and calls a process its own only inside that namespace (item 4's local spawn is
declined while any other claude of the owner's runs). `down` ends it and removes the scratch directory. The marked
events, the events the run's sessions wrote (counted by writer, from the offset the log stood at before lane A), the
machine's project and its history stay, printed as `KEPT …` lines.

## `admin`: the owner's hand on the org state (P5 O13 M2)

Until O8's Org page, the owner roots a deployment's org, pairs a device into it, revokes one and keeps the head
fresh from the Mac with this command and an admin device of its own. It acts on the deployment `--config` names
(production's `config.json` by default) as the signed-in owner, `DESK_ACCESS_TOKEN` on stdin; `checkTestHub` does not
apply, and no agent runs it against production. Against the suites' local hub, `--hub <loopback url> --user <email>`
signs in through the stand-in instead, and only there may `--yes` answer its confirmations.

    pnpm --filter desk-hub deployment admin <init | genesis | adopt | refresh | pair | devices | remove-device | root add>
        [--config deploy/<file>.json] [--keys <file>] [--recovery <path | paper>] [--media-check] [--class web-cards|native-mac] [--ttl <s>] [<device id>]

- `--keys <file>` (or `DESK_ADMIN_KEYS`): the admin device's keys, `{"device": "<id>", "keys": {"<id>.channel": <JWK>,
  "<id>.stepUp": <JWK>}}`, read and never printed. A file without `device` names `a1`, the staging test device's (so
  `adopt` takes O11's `keys.json` as it stands).
- `init` makes the keys file empty (0600, never over a file), runs `tmutil addexclusion` on it, and only then writes
  the new device's keys into it; when the exclusion fails it removes the empty file and writes no key. It refuses a path
  under `/tmp`, `/private/tmp` or `$TMPDIR` (a sweep), inside a git work tree (a commit), or under `~/.claude`,
  `~/Library/Mobile Documents` or `~/.config/claude-secrets` (a sync or a backup).
- `genesis --recovery <path | paper>` makes the org's recovery key and writes its private half only to the destination:
  a path on a removable volume mounted for the step, or `paper`, printed once at the terminal. A path is refused beside
  the keys, inside a sync or backup scope, or over an existing file; against a deployment also on the keys' volume, or
  on a volume Disk Utility does not report as removable or external (`df` names its device, `diskutil info -plist`
  describes it; a mounted disk image is refused too, its file being on some other disk). It reads the key back from the
  path (or takes it typed back), refuses unless it is `recoveryPub`'s pair, asks `root <org> at <hub>? [y/N]`, signs
  version 1 (the owner alone, an admin, with this device as the root) and posts it. It prints `orgGenesis <hash>` for
  the deployment's config, which the owner commits; `recoveryPub` stays in the anchor, and nothing of the private half
  on this machine. It refuses a hub that holds a state. The state is written to `<keys>.genesis.json` before its POST:
  a run that stops after the hub took it finishes on a rerun (the volume mounted again, the key checked back again),
  posting nothing new and anchoring only a head the served chain, verified from that genesis, reaches; a rerun never
  builds a second genesis. At the local hub, `--media-check` holds the destination to a deployment's volume rules too
  (another volume than the keys', on removable or external media), refusing it in the same words: the owner's check
  that their own drive passes before production's genesis meets it (the staging sitting's step 0, below). It only adds
  refusals, and is refused against a deployment, which always checks.
- `adopt` anchors an org rooted before this command (staging's, rooted by O11 M3): the chain verified from the genesis
  the config's `orgGenesis` pins (required), this device listed under the signed-in member and a root key of the head.
- `refresh` signs and posts a no-change successor. The endpoint refuses every remote action once the head is 30 days
  old (`src/endpoint/org-sync.ts`), and while this command is the only admin device nothing else signs one: run it
  before then. Every subcommand that reads the head prints `head version n, issued d days ago` first.
- `pair --class web-cards|native-mac [--ttl <s>]` prints a pairing code once (`smns-pair-v1.…`: the hub, the org, the
  member, the head's root key ids, `recoveryPub` and a fresh 128-bit `k`) to the terminal and the clipboard, never to
  stdout; then reads `GET /api/devices/pending` every 2 s for up to 10 minutes. An entry is this pairing's when its MAC
  verifies under `k` over the org, the member and the whole entry (`org-protocol`'s `verifyPairingMac`), whose device
  id is base64url's alphabet and whose passkey's `rpId` is a host name; others are named in the output and ignored.
  Everything the hub supplies is printed with its control characters escaped (`\u001b`), so an entry cannot draw a
  line or a prompt of its own. It shows the entry with its fingerprint (`pairingFingerprint`, `xxxxx-xxxxx`), which
  the device's panel shows too: compare the two before `y`, since the clipboard exposes `k` to every process under
  your uid. Two entries answering one code are refused and the code is spent. It then signs a successor listing the
  device, endorsed by this device, and prints `listed: version n`.
- `devices` lists the member's devices; `remove-device -- <id>` asks, then signs a successor dropping the device, its keys
  into `revoked` and its step-up key out of the root set if it was a root. Machines learn it at the hub's `state` notice, within its 10-minute poll at worst.
- `root add -- <id>` makes a device of the signed-in member a root beside this one (P5 O8 M3: the owner's MAWS, whose
  Settings › Org shows its id and fingerprint): a native-mac device with a step-up key, as this device is; a web-cards
  device, another member's, one the head doesn't list or one already a root is refused. It asks `make <device> of
  <email> (fingerprint <xxxxx-xxxxx>, step-up <kid>) a root of <org>? [y/N]` (the fingerprint `pair` showed for the
  device, to compare with the app's), then signs a successor adding the step-up key's kid to `root.keys`. Either root
  then signs any successor alone, and `remove-device` takes the added root out again.

Where it writes: the deployment's own org, under the anchor `<keys>.org.json` (`{hub, org, genesis, version, roots,
recoveryPub, pending?}`, 0600, each write synced and renamed into place), which `genesis` or `adopt` writes; every
other subcommand reads the chain from its genesis, verifies it against the anchor's pins, refuses another genesis or a
head older than the anchor's version, and moves the version forward. Never a throwaway org.

No two successors of one parent: every successor this device signs (`refresh`, `pair`, `remove-device`, one path,
`amend` in `admin.ts`) is written to the anchor's `pending` before its POST, and leaves it only once the hub took it.
Any answer but 201, or none, leaves it there, and the next subcommand settles it before anything else: the hub's chain
holding it adopts it (`pending version n is the hub's: adopted`); the hub's head still its parent sends the same bytes
again (`pending version n is not at the hub: sent again`); the hub holding another state at its version refuses
`fork: …: nothing was signed`, the anchor unchanged. A `not-head` refusal is not signed again: the next run finds the
hub's other successor and refuses `fork`, which is the owner's to take to whoever runs the hub (or to the other admin
device that signed it). Each subcommand but `init` holds `<keys>.org.json.lock` from its first read to its last write;
a second one is refused, naming the holder's pid, host and start time (and saying when that pid is gone from this host).
A run ended by Ctrl-C, its terminal closed or a SIGTERM, in `pair`'s wait or at a prompt, removes its own lock as it
exits; a lock left by a run that died otherwise (a SIGKILL, a crash) is removed by hand once nothing runs (`run-lock.ts`,
never taken over). Against a deployment, `genesis`, `pair`, `remove-device` and `root add` open
`/dev/tty` before any request and confirm there: a shell with no controlling terminal stops at that open
(`Device not configured`) and sends nothing.

### The cutover's verbs (P5 O14 M2)

    pnpm --filter desk-hub deployment admin <show | enroll | delegation create|publish|drop | machine drop | provisioning revoke | keys retire|purge | abandon-pending | code inspect|strip-legacy> …

The same keys file, anchor, lock and confirmation rule as above: each verb verifies the served chain against the anchor
before anything else, settles a pending proposal first, and signs through the one `amend` (`delegation create`
through its no-POST half, `propose`). An `unsent` proposal (`delegation create`'s) is the exception: no verb settles
it but `delegation publish`; `show` and `devices` name it and go on, and every other verb refuses, signing and sending
nothing, naming `delegation publish` and `abandon-pending`. Against a deployment each verb that signs, posts or
deletes (`enroll`, `delegation create`, `delegation publish`, `delegation drop`, `machine drop`, `provisioning revoke`,
`keys retire`, `keys purge`, `abandon-pending`) opens `/dev/tty` before any request. The token is `DESK_ACCESS_TOKEN` from the environment when it is
set there (the runners' `--pipe`), else on stdin.

- `show` prints the age line, the members and their devices, the roots (each with the device that holds it), the machines as a table (`NAME STATE REF KEY ONLINE
  SEEN`: a head entry `listed`; a served certificate `certified`, `retired <notAfter>`, `revoked` or `refused <code>`,
  as `org-protocol`'s checks judge it against the verified head; a hub row neither covers `unlisted` when it posted a
  v2 key the head does not list, `phase-1` otherwise; `ONLINE` and `SEEN` are the row's DX2 presence when
  `GET /api/machines` reports it, `-` when not, which is the hub's answer today), the delegations (and the dropped
  ones, whose prefixes stay reserved), and `legacyRetired` once a head carries it. It settles a sent pending proposal
  as every verb does, and never sends an unsent one: `pending version n lists delegation <id> (prefix <p>), unsent:
  admin delegation publish sends it once its stored code decodes under code inspect`.
- `enroll <name> [--replace] [--ttl <s>] [--wait <s>]` mints an enrollment token (`--ttl`, default 900 s; with
  `--replace`, `{machine: <name>}`, which re-enrolls an active hub row in place and ends its old credential at the
  machine's redemption), builds the `smns-enroll-v2.` code with a fresh `k` and writes it to the terminal and the
  clipboard, never stdout; then asks `GET /api/enrollments/<id>/key` every 5 s for up to `--wait` (default 1800 s).
  It refuses a key posted under another name or whose MAC is not under `k`, prints `machine <name> ref <ref> key <key
  id>`, and asks `compare with mawsd keys --json on <name>, then list it? [y/N]`: answer only once the three values match
  what `mawsd keys --json` prints on the intended machine, since a process that read the code could have redeemed it
  first under a valid MAC. It then signs the successor listing the machine, owned by you (with `--replace` on a listed
  name: the new key under the same ref, the old one retired), and prints `listed: version n`. A name the head binds to
  another ref is refused, as is a name under a delegation's prefix, a listed name or a hub row's without `--replace`.
  The anchor's lock is held for its reads and its signing, never across the wait: a `refresh` meanwhile signs, and
  `enroll` signs after it, on the head it reads again. An interrupted `enroll` leaves only a token that lapses.
- `delegation create --label <l> --prefix <p> --code-to-stdout [--ttl <s>] [--max-uses <n>] [--legacy-from-v1-code]`
  refuses a stdout that is a terminal and a prefix the head holds, nests or reserved (a dropped delegation's), asks
  `delegate <p> for <s> s? [y/N]`, mints the provisioning key (`POST /api/provisioning-keys`, `--ttl` default 90 days),
  makes the delegation's key pair, signs the successor holding it, and writes the `smns-provision-v2.` code (the hub,
  the org, the roots, `recoveryPub`, the key's token, the delegation's id, prefix and private JWK) to stdout and
  nothing else there; every other line goes to stderr. With `--legacy-from-v1-code` it reads a v1 provisioning code on
  stdin (for this hub and org) and copies its org key into the code's `legacy`. What it signs is what you approved:
  the prefix, an expiry `--ttl` from the mint, the use limit; a mint answer that disagrees with them (another prefix,
  an expiry more than 60 s off, another limit, an id that is not 32 hex) is refused before anything is signed, naming
  the key to revoke. It posts no state: the successor is signed into the anchor's pending slot, marked `unsent`, the
  code written, and the command exits 0, closing the pipe, at which `gcloud secrets create --data-file=-` stores it
  (it reads to EOF before it stores anything). So the delegation cannot take effect before its code is stored: a run
  killed anywhere leaves nothing at the hub. Then check the stored code (`gcloud secrets versions access latest
  --secret=<id> | … admin code inspect`), and only once it decodes run `admin delegation publish`, which posts the
  proposal and puts the delegation in effect; until then every other verb but `show` and `devices` refuses, so a
  verb waiting meanwhile (an `enroll` waiting for its machine's key) cannot send it. A store that failed: `admin abandon-pending` (nothing was posted, so no fork can follow),
  `admin provisioning revoke <id>`, and delete the secret if it was created. A code that could not be written (the
  pipe closed) drops the proposal there and names the key to revoke. The stderr lines say these next steps. Its one
  destination is a pipe into Secret Manager:
  `… | production-run.sh admin --pipe delegation create … | gcloud secrets create <id> --data-file=-`.
- `delegation publish` posts the unsent proposal `delegation create` left pending, after asking `publish delegation
  <id>? [y/N]`, and prints `delegation <id> prefix <p> in effect from version n` and `published: version n`. With none
  pending it refuses; with a stale one (another successor took its version) it refuses, naming `abandon-pending`.
- `delegation drop <id>` asks, then signs the successor revoking the delegation's key by its id and prefix (both
  reserved for the life of the org) and moving every admin retirement of its certificates into `revoked`, then revokes
  its provisioning key at the hub.
- `machine drop <name> [--revoke]` says what holds the name and asks: a head entry gets a successor retiring its key
  (`--revoke`: revoking it) and its hub row deleted; a live certificate, an admin's retirement of its key under its ref
  (RL §5.2) and the row deleted, so a recreated VM may take the name; a hub row with nothing in the head, the
  `DELETE /api/machines/<name>` alone. Rerun after a failed DELETE, it finds the row alone and deletes it.
- `provisioning revoke <id>` revokes a provisioning key at the hub (the phase-1 key at B4) after showing its label,
  prefix and uses; a live delegation's key is refused (`delegation drop` revokes it with the delegation).
- `keys retire [--undo]` asks, then signs the successor retiring the DX1 org key (`legacyRetired` at its own version
  and issue time, O14 M5a: machines stop dual-coding), which `show` prints; `--undo` signs the successor dropping it,
  refused before anything is signed once the hub has purged the wrapped copies (`GET /api/org/keys` `410 retired`; the
  hub would refuse the successor `409 key-purged`). A head already retiring the key, or retiring none for `--undo`,
  signs nothing and says so.
- `keys purge` deletes every wrapped copy of the org key at the hub (`POST /api/org/keys/purge`), which cannot be
  undone: it refuses unless the head carries `legacyRetired` (as the hub does, `409 not-retired`), shows the number of
  copies and asks with that consequence. From then the retirement stands. Run again, it says the hub holds none.
- `abandon-pending` drops the anchor's pending proposal, after showing it and what the hub holds and asking with the
  consequence (a later verb may sign another successor of the same parent, which a hub that kept the abandoned bytes
  could show a machine as a fork): for a proposal the hub refused for good, once you know why. An `unsent` proposal
  (`delegation create`'s, never posted) carries no such risk, and it says so: `pending version n <hash> was never sent:
  nothing was posted`. A delegation the proposal held is named with its minted provisioning key to revoke. It settles
  nothing else, and refuses while the hub's chain holds the proposal, which the next run adopts.
- `code inspect` and `code strip-legacy` are local transforms, stdin to stdout, with no keys, anchor, credential or
  hub request: `inspect` prints a provisioning code's fields, every key and token elided; `strip-legacy` writes the
  same code without `legacy` (B4), to a pipe alone, refused on a terminal. Run `strip-legacy` as
  `zsh apps/desk-hub/deploy/production-run.sh admin --pipe code strip-legacy` (no credential read), never through
  `pnpm … deployment`: pnpm's recursive runner writes its own failure lines to stdout even under `--silent`, which in a
  pipe would join the stream. `inspect`, whose stdout is the terminal, runs as
  `pnpm --silent --filter desk-hub deployment admin code inspect`.

Nothing these verbs print on stdout or stderr holds a key, a token or a code, but the code on the two verbs whose stdout
is one (`delegation create`, `code strip-legacy`); a machine's code goes to the terminal and the clipboard alone. The
provisioning code's codec is `org-protocol`'s (`encodeProvisioningCodeV2` / `decodeProvisioningCodeV2`, O14 M1): a code
it refuses is reported as `stdin: provisioning code: <reason>`, and `strip-legacy` writes the package's canonical
encoding of what remains.

## `walk-console.js` (the walk's item 8, read into DevTools)

`deploy/walk-console.js` is not a `deployment` command: it is a snippet the owner
pastes into the desk's own DevTools console while signed in, for Part G of the
recomposition walk (`docs/doperpowers/plans/2026-10-16-desk-recomposition-walk.md`,
G1 and G3). Having set `DESK_WALK = { project, session, machine }`, it opens one
project socket, sends exactly two frames — a `human` event and a `steer` RPC,
each sealed with a wrong code the org key never signed — prints what comes back,
and closes. Both are meant to be refused: the hub holds no key, so it stores the
`human` and the daemons refuse it on import (`bad-code`, drawn as the desk's
audit banner), while the `steer` is forwarded and the machine refuses it
`bad-code`, relayed back as `rpc-state` failed. It sends nothing else and never
touches the org key, and it refuses to run against any project but the one in
`DESK_WALK` (it checks the socket's `welcome`). Since O14 M5b the hub forwards no
RPC: the `steer` is answered `refused retired` at the hub, so the walk's G3 half no
longer runs as written, and its local-hub suite left with DX6.

## The checks (DC3.G2, G4, G6)

Each runs against the deployment through Access and enrolls throwaway
machines. Each requires `--test-org <id>`: a throwaway org, never the
configuration's own (staging's `staging-ssfskim` included), which the
deployment must be serving (`deploy --config <file> --org-id <id>` first). Before enrolling or writing anything, each checks that `/api/me` names
that org, and refuses otherwise. Their projects and events outlive the machines'
revocation, and their events are sealed with a throwaway org key.

Each revokes what it enrolled, which deletes the machines' service tokens, and
deletes what it minted, however it ends. It fails if any of that fails.

- `probe`: the admission probe's five cases, plus enrollment's name refusal. Needs `DESK_ACCESS_TOKEN` and `CF_DESK_HUB_SERVICE_TOKENS`, the latter for minting the one never-enrolled token, which it deletes. The machine's admission is its own request (`GET /machine/enrollment`), which confirms it and registers its machine project, the project the browser case opens; the archive designation it once told at a DX2 hello left with that stream (O14 M5b).

  `probe --rpc` runs one case alone, the one O14's B4 step 3 asks for: an `rpc` frame on a project socket opened with the owner's token is answered `refused retired`. The frame carries a nonce and nothing else, so it writes nothing on any build (one before M5b answers it a bad shape and keeps nothing, and the case fails there); it therefore runs in the deployment's own org, without `--test-org`, and needs `DESK_ACCESS_TOKEN` alone:

      printf 'DESK_ACCESS_TOKEN=%s\n' "$(cloudflared access token -app=$HUB)" \
        | pnpm --filter desk-hub deployment probe --rpc --config deploy/config.json

  `probe --retired` is the same step's owner-token half of the removed routes: `POST /api/org/keys` and `DELETE /api/org/keys/x` answer the Worker's own 404 (`{"error":"not-found"}`) under the deployed build, and `GET /api/org/keys` answers `410 retired` (after B4 step 4's purge) or the list (before it), each under that build too (K1 to K3). The build it expects is the one the credential-free `POST /machine/enroll` names, as step 3's `curl` reads it; `--build <name>` pins it instead. Each request carries no body, so a hub before M5b refuses the POST a bad shape and the DELETE `not-key-holder` and keeps nothing (and the case fails there); it runs in the deployment's own org on `DESK_ACCESS_TOKEN` alone:

      printf 'DESK_ACCESS_TOKEN=%s\n' "$(cloudflared access token -app=$HUB)" \
        | pnpm --filter desk-hub deployment probe --retired --config deploy/config.json

  The machine-token half (DX2's two routes) runs on the VM, whose endpoint holds a service token: `deploy/vm-dx2-retired.mjs`, fed to the VM's node on stdin (it imports nothing but node's own modules), reads the token by path from the endpoint's `enrollment.json` (`credentials.clientId`, `credentials.clientSecret`; `${XDG_CONFIG_HOME:-$HOME/.config}/MAWS/mawsd/endpoint/` on Linux) and never prints it. It asks `GET /machine/stream` and `POST /machine/frames` with no body, and passes only when both answer the Worker's `404 {"error":"not-found"}` under `BUILD`, the build step 3's `curl` named; anything else fails it, exit 1: a hub before M5b answering the VM's v2 credential `403 v2-credential` (M5a), another build's answer, or Access's redirect with no build header. `HUB` and `BUILD` reach it as arguments of their own, never spliced into the remote command:

      BUILD=$(curl -sI -X POST $HUB/machine/enroll | awk 'tolower($1) == "x-desk-build:" { sub(/^[^:]*:[ \t]*/, ""); sub(/[ \t\r]*$/, ""); print }')
      devcloud vm ssh <vm> -- env "HUB=$HUB" "BUILD=$BUILD" node --input-type=module - < apps/desk-hub/deploy/vm-dx2-retired.mjs

- `fake-check`: M4's fake machine, enrolled from a code, replays its recording, and a browser sees every row, request, decision, log event, and outcome, plus one RPC answered.
- `redeploy-check`: two fake machines and a browser write while the hub is redeployed mid-run, under the same throwaway org. The writing lasts 420 s by default (`--seconds`), because the cut came +314 to +329 s after the deploy. The redeploy is new code, since its build's name is new: Cloudflare restarts objects for new code only. Nothing may be lost or duplicated, and the check fails as "not exercised" when the redeploy cut no machine's stream. See M5's findings in DC3's plan: on 2026-10-15, Cloudflare kept the old version's connections open after a deploy.
  Beside them runs RL1's leg (O11): a v2 machine listed in the throwaway org's state holds RL1 through its endpoint, and an app holds a channel to it. A socket the redeploy drops must come back: the endpoint under a higher generation, the app through a new channel. It prints when each socket dropped (from the redeploy's start) and how long each took to come back. Cloudflare cuts the sockets when it chooses, and within the window it may not (O11 M8's phase B saw a cut in one run of three), so once the writing stops the leg cuts both sockets itself, from the client's end, twice in a row: each time the endpoint must be welcomed again under a higher generation and a new channel echo within 60 s (`rl1: forced cut <n>: …`). Those prove the reconnect, not the deploy's cut, which is what acceptance 3 asks for: only a run whose redeploy cut both RL1 sockets, both came back, and whose forced cuts came back is a PASS. A run that lost nothing and whose forced cuts came back but whose redeploy left an RL1 socket uncut (`rl1: neither socket was cut`) ends `INCONCLUSIVE: deploy cut: not exercised (…)` with status 3, neither PASS nor FAIL. The state is signed by an admin device: `--device-keys <file>` (below), or without it a device made for the run, which posts the throwaway org's genesis and so needs an org with no state yet.
- `measure`: machines streaming chunks into one project, with browsers subscribed. It runs three series: the phase-1 budget (one session at 150 chunks/s watched by 1 to 3 browsers, with another machine's presence and log events crossing it), fan-out, and a ramp. It reports throughput, latency, and the load average per step, as DC3's plan records them (G6).
- `frame-cost`: what a POST and each frame in it cost on the path from a machine to its project.

`fake-check`, `redeploy-check`'s two fake machines, `measure` and `frame-cost` drive DX2's stream (the fake machine,
`fake-machine/`), which a hub from O14 M5b on answers 404: they prove a build before it, and go once the cutover is
done.


## Staging runs: `staging-deploy.sh`, `staging-run.sh`, `staging-sweep.py`

The live runs on staging (O11 M8's phase B; O13's and O14's acceptance re-run them) are three scripts beside the
commands, run from any clean MAWS checkout. They act on `desk-hub-staging` alone: each holds staging's Worker, host and
org (`desk-hub-staging`, `desk-hub-staging.opencognita-platform.workers.dev`, `staging-ssfskim`) and production's
(`desk-hub`, `desk-hub.opencognita-platform.workers.dev`) as named constants, reads `deploy/staging.json` first, and
stops before anything else runs unless it names exactly staging's Worker, host and org; a configuration naming
production's Worker or host, or a preview alias of it (`<alias>-desk-hub.…`), is refused as production by name.

- `zsh deploy/staging-deploy.sh [--checkout <path>] [--org-id staging-<…>] [--org-name <name>]` builds desk-web with
  `VITE_DESK_WEB_BUILD=<branch>.<sha8>` exported (the label the phone's channel handshake carries, `h1.build`) and
  runs `deployment deploy --config deploy/staging.json --web <branch>.<sha8>` from the checkout (default: the one the
  script is in; it must have no uncommitted changes to tracked files). `--org-id` deploys staging as a throwaway org.
  It prints production's `X-Desk-Build` before and after, credential-free, and fails if any wrangler call named a
  Worker other than `desk-hub-staging`.
- `zsh deploy/staging-run.sh <step>`, one step at a time; any further arguments go to the step's command:
  - `prod <label>`: production's `X-Desk-Build`, credential-free, into `prod/prod-build-<label>.txt`; `prod after`
    compares it with `prod before`.
  - `deploy`, `build`: the checkout to staging; staging's and production's `X-Desk-Build`.
  - `acceptance [--no-push]`, `relay-measure`: those commands under `staging-ssfskim` with the admin device's keys.
    `acceptance`'s push item gets its sink behind an account-less quick tunnel, stopped when the run ends; `--no-push`
    skips the item. The tunnel (`start_tunnel`, shared with `phone`) is `cloudflared tunnel --url` tried three times,
    then the quick-tunnel API asked directly with a 60 s wait (cloudflared's own request gives up after 15 s, and the
    API has taken 22-33 s to answer), with cloudflared run on the credentials it answered. That credentials file is
    written 0600 into the state directory and removed when the tunnel stops; its secret is never printed.
  - `endpoint [args…]`, `endpoint-vm setup <base> | teardown`: `endpoint-acceptance` under `staging-ssfskim` with the
    admin device's keys, its hub-deploy item this script's own `deploy`, the secrets it handled searched for in its log
    after; the VM scene set up from a bundle cut at <base> (a commit the VM's MAWS checkout holds), or removed.
  - `access-sync`: the people policy read back at the org state's head, with the machine credentials access-sync uses.
  - `admin <args…>`: `deployment admin` against `staging-ssfskim` with the admin device's `keys.json` (its anchor,
    `keys.json.org.json`, beside it once `admin adopt` ran). `adopt`, `devices` and `refresh` run unattended; `pair` and
    `remove-device` ask at `/dev/tty`, and `pair`'s code goes to the terminal and the clipboard, never the step's log.
    The step names the deployment and the keys itself: it refuses `--hub`, `--user`, `--yes`, `--config`, `--keys`
    and `init`. Its output is filtered line by line, so a fingerprint is on screen before the question about it.
    `admin --pipe <verb…>` is the secret-stream mode, as `production-run.sh`'s below.
  - `throwaway <n>`: staging deployed under the throwaway org `staging-probe-<n>`, then `fake-check` and
    `redeploy-check` there (its RL1 leg included), then the account swept and staging deployed back under
    `staging-ssfskim`. The sweep and the restore run however the step ends, a failure or Ctrl-C included; the step
    fails unless both checks, the sweep and the restore passed and `/api/me` names `staging-ssfskim` again (read
    within 30 s; a read that fails or times out is `restore check failed: …`). An `INCONCLUSIVE` redeploy-check
    (status 3) fails the step too.
  - Acceptance 8's `desk-web <n>` check, Playwright against the paused desk-web over DX2 and the org key, left with
    DX2's routes (P5 O14 M5b); O13 M7's `phone <n>` below supersedes it.
  - `phone <n> [--rehearse] [--lane-b] [--device <id>]` (P5 O13 M7): `test/endpoint/staging-phone.live.test.ts`, the
    owner's phone against a real endpoint module. MAWS's endpoint runs in the suite's process over the suites' fake
    engine host and fake sminos, enrolled the v2 way on `staging-ssfskim` as the scratch machine `o13-phone-<n>` and
    listed by the admin device. Its sessions are the owner's `la-1` (*o13 staging run <n>: yours to answer*) and `la-2`
    (the harness's own), the owner's lane B `app-1` and `app-2`, and `la-b`, owned by a second member `o13-b-<n>`
    (`@staging.invalid`, one `native-mac` device, no sign-in). The owner's second `web-cards` device `o13-c-<n>` (a
    software passkey) pairs through staging's pairing exchange by M3's code path and subscribes to push at the run's
    sink, behind the quick tunnel `acceptance` uses. The run raises a question and a permission on each of the owner's
    sessions, and one on `la-b`. `o13-c-<n>` drives acceptance 2's and 3's refusals on the harness's sessions (on each
    lane: an assertion replayed, another action's, and an answer on a session of the second member's, `la-b` or the
    unlisted lane B `app-b`), whose cards are withdrawn after. Then the run waits up to 10 minutes (`WAITING …`) for the phone to answer `la-1`'s two
    cards: the phone is the owner's one `web-cards` device the run did not make, or `--device <id>`. `--rehearse` has
    `o13-c-<n>` answer them in the phone's place, which proves the whole run on staging before the owner sits down.
    It prints a line per check, then `PASS`, `FAIL`, `NOT RUN` or `NOT SHOWN` per item: `registration`, `round-trip
    lane A`, `round-trip lane B`, `class-bound`, `push-owner-only`, `freeze-seam`.
    - Lane B: O10's notifier feed (#272, P5 Decision Log 90) gives a lane B session its count at the hub, so it has a
      Cards row and a push. The run looks for that count, and without it prints `NOT RUN round-trip lane B: waiting on
      O10's lane B notifier feed`. Run it with `--lane-b`, which makes that absence a failure. Lane B's refusals need no
      feed (the device subscribes to the harness's session by its id), so they run either way, under the same item.
      Its scope: the harness runs the endpoint in this process over the fake engine host, which is always attached, so
      a `PASS round-trip lane B` proves the endpoint's lane B path. It does not prove a real machine's counts under P5
      Decision Log 29 (lane B's events reach the endpoint only while an app is linked, until O3).
    - Cleanup: however the run ends, it takes the machine out of the state (its key retired, its service token revoked
      at the hub), removes `o13-b-<n>` and `o13-c-<n>` (their keys revoked) and deletes the sink's subscription. The
      step then runs a cleanup pass of its own (`DESK_STAGING_PHONE=cleanup`), which finds them by name again for a run
      killed outright, and says `LEFT …` for anything still current. A pairing entry `o13-c-<n>` posted but never
      listed (the run ended between the two) cannot be removed: it is `LEFT` with its expiry, ten minutes after it was
      posted. A rerun under the same `<n>` sweeps first, and stops while anything is left. An INT or TERM to the step
      stops the suite at once (it runs in a process group of its own, killed 10 s after TERM if it lingers) and then
      runs the cleanup pass. The phone itself is never touched.
    - Nothing recorded: the owner's token reaches the suite in its environment alone, and the output passes the filter.
      The suite lists each secret it handles in `phone-<n>.scan`: the enrollment code and its one-time token, the
      pairing code and its secret, and the machine's service token; the tunnel's secret is listed there too when the
      quick-tunnel API gave it. After the run the log and the run's tunnel logs are searched for the token and
      for every listed secret, and the step fails if any file holds one. The sink keeps what it receives (encrypted
      notices) in memory alone. The endpoint's scratch profile, `phone-<n>.profile`, holds the machine's keys and
      ledgers; it and the list are removed however the step ends. Production's `X-Desk-Build` is compared before and
      after (`production untouched: …`).
- `staging-sweep.py snapshot|sweep` is the throwaway step's account sweep: the service tokens and the `desk-hub*`
  Access apps and policies before the run, and after it the deletion of what appeared and is the throwaway org's
  (service tokens `desk-<org>-*`, and the apps and policies the deploy tool makes on staging, by exact name:
  `desk-hub-staging`, `desk-hub-staging public paths`, `desk-hub-staging owner`, `desk-hub-staging machines`). Anything
  else that appeared is left alone and fails the sweep, a name merely starting with `desk-hub-staging` too (a production
  preview alias's, `desk-hub-staging-desk-hub`, would); it refuses an org that is not `staging-probe-*` and never deletes
  production's objects.

What they read, at run time, never printed or passed as an argument:
- `DESK_STAGING_SECRETS` (default `~/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers`): the
  directory holding `CF_ACCESS_SETUP_TOKEN` and `CF_DESK_HUB_SERVICE_TOKENS`, each read with `cat` inside the pipe
  that hands it to the command;
- the owner's staging Access token, from `cloudflared access token -app=https://desk-hub-staging.opencognita-platform.workers.dev`
  (the owner's `cloudflared access login` once; a step without it stops with nothing changed). It reaches a command on
  its stdin and curl as a configuration through a pipe (`printf … | curl -q -K -`), never a here-string, which zsh
  spools to a temporary file; every curl call puts `-q` first, so the user's `~/.curlrc` (a `verbose` or `trace` there
  would print or keep the token) is never read;
- `DESK_STAGING_DEVICE` (default `$DESK_STAGING_DIR/device`): `keys.json`, the admin device's keys (the org-state
  commands above and `admin`), and `machine.json`, `{"DESK_MACHINE_CLIENT_ID": …, "DESK_MACHINE_CLIENT_SECRET": …}` for
  `access-sync`.

Where they write: `DESK_STAGING_DIR` (default `~/.local/state/desk-hub-staging`, created 0700): one log per step and
deploy, `prod/`, the throwaway step's snapshots and sweeps, and `access-sync/` (its checkpoint).
`DESK_HEAVY_WRAPPER`, when set, prefixes the web build (a slot limiter on a shared machine).

Production's Access read-back (its apps and policies, GETs only, compared before and after a run) is not among them:
it reads production's objects with the setup token, which no script here does.

### The owner's sitting: the phone on staging (P5 O13 M7)

The owner's phone joins staging once, at the owner's hand. The steps run in order from a MAWS checkout of the branch
under test, with `export DESK_STAGING_DEVICE=~/.local/share/dsk-scripts/p5-o11/staging-device` set in the owner's
terminal: it holds the staging admin's `keys.json` and its anchor, `keys.json.org.json`. `<n>` is a fresh run id
(`[a-z0-9-]{1,20}`), and `<drive>` is the owner's USB drive as Finder mounts it under `/Volumes`.

0. **The USB drive meets the removable-media check** (the owner, at the terminal; P5 Decision Log 74). This is a
   loopback genesis onto the drive, so a real drive meets the check before production's genesis does. Everything is
   scratch: a throwaway local org, its keys under `~/.local/share/desk-usb-check`.

       pnpm --filter desk-hub local --state ~/.local/share/desk-usb-check/hub      # a second terminal; Ctrl-C at the end
       pnpm --filter desk-hub deployment admin init --keys ~/.local/share/desk-usb-check/keys.json --hub http://127.0.0.1:8747 --user owner@example.com
       pnpm --filter desk-hub deployment admin genesis --keys ~/.local/share/desk-usb-check/keys.json --hub http://127.0.0.1:8747 --user owner@example.com --media-check --recovery /Volumes/<drive>/desk-usb-check-recovery.json

   The owner sees `keys written: …` and `excluded from Time Machine: …`. Then `head: none`, then `recovery key written to
   /Volumes/<drive>/desk-usb-check-recovery.json and read back: matches recoveryPub`, then `root local at
   http://127.0.0.1:8747? [y/N]`. They answer `y` and see `genesis posted: version 1, orgGenesis <hash>`. A refusal
   naming the drive (`is not on removable or external media`, `could not tell whether … is on removable media`, `on the
   same volume as the admin keys`) is an M2 defect: stop, and report it with the output of `diskutil info
   /Volumes/<drive>`. Once the check has passed, the test files are removed (not run until the owner chooses):

       rm /Volumes/<drive>/desk-usb-check-recovery.json     # the throwaway org's recovery key, on the drive
       rm -r ~/.local/share/desk-usb-check                   # its admin keys, their anchor and lock, the local hub's state

1. **Staging at the branch's build** (the agent): `zsh apps/desk-hub/deploy/staging-run.sh deploy`, then `… build`,
   which shows `staging: X-Desk-Build: hub@<sha8> web@<branch>.<sha8>`. The owner sees nothing yet.
2. **The phone** (the owner, on the phone):
   - open `https://desk-hub-staging.opencognita-platform.workers.dev` in Safari and sign in through Access (the email
     code);
   - Share → *Add to Home Screen*, and open the desk from that icon (iOS pushes only to an installed web app);
   - in the menu, *Notifications*: turn them on, and allow them when iOS asks;
   - in the menu, *Device*: the panel shows a *Pairing code* field.
3. **The pairing** (the owner, at the terminal): `zsh apps/desk-hub/deploy/staging-run.sh admin pair --class web-cards`.
   - The terminal prints the code once, and the code goes to the clipboard (never to the log).
   - On the phone: paste it into the field (Universal Clipboard; Handoff on, one Apple ID), tap *Pair this device*, and
     let Face ID save the passkey for the staging host. The panel reads *waiting for approval on your Mac —
     fingerprint xxxxx-xxxxx* within 2 s.
   - The terminal shows `pending: <id> web-cards webcrypto rpId desk-hub-staging.opencognita-platform.workers.dev
     fingerprint xxxxx-xxxxx — compare the fingerprint with the device's, then approve? [y/N]`.
   - The owner compares the two fingerprints, answers `y`, and sees `listed: version <v>`. Within 10 s the panel reads
     *Listed, version <v>*.
4. **The run** (the agent: `zsh apps/desk-hub/deploy/staging-run.sh phone <n> --lane-b`; the owner, on the phone).
   - Within about two minutes (the enrollment, then Access admitting the machine's new service token), the phone shows
     two notifications reading *A session is waiting for your answer*: one for `la-1` and one for the harness's `la-2`.
     With O10's lane B feed, there are four: `app-1` and the harness's `app-2` as well.
   - The owner opens *Cards* (or either notification) and the machine `o13-phone-<n>`'s session *o13 staging run <n>:
     yours to answer*. They answer *o13 staging run <n>: which way?* either way and Allow or Deny `echo o13-phone-<n>
     permission`, each with Face ID. Then the same on *o13 staging run <n>: yours to answer, lane B*. Each card settles
     within a few seconds.
   - The owner leaves the harness's sessions alone: their cards are withdrawn within about half a minute.
   - The owner takes a screenshot of the notifications, and says what they saw: how many notifications, their text,
     and none for the second member's session. Nothing of the run records the phone.
   - The run ends with its `PASS` lines, its cleanup and `production untouched`. The agent runs it with `--lane-b`
     now that O10's feed has landed.
5. **Cleanup**: the run's own is automatic (step 4's last lines). The phone stays listed on staging. To take it off:
   the owner runs `staging-run.sh admin devices` for its id, then `staging-run.sh admin remove-device -- <id>`, which asks
   `revoke <id>? [y/N]` at the terminal and prints `revoked: version <v>`. Then *Forget* in the phone's Device panel,
   and the home-screen icon removed.

Before the owner sits down, the agent runs `zsh apps/desk-hub/deploy/staging-run.sh phone <n> --rehearse --lane-b`: the same run
with `o13-c-<n>` answering in the phone's place, and the `registration` item checking `o13-c-<n>`'s own pairing.

## Production runs: `production-deploy.sh`, `production-run.sh`

Production's deploy and the steps around it (P5 Decision Log 40) are two scripts beside the staging ones, with their
mechanism aimed the other way. **The owner runs them; an agent never does**, not even read-only or `--dry-run`
against the real configuration. Each holds production's Worker, host and org (`desk-hub`,
`desk-hub.opencognita-platform.workers.dev`, `ssfskim`, as `config.ts` names them) and staging's as named constants,
reads `deploy/config.json` of its checkout first, and stops before anything else runs unless it names exactly
production's Worker, host and org; a configuration naming staging's Worker or host, a preview alias (`<alias>-desk-hub.…`)
or another org is refused as not production. Every token is read inside the script, by path, inside the pipe that
hands it to a command, and never printed or passed as an argument; output goes through the staging scripts' filter
(any line holding `token`, `secret`, `bearer` or `eyJ` is dropped, `wrangler target …` lines kept).

- `zsh deploy/production-deploy.sh --checkout <path> --confirm <sha8> [--allow-head] [--dry-run]` deploys the checkout
  (default: the one the script is in): the top of a git worktree with no uncommitted changes to tracked files, whose
  HEAD is `--confirm` (as `git rev-parse --short=8 HEAD` prints it, so a command copied from a note cannot deploy
  another commit) and, after a `git fetch origin master`, `origin/master`'s head. `--allow-head` deploys a HEAD that is
  not master's (a hotfix), still named by `--confirm`. It builds desk-web with `VITE_DESK_WEB_BUILD=<label>` exported
  (the build the phone's channel handshake names), then runs `deployment deploy --config deploy/config.json --assets
  <checkout>/apps/desk-web/dist --web <label>` with the two API tokens on its stdin; `<label>` is `master.<sha8>`, or
  `head.<sha8>` for a commit that is not master's. The checkout is held under a lock for the whole run
  (`desk-production.lock` in its git directory, which `production-run.sh checkout` takes too, so neither runs while the
  other holds it; a lock left by a run that died is removed by hand), and after the web build, which may wait under
  `DESK_HEAVY_WRAPPER`, the checkout must still be the confirmed commit with no uncommitted changes to tracked files
  before the tokens are handed over. It prints production's `X-Desk-Build` before (credential-free), fails if no wrangler
  call or any but `desk-hub`'s ran, then reads production's `X-Desk-Build` until it carries `hub@<sha8>` (not `+dirty`),
  every 10 s within 2 minutes of elapsed time (each read's own timeout and each pause cut to what is left), and fails if
  it never does. `--dry-run` makes every check, then prints
  what it would run (no token in it) and runs none of it.
- `zsh deploy/production-run.sh <step>`, one step at a time:
  - `checkout [<path>]`: a detached worktree of `origin/master` at `<path>` (default `~/.local/share/maws-desk-deploy`;
    a path under `/tmp`, `/private/tmp` or `$TMPDIR` is refused, since a sweep empties them): added from the worktree the
    script is in (`git worktree add -f --detach`), or fetched and checked out again where it exists, under the
    deploy's lock on that checkout. Git never runs in
    a worktree with uncommitted changes, so a dirty checkout, or a dirty worktree to add from, is refused. Then
    `pnpm install --frozen-lockfile --filter 'desk-hub...' --filter 'desk-web...'` there, and the deploy command for
    that commit is printed.
  - `build`: production's `X-Desk-Build`, credential-free; it fails, saying what it read, when there is none naming a
    hub build. `wait <sha8>`: the deploy's 2-minute wait, alone.
  - `access-sync` (changes production's Access): `deployment access-sync` against production, reading the head as a
    production machine enrolled v2 (O14), whose credentials the owner writes to `$DESK_PRODUCTION_DEVICE/machine.json`
    (`{"DESK_MACHINE_CLIENT_ID": …, "DESK_MACHINE_CLIENT_SECRET": …}`); without the file it stops and says so. Its
    checkpoint is `$DESK_PRODUCTION_DIR/access-sync/desk-hub.json`. It takes no option.
  - `admin <args…>`: `deployment admin <args…>` (O13 M2) against production, with `--keys
    $DESK_PRODUCTION_DEVICE/keys.json` and the owner's production Access token (`cloudflared access token
    -app=https://desk-hub.opencognita-platform.workers.dev`, after `cloudflared access login` once) on its stdin; `init`
    needs no token. The deployment and the keys are the script's: `--config`, `--keys`, `--hub`, `--user` and `--yes` are
    refused. Every verb that signs, posts or deletes asks on the terminal (`/dev/tty`) first, and a pairing or
    enrollment code is written to the terminal alone, never to the step's log; `genesis` keeps no log at all
    (`--recovery paper` prints the recovery key once). `delegation create` and the `code` verbs are refused here: their
    stdout is a code, which this step would filter and log.
  - `admin --pipe <verb…>` (O14 M2), for `delegation create` and `code strip-legacy` alone, the two verbs whose stdout
    is a secret code: the owner's token goes to the command's environment (`DESK_ACCESS_TOKEN`) instead of its stdin,
    which, with its stdout, passes through untouched and unlogged; its stderr alone is filtered and logged
    (`admin-<verb>-pipe-<time>.log`), and every line of the step's own goes to stderr. The command runs as the package's
    `deployment` script runs it (`node … deploy/bin.ts` in the app's directory), not through pnpm, whose failure lines
    go to stdout. The step refuses the mode when its stdout is a terminal. `code strip-legacy` reads no token and no
    keys.

  The steps that change production (`access-sync`; `admin genesis`, `pair`, `remove-device`, `root add`, `refresh`, `enroll`,
  `delegation`, `machine drop`, `provisioning revoke`, `keys`) say so in their first line, before they read any credential, and
  stop at the first one they lack.

What they read, at run time:
- `DESK_PRODUCTION_SECRETS` (default `~/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers`): the
  directory holding `CF_ACCESS_SETUP_TOKEN` (the deploy, `access-sync`) and `CF_DESK_HUB_SERVICE_TOKENS` (the deploy);
- `DESK_PRODUCTION_DEVICE` (default `$DESK_PRODUCTION_DIR/device`, created 0700): `keys.json`, the admin device's keys
  (`admin init` writes it; the command keeps its own files beside it), and `machine.json` for `access-sync`;
- `DESK_HEAVY_WRAPPER`, when set, prefixes the web build and the checkout's install (`with-slot.sh`, the Mac's slot
  limiter, stays the owner's);
- `TMPDIR`, only to refuse a checkout under it.

Where they write: `DESK_PRODUCTION_DIR` (default `~/.local/state/desk-hub-production`, created 0700): one log per
deploy (`production-deploy-<time>.log`), per `access-sync` and per `admin` run but `genesis`, and `access-sync/`.
Nothing of production's Access objects is read.

A deploy, in order: `zsh apps/desk-hub/deploy/production-run.sh checkout`, then from the checkout it names
`zsh <checkout>/apps/desk-hub/deploy/production-deploy.sh --checkout <checkout> --confirm <sha8> --dry-run`, read, and
the same without `--dry-run`.

### The rollout: hub v2, the org's root and the phone on production (P5 O13 M7)

Each step is the owner's, in order, at the Mac's terminal unless it says otherwise; nothing here is an agent's. It
follows the staging sitting above, whose step 0 has shown that the owner's USB drive passes the removable-media check.

1. **Hub v2's first production deploy**, with the web build that carries the phone's cards (O13 M3-M6):
   `zsh apps/desk-hub/deploy/production-run.sh checkout`, then, from the checkout it names,
   `zsh <checkout>/apps/desk-hub/deploy/production-deploy.sh --checkout <checkout> --confirm <sha8> --dry-run`. Read
   it, then run the same command without `--dry-run`. The deploy ends when production's `X-Desk-Build` carries
   `hub@<sha8>` (`production-run.sh build` shows it again). It adds no Durable Object migration, so DX2 and DX6 keep
   working (O11 acceptance 8). The phone's DX6 cards for the machines not yet moved keep answering through the deploy:
   acceptance 4 on production, recorded by the owner's use.
2. **The org's root.**
   - `zsh apps/desk-hub/deploy/production-run.sh admin init` writes the admin device's keys to
     `$DESK_PRODUCTION_DEVICE/keys.json` (0600, excluded from Time Machine).
   - With the USB volume mounted, run `zsh apps/desk-hub/deploy/production-run.sh admin genesis --recovery
     /Volumes/<drive>/<file>`. It writes the recovery key to the drive alone and reads it back against `recoveryPub`.
     It then asks `root ssfskim at https://desk-hub.opencognita-platform.workers.dev? [y/N]`, and after `y` prints
     `genesis posted: version 1, orgGenesis <hash>`.
   - Eject the drive and keep it offline: only `recoveryPub` stays on the Mac.
   - Add `"orgGenesis": "<hash>"` to `apps/desk-hub/deploy/config.json`, and commit it.
   - The genesis lists the owner alone, so Access's policy already matches the head, and no `access-sync` is due. The
     first `access-sync` runs once O14 enrolls a production machine and its credentials are in
     `$DESK_PRODUCTION_DEVICE/machine.json`.
3. **The phone on production.**
   - On the phone: open production's desk-web, the installed home-screen app already signed in, and open the menu's
     *Device* panel.
   - On the Mac: `zsh apps/desk-hub/deploy/production-run.sh admin pair --class web-cards`. Paste the code into the
     panel and let Face ID save the passkey for `desk-hub.opencognita-platform.workers.dev`.
   - Compare the two fingerprints, answer `y`, and the panel reads *Listed, version <v>*. Its push subscription is
     bound to the device from then on.
4. **The mini's cutover** is O14's mini brief. After it, the first question a session on the mini asks reaches the
   phone as a v2 push and is answered over the new protocol: acceptance 2 on production. A request pending across the
   cutover closes on the DX6 side, and the endpoint's first `notify` at its welcome tells it again, so the phone gets
   one push for it.
5. **The weekly successor.** Run `zsh apps/desk-hub/deploy/production-run.sh admin refresh` before every 30th day,
   until O8's app signs the weekly successor. The endpoint refuses every remote action on a head 30 days old, and the
   Device panel warns from day 21. Every `admin` run prints `head version n, issued d days ago` first.
