---
name: setting-up-gws-oauth
description: Use when gws (the Google Workspace CLI) must start working on a machine against a Google account that has no Cloud project or OAuth client yet, and the Google Cloud Console is reachable only through a logged-in Chrome that cua_repl can drive. Triggers include `gws auth status` reporting client_config_exists false, "Access blocked" or redirect_uri_mismatch at login, a 403 accessNotConfigured from an API call, or onboarding a fresh Google account on a cloud VM where the human can log in to Chrome but will not click through the console.
---

# Setting up gws OAuth through the console GUI

gws needs a Desktop-app OAuth client in a Cloud project whose consent screen lists the
account as a test user. `gws auth setup` creates the project and enables APIs (it needs
gcloud) but stops at the consent screen and the client: no CLI or API creates those, so
the console GUI is the only route. This skill is the agent walking that GUI in the
human's logged-in Chrome, then finishing `gws auth login` in the same browser.

Draft, not yet replayed by a fresh agent. Written from two runs on 2026-10-07 (Ubuntu 24.04
VM, cua over a relay, a brand-new gmail.com account, gws 0.22.5); timings and quirks are in
README.md beside this file.

## The scene

The human and the agent share one screen: a terminal and the Chrome profile that holds
the account. The spine is the stock wizard, `gws auth setup` run interactively by the
human (it needs gcloud); the agent fills the gaps the wizard cannot cross, in the
browser, while the human watches, and asks for the human's hands only at the moments
Google demands them, pointing at the field on screen. Target: under ten minutes
end to end, with the human never searching the console themselves.

For repeat deployments none of this is needed: a Desktop-app client is per account, not
per machine. Copy an existing client_secret.json into `~/.config/gws/` and only the
consent step remains; `gws auth export --unmasked` on an authenticated machine removes
even that. This skill is for the first account.

## Before touching the console

- gws installed and `gws auth status` showing `client_config_exists: false`. Prebuilt
  binaries exist for linux x86_64 and aarch64 under GitHub Releases; verify the sha256.
- gcloud installed (the tarball installs in under a minute).
- A cua Chrome profile bound to the profile that holds the account. Signing a second
  Google account into Chrome through accounts.google.com/AddSession can create a new
  Chrome profile directory for it; the old profile's window closes, its extension host
  exits and the registered profile key reports `binding_stale`. Read Chrome's
  `Preferences` (`profile.name`, `account_info`) to find the new directory, then
  `cua profiles add <key> --chrome-profile "<dir>"` and `cua profiles bind <key>`.
- Decide the scopes now. Non-TTY `gws auth login` skips the picker and requests
  drive, gmail.modify, calendar, spreadsheets, documents, presentations, tasks (plus
  openid, email, profile); pass `--scopes` explicitly to get exactly what you intend.
  Unverified apps and gmail.com accounts are capped near 25 scopes.

## The wizard as the spine, the agent in the gaps

Run `gws auth setup --login` in a tmux session so the agent can drive the TUI itself
(`tmux send-keys` for keys, `capture-pane -p` to read; verified on the VM: account
picker, project picker, API picker with Space to toggle and "a" for all, then the pause).
The human only needs to watch, or to take the keyboard for the choices they care about.
In order, with who acts:

1. gcloud check, then `gcloud auth login`: the wizard opens the consent in Chrome. The
   agent drives it (account chooser, Google Cloud SDK consent, Allow). Google's own
   client: no unverified-app warning, and no password re-prompt in the test run.
2. Project: the human picks "Create new project" or an existing one in the TUI. A
   brand-new account must accept the Cloud terms once before project creation works;
   the wizard's error names the terms. The agent opens `console.cloud.google.com`
   in Chrome and takes the first-run dialog (country, the terms checkbox, in some
   countries a second confirmation checkbox that appears after the country is chosen;
   the agree button stays disabled until both are ticked), then the human retries.
3. APIs: the human toggles the ones they want in the TUI ("a" selects all). Non-TTY
   runs enable all 15; both take about 30 s.
4. OAuth credentials: the wizard tries to create the consent screen through
   `oauth2.googleapis.com/v1/projects/<id>/brands`, which answers 404 and is swallowed,
   never adds a test user, and cannot create a client (removed when the IAP admin API
   was deprecated). It pauses asking for a Client ID and Secret. This is the agent's
   part, in Chrome, while the terminal waits: consent screen, test user, Desktop
   client (steps 4 to 6 below). Then feed the ID and secret into the
   wizard's prompts with `tmux send-keys -l`, read from the downloaded JSON on that
   machine (`python3 -c` into the command substitution, never printed); the prompt
   pre-fills from an existing `~/.config/gws/client_secret.json` if one is there.
