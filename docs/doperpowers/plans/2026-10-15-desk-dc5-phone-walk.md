# The desk, DC5 M4 — the owner's walk (2026-10-15)

What only the owner's hands can prove for the phone milestone (DC5.G4) and §8 unknown 4 of the composite
(`docs/doperpowers/specs/2026-10-15-desk-design.md`, on `smns-erb`): a real iCloud Keychain passkey, Safari's
WebAuthn PRF and key unwrap, Cloudflare Access inside an iPhone home-screen app, a real push service, and how long an
Access session lasts against a notification tapped hours later. Everything else of M4 is proved in the browser
suites against the protocol double (`apps/desk-web/e2e/phone.spec.ts`).

Two parts. **Part 1** runs now, on the Mac, against the local hub. **Part 2** runs once DC3 has deployed the hub
(its M5) and its fake machine works against the deployment; the controller says when.

Write down what each **Record** line asks, in the sheet at the end, and send the sheet back through the session that
gave you this walk. A step that does something other than what it says is a finding: record what you saw (a
screenshot is best) and carry on where you can.

---

## Part 1 — on the Mac, against the local hub (about 15 minutes)

This records §8 unknown 4's first half: whether a passkey saved to iCloud Keychain gives the WebAuthn PRF output the
org key needs, in Safari and in Chrome, whether both get the same key from it, and whether Safari unwraps the key's
locked copies. The passkey made here is a throwaway for `localhost`; the org's real passkey is made in Part 2, step 1.

**Prepare.** In a terminal, from the MAWS worktree on branch `smns-erb-web` (or wherever the controller says):

    pnpm install
    pnpm --filter desk-web build
    rm -rf apps/desk-hub/.wrangler        # a fresh local org, with no key yet (this deletes the local hub's state)
    pnpm --filter desk-hub local

Wait for it to print its URL. Use **`http://localhost:8747`** in the browsers, not the `127.0.0.1` address it prints:
a passkey cannot be made for an IP address.

### In Safari

