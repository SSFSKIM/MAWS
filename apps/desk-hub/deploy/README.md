# Deploying the hub

The hub runs on the owner's Cloudflare account as the Worker `desk-hub`, at
`https://desk-hub.opencognita-platform.workers.dev`, behind Cloudflare Access
(DC3's plan, M5; the composite's DX7). `config.json` names the account, the
host, the owner, and the org. Everything here goes through one command, run
from the MAWS worktree root:

    pnpm --filter desk-hub deployment <deploy|probe|fake-check|redeploy-check|measure|frame-cost|counts> [options]

## Credentials

Every command reads its credentials from the environment or as `NAME=value`
lines on stdin, so they reach no process's arguments and no file of the
repository:

| Name | What it is | Used by |
| --- | --- | --- |
| `CF_ACCESS_SETUP_TOKEN` | An API token with Access: Apps and Policies Edit, Service Tokens Edit, Organizations Read | `deploy`, `redeploy-check` |
| `CF_DESK_HUB_SERVICE_TOKENS` | An API token with Access: Service Tokens Edit only. It becomes the Worker's `CF_API_TOKEN` secret, with which the hub mints and deletes machines' service tokens | `deploy`, `probe`, `redeploy-check` |
| `DESK_ACCESS_TOKEN` | A person's Access session as an app token: `cloudflared access login https://desk-hub.opencognita-platform.workers.dev` once (a browser sign-in), then `cloudflared access token -app=https://desk-hub.opencognita-platform.workers.dev` | `probe`, `fake-check`, `redeploy-check`, `measure` |

The owner keeps the two API tokens under
`~/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers/`.
For example:

    S=~/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers
    printf '%s\n' "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)" "CF_DESK_HUB_SERVICE_TOKENS=$(cat $S/CF_DESK_HUB_SERVICE_TOKENS)" \
      | pnpm --filter desk-hub deployment deploy --assets "$PWD/apps/desk-web/dist"

The logged-in wrangler (`wrangler login`) does the Worker's own upload. Its
OAuth token carries no Access scopes, which is why the setup token exists.

## `deploy`

`deploy` runs in an order that never leaves anything reachable unguarded:

