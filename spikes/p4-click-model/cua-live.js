// P4-B2's spike S-IME, the real Mac's run: the cua_repl cells for L0 to L8 (research/p4-ux-prior-art.md §2.4;
// docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.4, §4.10). Written in the spike's first phase; NOT RUN yet. It runs
// in a GUI hold (findings.txt, "The real run"), by a session in the hold host's GUI session, with that host's own cua_repl.
//
// The order: setup, L8, L0, L1 … L7. L8 comes first because it makes no native edit: it must run while the page's undo
// stack (Blink's) is empty, which is what the Edit menu's Undo turns on (findings.txt finding 1); it needs no input source.
//
// The protocol. e2e/presentations-ime-live.spec.ts (`pnpm e2e:ime-live`) brings MAWS up foreground, and for each case
// writes /tmp/maws-ime-live/<case>.ready.json (what to press: page px, the window, the steps in words), then waits for
// /tmp/maws-ime-live/<case>.done. For each case the session:
//   1. reads <case>.ready.json (Bash: cat), and sets `T = <its page targets>` at the top of the case's cell;
//   2. runs the case's cell below through mcp__plugin_cua_cua_repl__js (one call; observe its output and screenshot);
//   3. writes <case>.done (Bash: `echo '<what it saw, one line>' > /tmp/maws-ime-live/<case>.done`);
//   4. reads <case>.result.json's `checks` and `facts` before the next case. A failed check is a finding, not a stop;
//      stop only when L0 fails (the keys do not reach the input method) or the window is not where the cells press.
// Keys go through `pressKey` one physical key at a time (xdotool names, the US letters of the 2-Set layout), never
// `typeText`: a typed string reaches the app as characters, past the input method. Call end_task when the run ends.
//
// The 2-Set keys: 한글 = g k s r m f; 하나 = g k s k; 한 = g k s; 하 = g k. Hanja: alt+Return. Input source: ctrl+space
// (macOS "Select the previous input source", enabled on both Macs: AppleSymbolicHotKeys 60 = ⌃Space).

// The first hold (2026-10-20, findings.txt §4): through the relay route (the vendor helper's CGEventPostToPid) L8 ran
// and passed, and the L0 gate failed: r and k arrived as plain keys, never reaching the input method. Run L0 first on any
// new route, and L1 to L7 only once it composes.
//
// ---- cell: setup (once). Binds the MAWS window and the coordinate mapping.
// Bind the e2e app by its path: getApp('Electron') resolved the name to another Electron.app on disk and launched its
// default app (the first hold). The path is <worktree>/node_modules/electron/dist/Electron.app.
const app = await cua.getApp('/Users/new/<worktree>/node_modules/electron/dist/Electron.app');
const shot = await app.getScreenshot({ emit: false });
// Sky's coordinates on macOS are the window screenshot's pixels. The spec's targets are page px (CSS px from the
// content's top-left; MAWS's window hides its title bar, so the content starts at the window's top-left). k maps one to
// the other: the screenshot's width over the window's width in points (the first ready.json's `window.outerW`; the
// spec fills the display's work area, the sidebar and the panel collapsed, and records the slide's `scale`).
const OUTER_W = 0; // set from ready.json's window.outerW before running this cell
// the screenshot is a JPEG (the first hold: 5120 × 2716 for a 2560 × 1358 window, so k = 2): its size from the SOF marker
const jpegSize = (b) => {
  for (let i = 2; i < b.length; ) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
};
const size = jpegSize(shot);
globalThis.k = size.w / OUTER_W;
globalThis.press = (p) => app.click([Math.round(p.x * k), Math.round(p.y * k)]);
globalThis.keys = async (list, gapMs = 60) => {
  for (const key of list.split(' ')) {
    await app.pressKey(key);
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
};
globalThis.wait = (ms) => new Promise((r) => setTimeout(r, ms));
nodeRepl.write(JSON.stringify({ screenshot: size, k }));

// ---- cell: L0, the instrument check (the prototype off). Needs 2-Set selected: if the notes field shows gks, press
// ctrl+space once and run the cell again (Escape first). Also checks the mapping: the press must land in the notes field.
var T = /* ready.json's page */ { notes: { x: 0, y: 0 }, a: { x: 0, y: 0 }, empty: { x: 0, y: 0 } };
await press(T.notes);
await wait(300);
await keys('g k s');
await wait(300);
await app.getScreenshot(); // the notes field should end in 한 (composing); the spec reads its value
await app.pressKey('Escape');
// then write L0.done; L0.result.json's facts.notes must end in 한 and its events must hold keydowns with keyCode 229.
// If the press missed (the trace's pointerdown is elsewhere), set k from the miss and run again.

// ---- cell: L1, basic (the fixture). Select a box and type 한글.
var T = { a: { x: 0, y: 0 }, empty: { x: 0, y: 0 } };
await press(T.a);
await wait(300);
await keys('g k s r m f');
await wait(300);
await press(T.empty);
// result: a reads 한글; Q2: the first keydown keyCode 229 not composing, compositionStartText '' (mode clear).
// The run writes /tmp/maws-ime-live/l1-hangul.json: copy it to e2e/fixtures/ime/l1-hangul.json on the branch after.

// ---- cell: L2, the carried consonant: 하나, into b, whose text is one bold run (the clear keeps it bold through the
// stored marks ProseMirror wraps the cursor in at compositionstart: a DOM write at the composition's start; findings Q2).
var T = { b: { x: 0, y: 0 }, empty: { x: 0, y: 0 } };
await press(T.b);
await wait(300);
await keys('g k s k');
await wait(300);
await press(T.empty);

// ---- cell: L3, switching the input source while the box is armed. FIRST select ABC (ctrl+space until
// `defaults read com.apple.HIToolbox AppleSelectedInputSources` names ABC; Bash), then run the cell.
var T = { a: { x: 0, y: 0 }, empty: { x: 0, y: 0 } };
await press(T.a);
await wait(300);
await app.pressKey('ctrl+space'); // to 2-Set while a is armed
await wait(500);
await keys('g k s r m f');
await wait(300);
await press(T.empty);
// result: a reads 한글, no ㅎㅏㄴ. Leave 2-Set selected for the cases after.

// ---- cell: L4, fast typing: the first key within 100 ms of the press that arms the box. Nothing selected for a second
// first (the spec's setup leaves it so). One call, no waits: result.facts.pressToFirstKeyMs says whether cua got the
// first key in under 100 ms; if not, L4 was not reached by cua (say so in the done line; the owner's hands can do it).
var T = { a: { x: 0, y: 0 }, empty: { x: 0, y: 0 } };
await wait(1000);
await press(T.a);
await keys('g k s r m f', 0);
await wait(300);
await press(T.empty);

// ---- cell: L5, moving mid-composition: 하 composing in a, then a press on b, then ㅏ in b.
var T = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, empty: { x: 0, y: 0 } };
await press(T.a);
await wait(300);
await keys('g k');
await press(T.b);
await wait(300);
await keys('k');
await wait(300);
await press(T.empty);
// result: a keeps 하; b reads ㅏ (a fresh composition, no ㅎ carried over).