1. Open `http://localhost:8747`. The grid says "No projects yet"; the top bar says **Locked**.
2. Click **Locked**. The Org key dialog says the org has no key yet. Click **Set up with a passkey**. When macOS asks
   where to save it, save it to **iCloud Keychain** (Passwords), and confirm with Touch ID.
   - Expected: the dialog says "Unlocked for this tab. Fingerprint xxxx-xxxx-xxxx", and below it that this is the
     key's only method.
   - **Record P1.1:** the fingerprint, or the exact message if it failed (for instance "This browser can't use a
     passkey for the org key: it has no WebAuthn PRF…").
3. Click **Add a method**. Type a passphrase of at least 12 characters in both fields, click **Add**, wait for
   it, then click **Confirm with passkey** and confirm with Touch ID.
   - Expected: two methods listed, the same fingerprint, and a line "Deriving from the passphrase took N s on this
     device (Argon2id, 64 MiB, t 3, p 4)".
   - **Record P1.2:** that time.
4. Click **Lock**. Then **Locked** → **Unlock with passkey** → Touch ID. This is Safari unwrapping the key's copy
   locked with the passkey.
   - **Record P1.3:** the fingerprint shown (the same as P1.1?), or the message.
5. **Lock** again, and unlock with the passphrase this time (**Unlock**). This is Safari unwrapping the passphrase's
   copy.
   - **Record P1.4:** the fingerprint, and the time line.

### In Chrome

6. Open `http://localhost:8747` in Chrome. Click **Locked** → **Unlock with passkey**. Choose the passkey you saved
   in step 2 (Chrome offers the iCloud Keychain passkey; if it shows only a QR code or "use another device", record
   that).
   - **Record P1.5:** the fingerprint (the same as Safari's?), or the message.
7. **Lock**, then unlock with the passphrase.
   - **Record P1.6:** the fingerprint and the time line.

8. Stop the local hub (Ctrl-C). Note Safari's and Chrome's versions (Safari → About Safari; `chrome://version`) and
   macOS's. **Record P1.7.** You may delete the throwaway `localhost` passkey from Passwords afterwards.

---

## Part 2 — the iPhone, against the deployed hub (when the controller says it is deployed)

This records §8 unknown 4's second half and proves DC5.G4: PRF inside the standalone app (whose storage is separate
from Safari's, so the key is unlocked again there), Access sign-in inside the standalone app, push to the lock
screen, a tap opening the card, the answer reaching the machine, and an Access session against a push tapped hours
later. The controller gives you the hub's URL (below: `https://<hub>`).

### On the Mac first: the org's real key

1. Right after deployment (DX7: the first key set up decides the org's key), open `https://<hub>` in Safari, sign in
   through Access, and set up the org key as in Part 1, steps 2 and 3: **Set up with a passkey** (save to iCloud
   Keychain), then **Add a method** with a passphrase. Keep the passphrase in your password manager: it is one of
   the two ways back to the key every enrolled machine holds.
   - **Record P2.1:** the fingerprint.

### On the iPhone

2. Note the iPhone's iOS version (Settings → General → About). **Record P2.2.** Web push needs iOS 16.4 or later.
3. In Safari on the iPhone, open `https://<hub>` and sign in through Access.
   - Expected: the desk's grid. **Record P2.3:** how the sign-in went (which identity provider screens, anything
     odd).
4. Tap **Share** → **Add to Home Screen** → keep the name **Desk** → **Add**.
   - **Record P2.4:** the icon on the home screen: the desk's (a dark square with a `#` and an amber dot), or a
     screenshot of the page (which means Access kept iOS from fetching the icon).
5. Open **Desk** from the home screen. It opens without Safari's address bar.
   - **Record P2.5:** did it show the grid straight away (the Access session carried into the app), or an Access
     sign-in page? If a sign-in page: sign in, and record whether the sign-in stayed inside the app or jumped to
     Safari, and whether you ended up back in the app signed in.
6. In the app: **Menu** → **Org key**. It is locked (the installed app's storage is its own). **Keep unlocked on
   this device** is already ticked in the installed app (record it if not); leave it, then **Unlock with passkey** →
   Face ID, choosing the passkey from step 1.
   - **Record P2.6:** the fingerprint (the same as P2.1?), or the exact message if the passkey could not be used.
7. In the same dialog: **Lock**, check **Keep unlocked on this device** is ticked, and unlock with the
   **passphrase**.
   - **Record P2.7:** the fingerprint and the line "Deriving from the passphrase took N s on this device". This is
     the phone's cost of the passphrase, which nothing else can measure honestly.
8. **Menu** → **Notifications** → **Turn on notifications** → **Allow** when iOS asks.
   - Expected: "On for this device." **Record P2.8:** what it said (or the error).
9. Swipe the app away and lock the phone. Tell the controller you are ready; it raises a question from the fake
   machine in a project.
   - Expected, within seconds: a notification "‹session› has a question for you", under it "‹project› · Opens at
     the question", and the Desk icon's badge showing the org's waiting count. Press and hold it: there is no
     Allow, Deny, or reply.
   - **Record P2.9:** how long it took to arrive, its exact text, and the badge's number.
10. Tap the notification.
    - Expected: the app opens on that session's channel; "Checking the request…" shows briefly, then the question's
      card is drawn, marked. Answer it. The badge drops by one once the grid has the answer; back (‹ project) shows
      the project's channel list.
    - **Record P2.10:** what you saw, and whether the controller confirms the fake machine received the answer and
      verified it.
11. Leave it for some hours (at least four; the next morning is better). Then tell the controller, and it raises
    another question. Tap the notification.
    - **Record P2.11:** how many hours had passed; whether the app opened signed in, or on an Access sign-in page
      (and, after signing in, whether it landed on the card); whether the key was still unlocked.
12. One more, optional: open the app on that project's group chat and keep it on screen; the controller raises a
    question. No notification should arrive while you are looking at the project. Then go back to the grid, and the
    next one should arrive. **Record P2.12.**

---

## The sheet

| | What | Result |
| --- | --- | --- |
| P1.1 | Safari: org key set up with an iCloud Keychain passkey (fingerprint, or message) | |
| P1.2 | Mac Safari: passphrase derivation time | |
| P1.3 | Safari: unlock with the passkey (fingerprint) | |
| P1.4 | Safari: unlock with the passphrase (fingerprint, time) | |
| P1.5 | Chrome: unlock with the same passkey (fingerprint, or message) | |
| P1.6 | Chrome: unlock with the passphrase (fingerprint, time) | |
| P1.7 | Safari, Chrome, macOS versions | |
| P2.1 | The deployed org's fingerprint | |
| P2.2 | iOS version | |
| P2.3 | Access sign-in in iPhone Safari | |
| P2.4 | Home-screen icon: the desk's, or a screenshot | |
| P2.5 | Opening the installed app: signed in, or Access inside the app | |
| P2.6 | The installed app: unlock with the passkey (fingerprint, or message) | |
| P2.7 | The installed app: unlock with the passphrase (fingerprint, **time on the iPhone**) | |
| P2.8 | Turning notifications on | |
| P2.9 | The question's notification: delay, text, no actions | |
| P2.10 | Tap → card → answer reached the fake machine, verified | |
| P2.11 | Hours later: hours passed, signed in or not, landed on the card, still unlocked | |
| P2.12 | No push while the project is on screen; a push once it is not | |
