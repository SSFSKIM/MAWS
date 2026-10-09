# cua board #90: the in-app browser's Chrome-like top chrome (execution pointer)

> **Parent:** `docs/charter.md` (E4a's browser and E4b's profile import, X14, X15) and the P1 interface ledger
> `docs/doperpowers/plans/2026-10-05-p1-interface-ledger.md` §4. Board issue #90 in the cua repository, owned by the
> cua_repl session.

Purpose: a Browser tab of an imported Chrome profile gets the top chrome Chrome users expect. A bookmarks bar mirrors the
profile's Chrome bookmarks read-only, with folders as native menus, a » overflow and suggestions in the address field.
The profile pill shows the profile's avatar and opens a popover (account, Switch profile, Sync bookmarks now, Re-import)
instead of replacing the main tab with Settings. An extensions action bar right of the address field opens each
extension's popup in a MAWS-hosted view and its options page as a transient tab, folding into one puzzle button when the
panel is narrow.

The living spec of this work is in the cua repository:
`docs/doperpowers/specs/2026-10-08-maws-browser-chrome-design.md` (cua worktree `/Users/new/Developer/GitHub/cua-wt-90`,
branch `spec/browser-chrome-90`). It owns the design, the acceptance, the Decision Log and Surprises & Discoveries for
both repositories; this file only keeps MAWS's convention that execution documents live under `plans/`.

MAWS branch: `90-browser-chrome` (worktree `/Users/new/Developer/GitHub/MAWS-wt-90`), cut from `master` at `5bd2cd57`
and rebased onto `16006624` at M4 with no conflicts.

Versions taken (ledger §4, X15), unchanged by the rebase since master's index and settings stood at 6 and 11:
settings version 12 (`browser.bookmarksBar`, `fromV11`; no keymap action), index migration 7 (`browser_bookmarks`,
pinned in `migrations.test.ts`), `profiles.json` version 2 (`bookmarks`, `gaiaName`, `userName`, `avatar` per record;
a version-1 file upgrades in memory, an older build opens version 2 read-only).

Verdicts (the spec's Decision Log):

- **S1** (`spikes/extension-popup/`): popups **promoted**. Under Electron 44.4.5 an extension's popup in a
  `WebContentsView` of the partition session loads, reaches its MV3 service worker or MV2 background page and sizes
  itself. `chrome.tabs.query` never answers the page's tab, `chrome.action.onClicked` has no API (a popup-less action is
  drawn inert with a tooltip), and `chrome.runtime.openOptionsPage()` fails, so options pages load directly.
- `electron-chrome-extensions` rejected (GPL-3.0 or a patron licence; its tab and window shims and child-window popup sit
  outside `TabStore`, the cua lease and the cover protocol); MAWS's own thin bar instead.
- Bookmarks are a read-only mirror of Chrome's `Bookmarks` file, read in place (capped, `O_NOFOLLOW`, after
  `admitted()`), re-read when the profile's partition is prepared and on Sync bookmarks now. Chrome's folder is never
  written.
- Folder and overflow menus are native (`Menu.popup`), so the page stays live; the profile popover is a DOM layer under
  the cover protocol.
- ⌘⇧B is a fixed chord, taken only in a tab whose partition has consented bookmarks and passed through to `panel.toggle`
  elsewhere (the owner's ruling, narrowed at M1b's review).
- A re-import follows E4b's import rule: the re-imported profile is active afterwards.
- The cover's still: a page under a DOM layer shows its captured still, never an empty pane (a pre-existing gap fixed in
  `view.ts` within #90).
- An options tab is transient and never holds a web page: leaving its extension's pages closes it and opens the page as a
  new ordinary tab in its place, and a partition request rule keeps ordinary tabs off `chrome-extension://` pages.

Milestones in MAWS: S1 (the popup spike), M1a (bookmarks behind the chrome), M1b (the bar, native menus, the toggle), M2
(the avatar and the profile popover, and the cover's still), M3 (the extensions action bar, popups and options pages),
M4 (acceptance, gates and these documents). The owner's sitting on their real profile is the last check before merge.
