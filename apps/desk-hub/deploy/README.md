# Deploying the hub

The hub runs on the owner's Cloudflare account as the Worker `desk-hub`, at
`https://desk-hub.opencognita-platform.workers.dev`, behind Cloudflare Access
(DC3's plan, M5; the composite's DX7). `config.json` names the account, the
host, the owner, and the org. Everything here goes through one command, run
from the MAWS worktree root:

    pnpm --filter desk-hub deployment <deploy|probe|fake-check|redeploy-check|measure> [options]

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
      | pnpm --filter desk-hub deployment deploy --assets <desk-web's dist>

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
     - `desk-hub`: the whole workers.dev host, with owner and machines, a 24 h session, and 401 for a failed service token in place of a redirect;
     - `desk-hub public paths`: `/machine/enroll`, `/manifest.webmanifest`, and `/icons/*` on the same host, Bypass. It is more specific, so it takes precedence.

   A hostname-level application is used, not the Worker's own Access toggle, which refuses WebSocket upgrades. Access admits any service token of the account; the hub's Registry refuses a client id it never enrolled (`403 not-enrolled`).
2. **The Worker** (`wrangler deploy`), with its variables on the command line (`--var`): `ORG_ID`, `ORG_NAME`, `ORG_ADMIN_EMAIL`, `ACCESS_ISSUER`, `ACCESS_AUD` (the `desk-hub` application's AUD), `ACCESS_CERTS_URL`, `CF_API_URL`, `CF_ACCOUNT_ID`. `wrangler.jsonc` keeps them empty on purpose. A deploy made any other way (a plain `wrangler deploy`) resets them, and the hub then answers `503 not-configured` to everything until `deploy` runs again. `--assets <dir>` serves the web app's build from `<dir>` (default `apps/desk-web/dist`). Pass it on every deploy once the web app is live: a deploy without it uploads whatever `apps/desk-web/dist` holds, possibly nothing.
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

## The checks (DC3.G2, G4, G6)

Each runs against the deployment through Access, enrolls throwaway machines,
and revokes them at its end, which deletes their service tokens:

- `probe`: the admission probe's five cases, plus enrollment's name refusal and the archive designation. Needs `DESK_ACCESS_TOKEN` and `CF_DESK_HUB_SERVICE_TOKENS`, the latter for minting the one never-enrolled token, which it deletes.
- `fake-check`: M4's fake machine, enrolled from a code, replays its recording, and a browser sees every row, request, decision, log event, and outcome, plus one RPC answered.
- `redeploy-check`: two fake machines and a browser write while the hub is redeployed mid-run. The redeploy is new code, since its build's name is new: Cloudflare restarts objects for new code only. Nothing may be lost or duplicated, and the check fails as "not exercised" when the redeploy cut no machine's stream. See M5's findings in DC3's plan: on 2026-10-15, Cloudflare kept the old version's connections open after a deploy.
- `measure`: three machines streaming chunks into one project, with browsers subscribed. It reports the throughput and the latency, as DC3's plan records them (G6).

Run them under a throwaway org (`deploy --org-id <test org>` first), never in
the owner's real org: their events are sealed with a throwaway org key, and the
projects they register stay in the org's registry.
