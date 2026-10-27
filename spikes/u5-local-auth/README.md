# U5: what gates a step-up signature in an unsigned build

P5-O10 M9 (`docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md`), the remote layer's §12 unknown 1. An unsigned MAWS
keeps its device keys as software keys (`src/main/device/keys.ts`). Before main signs a step-up (RL §5.6), the person
must confirm the action. This spike finds which confirmation works in this repository's unsigned dev build. It tries
three candidates, in the spec's order of preference:

1. **Electron's `systemPreferences.promptTouchID(reason)`.** Electron runs `LAContext evaluateAccessControl` with
   `kSecAccessControlUserPresence` (Electron's `electron_api_system_preferences_mac.mm`). User presence accepts
   biometry *or* the device passcode. So it may fall back to the password even where `canPromptTouchID()` is false,
   as on the mini. The spike tests that guess.
2. **A LocalAuthentication addon** (`local-auth.m`, built like `native/peer-auth/`) with
   `LAPolicyDeviceOwnerAuthentication`. This accepts Touch ID, a paired Watch, or the login password, and the password
   is how the mini, which has no Touch ID, would answer.
3. **An app-level confirmation** (`dialog.showMessageBox`) with no OS authentication. RL §5.1 would record this as a
   weaker device.

The winner must work on the MacBook and must also fall back to the password on the mini.

## Running it (the owner, at the MacBook)

From the worktree, with `pnpm install --frozen-lockfile` done:

```sh
spikes/u5-local-auth/run.sh
```

It builds the addon, which needs the Xcode command line tools. It then opens a small window titled "MAWS U5 spike" and
asks **Start**. After that it shows eight prompts, one at a time. The window says what to do at each, and so does each
prompt's own text:

| # | Candidate | Prompt | Do this |
|---|---|---|---|
| 1 | promptTouchID | system | Approve with **Touch ID**. Note whether the text ends with `[END OF REASON]`. |
| 2 | promptTouchID | system | **Don't touch the sensor.** Choose "Use Password…" and type the login password. If there is no such option, press Cancel and note it. |
| 3 | promptTouchID | system | Press **Cancel**. |
| 4 | addon | system | Approve with **Touch ID**. Note whether `[END OF REASON]` shows. |
| 5 | addon | system | **Don't touch the sensor.** Choose "Use Password…" and type the password. |
| 6 | addon | system | Press **Cancel**. |
| 7 | app-level | app dialog | Press **Confirm**. |
| 8 | app-level | app dialog | Press **Cancel**. |

A step left unanswered for 120 s is recorded as `no answer` and the run moves on. It takes about three minutes.

The run writes `results/<host>-<time>.json`, which holds the environment (macOS, Electron, the binary's `codesign -dv`)
and each step's outcome. Next, copy `RECORD.md` to `results/<host>-<time>.md` and fill in what you saw. A step's
outcome can't say what a prompt looked like.

**Optional, on the mini:** run `spikes/u5-local-auth/run.sh --only 1,2` there. The mini has no Touch ID, so this shows
directly whether candidate 1 falls back to the password. Without that run, step 2 on the MacBook is the evidence.

The spike writes nothing outside this directory, apart from a scratch Electron profile under `$TMPDIR`, which it
removes at the end. It never touches MAWS's own profile.

## Choosing the winner

Pick the first candidate, in the order above, for which all of these hold:

- the Touch ID approval resolves;
- the password approval resolves;
- the cancel is refused.

The password approval is what stands in for the mini.

- **Candidate 1** needs no native code.
- **Candidate 2** moves to `native/local-auth/` with a committed prebuild and a loader in main, as peer-auth's does.
- **Candidate 3** is the fallback that always works. Choosing it records the device as weaker.

The winner plugs into `createStepUp({ confirm })` in `src/main/device/step-up.ts`, as a `Confirm` function:

- the OS candidates pass `prompt.summary` as the reason and leave the full `prompt.text` to the app's own view;
- the app-level candidate shows both.

Record the decision and its evidence in the O10 document's Surprises & Discoveries and Decision Log.