// ---- cell: L6, editing keys during a composition: 한, BackSpace (하), Left and Right (commit and move), 하 again, Return.
var T = { a: { x: 0, y: 0 } };
await press(T.a);
await wait(300);
await keys('g k s BackSpace Left Right g k Return', 120);
await wait(300);
await keys('Escape Escape', 200);
// result: a begins 하하, the element neither removed nor moved (no key was taken as an element key).

// ---- cell: L7, Hanja: the candidate window opens at the box.
var T = { a: { x: 0, y: 0 }, empty: { x: 0, y: 0 } };
await press(T.a);
await wait(300);
await keys('g k s');
await app.pressKey('alt+Return');
await wait(800);
await app.getScreenshot(); // judge: the Hanja candidate window sits at a's text (below or beside it), not at the window's corner
await app.pressKey('Escape');
await wait(300);
await press(T.empty);
// done line: "hanja window at the box: yes|no (where)".

// ---- cell: L8, shortcuts while armed, from the keyboard and from the Edit menu. For this case the spec's Edit menu is a
// probe (the same items, each noting itself, then doing what the role item does), so it can tell whether a key reached
// the menu: facts.menu lists what fired, in order. Its first press is the run's first, so it is a cell of its own that
// checks the mapping: if a is not selected (no frame on a in the screenshot), fix k and run that cell again (a press
// selects and types nothing, so nothing of the case is spent). Once the keys cell has run, a clean rerun of L8 means
// restarting the spec with MAWS_IME_LIVE_CASES=L8,L0,L1,… (the deck and the probe's list reset only at a case's start).
var T = { a: { x: 0, y: 0 }, empty: { x: 0, y: 0 } };
await press(T.a);
await wait(300);
await app.getScreenshot();

// ---- cell: L8's keys (after the mapping holds)
await app.pressKey('super+c'); // left to the menu: its Copy fires and the stage copies the element (prevented)
await app.pressKey('Right'); // a nudged to 201
await wait(1200); // past the deck's 1 s typing pause: the next nudge is a second undo step
await app.pressKey('Right'); // 202
await wait(300);
await app.pressKey('super+z'); // the box's own, cancelled: one step undone (201), the menu's Undo not reached
await app.pressKey('super+v'); // left to the menu: the element pasted, not its text into a
await wait(500);
await app.getAXState(); // find the menu bar's Edit item
// Then with the mouse, by the AX indices of the state above: Edit › Undo; then app.pressKey('Escape'), wait 200 ms,
// app.pressKey('Tab') (back from the pasted copy, now armed, to a, the slide's first element: the copy covers a's text,
// a press on it would edit the copy, and Shift+Tab would reach s, since a pinned paste is keyed over every sibling);
// Edit › Copy; Edit › Paste; Edit › Undo. Observe after each with getAXState or a screenshot.
// result: a keeps Hello; left 201px; facts.menu is copy, paste, undo, copy, paste, undo (no undo after the ⌘Z); the two
// pastes at 224px and 225px (copies of a at 200 and at 201); both Edit › Undo clicks do nothing to the deck (finding 1's
// gap: 5 elements, historyUndo 0).