1. **Access.** It reads the team domain (`GET /accounts/<id>/access/organizations`,
   `auth_domain`), then creates or updates by name, in place:
   - three reusable policies:
     - `desk-hub owner`: Allow, the owner's email;
     - `desk-hub machines`: Service Auth, any Access service token;
     - `desk-hub public paths`: Bypass, everyone;
   - two self-hosted applications:
     - `desk-hub`: the whole workers.dev host, with owner and machines, a 30-day session (`720h`, the owner's choice of 2026-10-18: a 24 h session left the phone signed out each day), and 401 for a failed service token in place of a redirect;
     - `desk-hub public paths`: `/machine/enroll`, `/manifest.webmanifest`, and `/icons/*` on the same host, Bypass. It is more specific, so it takes precedence.

   A hostname-level application is used, not the Worker's own Access toggle, which refuses WebSocket upgrades. Access admits any service token of the account; the hub's Registry refuses a client id it never enrolled (`403 not-enrolled`).
2. **The Worker** (`wrangler deploy`), with its variables on the command line (`--var`): `ORG_ID`, `ORG_NAME`, `ORG_ADMIN_EMAIL`, `ACCESS_ISSUER`, `ACCESS_AUD` (the `desk-hub` application's AUD), `ACCESS_CERTS_URL`, `CF_API_URL`, `CF_ACCOUNT_ID`. `wrangler.jsonc` keeps them empty on purpose. A deploy made any other way (a plain `wrangler deploy`) resets them, and the hub then answers `503 not-configured` to everything until `deploy` runs again. `--assets <dir>` serves the web app's build from `<dir>` (default `apps/desk-web/dist`). Pass it on every deploy once the web app is live: a deploy without it uploads whatever `apps/desk-web/dist` holds, possibly nothing. Give it absolute: pnpm runs the command in `apps/desk-hub`, where a relative `<dir>` would resolve.
3. **The secrets**, each put only when the Worker lacks it:
   - `CF_API_TOKEN`, from `CF_DESK_HUB_SERVICE_TOKENS` (`--put-api-token` rotates it);
   - `VAPID_KEY`, generated once. Browsers' push subscriptions are bound to it, so it is never regenerated, and it exists nowhere but the Worker.

Every answer the Worker makes, except a WebSocket upgrade and a machine's
stream, carries `X-Desk-Build`. The value names the build:
- `hub@<commit>`, where the commit is the hub's, with `+dirty` when its tree differed;
- `web@<label>` when `--web <label>` named the web build (`--web smns-erb-web.0fa05392`, say).

So `curl -sI -X POST https://desk-hub.opencognita-platform.workers.dev/machine/enroll`
shows what is deployed, without credentials.

Options:
- `--org-id`, `--org-name`: override `config.json`'s org. The proofs ran under a throwaway org, `dc3-m5-test`.
- `--web <label>`: what the web build is, for `X-Desk-Build`.
- `--access-only`: set up Access and stop.

The org id is written into every project's `.smns` (`hub.org`) and into each
machine's service-token name (`desk-<org>-<machine>`), so changing it later
means enrolling every machine again.

## After the first deploy (the owner)

1. Open the hub in a browser and sign in ("Sign in with Cloudflare"; the team allows account members, and the policy the owner's email).
2. Set up the org key first (the web app's first unlock method, DX7). An org whose key someone else set up first cannot be unlocked by the owner.
3. Enroll machines from the web app's "Enroll a machine" (`sminos hub enroll` on each, the code pasted at its hidden prompt).

## `counts` (read-only; the owner's org)

The composite's Parent-Level Acceptance 10 compares, writer by writer, each
machine's log files with the hub's log. `counts` reads the hub's half through a
project socket as the person whose `DESK_ACCESS_TOKEN` it is given: it resumes
the log from offset 0 to `caught-up` and sends nothing else (no visibility, no
`human`, no RPC, no subscription), so it runs against `config.json`'s org.
`machine-counts.py` reads a machine's half from its log files
(`$SMINOS_HOME/projects/<id>/log/`) and its enrolled and former names (from
`daemon/hub.json`, nothing else of it), standard library only, so a machine with
no MAWS checkout runs it over ssh:

    python3 apps/desk-hub/deploy/machine-counts.py --dir <checkout> > /tmp/sk.json
    ssh mini python3 - --dir <checkout on the mini> < apps/desk-hub/deploy/machine-counts.py > /tmp/mini.json
    printf 'DESK_ACCESS_TOKEN=%s\n' "$(cloudflared access token -app=https://desk-hub.opencognita-platform.workers.dev)" \
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
machines. Each requires `--test-org <id>`: a throwaway org, never
`config.json`'s, which the deployment must be serving (`deploy --org-id <id>`
first). Before enrolling or writing anything, each checks that `/api/me` names
that org, and refuses otherwise. Their projects and events outlive the machines'
revocation, and their events are sealed with a throwaway org key.

Each revokes what it enrolled, which deletes the machines' service tokens, and
deletes what it minted, however it ends. It fails if any of that fails.

- `probe`: the admission probe's five cases, plus enrollment's name refusal and the archive designation. Needs `DESK_ACCESS_TOKEN` and `CF_DESK_HUB_SERVICE_TOKENS`, the latter for minting the one never-enrolled token, which it deletes.
- `fake-check`: M4's fake machine, enrolled from a code, replays its recording, and a browser sees every row, request, decision, log event, and outcome, plus one RPC answered.
- `redeploy-check`: two fake machines and a browser write while the hub is redeployed mid-run, under the same throwaway org. The writing lasts 420 s by default (`--seconds`), because the cut came +314 to +329 s after the deploy. The redeploy is new code, since its build's name is new: Cloudflare restarts objects for new code only. Nothing may be lost or duplicated, and the check fails as "not exercised" when the redeploy cut no machine's stream. See M5's findings in DC3's plan: on 2026-10-15, Cloudflare kept the old version's connections open after a deploy.
- `measure`: machines streaming chunks into one project, with browsers subscribed. It runs three series: the phase-1 budget (one session at 150 chunks/s watched by 1 to 3 browsers, with another machine's presence and log events crossing it), fan-out, and a ramp. It reports throughput, latency, and the load average per step, as DC3's plan records them (G6).
- `frame-cost`: what a POST and each frame in it cost on the path from a machine to its project.

