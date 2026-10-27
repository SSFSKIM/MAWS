# U5 record: SK.local, 2026-10-27

Results files (committed beside this record):

- `results/SK.local-2026-10-27T15-13-10-970Z.json`: the full run, all three candidates.
- `results/SK.local-2026-10-27T15-14-46-697Z.json`: candidate 1 rerun alone (`--only 1`).

Run by: the owner, at the machine: yes
Machine: MacBook (MacBookPro18,4, arm64, macOS 26.6.2), Touch ID present: yes; Watch paired and unlocking: not recorded

Both runs used this repository's dev Electron (44.4.5, Node 24.21.0), `node_modules/electron/dist/Electron.app` in the
M9 worktree. Its `codesign -dv` says `Signature=adhoc`, `TeamIdentifier=not set`: this is the unsigned build U5 asks
about. `app.getName()` was `Electron`.

## Invalid steps in the full run

Two steps of the first run read as answered and `ok: true`, but they don't count. Both were operator error:

- **Candidate 1, step 3 (cancel).** The owner approved this prompt instead of cancelling it, so it resolved. It shows
  nothing about a cancel. The rerun repeated all of candidate 1, and its cancel was refused (below).
- **Candidate 3, step 2 (cancel).** The owner pressed Confirm instead of Cancel. Candidate 3 was not rerun. Its cancel
  path is `dialog.showMessageBox`'s `cancelId`, and with an OS candidate winning it no longer matters.

Every other step of the first run is valid.

## What each prompt showed

### 1. `promptTouchID`

`canPromptTouchID()` was `true` in both runs. Outcomes are from the rerun; the first run's steps 1 and 2 agree.

- **Step 1 (Touch ID):** resolved (8.2 s; 3.5 s in the first run).
  - App name and title shown: **not yet observed** (the owner is being asked).
  - Whether `[END OF REASON]` was visible, or where the reason was cut: **not yet observed**.
- **Step 2 (password):** resolved with the login password, not Touch ID (14.4 s; 2.2 s in the first run). So
  "Use Password…" was offered and the password went through.
- **Step 3 (cancel):** rejected, with the error `인증이 취소되었습니다.` ("authentication was cancelled", macOS's
  localized description; the owner's locale is Korean) after 3.3 s. Electron rejects with that string alone, and no
  code.

### 2. The LAContext addon

Addon version 1. `canEvaluate()` gave `{ok: true, biometryType: "touch-id"}`.

- **Step 1 (Touch ID):** `ok: true` (1.4 s).
  - App name and title shown: **not yet observed**.
  - Whether `[END OF REASON]` was visible: **not yet observed**.
- **Step 2 (password):** `ok: true` (1.3 s), so "Use Password…" was offered and the password went through.
- **Step 3 (cancel):** `ok: false`, `code: -2` (`LAErrorUserCancel`), domain `com.apple.LocalAuthentication`, message
  `인증이 취소되었습니다.` (2.0 s).

### 3. App-level confirmation

- **Confirm:** `ok: true` (2.5 s).
- **Cancel:** invalid (see above).
- Whether the dialog showed the action's full text: **not yet observed**.

### Anything else

Nothing was reported: no second prompt, Keychain or TCC dialog, delay, or lost focus. The prompts' look is
**not yet observed** in the same way as the app name and the reason.

## Outcome

| Candidate | Touch ID approve | Password approve | Cancel refused | Works here |
|---|---|---|---|---|
| 1 `promptTouchID` | yes | yes | yes (rerun) | yes |
| 2 LAContext addon | yes | yes | yes, code -2 | yes |
| 3 app-level | — | — | invalid (operator error) | not needed |

**Winner** (the first candidate in order that works here *and* falls back to the password): **candidate 1,
`systemPreferences.promptTouchID`**.

**Why:**

- It is first in the spec's order of preference, and it passes all three checks in the rerun: the Touch ID approval
  resolves, the password approval resolves, and the cancel is refused.
- It needs no native code.
- Its password approval stands in for the mini, which has no Touch ID. Electron asks for user presence, which takes the
  password, so `canPromptTouchID()` being false there doesn't stop it. That is inferred from this MacBook run and
  Electron's source; the optional mini run (`run.sh --only 1,2`) was not made.
- Candidate 2 passed every check too, and is the tested fallback if `promptTouchID` ever loses the password path. Its
  cancel carries LocalAuthentication's error code, where `promptTouchID` gives only a localized string.
- The app-level confirmation is not needed, so no device is recorded as weaker on its account.
