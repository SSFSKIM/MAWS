# gws onboarding spike: agent-driven Google Cloud setup for a fresh account

Question: can an agent, driving a logged-in Chrome through cua, take a brand-new Google
account from nothing to a working `gws` (Google Workspace CLI) login, and is the
gcloud-based `gws auth setup` route faster than walking the console GUI?

Both routes were run on 2026-10-07 on the Tart VM `cua-linux` (Ubuntu 24.04 arm64,
cua over the hosted relay) with the gmail.com account makeworth17@gmail.com, gws 0.22.5.
`SKILL.draft.md` next to this file is the distilled procedure. It is a draft: it was
written from these two runs and has not yet been handed to a fresh agent for a replay.

## Route A: console GUI for everything

Cloud Console first-run terms, project, three API enables, consent-screen wizard, test
user, Desktop-app client, JSON download, `gws auth login` consent. About 40 minutes
from opening the console to stored credentials, most of it the agent discovering the
console's quirks (below). Human steps: the initial Chrome login, then a password
re-prompt plus a phone 2-step approval right before the gws consent.

## Route B: gcloud + `gws auth setup --project`, GUI for the rest

| Step | Who | Time |
|---|---|---|
| gcloud CLI tarball download, extract, install (linux-arm) | agent, shell | 13 s |
| `gcloud auth login` consent in Chrome (no password re-prompt this time) | agent, cua | about 1 min |
| `gcloud projects create` | agent, shell | 7 s |
| `gws auth setup --project <id>` non-interactive: enables all 15 Workspace APIs | agent, shell | 33 s |
| consent-screen wizard (4 steps) with the quirks known | agent, cua | 14 s |
| test user add + save | agent, cua | about 45 s (needs a second activation) |
| Desktop client create + JSON download | agent, cua | 8 s |
| `gws auth login` consent | agent, cua | about 15 s of agent time |
| password re-prompt + phone prompt before the consent | human | dominated the wall clock |

What `gws auth setup` does and does not cover (from `crates/google-workspace-cli/src/setup.rs`
at v0.22.5): gcloud check, `gcloud auth login`, project (creates one only in the
interactive picker; `--project` expects it to exist), API enabling, then a REST call to
`oauth2.googleapis.com/v1/projects/<id>/brands` meant to create the consent screen, which
answered 404 HTML and is silently swallowed (the console still showed "not configured"),
then it stops: OAuth client creation was removed when the IAP admin API was deprecated,
and in non-interactive mode it exits 3 with manual instructions. Test users are not
handled at all. The interactive TUI pauses at the same point, so a tmux-driven terminal
does not change the picture.

So route B removes project creation and API enabling (the step whose console button was
the flakiest) and adds a gcloud install plus one more OAuth consent. The consent screen,
test user and client stay GUI on both routes. Net: a few minutes saved on a first run,
and the first half becomes deterministic, which matters more than the minutes.

## Where the time really goes

- Google's identity re-check before the gws consent: a password prompt and a phone
  prompt with a number that expires in about a minute. The phone prompt expired once
  while the human was being asked, and the whole flow had to restart. On both routes
  this is the long pole, not the console clicks.
- The cua device session dropped twice while waiting on the human (idle); the REPL
  state has to be rebuilt each time. Keep the hand-off messages short and ask only when
  the prompt is already on screen.
- On a Linux device cua has no secrets backend, so `{{secret:KEY}}` cannot be typed
  there. Workaround used: store the password with `/secret` on the client Mac and pipe
  it over ssh into `xdotool type --file -` against the focused password field, after
  checking `document.activeElement` is the password input. The value never enters the
  transcript.

## Console quirks found (both routes)

- Submit buttons in side panels (test users Save) and the API Enable button: the first
  activation after the preceding input is swallowed; a second activation (click or
  Enter on the focused button) submits. Verify by reading the table or the URL.
- `getByRole("button", {name})` misses most console buttons; the API Enable button's
  accessible name is "enable this API" with a hidden duplicate first. A generic
  `button, a, [role=button]` locator filtered by text, `getByLabel` for inputs, element
  ids for selects, `input[type=radio][value=...]` for radios, and coordinates from
  `getBoundingClientRect` all worked.
- The console renders in the account's locale; append `hl=en` to every URL.
- "Get started" on the OAuth overview: the first text match is the description
  sentence; click the last match or by position.
- The localhost redirect page shows ERR_BLOCKED_BY_CLIENT in the agent-driven tab; the
  callback still reaches gws (log shows `"status": "success"`).
- Signing a second Google account into Chrome via AddSession created a new Chrome
  profile; the cua profile binding went stale and a new key had to be added and bound.

## Recommendation for cloud-resident agents

Do the account's one-time setup on the human's own machine (or once per account on any
machine), then give each environment the client JSON and `gws auth export` output. The
agent-driven console walk is for the first account, where it works but costs two human
hand-offs and ten-plus minutes; it is not the per-environment path.

## Residue

Google account: projects gws-agent-510910 and gws-agent-cli-1135, each with a consent
screen (External, Testing), one test user and a Desktop client named gws-cli. VM: gws in
~/.local/bin, credentials under ~/.config/gws (route A) and ~/.config/gws-cli-route
(route B), gcloud under /tmp/gcloud-dl, a systemd user unit cua-agent.service from the
cua-58 checkout, Chrome profile "Steve" (Profile 2) bound as cua key `steve`.
