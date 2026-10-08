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

## Division of labour

The human: logs the account into Chrome before you start, and later types the password
and approves 2-step verification when Google re-challenges during consent. Everything
else is yours. Say up front that these two hand-offs will come, so the human stays near
the screen.

For repeat deployments this whole skill is overkill: a Desktop-app client is not per
machine. Copy an existing client_secret.json into `~/.config/gws/` and only the consent
step remains; `gws auth export --unmasked` on an authenticated machine removes even that.
Use this skill for the first account, not the fleet.

## Before touching the console

- gws installed and `gws auth status` showing `client_config_exists: false`. Prebuilt
  binaries exist for linux x86_64 and aarch64 under GitHub Releases; verify the sha256.
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

## Project and APIs: use gcloud, not the console

Install the gcloud CLI (the linux-arm or x86_64 tarball installs in under a minute), run
`gcloud auth login` in the background with DISPLAY set and drive its consent in the
account's Chrome profile (Google's own client: no unverified-app warning, and no password
re-prompt in the test run), then:

```sh
gcloud projects create <id> --name=<id>
gws auth setup --project <id>     # non-interactive: enables every Workspace API, ~30 s
```

`gws auth setup` then exits 3 with manual instructions; that is expected. Its REST call
to create the consent screen answers 404 and is swallowed, it never touches test users,
and OAuth client creation was removed from it, so everything below is still yours. A
brand-new account must accept the Cloud terms in the console once before
`gcloud projects create` works (the error names the terms); open
`console.cloud.google.com` and take the first-run dialog described in step 1.

## The console, in order

Append `?hl=en&authuser=0` (or the account's index) to every URL: the console renders in
the account's locale, and English makes text matchers stable. Steps 2 and 3 are the
fallback when gcloud is unavailable.

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
number expires in about a minute, so ask the human only when it is on screen and keep
the message short), the "hasn't verified this app" warning (Continue, or Advanced → go to app), an
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
