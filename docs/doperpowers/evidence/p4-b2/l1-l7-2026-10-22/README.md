# P4-B2 L1 to L7 on the mini, 2026-10-22 (P4 Decision Log 69)

Run by B2's finisher in the slot after cua's hold 2b: GO 03:55:13Z, GUI free 04:08:27Z, hard end 04:35:13Z. A detached checkout of origin/master at 995686f00 (`scripts/e2e-build.sh plain`), `e2e/presentations-ime-live.spec.ts` under `MAWS_IME_LIVE=1` as a LaunchAgent in gui/501 (MAWS front and key), Korean 2-Set selected through the cua engine's `--probe input-source`, keys posted by its `--probe keystroke` (`CUAEngineBuild` 1abea7b0eea810db35f0d42ad28bf12cde8820ed004fa9bca29be8a19b0b987a, cua 75286950, asserted with PlistBuddy before the first probe and read in every prelude). No screencapture; L7 judged by its text. Six launches, 03:57:06Z to 04:07:40Z; ABC restored and read back at 04:08:15Z.

The spec was varied locally for some runs (uncommitted; each folder is named by what it ran): L3 accepting the TIS report's `perContextInput: false` where the defaults key is absent; L4's press at the keys' instant (`afterMs` 0); L5 with 300 ms after `gk`; L3 by a posted ⌃Space; and controls of L3, L4 and L7 on the deck's notes textarea (`run6-notes-controls`).

| Step | Result | Reading |
|---|---|---|
| L0 | pass (6 of 6) | the notes field ends `Notes가`: the probe's keys reach the input method |
| L1 | pass | `한글`, no bare jamo; first keydown keyCode 229 not composing; composition starts on cleared content |
| L2 | pass | `하나`, one bold run |
| L3 | fail (TIS twice, ⌃Space once) | `gksrmf`; the probe's own report reads ABC after the switch; the notes textarea reads `Notesgksrmf`: the helper's switch does not reach a focused field (the instrument) |
| L4 | fail (inconclusive at 107 to 128 ms; fail at 51 and 53 ms) | `gㅏㄴ글`, the first key raw; the notes textarea at 92.6 ms reads `Notesgㅏㄴ글`: the input method attaches 50 to 90 ms after a focus change in any field |
| L5 | pass with 300 ms after the first keys | `a` keeps `하`, `b` takes a fresh `ㅏ` (two earlier failures were the harness) |
| L6 | pass | `하하`; the element kept, not moved |
| L7 | fail (twice) | `한韓`; the notes textarea reads `Notes한韓`: the Hanja commit appends |

`run1-L0-L8-order/l1-hangul.json` is a live L1 trace (`source: live-hid`, macOS 27.0, Electron 44.4.5) that can replace the CDP stand-in `e2e/fixtures/ime/l1-hangul.json`.
