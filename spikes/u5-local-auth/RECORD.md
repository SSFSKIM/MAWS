# U5 record: <host>, <date>

Results file: `results/<host>-<time>.json` (commit it beside this record)
Run by: <who>, at the machine: yes / no
Machine: <MacBook / mini>, Touch ID present: yes / no; Watch paired and unlocking: yes / no

## What each prompt showed

Answer from what you saw on screen. The results file holds each step's outcome; the outcome can't say what a prompt
looked like.

### 1. `promptTouchID`

- **Step 1 (Touch ID):** which app name the dialog showed ("Electron"?) and what title. Was `[END OF REASON]` visible?
  If it wasn't, where was the text cut?
- **Step 2 (password):** was "Use Password…" offered? Did the password go through?
- **Step 3 (cancel):** what did you see?

### 2. The LAContext addon

- **Step 1 (Touch ID):** the app name and title shown. Was `[END OF REASON]` visible?
- **Step 2 (password):** was "Use Password…" offered? Did the password go through?
- **Step 3 (cancel):** what did you see?

### 3. App-level confirmation

- Did the dialog show the action's full text?

### Anything else

- A second prompt, a Keychain or TCC dialog, a delay, or the window losing focus.

## Outcome

| Candidate | Touch ID approve | Password approve | Cancel refused | Works here |
|---|---|---|---|---|
| 1 `promptTouchID` | | | | |
| 2 LAContext addon | | | | |
| 3 app-level | — | — | | |

**Winner** (the first candidate in order that works here *and* falls back to the password):

**Why:**
