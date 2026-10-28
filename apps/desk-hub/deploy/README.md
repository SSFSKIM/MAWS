# Deploying the hub

The hub runs on the owner's Cloudflare account behind Cloudflare Access (DC3's
plan, M5; the composite's DX7), as two deployments. Each has a configuration
naming its account, Worker, host, owner and org:

| Configuration | Worker | Host | Org | What it is |
| --- | --- | --- | --- | --- |
| `config.json` (the default) | `desk-hub` | `desk-hub.opencognita-platform.workers.dev` | `ssfskim` | Production: the owner's machines and phone |
| `staging.json` | `desk-hub-staging` | `desk-hub-staging.opencognita-platform.workers.dev` | `staging-ssfskim` | Staging, for live tests (P5 O11's M2); agents deploy here and nowhere else |

Everything here goes through one command, run from the MAWS worktree root:

    pnpm --filter desk-hub deployment <deploy|probe|fake-check|redeploy-check|measure|frame-cost|counts|access-sync|relay-measure|acceptance|admin> [--config deploy/<file>.json] [options]

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

Every answer the Worker makes, except a WebSocket upgrade and a machine's
stream, carries `X-Desk-Build`. The value names the build:
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
  pid, host and start time. A lock is never taken over, even one whose run
  died: remove it by hand once you have checked that no run is going. A member the state
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
  (staging's is pinned; production's config pins none, so they refuse it), and never a genesis;
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

## `admin`: the owner's hand on the org state (P5 O13 M2)

Until O8's Org page, the owner roots a deployment's org, pairs a device into it, revokes one and keeps the head
fresh from the Mac with this command and an admin device of its own. It acts on the deployment `--config` names
(production's `config.json` by default) as the signed-in owner, `DESK_ACCESS_TOKEN` on stdin; `checkTestHub` does not
apply, and no agent runs it against production. Against the suites' local hub, `--hub <loopback url> --user <email>`
signs in through the stand-in instead, and only there may `--yes` answer its confirmations.

    pnpm --filter desk-hub deployment admin <init | genesis | adopt | refresh | pair | devices | remove-device>
        [--config deploy/<file>.json] [--keys <file>] [--recovery <path | paper>] [--class web-cards|native-mac] [--ttl <s>] [<device id>]

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
  builds a second genesis.
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
- `devices` lists the member's devices; `remove-device <id>` asks, then signs a successor dropping the device, its keys
  into `revoked` and its step-up key out of the root set if it was a root. Machines learn it at the hub's `state` notice, within its 10-minute poll at worst.

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
a second one is refused, naming the holder's pid, host and start time, and a lock left by a run that died is removed by
hand once nothing runs (`run-lock.ts`, never taken over). Against a deployment, `genesis`, `pair` and `remove-device` open
`/dev/tty` before any request and confirm there: a shell with no controlling terminal stops at that open
(`Device not configured`) and sends nothing.

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
`DESK_WALK` (it checks the socket's `welcome`). Proven against the local hub in
`test/deploy/walk-console.test.ts`.

## The checks (DC3.G2, G4, G6)

Each runs against the deployment through Access and enrolls throwaway
machines. Each requires `--test-org <id>`: a throwaway org, never the
configuration's own (staging's `staging-ssfskim` included), which the
deployment must be serving (`deploy --config <file> --org-id <id>` first). Before enrolling or writing anything, each checks that `/api/me` names
that org, and refuses otherwise. Their projects and events outlive the machines'
revocation, and their events are sealed with a throwaway org key.

Each revokes what it enrolled, which deletes the machines' service tokens, and
deletes what it minted, however it ends. It fails if any of that fails.

- `probe`: the admission probe's five cases, plus enrollment's name refusal and the archive designation. Needs `DESK_ACCESS_TOKEN` and `CF_DESK_HUB_SERVICE_TOKENS`, the latter for minting the one never-enrolled token, which it deletes.
- `fake-check`: M4's fake machine, enrolled from a code, replays its recording, and a browser sees every row, request, decision, log event, and outcome, plus one RPC answered.
- `redeploy-check`: two fake machines and a browser write while the hub is redeployed mid-run, under the same throwaway org. The writing lasts 420 s by default (`--seconds`), because the cut came +314 to +329 s after the deploy. The redeploy is new code, since its build's name is new: Cloudflare restarts objects for new code only. Nothing may be lost or duplicated, and the check fails as "not exercised" when the redeploy cut no machine's stream. See M5's findings in DC3's plan: on 2026-10-15, Cloudflare kept the old version's connections open after a deploy.
  Beside them runs RL1's leg (O11): a v2 machine listed in the throwaway org's state holds RL1 through its endpoint, and an app holds a channel to it. A socket the redeploy drops must come back: the endpoint under a higher generation, the app through a new channel. It prints when each socket dropped (from the redeploy's start) and how long each took to come back. Cloudflare cuts the sockets when it chooses, and within the window it may not (O11 M8's phase B saw a cut in one run of three), so once the writing stops the leg cuts both sockets itself, from the client's end, twice in a row: each time the endpoint must be welcomed again under a higher generation and a new channel echo within 60 s (`rl1: forced cut <n>: …`). Those prove the reconnect, not the deploy's cut, which is what acceptance 3 asks for: only a run whose redeploy cut both RL1 sockets, both came back, and whose forced cuts came back is a PASS. A run that lost nothing and whose forced cuts came back but whose redeploy left an RL1 socket uncut (`rl1: neither socket was cut`) ends `INCONCLUSIVE: deploy cut: not exercised (…)` with status 3, neither PASS nor FAIL. The state is signed by an admin device: `--device-keys <file>` (below), or without it a device made for the run, which posts the throwaway org's genesis and so needs an org with no state yet.
- `measure`: machines streaming chunks into one project, with browsers subscribed. It runs three series: the phase-1 budget (one session at 150 chunks/s watched by 1 to 3 browsers, with another machine's presence and log events crossing it), fan-out, and a ramp. It reports throughput, latency, and the load average per step, as DC3's plan records them (G6).
- `frame-cost`: what a POST and each frame in it cost on the path from a machine to its project.


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
    `acceptance`'s push item gets its sink behind an account-less quick tunnel (`cloudflared tunnel --url`), stopped
    when the run ends; `--no-push` skips the item.
  - `access-sync`: the people policy read back at the org state's head, with the machine credentials access-sync uses.
  - `admin <args…>`: `deployment admin` against `staging-ssfskim` with the admin device's `keys.json` (its anchor,
    `keys.json.org.json`, beside it once `admin adopt` ran). `adopt`, `devices` and `refresh` run unattended; `pair` and
    `remove-device` ask at `/dev/tty`, and `pair`'s code goes to the terminal and the clipboard, never the step's log.
    The step names the deployment and the keys itself: it refuses `--hub`, `--user`, `--yes`, `--config`, `--keys`
    and `init`. Its output is filtered line by line, so a fingerprint is on screen before the question about it.
  - `throwaway <n>`: staging deployed under the throwaway org `staging-probe-<n>`, then `fake-check` and
    `redeploy-check` there (its RL1 leg included), then the account swept and staging deployed back under
    `staging-ssfskim`. The sweep and the restore run however the step ends, a failure or Ctrl-C included; the step
    fails unless both checks, the sweep and the restore passed and `/api/me` names `staging-ssfskim` again (read
    within 30 s; a read that fails or times out is `restore check failed: …`). An `INCONCLUSIVE` redeploy-check
    (status 3) fails the step too.
  - `desk-web <n>`: the same around acceptance 8's desk-web check (`apps/desk-web/e2e-staging`, its own
    `playwright.staging.config.ts`): Playwright's headless Chromium loads staging's desk-web, sets the throwaway org's
    key up, enrolls M4's fake machine from the Machines dialog, and screenshots the grid, the session listed, its
    permission card, the card answered from the page and the decision in the group chat, into `desk-web-<n>/`. The
    browser holds the owner's Access token as its `CF_Authorization` cookie for the staging host; nothing records a
    trace, video or HAR, nor the failure context (`error-context.md`, with a snapshot of the page) Playwright writes
    for a failed test whatever its options say (`e2e-staging/unrecorded.ts`). Afterwards every file the step wrote is
    searched for the token and for what the check lists in `desk-web-<n>.scan` (the enrollment code it read from the
    Machines dialog, its one-time token and the org key), which must be in none; the list is removed with the run.
    The step takes no option to pass on, and Playwright runs in an environment the script builds (`env -i`, no
    `PWDEBUG`, `PW_*` or `PLAYWRIGHT_*`); `playwright.staging.config.ts` itself refuses any option but naming it and any
    such variable (`e2e-staging/recording.ts`), so nothing can turn recording back on.
    Playwright's Chromium must be installed once (`pnpm --filter desk-web exec playwright install chromium`).
- `staging-sweep.py snapshot|sweep` is the throwaway steps' account sweep: the service tokens and the `desk-hub*`
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
deploy, `prod/`, the throwaway steps' snapshots and sweeps, `access-sync/` (its checkpoint) and `desk-web-<n>/`.
`DESK_HEAVY_WRAPPER`, when set, prefixes the web build (a slot limiter on a shared machine).

Production's Access read-back (its apps and policies, GETs only, compared before and after a run) is not among them:
it reads production's objects with the setup token, which no script here does.

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
    refused. `genesis`, `pair` and `remove-device` ask on the terminal (`/dev/tty`) before they sign, and a pairing code
    is written to the terminal alone, never to the step's log; `genesis` keeps no log at all (`--recovery paper` prints
    the recovery key once).

  The steps that change production (`access-sync`; `admin genesis`, `pair`, `remove-device`, `refresh`) say so in their
  first line, before they read any credential, and stop at the first one they lack.

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