5. `--login` continues into `gws auth login`: the agent drives the consent (below),
   and the human types the password and approves the phone prompt the moment the
   agent says the field is on screen.

## The console, in order

Append `?hl=en&authuser=0` (or the account's index) to every URL: the console renders in
the account's locale, and English makes text matchers stable. Steps 2 and 3 are the
fallback when neither the wizard nor gcloud is available.

1. `console.cloud.google.com/` on a never-used account shows a first-run dialog:
   country, the terms checkbox, and in some countries a second confirmation checkbox
   that appears only after the country is chosen; the agree button stays disabled until
   both are ticked.
2. `console.cloud.google.com/projectcreate`: fill the name, read the generated ID from
   the "Project ID:" line before clicking Create, and keep it; every later URL takes
   `project=<id>`.
3. `console.cloud.google.com/apis/library/<service>` for each API gws will call. The
   button's accessible name is "enable this API", not "Enable", and a hidden duplicate
   precedes the visible one. Enabled state: the URL moves to `/apis/api/<service>/`
   or a "manage this API" button appears. Confirm each one; a click that lands on
   nothing fails silently, and the agent that assumed success here found the Calendar
   API still disabled at the end.
4. `console.cloud.google.com/auth/overview` → Get started. The wizard is four
   expanding steps: app name and support email; audience (gmail.com accounts can only
   pick External); contact email as a chip input (type, Enter); the user-data policy
   checkbox, then Continue, then Create. Click "Get started" by position or as the last
   text match: role locators miss it, and the first text match is the description
   sentence that starts with the same words.
5. `console.cloud.google.com/auth/audience` → Add users → the account's email → Save.
   Without this entry consent ends in "Access blocked". Verify by reading the Test
   users table, not the Save click.
6. `console.cloud.google.com/auth/clients/create`: Application type Desktop app
   (anything else gives redirect_uri_mismatch, because gws redirects to a random
   localhost port), a name, Create. The confirmation dialog's Download JSON writes
   `client_secret_<id>.json` to Chrome's download directory on that machine; move it to
   `~/.config/gws/client_secret.json` with mode 600, and only then dismiss the dialog,
   which is the last time the secret is shown.

Creating the client is persistent access to the account: confirm with the human right
before Create, with the project and account named.

### Console interaction facts

- Submit buttons in side panels (the test users Save) and the API Enable button swallow
  the first activation that follows the preceding input; the second one (a click, or
  Enter on the focused button) submits. Activate, read the result (the table, the URL),
  and activate once more if nothing changed.
- Material widgets expose little through role locators here. What worked: `getByLabel`
  for text inputs, element ids for selects (`#..._cfc-select-0`), `getByRole("option")`
  for dropdown entries, a generic `button, a, [role=button]` locator filtered by text
  for buttons, and `input[type=radio]` or coordinates for radios.
- Onboarding tooltips ("Got it", "Configure Gemini Cloud Assist") cover controls;
  dismiss them when a click has no effect.

## Finishing the login

Run `gws auth login --scopes ...` in the background with DISPLAY set and stdout to a
file. It prints the authorization URL and listens on 127.0.0.1:<random port>; do not
count on it opening a browser (xdg-open opened nothing on the test VM). Open the URL in
your tab in the account's profile and handle, in this order: the account chooser (its
heading is localized; click the row containing the email), a password re-prompt and a
phone 2-step prompt (Google asks even though Chrome is signed in; the phone prompt's
number expires in about a minute, so say "password here" or "approve 77 on your phone"
the moment the screen shows it, and nothing else), the "hasn't verified this app" warning (Continue, or Advanced → go to app), an
intermediate Continue, and the consent page (tick Select all, Continue).

The redirect to `http://localhost:<port>` renders as ERR_BLOCKED_BY_CLIENT in the
agent-driven tab. That is cosmetic: the request reached gws. The proof is
`"status": "success"` in the log and `~/.config/gws/credentials.enc` appearing. The
login process may stay alive afterwards; terminate it by its full path, not by a
pattern that also matches your own shell.

For the password, the human can store it with `/secret` instead of typing at the VM.
On a Linux device cua has no secrets backend, so `{{secret:KEY}}` is not expanded there;
pipe the value from the client machine into `xdotool type --file -` over ssh against
the focused field, after confirming `document.activeElement` is the password input, and
never echo it.

On a headless machine with no keyring daemon gws falls back to a file-backed key
beside the credentials; mention that to the human when reporting where secrets live.

## Done means

An API call per enabled service succeeds (`gws drive files list --params
'{"pageSize":1}'`, `gws gmail users getProfile --params '{"userId":"me"}'`,
`gws calendar calendarList list`). Report the project id, the client name, the scopes
granted, where the credentials and key sit, and that the client can be deleted from the
console's Clients page.
