---
name: setting-up-gws-oauth
description: Use when gws (the Google Workspace CLI) must start working against a Google account that has no Cloud project or OAuth client yet, on a machine where the human is logged into Chrome and cua_repl can drive both that Chrome and a tmux terminal. Triggers include `gws auth status` reporting client_config_exists false, "Access blocked" or redirect_uri_mismatch at login, a 403 accessNotConfigured from an API call, or onboarding a new Google account for an agent.
---

# Setting up gws OAuth with the human beside you

The spine is gws's own wizard, `gws auth setup --login`, which the agent runs inside
tmux and drives itself. The wizard handles gcloud login, project, and APIs, then pauses
for a Client ID and Secret because no CLI or API can create the consent screen, the test
user, or the Desktop-app client. The agent crosses that gap in the human's Chrome, feeds
the result back into the wizard, and drives the final consent. The human acts twice at
most: a password re-prompt and a phone prompt, each only when it is already on screen.

Target: under ten minutes from a bare machine. Say at the start that two short hand-offs
will come, so the human stays near the screen; a phone prompt expires in about a minute.

Repeat deployments do not need this skill: a Desktop-app client is per account, not per
machine. Copy an existing client_secret.json into `~/.config/gws/` and only the consent
remains; `gws auth export --unmasked` from an authenticated machine removes even that.

## Preconditions

- gws on PATH (prebuilt linux x86_64 and aarch64 binaries under GitHub Releases, sha256
  verified) with `gws auth status` showing `client_config_exists: false`; gcloud on PATH
  (the tarball installs in under a minute); tmux.
- The account signed into a Chrome profile that cua has bound (`cua profiles list`). If
  the human signs a second account in through accounts.google.com/AddSession, Chrome may
  create a new profile directory for it and the old binding reports `binding_stale`: read
  Chrome's `Preferences` for the new directory, `cua profiles add` and `bind` it.
- Scopes decided. `gws auth login` outside a TTY requests drive, gmail.modify, calendar,
  spreadsheets, documents, presentations, tasks plus openid, email, profile; the wizard's
  `--login` runs the TTY picker. Unverified apps on gmail.com accounts cap near 25 scopes.

## Driving the wizard

```sh
tmux new-session -d -s gws -x 120 -y 40 'gws auth setup --login; echo "[exit $?]"; sleep 600'
tmux capture-pane -p -t gws        # read; blank-line filtering keeps it short
tmux send-keys -t gws Down Enter   # pickers: arrows, Space to toggle, "a" all, Enter confirm
tmux send-keys -t gws -l "<text>"  # text prompts
```

1. **Authentication.** With no gcloud login the picker offers "Login with new account",
   which opens Google's consent in Chrome: drive it (account chooser, Google Cloud SDK
   consent, Allow). Google's own client, so no unverified warning.
2. **Project.** "Create new project" or an existing one. A never-used account must
   accept the Cloud terms first; the wizard's error names them. Open
   `console.cloud.google.com/?hl=en&authuser=<n>` in Chrome, take the first-run dialog
   (country; the terms box; in some countries a second box that appears after the
   country is chosen; agree stays disabled until all are ticked). Read the boxes as
   `input[type=checkbox]` and click only the unchecked ones: the role locator reports
   no state and a blind click untoggles the pre-ticked box. Then retry in the wizard
   (Enter resubmits the same project id).
3. **APIs.** Toggle what the account will use; "a" selects all (about 30 s to enable).
   Validated live on 2026-10-07: 12 minutes on a fresh gmail.com account, one phone
   approval, no password re-prompt (see README.md beside this file).
4. **OAuth credentials.** The wizard prints manual steps and waits at "Enter OAuth
   Client ID". Its attempt to create the consent screen via
   `oauth2.googleapis.com/v1/projects/<id>/brands` answers 404 and is swallowed, so do
   all of the next section now, in Chrome, while the pane waits. Then type the ID and
   Secret from the downloaded JSON with `send-keys -l`, read out of the file on that
   machine inside the command and never printed. The prompt pre-fills from an existing
   `~/.config/gws/client_secret.json` if one is present.
5. **Login.** `--login` opens the scope picker (Enter accepts the Recommended template)
   and then the consent; see the last section.

## The console gap, in Chrome

Append `hl=en&authuser=<n>` to every URL: the console renders in the account's locale
and English keeps text matchers stable. Use `project=<id>` from the wizard's screen.

1. `console.cloud.google.com/auth/overview` → Get started (click by position or the
   last text match; the first match is the description sentence). Four expanding
   steps: app name and support email (`getByLabel`, the select's id, `getByRole
   option`); audience (gmail.com accounts can only choose External; click the
   `input[type=radio][value=external]` centre); contact email as a chip input (type,
   Enter); the user-data policy checkbox (click its centre), Continue, Create.
2. `console.cloud.google.com/auth/audience` → Add users → the account's email, Enter →
   Save. Without this the consent ends in "Access blocked". Verify by the Test users
   table, not the click.
3. `console.cloud.google.com/auth/clients/create` → Application type Desktop app
   (anything else gives redirect_uri_mismatch: gws redirects to a random localhost
   port), a name, Create. Confirm with the human before Create: it is persistent access
   to the account. Download JSON writes `client_secret_<id>.json` to Chrome's download
   directory on that machine; `install -m 600` it to `~/.config/gws/client_secret.json`
   before dismissing the dialog, which is the last time the secret is shown.

Console facts that cost retries when unknown:

- Side-panel submit buttons (the test users Save) and the API Enable button swallow the
  first activation after the preceding input; the second (click, or Enter on the
  focused button) submits. Activate, read the result, activate again if unchanged.
- Role locators miss most console buttons. What works: a `button, a, [role=button]`
  locator filtered by text, `getByLabel` for inputs, element ids for selects, radios by
  value, and coordinates from `getBoundingClientRect`.
- Onboarding tooltips ("Got it", "Configure Gemini Cloud Assist") cover controls.

## The consent, with the human's two moments

The login prints the authorization URL and listens on a random localhost port; open the
URL in the account's Chrome profile yourself rather than trusting xdg-open. Screens in
order: account chooser (localized heading; click the row with the email), then possibly
Google's re-check, then "hasn't verified this app" (Continue, or Advanced → go to app),
an intermediate Continue, the consent page (Select all, Continue).

The re-check is the human's part. A password field: say "password, here" and nothing
else; if they stored it with `/secret` on a macOS client, type `{{secret:KEY}}` where cua
has a secrets backend, or on a Linux device pipe it from the client into
`xdotool type --file -` against the focused field after confirming
`document.activeElement` is the password input. A phone prompt: read the number from the
page and say "approve <number> on your phone" the moment it shows.

The redirect to `http://localhost:<port>` renders as ERR_BLOCKED_BY_CLIENT in the
agent-driven tab; the request still reached gws. Proof is `"status": "success"` in the
pane and `credentials.enc` under `~/.config/gws/`. If the login process lingers, end it by
its full path. On a machine without a keyring daemon gws keeps a file-backed key beside
the credentials; say so when reporting.

## Done means

One call per enabled service succeeds (`gws drive files list --params '{"pageSize":1}'`,
`gws gmail users getProfile --params '{"userId":"me"}'`, `gws calendar calendarList
list`). Report the project id, the client name, the scopes, where the credentials and
key sit, and that the client can be deleted from the console's Clients page.
