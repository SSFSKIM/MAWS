# Question sheet, C4 — the local page: execution (2026-11-24)

> **Composite:** `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`, child **C4** (The local page). **Parent pin:** `760d7ad1a` (master). **Ticket:** MAWS board #869, a child of #600. The child's section in the composite ("### C4: The local page") is its spec. The composite's §7 and §8.2 are its design: §8.2's four rules bind, and so do §7, §3's one writer and §4.2's table; the port, the pairing command and the bundle's build are advisory (the composite's "Grades"). X4 is the contract it writes; X1, X2 and X5 the ones it consumes. This document carries the constraints, the decisions the composite left to this child, the interfaces and the milestones, and nothing of the design.
>
> **Written against:** MAWS master `760d7ad1a`. C3's execution document, `docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md` on branch `question-sheet-c3` at `0424db990`, whose first landing (its M1 to M3) is being built and is not on master: every name this document takes from its §C (the reader and the service), §E (the stand-in door), §F and §G (the components, the composite's X5) is the name that plan states, and **is read again in the merged code when that landing merges, before M3 starts; where the code differs, the code binds** and the controller rewrites the sentence here. The sheet's published set at doperpowers `2594002af` (set version 1), and C2's plan, `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` in doperpowers (I1, I3, I5, I8, its M5), for how the tool reads a registration and prints the terminal's line; C2's terminal side (its gate G2) is not merged either.
>
> **Read before M1:** the composite whole; C3's plan (Constraints, S1 to S7, S13 to S15, §B to §G); in doperpowers, `sminos/types/sheet/README.md` and `schema/surface.schema.json`; here, `src/mawsd/daemon.ts` (its opening comment is the daemon's design in one place), `src/mawsd/artifacts-endpoint.ts` (the shape this child's listener copies) and `docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md` ("The daemon shape", "The clocks").

After this child, a terminal session that asks through the sheet has a place to be answered beside the terminal. The terminal's line shows a link, `http://sheet.localhost:47590/s/<session>`. Opened in a browser that was never paired, the link shows one screen that says how to pair: run `mawsd sheet pair` in a terminal, type the code it prints. From then on that browser shows, at `/`, every session on this machine that has open questions, the stopped ones apart, and at `/s/<session>` that session's sheet: the same cards the MAWS app draws, with one Send. The page follows the record as it changes, keeps what the person typed across a reload, and says so when `mawsd` is not reachable. A page open on any other site, a development server on another port, another machine and a rebound DNS name get nothing from it: each is refused by a rule the composite fixed, and each refusal is a test that sends the request and sees it refused.

Nothing in use today changes. The page serves only sessions that have a record under the sminos home, which exist only where someone turned the sheet on; no session's question tool changes (that is C7), and until this child's last milestone has seen the page work with a real terminal session, only a `mawsd` started with a switch serves it.

How to see each of these is Concrete Steps. What closes the child is its acceptance in the composite, cut into clauses under "The acceptance, by clause".

## Progress

- [x] (2026-11-24) This document written against the composite at `760d7ad1a`, MAWS master `760d7ad1a`, C3's plan at `0424db990` and the set at doperpowers `2594002af`.
- [ ] The document's buildability review (one round).
- [ ] The look: the page's own screens put to the owner and the answers recorded ("The look"). Blocks M2 and M4, not M1 or M3.
- [ ] M1 — The page server: who is let in. Blocked by: nothing.
- [ ] M2 — The page's shell, shipped and paired in a browser. Blocked by: M1; the look.
- [ ] M3 — Sheets through the page server, and the registration. Blocked by: M1; C3's first landing merged.
- [ ] M4 — The overview and the sheet on the page. Blocked by: M2, M3; the look.
- [ ] Landing C4a (M1 to M4): everything a gate on GitHub Actions can prove; the page served only under its switch.
- [ ] M5 — Live on a Mac with a real terminal session, the built look, the default turned on. Blocked by: M4; C2.G2 merged in doperpowers.
- [ ] Landing C4b (M5).

## Words this document adds

The composite's Terms define terminal session, MAWS-run session, the tool, sheet, question, asker, surface, the page, the bridge and envelope. C2's plan adds the record (one session's sheet directory), **the door** (`sminos sheet put`, the one writer's entrance; this document keeps that meaning and never uses the word for anything of its own) and the published set. C3's plan adds the set's pin, the model, the spine, the stand-in door and the surface's memory. Added here:

- **The page server** is the part of `mawsd` that listens on loopback and answers a browser (`src/mawsd/sheet-page/`). **The bundle** is the built page it serves: static files made by `apps/sheet-page` (§P).
- **The page's origin** is `http://sheet.localhost:<port>`, the port being the one the page server listens on (47590 unless told). It is one string, and the Host check, the Origin check and the registration's `url` are all read from it.
- **The shell** is what a navigation gets: the bundle's `index.html` and the files it names. It holds no session's data and is the same bytes whatever path was asked.
- **The three checks** are the Host check, the Origin check and the credential check (§L). **A stranger** is any requester that fails one.
- **A code** is the one-time pairing code `mawsd sheet pair` prints. **The credential** is what a browser gets for it and sends from then on. **A paired browser** is one whose credential the page server knows.
- **The live connection** is the WebSocket a page holds open to hear that a record changed (§N).
- **The registration** is the file of the composite's §7, `<sminos home>/sheet/surfaces/<name>.json` (X4). **The heartbeat** is its rewrite every ten seconds.
- **The default daemon** is the `mawsd` of the machine's default profile, which the app installs as a unit and which never exits by itself. Every other `mawsd` is a private one of a scratch or development profile.
- **The rig** is the browser suite's support under `apps/sheet-page/e2e/`: a real `mawsd` process over scratch directories, a real Chromium (§Q).
- **The look** is the appearance of the page's own screens, settled with the owner ("The look").

Interface sections are lettered §J to §Q, on from C3's §A to §I, so a letter names one place across the two documents. Decisions are T1 to T27 (the charter's are D-, C3's S, C2's U and K).

## Verification

- This document: the buildability review (the composite's Verification, "Each plan child's execution document"), once.
- Each milestone: the task review of doperpowers:subagent-driven-execution at its boundary. M1 (the three checks, which every later milestone stands behind) is reviewed before anything consumes it.
- The branch: doperpowers:review-code at **high** for landing C4a (the composite's Verification: a door into every session on the machine). Landing C4b is one constant, pictures and whatever the live run found: reviewed at the rung its diff warrants, and at high again if it changed anything under `src/mawsd/sheet-page/`.
- The look: the owner's eye, on a drawn example before M2 and on pictures of the built page at M5. No review by an agent stands in for it.

## Constraints on every milestone

**Binding inheritance** (the composite's "Constraints on every child" and "Grades").

- The engine is unmodified (charter D-1). Nothing here touches it.
- Board ticket 711: nothing in this child sends a user-role message, so it binds only as a rule not to start.
- §3's one writer and §4.2's table: the page changes a sheet only by inbox lines through the door, reached through C3's service; it writes nothing in a record but an image under `uploads/` before the door names it; it deletes nothing there; it never computes a verdict and shows what became of an act from the model's `sent`. The page server reads no record itself: C3's reader is the only one (X5).
- §7 and X4: the registration's shape is the set's `schema/surface.schema.json`, rewritten every 10 seconds; nothing of the published set changes.
- §8.2's four rules, each quoted where it is implemented (§L, §M, §N) and each with a test that sends the request the rule refuses.
- MAWS: tokens only, light theme default; gates through `scripts/ci-gate.sh`.
- Nothing the owner uses today stops working at any step: a new path lands beside the old one, and a default changes only after its replacement is verified. Here: the page server is inert in a `mawsd` whose build holds no bundle; it is served only under a switch until M5 has seen it work (T2); it serves only sessions that have a record; it changes no session's question tool, no setting and no file MAWS or sminos reads today; and a `mawsd` in which any part of it fails starts and serves everything else exactly as before (T6).

**The repository's rules** (`CLAUDE.md`).

- Light theme is the default; components use tokens only. The page's own components live in `apps/sheet-page/src/`, outside what `test/support/tokens-guard.test.ts` walks today; M2 adds that directory to the guard.
- Shapes and colours are today's (the UX wave's law 7): the page starts from the parts MAWS already has and adds no palette of its own.
- Copy lives in a `copy.ts` beside its module and follows the word cut's rules (`docs/doperpowers/specs/2026-11-16-word-cut-design.md`); `test/one-locale.test.ts` gains the page's directory. The strings the composite fixes are quoted in §P; every other string is settled in the look.
- The charter's contracts and decisions bind; the wire's rules are the ones this child meets (three commands join the `daemon` namespace in M1, so the wire moves there: `WIRE_MINOR` rises by one over whatever master holds then and the three pinned files are regenerated with `pnpm wire:manifest`).
- Gates (`docs/doperpowers/plans/2026-10-14-gate-offload.md` §3.5). Class 1a, which is typecheck, lint, the unit suite and the probes, runs on GitHub Actions: `scripts/ci-gate.sh <worktree> --gates static,unit,probes`. An Electron e2e group a milestone names runs on a macOS lane: `--gates e2e:<group>`. The page's own browser suite is a new group, `e2e:sheet-page`, which drives no Electron and runs on the Linux pool as `e2e:desk-web` does (T24). A call naming no gates is refused. M5's live steps need a real model, a real terminal and a person's browser, and run by hand on a Mac under the load rule. While iterating, one focused test file may be run on the machine.
- **The repository is public.** No file, test, fixture, document, commit message or pull request carries a path under the owner's home, a machine's name, an account, or the version of any software installed on the owner's machines. Examples and fixtures use invented names, paths and text (`/Users/me/work/proj/...`, session ids of the set's own form). The set's copy under `test/fixtures/sheet/set/` is never edited; a test that needs another record builds it in a temporary directory. Pictures of the built page are kept outside the repository.

**Facts of the code at the pin**, each read at `760d7ad1a`.

- **How `mawsd` is built and started.** `mawsd` is `out/main/mawsd.js`, the second input of main's build (`electron.vite.config.ts`), run as plain Node: the app's binary with `ELECTRON_RUN_AS_NODE=1` on a Mac, a pinned Node on Linux (`src/mawsd/index.ts`). The daemon is `mawsd run --unit|--private --dir <profile>/mawsd` with the profile in `MAWS_USER_DATA`; every other command is the command line's (`src/mawsd/cli.ts`), which reaches a running daemon through `machine.sock` and never starts one. The app installs the default profile's daemon as a unit (a LaunchAgent on macOS, a systemd user unit on Linux) and starts a private one for any other profile; a unit never exits by itself, a private one exits after ten minutes with no client, both hosts parked and no hold out (`src/mawsd/clocks.ts`). The default profile is `defaultProfileDir` (`src/shared/daemon/profile.ts`).
- **Its start and its exit** are one function, `startDaemon` (`src/mawsd/daemon.ts`): the directory, the lock, the token, the log, the sockets, the endpoint module, the adoption of running hosts, then `clocks.served()`. A socket that cannot listen there is fatal. The exit order closes the listeners, stops the endpoint, the render seam and the spine, closes the clients, and removes what is the daemon's own.
- **What it serves today, and how each entrance knows its caller** (`src/shared/daemon/files.ts`, `src/mawsd/daemon.ts`). Three Unix sockets, `engine-host.sock`, `pty-host.sock` and `machine.sock`, mode 0600 in a 0700 directory, whose clients present `mawsd.token`. `artifacts.sock`, which is HTTP over a Unix socket with no token and no loopback port: the file's mode is its whole check (`src/mawsd/artifacts-endpoint.ts`). A cua socket per session, checked by the peer's identity. The endpoint module's sealed channels, among them a WebSocket listener bound to the tailnet's addresses, never a wildcard, and by default only in a unit daemon (`src/endpoint/direct-listener.ts`, `src/endpoint/endpoint.ts`). The one loopback TCP listener in the tree is the connectors' OAuth callback (`src/services/connectors/oauth-callback.ts`): `127.0.0.1`, a random port, fixed text, closed when the flow ends. **So nothing in the repository answers a browser on a known port, checks a Host or an Origin header, or keeps a browser's credential: all of §L is new code**, and the composite's "first HTTP door" is exact in that sense and not in the sense that `mawsd` never spoke HTTP.
- **Nothing is loaded at an idle start.** `mawsd`'s deferred parts (the endpoint, the services library, the artifact handler, the render seam) are chunks loaded at their first use; `src/engine-host/bundle-guard.test.ts` has a case for each and keeps `ws` off the run path, and `src/mawsd/pack-chunks.test.ts` holds the Linux pack to every chunk the graph names. The artifact endpoint is the pattern: a `node:net` server whose accepted connections are paused until the handler's chunk has loaded.
- **The same guard reads every `.js` file under `out/main` and `out/preload`, at any depth, and fails on a character above U+00FF** (its last case, with `scripts/latin1-bundles.ts`). A browser bundle put under `out/main` would fail it.
- **The spine** (C3's word) is composed by `src/mawsd/spine-seam.ts`: cold at start, loaded at a trigger (`ensure('command')`), released when the daemon has been quiet for its quiet period, refused while another process holds `spine.lock`, yielded to an older app. `root()` answers the loaded root (`SpineRoot`, `src/services/spine-root.ts`), which at this pin exposes `view`, `channel` and `projects` and nothing of a sheet. A hold (`DaemonServices.hold(reason, standing)`, `src/mawsd/endpoint-seam.ts`) keeps the daemon from being quiet, so the spine stays loaded and a private daemon stays up while one is out; `DaemonServices.onEvent` carries the spine's events with owner `machine` across loads.
- **The `daemon` namespace** (`src/shared/ipc/schema/daemon.ts`, `names/daemon.ts`, `grades/daemon.ts`) is main-only and machine-owned, served on `machine.sock` by the services front (`src/mawsd/front.ts`, `FRONT_COMMANDS`) through `daemon.ts`'s own switch. `daemon.endpoint` is graded `internal`, which no remote caller holds. `daemon.status`'s schema marks the fields a remote caller must not see (`localOnly`).
- **A person's `mawsd` command** is a wrapper, `<profile>/mawsd/bin/mawsd`, which for the default profile is linked as `mawsd` into the user's own `bin` directory when that exists and holds no other (`src/mawsd/install.ts`).
- **How the sminos home is found.** `sminosHome(env, shell)` in `src/services/lane-a/discovery.ts`: `SMINOS_HOME`, then `DAEMON_HOME`, each from the process's environment and then the login shell's, else `~/.claude/sminos`; under a test runner (`VITEST`, or `MAWS_E2E=1`) it throws for a home under the real `~/.claude`. A unit daemon has its unit's environment and none of the shell's exports; the login shell's is captured with `captureShellEnvironment` (`src/shared/host/shell-env.ts`: `$SHELL -ilc 'env -0'`, five seconds at most), which the spine does at each load and `daemon.ts` already imports. `discovery.ts` imports Node builtins only.
- **How desk-web bundles renderer modules** (`apps/desk-web/vite.config.ts`): Vite with the React plugin under the React Compiler and Tailwind's plugin; aliases `@shared` and `@artifacts` to `src/shared` and `src/artifacts`, `shiki/wasm` to a stub, and `lowlight` to MAWS's grammar-free build; the Markdown stack split into vendor chunks. Its stylesheet (`apps/desk-web/src/styles/app.css`) imports the app's tokens (`src/renderer/src/styles/app.css`), the transcript's and Streamdown's stylesheets, and names each renderer directory it imports in a Tailwind `@source` line. A workspace package is any directory under `apps/` (`pnpm-workspace.yaml`); the root `typecheck` script names each app's, the root `vitest.config.ts` lists each app's config among its projects, and `pnpm build` chains each app's build after `electron-vite build`.
- **What ships.** The Mac app packs `out/**` (`electron-builder.yml`); a `mawsd` inside an `app.asar` reads its own files through Electron's archive layer. The Linux pack (`scripts/mawsd-pack.mjs`) copies `out/main/**` after `pnpm build:main-preload` and names the release by a hash of its content. `electron-vite build` empties the output directories it builds (`out/main`, `out/preload`, `out/renderer`) and no other.
- **The browser-level rigs that exist.** The root Playwright config drives Electron only, and installs no browser. `apps/desk-web` has its own (`playwright.config.ts`, `e2e/`): the built app served by a double, driven in Playwright's own Chromium on Linux, where the gate runs it; on a Mac it would drive the installed Chrome, which is why the gate keeps that group off the Macs. The gate's groups are three lists in `.github/workflows/gate.yml`: `CLASS1_E2E` (every class-1 group), `LINUX_E2E` (those a Linux lane takes) and `POOL_E2E` (those that drive no Electron and run on the pool; today `desk-web` alone), with one workflow step that installs Playwright's browsers for the `desk-web` group; a group is its package script `e2e:<group>`. Process-level suites start a real daemon in the test's process over the built bundles and a scratch profile (`src/mawsd/process-spine.test.ts`), skipped without a build, which class 1a makes first.
- **The transcript's Markdown** (`src/renderer/src/transcript/view/markdown/`) draws no raw HTML (a tag is text) and no image but inline `data:image/` ones; its links pass two gates and reach `Link.tsx`, which draws a path link and an artifact mention as a `span` with the role of a button, and **an `http`, `https` or `mailto:` link as an anchor that carries its `href`**, opened through an action on click. In the app nothing else can follow that anchor. In a browser the browser can: a middle click, a modified click and the context menu follow an `href` whatever a click handler does.
- **The app's own content policy** (`src/main/csp.ts`) allows inline styles, which Tailwind's and Streamdown's output and the syntax highlighter need, and `data:` and `blob:` images and `data:` fonts.
- **The name resolves to both loopback addresses.** On the Mac this was written on, the system resolver answers `sheet.localhost` with `127.0.0.1` and `::1` (asked with `getaddrinfo`), and Node lists `::1` first. Chromium and Firefox resolve any name under `localhost` to loopback themselves.

## Decisions settled at authoring

Each is a choice the composite left to this child. Where one makes a sentence of the composite false or incomplete, the sentence is in the last section. Shapes and constants are in §J to §Q.

**Where the page server lives, and when it serves.**

- **T1 · It is `mawsd`'s own part, outside the spine**, in `src/mawsd/sheet-page/`, built on the artifact endpoint's pattern: listeners of `node:net` made by the daemon, the handler a chunk loaded at the first accepted connection. It reaches sheets by calling C3's service in process, through the spine's root (§N). It is not a part of the spine because the spine is cold at start, is released when the machine is quiet and can be refused, while the shell, the pairing and the heartbeat must answer through all three. It does not go through the wire's `sheet.*` commands because `sheet.put`'s handler stamps every inbox line `by: 'maws'` (C3's §D), and a line from the page is `by: 'page'`.
- **T2 · The default daemon serves the page; any other `mawsd` serves it only when `MAWS_SHEET_PAGE=1`**, and `MAWS_SHEET_PAGE=0` turns it off in the default one. The rule is the direct listener's (only a unit binds it by default), stated by profile and not by kind because the gate's launchd suites run unit daemons over scratch profiles, which must never take the port or write into a real sminos home. It also makes one page a machine account without any negotiation: there is one default profile. A daemon decides first from its own environment and the constant below, and only one that is going to serve captures the login shell's (for the sminos home, the port, and a `MAWS_SHEET_PAGE=0` exported there), so a private daemon that serves no page starts no shell for it. Until M5 the constant `SHEET_PAGE_DEFAULT_ON` is false, so through M1 to M4 even the default daemon serves only under the switch; M5 sets it true after the live check (the composite's rule that a default changes only after its replacement is verified).
- **T3 · It listens on `127.0.0.1` and on `::1`, each named, never a wildcard, the same port on both, and serves on neither unless it holds both.** The name resolves to both addresses, and a browser may try `::1` first. Were the page on one address only, any process that bound the other would answer under the page's origin, and the browser would hand it everything the origin has stored. A machine with no IPv6 loopback (the bind answers `EADDRNOTAVAIL` or `EAFNOSUPPORT`) is served on `127.0.0.1` alone.
- **T4 · The port is 47590, or `MAWS_SHEET_PORT`** (1024 to 65535, or 0 for one the system picks, which the suites use), read from `mawsd`'s environment and then from the login shell's, as C3's S2 reads `MAWS_SMINOS_CLI`; a value that names no port is ignored with a log line, as `MAWS_ENDPOINT_PORT` is. **A taken port is not served and not registered.** The state reads `port-taken`, `mawsd status` says so, and the bind is tried again every 30 seconds. It does not move to another port: the port is part of the page's origin, so a page on another port is a browser that was never paired with drafts it cannot see, behind a link that changed; and whatever holds 47590 may be another profile's page, whose registration stands. A terminal session started meanwhile finds no live surface and has today's tool, which is the composite's own fallback.
- **T5 · A build with no bundle serves no page** (state `no-bundle`). The bundle is found beside the build (§P); a development run and the Electron suites' builds have none, and need none.
- **T6 · Nothing of the page can stop or delay the daemon.** The page server starts after `clocks.served()`, in the background; every failure in it (the shell capture, the bundle, a bind, the handler's load, the sminos home, a write of the registration or of the browsers' file) is a state and a log line, never an exit. Its listeners are closed first in the exit order, with the daemon's others, and its stop is bounded at half a second.

**Who is let in.**

- **T7 · The page's origin is one string, `http://sheet.localhost:<port>`, and the three checks are read from it** (§L has them request by request). The Host check compares the request's `Host` with `sheet.localhost:<port>`, case folded, and nothing else passes: not `127.0.0.1:<port>`, not `localhost:<port>`, not the name with a trailing dot or without its port. It runs first, on every request, the shell and a WebSocket's upgrade included, so a requester with the wrong Host learns nothing, not even which paths exist. A refusal's body is a constant: nothing of the request is written back.
- **T8 · A code is eight characters of a 32-letter alphabet without look-alikes, shown as `XXXX-XXXX`: 40 bits.** `mawsd sheet pair` asks the running daemon for one over `machine.sock`, whose token only this user's processes can read, and prints it. It is held in memory only, lives five minutes, works once, and there is one at a time: a second `pair` voids the first. Five wrong tries void it, and the page server answers at most ten exchanges a minute whatever their source. It is typed into the pairing screen, never carried in a link: the composite's link has no secret, and a typed code pairs whichever browser the person is looking at.
- **T9 · The credential is 32 random bytes, in base64url**, made at the exchange and sent back once. The page keeps it in `localStorage`, which is scoped to the origin, port included, and sends it as `Authorization: Bearer <credential>` on every request under `/api/` and as the first message of the live connection (rule 1). It is never a cookie, never in a URL and never in a log line. `mawsd` keeps only its SHA-256, in `<profile>/mawsd/sheet-page.json` (mode 0600 in the daemon's 0700 directory, written by replace), and compares in constant time. Hashed because the file then holds nothing a reader of it could send.
- **T10 · A credential lasts until it is revoked or has not been used for 90 days. Each browser pairs for itself**, with a code of its own; at most 16 are kept, and a seventeenth drops the one seen longest ago. `mawsd sheet browsers` lists them (an id, a label read from the user agent and cut to a fixed alphabet, when paired, when last seen); `mawsd sheet unpair <id>` and `--all` revoke, and the page's own menu unpairs the browser it runs in. A revocation closes that browser's live connections at once, and its next request is refused. When a browser was last seen is written at most once an hour.
- **T11 · Three commands join the `daemon` namespace**, main-only and graded `internal`, so no caller that comes through the endpoint can mint a code or list a browser: `daemon.sheetPair`, `daemon.sheetBrowsers`, `daemon.sheetUnpair` (§K). Three commands and not one with a union for its input, because a member added to a union later breaks the wire (the reason `daemon.e2eRender` is a command of its own).

**What it answers with.**

- **T12 · Every response, a refusal and a WebSocket's refused upgrade included, carries the same headers** (§M): rule 3's three, and with them `frame-ancestors 'none'` in the content policy, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`. The content policy starts from `default-src 'none'` and names only the page's own origin, `data:` and `blob:` for images, `data:` for fonts, and inline styles, which the highlighter and the component library write; it allows no inline script and no `eval`. The framing directive is this child's addition to rule 3 and is in the last section: the four rules as written do not stop another site from framing the page and steering a click onto Send.
- **T13 · Static files are served from a table, never from a path.** At the handler's load the bundle's directory is listed once into a map from URL path to file, regular files only; a request is a lookup in that map, so no path a requester writes is ever joined to a directory. `/` and anything under `/s/` answer the shell; a path that is neither in the table nor one of those is 404. Types come from a fixed list of extensions, and a file whose extension is not on it is not in the table. Everything static is `Cache-Control: no-cache` with an ETag, everything under `/api/` is `no-store`: on loopback a revalidation costs nothing, and after an update no browser holds a shell that names files that are gone.
- **T14 · The live connection is a WebSocket at `/live`**, served with the `ws` library the tree already bundles. A WebSocket and not an event stream, because rule 1 asks for the credential "as the first message of the live connection" and rule 2 for an Origin on it, and a browser sends an Origin on every WebSocket handshake but not on a same-origin `GET`. The upgrade is refused before the handshake unless the Host and the Origin pass. Then the server says nothing until the page's first message, which must be `{"t":"hello","v":1,"credential":"…"}` within five seconds. Its answer is a snapshot taken after the connection was subscribed, so no change falls between the two; after it, one small message per change, and the page reads a model over HTTP only for the session it shows (C3's S7). The page sends nothing else, and anything else closes the connection.
- **T15 · A live connection is a standing hold, and a request for data an operation's hold**, on the daemon (`DaemonServices.hold`). So the spine stays loaded while a page is listening and announces changes, a private daemon does not exit under an open page, and a tab forgotten in the background costs what an open app costs. To bound that, the page lets its connection go once its tab has been hidden for five minutes and connects again when it is shown. When the spine leaves `loaded` for any reason, every live connection is closed with "try again", so a page never sits on a connection that will say nothing.
- **T16 · A reference's or an upload's body is answered as bytes with one of five types**: `text/plain; charset=utf-8`, or `image/png`, `image/jpeg`, `image/gif`, `image/webp` (rule 4, to the letter). Which is decided by the record's own account of the body through C3's service, never by the bytes or a name: a captured HTML or SVG file is a text reference and goes out as plain text. Like every `/api/` path it needs the credential in a header, which a navigation, an `img` and a frame cannot send, so the body is only ever read by the page's own script and drawn as characters or as an image element.
- **T17 · A pasted image reaches the record through the page server before the door names it.** The page scales it as the app does (`downscaleImage`, `src/renderer/src/composer/editor/attachments.ts`, which imports only shared modules), posts the bytes with their type, and the page server holds them to 5 MiB and to the signature of the type they claim before it hands them to C3's `upload`, which writes `uploads/<name>` exclusively and answers the path. The draft carries that path; the Send's answer names it; the door checks the file. The signature check is at this boundary because the bytes come from a browser.

**The registration.**

- **T18 · `mawsd` itself writes the registration, from a timer of its own that needs nothing loaded.** The file is `<sminos home>/sheet/surfaces/<name>.json`, `name` being `mawsd` for the default daemon and `mawsd-<12 hex of the profile path's SHA-1>` for any other, so a scratch daemon sharing a home never writes the default one's file. `url` is the page's origin with no path and no trailing slash, since the tool appends `/s/<session>` (C2's M5); `reach` is `local`; `pid` is the daemon's; `heartbeatAt` is `toISOString()`. It is written by replace at the first tick after the listeners are up and every 10 seconds after. The home is `sminosHome` over `mawsd`'s environment and one capture of the login shell's, the rule C3's reader reads by; where the home does not exist nothing is written or made, and it is looked for again at each tick, so a machine without sminos gets no directory from MAWS. `sheet/` and `surfaces/` are made 0700 when absent, the file is 0600, and a `sheet` or `surfaces` that is a link is refused as C3's Confinement refuses one. **At a clean stop the file is removed if it still names this process.** After a death it stays: its `pid` is then no running process and its `heartbeatAt` ages past 30 seconds, either of which makes it not alive to C2's reader. The heartbeat does not follow the spine's state: where the spine cannot load, the page says so (§P).

**What the page keeps, and what it reads.**

- **T19 · The browser keeps three things, all in `localStorage` under `maws.sheet.`, and nothing else: no cookie, no service worker, no cache of its own.** The credential, until unpaired or refused. Each session's memory (C3's `SheetMemory`: drafts, the revision of each question the person last saw, the acts sent, a Send in flight), so that a reload, and a second tab opened from the terminal's link, show the draft and the "Updated" mark the first tab had; it is written through on every change, adopted by other tabs through the `storage` event, dropped per question by C3's `reconcile`, per session when its record is gone, and whole after 30 days untouched. And nothing of a model. A Send found in flight at a load is offered again as the same inbox lines: the key makes a resend the same act (composite §4.2), which is also why two tabs sharing one memory are safe. Unpairing clears every key.
- **T20 · The page reads its path and nothing else of its address.** No query parameter and no fragment does anything, so a link another site makes to the page can open a sheet and can do nothing more.
- **T21 · The page uses nothing a browser gives only to a secure context**: no `crypto.randomUUID`, no `crypto.subtle`, no asynchronous clipboard. Keys come from `crypto.getRandomValues`. Whatever a browser thinks of a name under `localhost`, the page works where it loads.
- **T22 · A link the sheet's policy refuses is drawn as text, on every surface, from this child on.** Rule 3 limits agent-written links to `http`, `https` and the question's own references. C3's `SheetMarkdown` makes a refused link inert by giving it no action, which is enough in the app. In a browser a `mailto:` link is still an anchor with its `href`, and the browser's own gestures follow it. The seam is one optional function on the transcript's context that says whether a link's `href` may stand; `TranscriptLink` draws its children in a `span` when it says no; the transcript leaves it unset and changes nothing; `SheetMarkdown` sets it to the sheet's policy. This is the change the composite's §8.2 says C4 carries if it needs it; it does.

**How the page is built, shipped and tested.**

- **T23 · The page is a workspace app, `apps/sheet-page`, built with Vite the way `apps/desk-web` is, into `out/sheet-page/`**, which the Mac app's archive already includes and which the Linux pack is taught to copy; `mawsd` finds it one directory above its own entry. Not under `out/main`: the bundle guard reads every `.js` file there as a main-process file and fails on the first character above U+00FF, which a Markdown stack is full of. Not a third page of the app's renderer build: that build shares its chunks with the app, so the page server would serve the app's own code, and the Linux pack ships no renderer. The page's build is a step after `electron-vite build` wherever a shippable tree is made (`pnpm build`, `pnpm build:app`, `pnpm mawsd:pack`) and is not part of `scripts/e2e-build.sh`, whose Electron suites never open the page.
- **T24 · The page's browser suite lives in `apps/sheet-page/e2e/` and is a gate group of its own, `sheet-page`**, added to the workflow's three lists beside `desk-web` and to the step that installs Playwright's browsers. It starts the built `mawsd` as a process, which needs Node and no Electron, so it runs on the Linux pool. A new group and not cases in an existing one, because no existing group drives a browser against `mawsd`. The requests the four rules refuse are sent twice: by Node clients that write any header they like (class 1a, M1 and M3), and by a real browser from a real second origin, which cannot (this group, M2 and M4). The first shows the server refuses; the second shows what a web page can actually send.
- **T25 · Two landings.** C4a is M1 to M4, each provable on GitHub Actions and none served without the switch, so it can merge as soon as it is reviewed, before C2's terminal side exists. C4b is M5.
- **T26 · No measured idle scene is added for the heartbeat.** The idle bound's scenes (`e2e:daemon-idle*`) run private daemons, where the page is off, so one write of under 200 bytes every 10 seconds in the default daemon is in no measured scene. X4 fixes the interval, so a measurement could not change it, and what M1 and M3 pin instead is what could regress unseen: after a start with the page on and no connection, the handler's chunk is not loaded and no login shell is captured twice. A measured scene would catch a heartbeat that grew expensive; this does not.
- **T27 · The gate drives Chromium; Safari and Firefox are checked by hand at M5**, on the Mac, each through pairing, a sheet, a Send and a reload. Nothing in the page is specific to one engine (T21), and the gate's runners have no Safari.

## The page server, as an attacker meets it

The composite names whom the page defends against (§8.2: web content and other hosts) and whom it does not (a process running as the same user). This table takes each of them in turn, says what each can send, and names the rule that refuses it and the test that sends it. "Rule 1" to "rule 4" are §8.2's four, in its order: the credential in origin-scoped storage and a header; the Host on everything, the Origin on writes and the live connection; the three headers and the content policy with the Markdown's limits; a body as plain text or a raster image. Rows marked in bold are not stopped by the four rules as written. Two of them are stopped by something this child builds and proposes as a sentence of the composite (the framing directive; the bind on both loopback addresses). Three are not stopped at all and are stated as limits. All five are in the last section (entries 2, 4 and 7).

| who | what it tries | what stops it | proven in |
|---|---|---|---|
| A page of any site, open in the same browser | to read a sheet: `fetch`, an `img`, a `script` | Rule 1: it holds no credential, and storage is scoped to the page's origin. Behind it, no response carries a CORS header, so nothing is readable even of a refusal. | M3 (Node), M4 (a browser) |
| | to write or to pair: a form post, a `no-cors` `fetch` | Rule 2: its Origin is not the page's. The exchange of a code is a write. | M1 (pair), M3 (put, upload), M2 and M4 (a browser) |
| | to open the live connection | Rule 2 at the upgrade; rule 1 at the first message | M3, M4 |
| | to frame the page and steer a click onto Send | **Not the four rules as written.** T12's `frame-ancestors 'none'`, added to rule 3's content policy | M1 (the header), M2 (a browser refuses the frame) |
| | to send the person's tab to `/s/<id>`, or to `/#anything` | Nothing needs stopping: a `GET` changes nothing and the page reads only its path (T20) | M2 |
| | to learn that something answers on the port | **Not stopped**, and accepted: it learns that MAWS runs here and nothing else | none |
| A development server an agent started on another port of the name, or of `localhost` | everything a page can, and it shares the page's cookies | Rule 1: there is no cookie, and `localStorage` is scoped by port. Rule 2: its Origin differs by its port | M2, M4 (the second origin is exactly this) |
| Anything that binds the page's own port while `mawsd` is not listening | to serve its own page under the page's origin: read the credential and the drafts the browser stored, leave a service worker behind | **Not stopped by the four rules.** A process of the same user is outside the defence by §8.2's own sentence, and gains nothing it could not do directly. A process of another user of the machine is a gap. Narrowed, not closed, by T3 (both addresses, or none) and by the default daemon holding the port from login to logout | M1 (the narrowing only) |
| A DNS name rebound to `127.0.0.1` | to make the browser send it the page's responses under the attacker's name | Rule 2: the Host is the attacker's name, on every request, the shell included | M1 (Node), M2 (a browser whose resolver maps a foreign name to loopback) |
| Another machine on the network | to connect | **The loopback bind, which is §8.2's opening sentence and none of the four rules** (T3). Behind it: a forwarded port arrives with the forwarder's Host and meets rule 2, and a tunnel that rewrites the Host still has no credential, and cannot pair, because a browser on it sends the tunnel's Origin | M1 (the bound addresses; a connection to a non-loopback address is refused) |
| A process of another user on this machine | to connect over loopback | Rule 1, and the code: only a holder of `mawsd.token` (0600) can ask for one, and guessing is bounded (T8) | M1 |
| Text an agent wrote: a question, a context, a preview, a label | script, a link of a dangerous scheme, an image that calls home | Rule 3: the Markdown draws no raw HTML and no remote image, a refused link is text (T22), and the content policy stands behind all of it | M4 |
| Bytes an agent chose: a referenced file, an upload | to be read as a document at the page's origin | Rule 4 (T16), with `nosniff`; an upload is held to its type's signature (T17) | M3, M4 |
| A browser extension the person gave access to the page | to read and send as the page | **Not stopped**, by this or any page | none |
| A process running as the same user | anything | Not defended (§8.2): it can append to an inbox with `sminos sheet put` today | none |

Nothing in M1 to M4 adds a fifth rule. T3 is how "on loopback only" is built once the name is known to resolve to two addresses, and T12's framing directive is one directive in the policy rule 3 already requires; both are proposed as sentences of the composite in the last section, and the two that stay open are stated there as limits.

## The look

The cards, the session's sheet and the overview are C3's components, whose look the owner settled on a drawn example (C3's "The look"); this child changes nothing of them and draws them as they stand. **What is the page's own has not been seen by the owner**: the pairing screen, the frame around a sheet and around the overview, what stands where there is nothing, and what the page says when `mawsd` is not reachable. This section proposes each concretely. It is a proposal until the owner answers; the answers are recorded here verbatim, in C3's form, and M2 and M4 draw nothing before they are.

**How it is settled.** As C3's was: a drawn example of four frames at real size, in the app's light-theme tokens and today's shapes, with invented names, paths and text, kept outside the repository by the session that holds the composite, and put to the owner with the questions below.

1. The pairing screen: at rest; after a wrong code; after an expired one; and as a browser that was unpaired meets it.
2. The overview in its frame: three running sessions and two stopped ones apart; and the overview with nothing on it.
3. A sheet in its frame at 1280 px and at 480 px of window: four cards as C3's frame 1 has them, the foot with Send; and a session with nothing on its sheet.
4. A sheet while `mawsd` is not reachable; and while `mawsd` answers but its services do not.

**The proposal.** Tokens and classes are the app's (`src/renderer/src/styles/tokens.css`).

- **The frame.** The page's ground is `--bg`. A bar of `--toolbar-h` at the top, one `--border` line under it: at its left the page's name, "Sheet", at medium weight, and after it, muted, where the person is ("This Mac" on the overview; on a sheet a link back, "All sessions", then the session's title, and "stopped" in `--fg-faint` when no process holds it). At its right, only when it has something to say, the connection's state as a small dot and two words, and a quiet menu whose one entry is "Unpair this browser". Under the bar one column, centred, `--measure` wide (768 px) with `--measure-pad` inside it, which is the transcript's own column; at that width a card is past the 560 px at which C3 puts an option's preview beside the options. Below 768 px of window the column is the window.
- **The pairing screen.** No bar. One box in the middle of the ground, `--bg-raised` with a `--border` line and `--radius-lg`, at most 420 px wide: a heading, "Pair this browser"; one sentence, "This page shows the open questions of the sessions on this Mac. A browser has to be paired once before it can read and answer them."; "Run this in a terminal on this Mac:" over the command in the mono face in a bordered box, selectable, `mawsd sheet pair`; "Then type the code it prints:" over one field in the mono face at a large size, which takes eight characters, writes them upper case and shows the dash itself; and one button in the accent, "Pair", active once eight characters stand. A refusal is one line under the field in `--danger`: "That code is not right. 3 tries left.", "That code has expired. Run the command again.", "Too many tries. Run the command again for a new code." A browser that was unpaired sees one muted line above the heading: "This browser was unpaired." Under the box, small and faint: "The link in your terminal carries no secret. Pairing lasts until this browser is unpaired."
- **The overview.** In the column: `SheetOverview` as it stands (the sessions with something on their sheet, their counts and oldest question's age, the stopped ones apart). The page's own part is what stands when there is none: in the column's middle, muted, "No open questions on this Mac", and under it, faint, "A session's questions appear here when it asks."
- **A sheet.** In the column: `SessionSheet` at full density, as it stands. The page's own part is its foot: the one with Send stays at the bottom of the window, on the ground's colour behind one border, so that Send is in reach under any number of cards. A session with no record, or a path that names none: "No open questions for this session", and the link "All sessions".
- **The tab.** The browser tab's title is the count and the place: "(3) Sheet" on the overview with three open questions on the machine, "(2) auth rework · Sheet" on a session's sheet, and no count when there is none. No sound, no notification, and nothing moves to the front: the terminal's line announces a question, and the count is for a tab the person already keeps.
- **Not reachable.** Three cases, and the page can draw two of them. *The page is open and its connection is lost* (a restart, a stop): one band under the bar in the calm tone, a small dot in `--fg-faint` and "Not connected to MAWS on this Mac. Trying again." The cards stay as they were, readable, and every draft stays; Send is replaced by its reason, as C3's sheet draws an unavailable Send: "Answers cannot be sent while MAWS is not reachable." The band goes when the connection returns, with no notice of its own. *`mawsd` answers and its services do not* (the spine refused or yielded): the same band, "MAWS is running, but its session services are not available right now." *`mawsd` is not listening when the link is opened*: the browser's own error page. No part of MAWS is there to draw anything, and a service worker that could is ruled out (T19). The terminal's line covers that case in C2's words: "the page is unreachable: sminos sheet show …".

**Open with the owner.** Each is a matter of taste or of product; none is decided here. The recommendation is what the proposal above draws.

1. *How does a browser get paired?* Recommended: the person types the code the command prints. The other way: the command prints a one-time link that pairs the browser that opens it. A link is one click, but it carries the code, pairs whichever browser the system opens links in and not the one the person is looking at, and drops the session the terminal's link named.
2. *What is the page called?* Recommended: "Sheet", the name of the app's tab. The other: "Questions".
3. *How wide is a sheet on the page?* Recommended: one column of 768 px, the transcript's own. The other: two panes on a wide window, the questions' lines at the left and the chosen card at the right, which shows more of a long sheet and costs a second layout of C3's components.
4. *Where is Send?* Recommended: in a foot that stays at the bottom of the window. The other: at the end of the cards, as a document has it.
5. *Does the page follow the system's dark mode?* Recommended: no, light only, as the app's default and desk-web are; the page has no settings of its own. The other: the app's dark tokens when the system asks for them.
6. *Does the tab's title carry the count of open questions?* Recommended: yes. The other: a fixed title.
7. *What tone does "not connected" take?* Recommended: calm, the faint dot, since nothing is lost and the page recovers by itself. The other: the warning tone, since Send is unavailable.
8. *Does the pairing screen name the command alone?* Recommended: yes, `mawsd sheet pair`. Where the person's shell does not find `mawsd`, the other way is to show the wrapper's full path, which puts a path under the home on a screen any visitor to the port can load.

**The built look.** M5 photographs the built page (the rig's own screenshots, to a directory outside the repository) and hands the pictures to the composite's writer for the owner, the pairing screen and the not-connected sheet first.

## Interfaces and Dependencies

Paths are from the repository's root. `R/` is `src/renderer/src/`. A name given here is the name that must exist at the end of the milestone that makes it; where an executor finds a better shape, it reports it and the controller rewrites this section.

### §J · The page server in `mawsd` (M1)

    src/mawsd/sheet-page/
      serve.ts          on the daemon's run path: the decision, the listeners, the state, the heartbeat's timer; loads the chunk
      registration.ts   on the run path: the file of §O (M3)
      handler.ts        the chunk: the HTTP server, the routes, the WebSocket (M1; its sheet routes M3)
      checks.ts         the three checks and the headers, pure (§L, §M)
      pairing.ts        the code and the browsers' file (§K)
      static.ts         the bundle's table (§M)
      sheets.ts         C3's service through the spine (§N, M3)

`serve.ts` and `registration.ts` import Node builtins, `@shared/host/shell-env` and `sminosHome`, and nothing else; everything else is behind one deferred import, as `loadEndpointChunk` is in `src/mawsd/artifacts-endpoint.ts`. The bundle guard gains a case that the handler and `ws` stay off the run path. Should the guard's case for the services library object to `sminosHome` being imported from `src/services/lane-a/discovery.ts`, the function moves to `src/shared/` with a re-export left behind, and the executor reports it.

    export const SHEET_HOST = 'sheet.localhost'
    export const SHEET_PORT = 47590
    export const SHEET_PAGE_DEFAULT_ON = false                 // true from M5
    export type SheetPageState = 'off' | 'no-bundle' | 'port-taken' | 'listening' | 'stopped'
    export interface SheetPageOptions {
      kind: 'unit' | 'private'; profileDir: string; dir: string;            // dir: <profile>/mawsd
      defaultProfile: boolean;                                              // profileDir is defaultProfileDir(...), both made real
      env: NodeJS.ProcessEnv; shell(): Promise<Record<string, string>>;     // one capture, made at the first need and kept
      bundleDir: string;                                                    // join(dirname(<the entry's real path>), '..', 'sheet-page'): the real path, as daemon.ts's entryOnDisk, so a release flipped under a running daemon is never half-served
      sheets: SheetAccess;                                                  // §N; a stand-in that refuses until M3
      onEvent: DaemonServices['onEvent']; hold: DaemonServices['hold'];
      log(line: string): void;
      load?(): Promise<SheetPageChunk>; now?(): number;                     // test seams
      listen?(host: string, port: number): Promise<net.Server>;             // test seam: a bind that fails as told
      timing?: Partial<SheetPageTiming>;
    }
    export interface SheetPage {
      start(): void;                                   // returns at once; T6
      status(): DaemonSheetPage;                       // daemon.status.sheetPage
      pair(): Promise<SheetPairAnswer>;                // §K
      browsers(): Promise<PairedBrowser[]>;
      unpair(id: string | null): Promise<number>;
      spineState(state: SpineState): void;             // T15: anything but 'loaded' closes the live connections
      stop(): Promise<void>;                           // listeners closed, connections ended, the registration removed if ours; at most 500 ms
    }
    export function createSheetPage(options: SheetPageOptions): SheetPage

    export interface SheetPageTiming { heartbeatMs: number; portRetryMs: number; codeTtlMs: number; helloMs: number; pingMs: number; silentMs: number; lastSeenGrainMs: number; credentialIdleMs: number }
    // 10_000 (X4), 30_000, 300_000, 5_000, 20_000, 45_000, 3_600_000, 90 days

**The start.** `start()` decides in this order and stops at the first that holds: not this daemon's to serve (T2: read from its own environment and the constant, and, only when those say yes, from the login shell's), `off`; no `index.html` in `bundleDir`, `no-bundle`; a bind refused as in use, `port-taken`, tried again every `portRetryMs`; else `listening`. A bind is `127.0.0.1` first, then `::1` on the port the first got (with port 0 the pair is tried again, a few times, if the second is taken), each `exclusive`, the second `ipv6Only`; T3 says when one address is enough. Each change of state is one log line. A connection accepted while the chunk loads is paused, and a load that fails answers that connection 503 in one line and loads again at the next, as the artifact endpoint does.

**In `startDaemon`.** The page is created with the daemon's other parts and started after `clocks.served()`. `daemon.ts`'s spine `onState` tells it each state. Its `stop()` runs in the exit order right after the listeners close, before the endpoint's, so no session is offered a page that is going. `daemon.status` gains `sheetPage`, added as `render` and `artifacts` were:

    DaemonSheetPageSchema = { state: string, detail: string | null, url: localOnly(string | null), browsers: number, connections: number, registered: boolean }

`detail` is one sentence and holds no path. `mawsd status` prints one line from it: `sheet page: http://sheet.localhost:47590 (2 browsers paired, 1 open)`, or `sheet page: not served (the port is in use)`.

**Limits of the HTTP server**, since it is a listener anyone on the machine can reach: `headersTimeout` 10 s, `requestTimeout` 30 s, 64 headers, 128 connections; a body of at most 1 KiB for a code, 8 MiB for a Send, 5 MiB for an image, each refused with 413 as soon as it is known to pass; `GET` and `POST` only; no `OPTIONS` is ever answered with anything but 405, so no cross-origin request that needs a preflight is ever allowed; no compression. The live connections: at most 32, and at most 8 that have not yet said hello; frames of at most 4 KiB; a ping every `pingMs`, and a connection silent for `silentMs` is ended.

### §K · Pairing (M1)

    // src/mawsd/sheet-page/pairing.ts
    export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'          // 32, no I, L, O, U
    export const CODE_TRIES = 5; export const EXCHANGES_PER_MINUTE = 10; export const BROWSERS_MAX = 16
    export interface PairedBrowser { id: string /* 8 hex */; label: string; pairedAt: string; lastSeenAt: string }
    export type SheetPairAnswer = { ok: true; code: string /* XXXX-XXXX */; expiresAt: string; url: string } | { ok: false; why: string }
    export interface Pairing {
      mint(): { code: string; expiresAt: string };                           // voids the code before it
      exchange(typed: string, userAgent: string): { ok: true; id: string; credential: string } | { ok: false; why: 'wrong' | 'expired' | 'none' | 'busy'; left?: number };
      check(credential: string): PairedBrowser | null;                        // constant time over the kept hashes; touches lastSeenAt by the grain
      list(): PairedBrowser[]; revoke(id: string | null): string[];           // the ids revoked
      onRevoked(listener: (id: string) => void): () => void;                  // the live connections' end
    }
    export function createPairing(deps: { file: string; now(): number; random(bytes: number): Buffer; log(line: string): void; timing: SheetPageTiming }): Pairing

    <profile>/mawsd/sheet-page.json     { "v": 1, "browsers": [ { "id", "label", "hash": "<sha256 hex of the credential>", "pairedAt", "lastSeenAt" } ] }

A typed code is read without its dash and without regard to case. `exchange` answers `none` when no code is live, `busy` past the minute's ten. The label is a browser's family and system read from the user agent ("Chrome on macOS"), from a fixed set of words, so nothing a requester wrote reaches a terminal. A file that does not parse, or whose `v` is not 1, is read as no browsers and replaced at the next write: the cost is a pairing, and a file half-read is worse. Nothing here logs a code, a credential or a hash.

The wire, in `src/shared/ipc/schema/daemon.ts` with its names and grades (each main-only, `owner: 'machine'`, graded `internal`), served in `daemon.ts`'s switch and listed in `FRONT_COMMANDS`:

    daemon.sheetPair       void                     → SheetPairAnswer
    daemon.sheetBrowsers   void                     → { served: boolean; browsers: PairedBrowser[] }
    daemon.sheetUnpair     { id: string | null }    → { removed: number }

The command line (`src/mawsd/cli.ts`, with its usage text):

    mawsd sheet pair                 the code alone on the first line of standard output, then one sentence; exit 2 with the reason where this mawsd serves no page, 3 where none runs
    mawsd sheet browsers [--json]    one line a browser: its id, its label, when paired, when last seen
    mawsd sheet unpair <id>|--all    "unpaired 1 browser"

    $ mawsd sheet pair
    K7QF-2M9D
    Type this code into the page at http://sheet.localhost:47590/ within 5 minutes. It works once.

### §L · The three checks, request by request (M1; the sheet's routes M3)

`checks.ts` is pure: a request's method, target and headers in, a refusal or a route out. The order is fixed, and each check runs only if the one before passed: **Host, then the route and its method, then Origin, then the credential, then the body.**

    export function pageOrigin(port: number): string                                       // http://sheet.localhost:<port>
    export type Refusal = { status: 400 | 401 | 403 | 404 | 405 | 413 | 421 | 429 | 503; body: string }   // body: one of a fixed list of sentences
    export function hostPasses(header: string | undefined, port: number): boolean          // equal to sheet.localhost:<port>, case folded; nothing else
    export function originOf(headers: IncomingHttpHeaders, port: number): 'absent' | 'page' | 'other'   // 'null' and a repeated header are 'other'
    export function bearerOf(headers: IncomingHttpHeaders): string | null                  // the one Authorization header, scheme Bearer; never a cookie, never the target
    export function routeOf(method: string, target: string): Route | Refusal               // a target that is not origin-form (it does not start with '/') is refused

| request | Host | Origin | credential | answers |
|---|---|---|---|---|
| `GET /`, `GET /s/<anything>` | required | not read | none | the shell: the same bytes whatever follows `/s/` |
| `GET <a path of the bundle's table>` | required | not read | none | the file |
| `POST /api/pair` `{ "code" }` | required | **the page's** | none: this is how one is had | 200 `{ id, credential }`; 403 `{ why, left }`; 429 |
| `GET /api/whoami` | required | the page's, or absent | required | 200 `{ id, pairedAt }` |
| `POST /api/unpair` | required | **the page's** | required | 204 |
| `GET /api/sheets/<session>` | required | the page's, or absent | required | 200 `{ model, door }` (§N) |
| `GET /api/sheets/<session>/body?…` | required | the page's, or absent | required | 200 with one of five types; 404 (§N) |
| `POST /api/sheets/<session>/put` | required | **the page's** | required | 200 `SheetPutResult` |
| `POST /api/sheets/<session>/uploads` | required | **the page's** | required | 200 `{ ok, path }` or `{ ok: false, why }` |
| `GET /live`, upgrading | required | **the page's** | the first message | 101, then §N |
| anything else | required | | | 404; a known path with another method, 405 |

A refused Host is 421, a refused Origin 403, a missing, malformed, unknown or revoked credential 401, each with its constant sentence as `text/plain` and every header of §M.

**Rule 2, read for a browser.** The composite's rule asks for the Origin "exactly the page's" on every write and on the live connection, and a browser sends one on every `POST` and every WebSocket handshake, so those require it. A browser sends none on a same-origin `GET`, so a read cannot require one; it requires the credential, and refuses an Origin that is present and is not the page's. A navigation carries none, and the shell and the pairing screen stand on the Host check alone, as the rule says.

**Rule 1, read for the page.** "Everything that reads or changes a sheet requires the credential": every path under `/api/` but the exchange, and the live connection before it is sent a byte.

### §M · The headers, and the bundle's table (M1)

    export const STANDING_HEADERS: (port: number) => Record<string, string>
      Referrer-Policy: no-referrer
      X-Content-Type-Options: nosniff
      Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
                               font-src 'self' data:; connect-src 'self' ws://sheet.localhost:<port>; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
      X-Frame-Options: DENY
      Cross-Origin-Opener-Policy: same-origin
      Cross-Origin-Resource-Policy: same-origin

The first three are rule 3's ("`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a content policy that loads nothing from outside the page"); T12 is why the rest. The WebSocket's own origin is named beside `'self'` because not every engine reads `'self'` as covering `ws:`. Inline styles are allowed and inline script is not: the app's own policy draws the same line (`src/main/csp.ts`), and no text an agent wrote can become a style, since the Markdown draws no raw HTML.

    // static.ts
    export interface BundleTable { shell: BundleFile; get(path: string): BundleFile | null }
    export interface BundleFile { type: string; etag: string; read(): Promise<Buffer> }
    export function readBundle(dir: string): Promise<BundleTable>             // every regular file under dir whose extension is in TYPES; a link is not followed
    const TYPES = { '.html', '.js', '.css', '.woff2', '.woff', '.ttf', '.png', '.ico', '.svg', '.json' }

An SVG in this table is a file of the build, served as what it is; rule 4's "never as HTML or SVG" is about bodies an agent chose, which never pass through this table (§N).

### §N · Sheets through the page server (M3)

**C3's service, in process.** `SpineRoot` (`src/services/spine-root.ts`) gains `sheet?: SheetService`, set where `startSpine` makes the service and absent in a run refused the spine. If C3's landing already exposes it, that name is used and nothing is added.

    // src/mawsd/sheet-page/sheets.ts
    export class SheetsUnavailable extends Error { why: 'refused' | 'yielded' | 'exiting' | 'no-service' }
    export interface SheetAccess { service(): Promise<SheetService> }          // spine.ensure('command'), then its root's sheet; rejects with SheetsUnavailable
    export function sheetsOf(spine: Pick<LazySpine, 'ensure'>): SheetAccess

A request for data that meets `SheetsUnavailable` is answered 503 with `{ "why" }`; the shell, a static file and the pairing never call it, so an unpaired link loads and a browser pairs whatever the spine's state. The page server passes a session's name on as the path gave it, decoded once: C3's service is the boundary that holds it to the engine's id form and confines every path (the composite's inheritance for this child), and what the service refuses is answered 404.

**The routes.**

- `GET /api/sheets/<session>` is `service.read(session)` and `service.door()`: `{ "model": SheetModel | null, "door": DoorState }`, as C3's `sheet.read` answers a window.
- `POST …/put` takes `{ "lines": SheetLine[] }`, holds each line to the model's schema (`src/shared/sheet/model.ts`), **sets `by: 'page'` on every line whatever the browser wrote**, and answers `service.put(session, lines)` as it stands. The fifty-line bound and `lineError` are the service's own, at its own boundary (C3's §C).
- `GET …/body?ref=<sha256>`, `?upload=<name>` or `?text=<sha256>` is `service.body(session, of)`: a `text` body goes out as `text/plain; charset=utf-8`, an `image` as its media type, which is one of the four, and `gone` as 404. This is rule 4: "it is sent as plain text or as a raster image type, never as HTML or SVG."
- `POST …/uploads` takes the image's bytes as the body with one of the four types as its `Content-Type`, checks the type's signature (PNG's eight bytes, JPEG's `FF D8 FF`, `GIF87a` or `GIF89a`, `RIFF….WEBP`), and answers `service.upload(session, { mediaType, data })`.

**The live connection.** One JSON object a frame, text frames only.

    page → server, once, first:   { "t": "hello", "v": 1, "credential": "…" }
    server → page, once:          { "t": "ready", "v": 1, "sessions": SheetSummary[], "door": DoorState }
    server → page, per change:    { "t": "changed", "session": "<id>", "summary": SheetSummary | null }
    close codes:  4401 the credential was refused or no hello came; 4403 this browser was unpaired; 1008 the page sent something else;
                  1013 the services are not available, try again; 1001 mawsd is stopping

On a good hello the server subscribes the connection to `sheet.changed` (through `onEvent`, owner `machine`), takes its hold (T15), and only then calls `service.list()` for `ready`, so a change during the list is delivered after it and none is lost. `SheetsUnavailable` at that point is 1013.

### §O · The registration (M3)

    // src/mawsd/sheet-page/registration.ts
    export interface Registration { v: 1; name: string; pid: number; url: string; reach: 'local'; heartbeatAt: string }
    export function registrationName(defaultProfile: boolean, profileDir: string): string    // 'mawsd', or 'mawsd-<12 hex>'
    export function writeRegistration(home: string, registration: Registration): 'written' | 'no-home' | 'refused'   // by replace; T18's modes and links
    export function removeRegistration(home: string, name: string, pid: number): void        // only a file that still names this pid

A zod schema for it is written field for field from the pin's `schema/surface.schema.json`, its patterns matched against the whole string, and a test holds the pin's `examples/surface.json` and every file this module writes to that one schema; no JSON Schema validator joins the dependencies (C3's S4). The heartbeat runs only in state `listening`. `daemon.status.sheetPage.registered` says whether the last tick wrote.

### §P · The page (M2, M4)

    apps/sheet-page/
      package.json  vite.config.ts  tsconfig.json  tsconfig.node.json  vitest.config.ts  playwright.config.ts  index.html
      src/main.tsx  src/App.tsx          the route, the frame, pairing or not
      src/route.ts                       placeOf(pathname) → { at: 'overview' } | { at: 'sheet'; session: string }     (T20: the path alone)
      src/api.ts                         pair, whoami, unpair, read, put, body, upload; adds the header; a 401 forgets the credential
      src/live.ts                        the live connection's client (M4)
      src/store.ts                       the summaries, the shown session's model, the door's state, the connection's state (M4)
      src/memory.ts                      the persisted memory (M4)
      src/host.ts                        the page's SheetHost (M4)
      src/pairing/  src/frame/  src/views/   the page's own components
      src/copy.ts  src/styles/app.css
      e2e/                               §Q

**The build** is desk-web's (`apps/desk-web/vite.config.ts`): the React plugin under the React Compiler, Tailwind's plugin, the aliases `@shared`, `@artifacts`, `shiki/wasm` and the two for `lowlight`; no service worker, no proxy. `build.outDir` is `<root>/out/sheet-page` with `emptyOutDir`, no source maps. The sheet's view is a lazy route, so the first load, which may be the pairing screen, carries none of the Markdown stack. The built `index.html` names its script and its stylesheet as files; a test reads it and fails on an inline script. The page's stylesheet imports the app's tokens and theme map (`R/styles/app.css`), the Markdown's two stylesheets, and names in `@source` lines its own directory and the renderer directories it draws from (`R/sheet`, `R/ui`, `R/request-card`, `R/transcript/view/markdown`), as C3's §G asks of a consumer.

**Where the build is run and what it joins.** The root `package.json`: `build` and `build:app` run `pnpm --filter sheet-page build` after `electron-vite build`; `typecheck` names the app's; a script `e2e:sheet-page` is `pnpm --filter sheet-page e2e`. `vitest.config.ts` lists the app's config among its projects. `scripts/mawsd-pack.mjs` builds the page after `build:main-preload` (not under `--no-build`), copies `out/sheet-page/**` into the pack, counts it in the release's content hash, and refuses a pack whose `out/sheet-page/index.html` is missing; its test and `src/mawsd/pack-chunks.test.ts` follow.

**What it imports.** From C3, the composite's X5 and nothing else of the sheet: `src/shared/sheet/` and `R/sheet/` through `R/sheet/index.ts`. Of the rest of the renderer, as they stand: the app's stylesheets, `R/ui/*`, and `downscaleImage` (T17). It imports no store of the app, nothing under `R/ipc`, and nothing that reads `window.maws`.

    // src/host.ts
    export function pageSheetHost(api: Api): SheetHost
      by         'page'
      newKey     'page-' and 26 characters of base32 from 16 bytes of crypto.getRandomValues
      send       api.put, once; a network failure, a 5xx or 30 s without an answer is { ok: false, why: 'failed' }, so C3's sheet offers the same inbox lines again
      openLink   window.open(url, '_blank', 'noopener,noreferrer')
      body       api.body, mapped to SheetBody: a text, an image as base64 with its type, or gone
      saveImage  downscaleImage, then api.upload
      openFile   absent: a browser opens no file of the machine

    // src/memory.ts (T19)
    export const CREDENTIAL_KEY = 'maws.sheet.credential'            // { v: 1, id, credential }
    export const MEMORY_PREFIX = 'maws.sheet.memory.'                // + the session: { v: 1, touchedAt, drafts, seen, marked, acts, sending }, the maps as pairs
    export function loadMemory(session: string): SheetMemory         // EMPTY_MEMORY when absent, unreadable or of another v; a Send stored as 'sending' is read as 'failed'
    export function saveMemory(session: string, memory: SheetMemory): void    // through, on every change; a full store drops the sessions touched longest ago first
    export function onMemory(session: string, listener: (memory: SheetMemory) => void): () => void    // another tab's write
    export function sweepMemory(now: number): void                   // at load: whatever was not touched for 30 days
    export function forgetEverything(): void                         // unpairing: every key under maws.sheet.

    // src/live.ts
    export type Connection = 'connecting' | 'connected' | 'lost' | 'unavailable' | 'unpaired'
    export function connect(deps: { url: string; credential(): string | null; onReady(sessions, door): void; onChanged(session, summary): void; onState(state: Connection): void }): () => void

`connect` says hello, and after a close tries again after 1, 2, 5 and then every 10 seconds; 4401 and 4403 forget the credential and end at the pairing screen, 4403 with its line; 1013 reads `unavailable`; a tab hidden for five minutes closes its connection and one shown again opens it. On `changed` for the session on screen the page reads that session's model; each read of a session carries a count that only grows, and an answer is applied only when no later read of that session has been, as C3's store rules (its §F), since two reads can finish in the other order. A model that arrives is met with `reconcile` and the memory saved. The door's state reaches `SessionSheet` as `unavailable` when it is known and not available, and the connection's state does when it is not `connected`.

**The link's seam (T22, M4).** `TranscriptActions` (`R/transcript/view/context.tsx`) gains one optional member:

    linkStands?: (href: string) => boolean      // absent: every link the Markdown's gates passed stands, as today

`TranscriptLink` (`R/transcript/view/markdown/Link.tsx`) asks it first, for an artifact mention, a path link and an anchor alike, and where it answers false draws the link's children in a `span`, the form it already has for a link whose `href` the gates removed. `SheetMarkdown` supplies it: true for an `http` or `https` link, true for a path link that names one of the question's own references, false for everything else. The transcript supplies none, and `links.test.tsx` passes unedited.

**Strings.** The composite fixes the command `mawsd sheet pair` and the two addresses, `/` and `/s/<session>`. Every other string of the page's own is the look's, proposed there and kept in `apps/sheet-page/src/copy.ts` once the owner has answered; the command line's are in §K.

### §Q · The rig, and the gate's group (M2)

    apps/sheet-page/e2e/rig.ts
      startMawsd(options?: { records?: string[]; env?: Record<string, string> }): Promise<Mawsd>
      interface Mawsd { url: string; home: string; profile: string; cli(...args: string[]): Promise<{ code: number; out: string }>;
                        pair(page: Page): Promise<void>; stop(): Promise<void>; kill(): void }
      secondOrigin(): Promise<{ sameName: string; otherName: string; close(): Promise<void> }>

`startMawsd` runs the built daemon as the app would start a private one, under plain Node: `node out/main/mawsd.js run --private --dir <scratch>/mawsd` with `MAWS_USER_DATA`, `HOME` and `SMINOS_HOME` in scratch directories, `MAWS_SHEET_PAGE=1`, `MAWS_SHEET_PORT=0`, `MAWS_E2E=1` (under which `sminosHome` refuses the real home) and `MAWS_ENGINE_REPLAY=1` (no engine runs); from M4, `MAWS_SMINOS_CLI` names C3's stand-in door. It reads the page's address from `mawsd status --json`, which is the daemon's own word. `records` are fixtures of the pin, seeded as C3's §E says a record is seeded. `pair` runs `mawsd sheet pair`, reads the first line and types it. `secondOrigin` is a static server on another port, reached under the page's own host name (`sameName`, the development server of the composite's example) and under `localhost` (`otherName`), serving one page whose script tries each thing a stranger can and writes what happened into its document.

The suite's Playwright config is desk-web's shape: one worker, Chromium, Playwright's own on Linux. The app's `e2e` script builds first: `pnpm -w run build:main-preload && vite build && playwright test`.

The workflow (`.github/workflows/gate.yml`): `sheet-page` joins `CLASS1_E2E`, `LINUX_E2E` and `POOL_E2E`, and the step that installs Playwright's browsers for `desk-web` runs for it too. `.github/scripts/gate-plan.mjs` reads a group from those lists and its package script, so no code there names the group; its tests, and any other that pins the lists, follow.

## The acceptance, by clause

The composite's acceptance for this child, cut into the clauses a milestone can prove. "The rig" is a browser against a real `mawsd` and the stand-in door; "live" is M5's real terminal session, real `sminos` and a person's browser.

| clause | what it says (the composite's C4 section) | proven in |
|---|---|---|
| A.a | in a real browser, the link from the terminal, opened unpaired, shows the pairing screen | M2 (the rig, a link of the same form), M5 (the terminal's own link) |
| A.b | after pairing, `/` shows the overview of this machine's sessions, stopped ones apart | M4 (the rig), M5 (live) |
| A.c | `/s/<session>` updates live | M4, M5 |
| A.d | Acceptance 1 to 6 hold end to end with the page as the surface | M4 (the page's half of each, on the stand-in door), M5 (end to end) |
| A.e | Acceptance 11 holds, each refusal shown by a request that is refused, and the unpaired link still loads its shell | M1 and M3 (every refusal, by Node clients), M2 and M4 (by a browser from a second origin; the page loads nothing from outside), M5 (the same requests at the live daemon) |
| A.f | the registration exists with `reach: local` while `mawsd` runs and is not alive 30 seconds after it stops | M3 (the file, a stop, a kill), M5 (`sminos sheet surfaces` says so) |
| A.g | questions asked while it was stopped show on the page when it returns (Acceptance 19) | M4 (a record made while no daemon runs), M5 (live) |
| A.h | the terminal's line shows the link | M5 |
| A.i | two surfaces answer the same question: the first is applied, the second reads that it was already answered (Acceptance 19) | M4 (two paired browsers held at the stand-in's barrier), M5 (the page and `sminos sheet answer`) |

## Plan of Work

Five milestones in two landings. M1 is the page server with its three checks and the pairing, and waits on nothing: it reads no sheet. M2 is the page's shell in a browser, and waits on M1 and the look. M3 puts sheets behind the checks and writes the registration; M4 puts them on the page; both wait on C3's first landing. M5 is the live gate and waits on C2's terminal side. M2 and M3 are independent of each other.

### M1 — The page server: who is let in

**At its end.** A `mawsd` started with `MAWS_SHEET_PAGE=1` over a directory that holds a bundle listens on `127.0.0.1` and `::1`, answers the shell to a request whose Host is the page's and refuses every other, pairs a browser through a code that `mawsd sheet pair` prints, and knows a paired browser by its credential. Every response carries §M's headers. A default daemon serves nothing yet, and a `mawsd` without the switch behaves exactly as master's.

**Touches.** `src/mawsd/sheet-page/` (new: `serve.ts`, `handler.ts`, `checks.ts`, `pairing.ts`, `static.ts`, their tests); `src/mawsd/daemon.ts` (the page made, started, told the spine's state, stopped; `daemon.status.sheetPage`; the three commands); `src/mawsd/front.ts` (`FRONT_COMMANDS`); `src/mawsd/cli.ts` (the `sheet` verbs, the usage text, the status line); `src/shared/ipc/schema/daemon.ts`, `names/daemon.ts`, `grades/daemon.ts`; `src/shared/ipc/wire.ts` and the three pinned files; `src/engine-host/bundle-guard.test.ts` (one case); `src/mawsd/process-sheet-page.test.ts` (new); `test/fixtures/sheet-page/bundle/` (new: an invented shell, one script, one stylesheet).

**Interfaces.** Exposes §J, §K, §L but for the sheet's routes, and §M. Consumes nothing of C3.

**Decisions.**

- T1 to T13. `sheets` is a stand-in here that rejects with `no-service`; the sheet's routes of §L are not in `routeOf` until M3, so in this milestone they are 404.
- The checks are written and tested as a table before the server exists: `checks.test.ts` holds §L's table row by row, each row as the request that passes and the requests that are refused, so the table in this document and the code cannot drift without a test moving.
- The process-level suite follows `src/mawsd/process-spine.test.ts`: `startDaemon` in the test's process with the product's options, a scratch profile, the fixture bundle given as `bundleDir`, port 0. Its clients are Node's `http` and `net`, which write any header; a connection is made to the address under test and the Host header set by hand, so no test depends on how its machine resolves a name.
- A machine with no IPv6 loopback is common among containers. The suite asserts both addresses where `::1` can be bound and one where it cannot, and T3's rule itself (one bind refused as in use means neither is served) is tested through `listen`, the seam.
- Pitfalls the code shows: a second `Host` header is refused by Node's parser with a 400 before any handler runs, and that answer too must carry no shell; a request target in absolute form reaches the handler as written and is refused by `routeOf`; `server.address()` is the proof of what was bound, not the options passed.

**Does not touch.** The spine and anything under `src/services/`; the renderer; `apps/`; the workflow; the sminos home (no registration yet).

**Proves.** Of A.e: every Host refusal, the pairing, the headers, and that an unpaired request still gets the shell. Its tests pin:

- **another Host** (Acceptance 11, "any request with another Host"): for the shell, a static file, the exchange, `whoami` and an upgrade to `/live`, a Host of `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`, `rebound.example:<port>`, the name without its port, with another port and with a trailing dot, and no Host at all, each answered 421 or the parser's 400, each with no byte of the shell; the name in upper case passes;
- **the shell on the Host alone** (Acceptance 11, "an unpaired browser still gets the pairing screen"): `GET /` and `GET /s/<a session>` with no credential answer 200 with the same bytes, for a session that has a record and for a string that names nothing;
- **the exchange is a write** (rule 2): `POST /api/pair` with the right code and an Origin of `http://localhost:<port>`, of the name on another port, of `https:` on the same, of `null`, and with none, is 403 each time and the code is still live; with the page's Origin it is 200;
- **the code** (T8): it works once; a second `pair` voids the first; it is refused after five minutes of an injected clock; the fifth wrong try voids it; the eleventh exchange in a minute is 429; no log line and no file holds it;
- **the credential** (rule 1, T9, T10): `whoami` without a header, with a scheme that is not `Bearer`, with an unknown credential, with the right one in a cookie and with the right one in the query is 401; with the right one in the header, 200; the browsers' file holds a hash and no credential, at mode 0600; `unpair` makes the next request 401; a seventeenth browser drops the one seen longest ago; one unused for 90 days is refused; a file that does not parse reads as no browsers;
- **the headers** (rule 3, T12): every response the suite received, the refusals, the 404s and a refused upgrade among them, carries the six headers; the content policy, parsed, names no source but `'self'`, `'none'`, `data:`, `blob:`, the page's own `ws:` origin and, for styles alone, `'unsafe-inline'`;
- **the table** (T13): a target with `..`, with an encoded separator or naming a file outside the bundle is 404 and reads nothing outside; a link placed in the bundle's directory is not served; a file whose extension is not listed is not served;
- **loopback only** (T3): the bound addresses are `127.0.0.1` and `::1` and no other; a connection to a non-loopback address of the machine on that port is refused (skipped where the machine has none); with the second bind refused as in use neither address is served and the state reads `port-taken`; a later try that succeeds reads `listening`;
- **never in the way** (T2, T5, T6): without the switch no socket is opened and no login shell is captured; with it and no bundle the state is `no-bundle`; with a `load` that fails the daemon serves its other sockets and the page's connection gets a 503; after a start with no connection made, the chunk's `load` was never called;
- **limits**: a body over its bound is 413; `OPTIONS` is 405; nothing of a refused request is in its answer;
- the three commands refused to a caller through the endpoint (their grade), and the command line's three verbs against a running daemon, a daemon that serves no page (exit 2) and none (exit 3).

**Gate.** Class 1a; `e2e:supervisor-daemon` and `e2e:daemon-unit`, unchanged and green (the daemon gained a part and the wire moved; a unit over a scratch profile must still open no port).

### M2 — The page's shell, shipped and paired in a browser

**At its end.** `pnpm build` makes `out/sheet-page/`, the app's archive and the Linux pack carry it, and a `mawsd` beside it serves it. In a browser, the link's address shows the pairing screen; the code pairs the browser; the frame shows, with nothing in it yet; a reload stays paired; "Unpair this browser" returns to the pairing screen. A page on a second origin, in the same browser, can do none of what it tries. The gate has a group that proves it.

**Blocked by** the look's answers, beside M1.

**Touches.** `apps/sheet-page/` (new: all of §P but `live.ts`, `store.ts`, `memory.ts`, `host.ts` and the two views' contents; `e2e/rig.ts` and its first specs); the root `package.json` (`build`, `build:app`, `typecheck`, `e2e:sheet-page`) and the lockfile; `vitest.config.ts`; `eslint.config.js` where the app needs a block as desk-web has; `scripts/mawsd-pack.mjs`, its test and `src/mawsd/pack-chunks.test.ts`; `.github/workflows/gate.yml` and the gate scripts' tests that pin its lists; `test/support/tokens-guard.test.ts` and `test/one-locale.test.ts` (the page's directory).

**Interfaces.** Exposes §P's build and shell and §Q. Consumes §K's exchange, `whoami` and `unpair`, and §M.

**Decisions.**

- T19 (the credential's key only), T20, T21, T23, T24, T27.
- Built to the drawn example and the owner's answers; the executor has the frames. Where a frame and this document's words differ on how a thing sits on the page, the frame holds.
- The page decides what to show from two facts alone: whether it holds a credential, and what `whoami` says of it. No credential, or a 401: the pairing screen, which keeps the path the browser asked for and shows that place once paired.
- The rig's daemon is the built one, as a process, since what is under test includes where `mawsd` finds its bundle. The suite starts no Electron.
- The first build confirms the two facts T23 stands on and reports them: that `electron-vite build` leaves `out/sheet-page/` alone when it runs second, and that the bundle guard's last case passes with the page built.

**Does not touch.** `src/mawsd/` but for a fault the browser finds; C3's components; `apps/desk-web`; `scripts/e2e-build.sh`.

**Proves.** A.a on the rig, and of A.e what only a browser can show. In `e2e:sheet-page`:

- a browser that never paired, sent to `/s/<a session id>`, shows the pairing screen and makes no request under `/api/`: it holds no credential, so it asks nothing;
- the code from `mawsd sheet pair`, typed, pairs it, and the place asked for shows; a wrong code says how many tries are left; a reload stays paired; a second browser context is not paired by the first's pairing;
- "Unpair this browser" clears every key under `maws.sheet.` and shows the pairing screen, and `mawsd sheet browsers` no longer lists it;
- **a stranger in the same browser** (the second origin, under the page's host name on another port and under `localhost`): its `fetch` of `/api/whoami` with no header and with a header it made up fails; its `no-cors` `POST` to `/api/pair` with the live code changes nothing, and the code still pairs the real page afterwards; its `iframe` of the page shows no page; its link to `/#x` and to `/?code=…` opens the page as `/` alone would, and no exchange is made; the credential the real page stored is not readable from it;
- **a rebound name**: Chromium started with a resolver rule that maps `rebound.example` to loopback, sent to `http://rebound.example:<port>/`, gets the 421 and no shell;
- **nothing from outside** (Acceptance 11, "the page loads nothing from outside itself"), for the shell: every request the browser made while it loaded the pairing screen and the frame has the page's origin, and the browser raised no content-policy violation.

Unit tests in the app's own project pin: `placeOf` reads the path alone; the built `index.html` holds no inline script; the pack refuses a tree with no `out/sheet-page/index.html` and its release name moves when a file of the page does.

**Gate.** Class 1a; `e2e:sheet-page`, its first run; `e2e:desk-web`, unchanged and green (the workflow's lists and its browsers' step moved).

### M3 — Sheets through the page server, and the registration

**At its end.** A paired browser's requests read any session's sheet, append inbox lines through the door as `by: 'page'`, fetch a captured file as plain text or as an image, and save a pasted image. A live connection hears each change within a second. None of it answers a stranger. While the page is served, `<sminos home>/sheet/surfaces/` holds the registration, rewritten every 10 seconds; a stop removes it, and a kill leaves one that reads not alive.

**Blocked by** C3's first landing on master, beside M1. Its first act is to read §C, §E, §F and §G of C3's plan against the merged code and report every difference from §N; the code binds.

**Touches.** `src/mawsd/sheet-page/` (`sheets.ts`, `registration.ts`, the routes and the WebSocket in `handler.ts`, `checks.ts`'s table, tests); `src/mawsd/daemon.ts` (the real `sheets`, the home for the registration); `src/services/spine-root.ts` (`sheet` on the root, only if the landing did not expose it); `src/mawsd/process-sheet-page.test.ts`.

**Interfaces.** Exposes §N and §O. Consumes C3's service and its stand-in door, and the pin.

**Decisions.**

- T14 to T18.
- The process-level suite runs the real spine over a scratch profile and a scratch sminos home seeded from the pin, with `MAWS_SMINOS_CLI` naming C3's stand-in door, so a Send goes through the same `execFile` path the real one takes. A record with an HTML file and an SVG file as text references is made in the scratch home from a fixture's own; the pin's copy is not edited.
- The live connection's order (subscribe, hold, then list) is tested by moving a record while the list is out, through a service stand-in whose `list` waits.
- The heartbeat's clock is injected. The suite never waits ten real seconds.

**Does not touch.** C3's service, reader and door but for the one member on the spine's root; the wire's `sheet.*` commands; the renderer; `apps/`.

**Proves.** The rest of A.e by Node clients, and A.f. Its tests pin:

- **no credential** (Acceptance 11, "a request for a sheet's data without the credential"): the read, the body, the put, the upload, each with no header, an unknown credential and a revoked one, is 401, holds nothing of a model, and the stand-in door did not run;
- **another Origin on a write** (Acceptance 11): the put and the upload with the right credential and each foreign Origin of M1's list, and with none, are 403; the inbox is byte for byte what it was and the stand-in door did not run; a read with a foreign Origin is 403 and with none is 200;
- **another Origin on the live connection** (Acceptance 11): an upgrade with a foreign Origin or none is refused with no `101`; with the page's Origin and no hello in five seconds the connection is closed and was sent nothing; a hello with an unknown credential closes with 4401 and was sent nothing; a second message closes with 1008; revoking the browser closes with 4403;
- **a body's type** (Acceptance 11, "a referenced HTML or SVG file is shown as text"; rule 4): the HTML reference and the SVG reference are answered `text/plain; charset=utf-8` with `nosniff`, their bytes unchanged; the pin's image reference is answered with its raster type; a body asked by a hash no listed question names is 404; no answer of the page server, in the whole suite, has an HTML or SVG type but the shell and the bundle's own files;
- **an upload** (T17): bytes that are HTML under a claimed `image/png` are refused and nothing is written; an image of 5 MiB and one byte is 413; a good one is written once, mode 0600, and its path answered; one for a session with no record is refused;
- **the line's author**: an inbox line sent with `by: 'maws'` is appended as `by: 'page'`;
- **the live connection**: `ready` holds every record's summary; a record that changes while the list is out is announced after `ready`; a change is one `changed`; an open connection keeps a hold out and a closed one releases it; a spine that leaves `loaded` closes the connections with 1013 and a new one answers 1013 until it loads; with the spine refused, the shell and the exchange still answer and a read is 503;
- **the registration** (X4): the file, parsed, passes the schema written from the pin's, as the pin's own example does; `url` is the page's origin with no trailing slash; `name` is `mawsd` for the default profile and `mawsd-<12 hex>` otherwise; it is written at the first tick and again at each, by replace (a reader in a loop never sees a partial file); no home, no write and no directory made, and a home that appears is written to at the next tick; a `surfaces` that is a link is refused; a stop removes the file, and does not remove one that names another pid; after a kill the file stands and names a pid that is gone; while the state is `port-taken` nothing is written.

**Gate.** Class 1a; `e2e:lane-a` and `e2e:supervisor-daemon`, unchanged and green (the spine's root gained a member; a connection now holds the daemon).

### M4 — The overview and the sheet on the page

**At its end.** In a paired browser `/` lists the machine's sessions that have open questions, the stopped ones apart, and `/s/<session>` is that session's sheet: C3's cards, one Send. A question added, revised or withdrawn shows without a reload. A draft, and the "Updated" mark, survive a reload and show in a second tab. A stopped session's answer reads queued and can be taken back. The page says when it is not connected and why Send is unavailable. A link the sheet's policy refuses is plain text.

**Blocked by** M2 and M3, and the look's answers.

**Touches.** `apps/sheet-page/src/` (`live.ts`, `store.ts`, `memory.ts`, `host.ts`, the two views, the band, their tests); `apps/sheet-page/e2e/` (the specs below); `R/transcript/view/context.tsx`, `R/transcript/view/markdown/Link.tsx`, `R/sheet/SheetMarkdown.tsx` and their tests (T22).

**Interfaces.** Exposes the rest of §P. Consumes §N, C3's X5, and the stand-in door's barrier and staged outcome (C3's §E).

**Decisions.**

- T19, T22, and T15's hidden tab.
- The components hold no state of the sheet (C3's M3): everything that must survive a reload is in the memory this milestone keeps, and `reconcile` is where the memory meets a new model. The page adds no rule of its own to it.
- A change of the record in a spec is the stand-in door's staged outcome, as in C3's e2e; the page learns what became of an act from the model, never from the act (C3's S15).
- The two-surface case is two browser contexts, each paired, on `two-surfaces` seeded as C3's §E says, both Sends held at the barrier and released together. Two tabs of one browser share one memory (T19) and are a different case, tested apart.
- The record of what the sheet's Markdown can reach is one spec that draws a context holding every kind of thing rule 3 names, and reads the browser's own account of what it requested.

**Does not touch.** `src/mawsd/` but for a fault the browser finds; C3's components but `SheetMarkdown`'s one supplied function; the transcript's own links, whose tests pass unedited; `apps/desk-web`.

**Proves.** A.b, A.c, A.g and A.i on the rig, the page's half of A.d, and the rest of A.e in a browser. In `e2e:sheet-page`:

- the overview lists every seeded record with something on it, the stopped ones apart (`stopped-queue`), and a row leads to its sheet; the overview with nothing on it reads so (A.b);
- a sheet shows one card for each listed question in the model's order, and a reference opens to its captured text (`references`) (Acceptance 1's page half);
- a staged change adds a card, and another removes one, with no reload (A.c); a record made while no daemon runs is on the page when the daemon starts (A.g);
- three drafts and one Send reach the door as one call whose three inbox lines share a batch and are `by: 'page'`; the cards that remain are the others (Acceptance 2's half); a pick and typed text travel in one line (Acceptance 4's half);
- a question rewritten under a typed draft reads "Updated", keeps the draft shown as carried, and after a reload still does; an answer refused as stale puts its draft back on a card that says so (`answer-stale`) (Acceptance 3's half);
- Dismiss sends one dismiss line (Acceptance 5's half); on a stopped session an answer reads queued and "Take back" sends a retract of its key (Acceptance 6's half);
- of two paired browsers whose Sends for one question are held at the barrier, one reads accepted and the other that the question was already answered (A.i);
- a draft typed in one tab is in a second tab opened on the same address; unpairing in one sends the other to the pairing screen;
- with the daemon stopped the band says so, the cards and the drafts stand, Send is replaced by its reason, and when the daemon returns the band goes and Send is back; a tab hidden past its five minutes (an injected clock) holds no connection, and one shown again does;
- **a stranger in the same browser, at the data**: from the second origin, a `fetch` of a sheet with no header and with one it made up, a `no-cors` `POST` to `put` and to `uploads`, and a WebSocket to `/live`, each fails, and the record's inbox is what it was;
- **text and bytes an agent wrote** (rule 3, rule 4): a context holding a `script` tag, an `img` tag with an `onerror`, a Markdown image of a remote address, a `javascript:` link, a `mailto:` link, a path link that names no reference, an `https` link, a code fence and a formula is drawn with the tags as characters and no image; the `mailto:`, the `javascript:` and the stray path link are text with no `href` and nothing a click or a middle click follows; the `https` link opens a new tab that has no opener; a marker the script would have set is not set; the HTML reference and the SVG reference open as characters;
- **nothing from outside**, for a sheet (Acceptance 11): over that whole spec every request the browser made has the page's origin or is a `data:` or `blob:` address, the remote image's address was never requested, and the browser raised no content-policy violation.

Unit tests pin: the memory's round trip through storage, a stored Send in flight read as failed and sent again under the same keys, the sweep at 30 days, a full store dropping the oldest session first; two reads that finish in the other order leave the later one standing; `linkStands` absent changes no link of the transcript, and present turns a refused link of each of the three forms into a `span`.

**Gate.** Class 1a; `e2e:sheet-page`; `e2e:transcript` and `e2e:desk-web`, unchanged and green (the link's seam is in a module both draw).

### M5 — Live on a Mac, the built look, the default turned on

**At its end.** The composite's acceptance for this child is seen with a real terminal session, a real model, the real `sminos` and a person's browser, on a Mac. `SHEET_PAGE_DEFAULT_ON` is true: from this landing on, the default daemon serves the page and registers it. The pictures of the built page are with the composite's writer. What was accepted as a limit is in the tracker.

**Blocked by** C2.G2 merged in doperpowers, beside M4.

**Touches.** `src/mawsd/sheet-page/serve.ts` (the constant, and its test); `docs/tech-debt-tracker.md`; this document's Progress and Outcomes.

**Decisions.**

- The live run uses a scratch profile and a scratch sminos home, never the owner's own daemon or home (the daemon plan's "Never the owner's daemon"): a private `mawsd` under the switch on a port of its own, so it runs beside whatever the machine's default daemon does. C2's stand-in surface is not started: the page's own registration is what the session finds, and the first check, before anything is read off the page, is that `sminos sheet surfaces` lists it alive.
- A stale answer and two competing answers are not left to a hand's timing: the daemon is started with C3's `test/support/sminos-barrier.sh` in front of the real command, as C3's M6 does.
- The constant is turned on in the landing's last commit, after the steps passed, and the gates of M1 to M4 run on that head.
- Limits logged in `docs/tech-debt-tracker.md`, one row each: whoever answers on the page's port owns its origin, so a process of another user that binds it while `mawsd` is not listening can read what the browser stored there; a browser extension with access to the page reads it; a web page can tell that something answers on the port; the heartbeat is in no measured idle scene (T26); when `mawsd` is not listening the link shows the browser's own error; the registration says the page is reachable, not that the spine will load; Safari and Firefox are checked by hand and not by a gate; a `mawsd` whose port is taken says so only in `mawsd status` and its log.

**Does not touch.** Anything a milestone before it built, but for a fault the live run finds, which is fixed where it lives and reported. No setting of any session, and not `SMINOS_QUESTION_SHEET`'s default, which is C7's.

**Proves.** A.a to A.i, by the steps quoted under Concrete Steps, in addition to the gates of M1 to M4 on the landing's head.

**Gate.** Class 1a; `e2e:sheet-page`, `e2e:supervisor-daemon`, `e2e:daemon-unit`, `e2e:lane-a`, `e2e:transcript`, `e2e:desk-web` on the landing's head; the live steps by hand.

## Concrete Steps

All from the worktree's root. A gate tests the committed head; while iterating, one focused file may be run on the machine (`pnpm exec vitest run <path>`). `<doperpowers>` is a checkout of that repository at C2.G2's merge. The transcripts are what the milestones' tests pin; the executor corrects this section to what was built.

**M1.** The gates, then the page server by hand, in a scratch profile, on a port of its own:

    pnpm exec vitest run src/mawsd/sheet-page src/mawsd/process-sheet-page.test.ts
    pnpm wire:manifest
    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:supervisor-daemon,e2e:daemon-unit

    pnpm build:main-preload
    mkdir -p out/sheet-page && cp -R test/fixtures/sheet-page/bundle/. out/sheet-page/      # M1 only: the fixture stands in for the page
    export MAWS_USER_DATA="$(mktemp -d)" MAWS_SHEET_PAGE=1 MAWS_SHEET_PORT=47591 SMINOS_HOME="$(mktemp -d)"
    node out/main/mawsd.js run --private --dir "$MAWS_USER_DATA/mawsd" &
    P='--resolve sheet.localhost:47591:127.0.0.1'
    curl -si $P http://sheet.localhost:47591/s/anything | head -12                           # 200, the shell, the six headers
    curl -si -H 'Host: 127.0.0.1:47591' http://127.0.0.1:47591/ | head -1                    # HTTP/1.1 421 Misdirected Request
    curl -si -H 'Host: rebound.example:47591' http://127.0.0.1:47591/ | head -1              # HTTP/1.1 421 Misdirected Request
    curl -si $P http://sheet.localhost:47591/api/whoami | head -1                            # HTTP/1.1 401 Unauthorized
    node out/main/mawsd.js sheet pair                                                        # the code, then one sentence
    curl -si $P -X POST -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' -d '{"code":"<the code>"}' http://sheet.localhost:47591/api/pair | head -1    # HTTP/1.1 403 Forbidden
    curl -s  $P -X POST -H 'Origin: http://sheet.localhost:47591' -H 'Content-Type: application/json' -d '{"code":"<the code>"}' http://sheet.localhost:47591/api/pair       # {"id":"…","credential":"…"}
    curl -si $P -H 'Authorization: Bearer <the credential>' http://sheet.localhost:47591/api/whoami | head -1    # HTTP/1.1 200 OK
    node out/main/mawsd.js sheet browsers                                                    # one line
    node out/main/mawsd.js status | grep 'sheet page'                                        # sheet page: http://sheet.localhost:47591 (1 browser paired, 0 open)

If the code's exchange passes with the foreign Origin, or any request with the wrong Host gets the shell, §L is not built and nothing later means anything.

**M2.**

    pnpm --filter sheet-page build && ls out/sheet-page/index.html
    pnpm exec vitest run src/engine-host/bundle-guard.test.ts                                # its last case passes with the page built
    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:sheet-page,e2e:desk-web

By hand, in any browser, against the daemon of M1's steps restarted after the build: `http://sheet.localhost:47591/s/5eed0000-0000-4000-8000-000000000019` shows the pairing screen; the code pairs it and the frame shows; a reload stays paired.

**M3.** The gates, then the registration and a body by hand, with the daemon of M1's steps and a record nobody runs:

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:lane-a,e2e:supervisor-daemon
    cp -R test/fixtures/sheet/set/fixtures/references/before/sheet "$SMINOS_HOME/"
    cat "$SMINOS_HOME"/sheet/surfaces/*.json                                                 # {"v":1,"name":"mawsd-…","pid":…,"url":"http://sheet.localhost:47591","reach":"local","heartbeatAt":"…"}
    S=5eed0000-0000-4000-8000-000000000019; A='Authorization: Bearer <the credential>'
    curl -s  $P -H "$A" http://sheet.localhost:47591/api/sheets/$S | head -c 300             # {"model":{"v":1,"session":"5eed0000-…
    curl -si $P http://sheet.localhost:47591/api/sheets/$S | head -1                         # HTTP/1.1 401 Unauthorized
    curl -si $P -H "$A" -H 'Origin: http://localhost:5173' -X POST -d '{"lines":[]}' http://sheet.localhost:47591/api/sheets/$S/put | head -1    # HTTP/1.1 403 Forbidden
    kill %1; sleep 1; ls "$SMINOS_HOME"/sheet/surfaces/                                      # empty: a clean stop removed it

The second `cat` ten seconds after the first shows a later `heartbeatAt`.

**M4.**

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:sheet-page,e2e:transcript,e2e:desk-web

By hand: with the `references` record seeded as above, `/` lists one session and its sheet shows two cards, one with three collapsed files.

**M5.** On a Mac, under the load rule, with the tree built from the landing's head (`pnpm build`) and `<doperpowers>` at C2.G2:

1. Set up as C2's live check does (its plan's Concrete Steps, "The live check"), with the page in place of its stand-in surface: one scratch configuration home and one scratch `SMINOS_HOME`, exported in every shell used below; `MAWS_USER_DATA` a scratch profile. Start the daemon from such a shell with `MAWS_SHEET_PAGE=1 MAWS_SHEET_PORT=47591 MAWS_SMINOS_CLI=<doperpowers>/sminos/bin/sminos node out/main/mawsd.js run --private --dir "$MAWS_USER_DATA/mawsd"`.
2. `<doperpowers>/sminos/bin/sminos sheet surfaces` lists one surface, its address `http://sheet.localhost:47591`, its reach `local`, alive (A.f). Go on only if it does.
3. Start a terminal session in a scratch project: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 SMINOS_QUESTION_SHEET=1 claude --plugin-dir <doperpowers>/sminos`. Ask it: "Put eight questions to me on your sheet in one call, one of them referencing README.md and one with three options and a recommendation. Then keep working: list this directory." The terminal shows `8 open questions · http://sheet.localhost:47591/s/<session>` (A.h, Acceptance 1).
4. Open that link in a browser that never paired: the pairing screen (A.a). Run `node out/main/mawsd.js sheet pair`, type the code: eight cards, the referenced file as captured. Edit README.md: the reference reads "Changed since asked" at the next change of the sheet and still shows the captured text (Acceptance 1). `/` lists the session (A.b).
5. Answer three, one of them with a pick and a typed comment, and press Send: the agent quotes the three together, with the comment (Acceptance 2, 4); five cards remain, without a reload (A.c).
6. Type a draft on one card and ask the agent to rewrite that question: the card reads "Updated" and keeps the draft; reload: it still does (Acceptance 3).
7. Dismiss one question: no turn starts, and the agent is told with its next delivery (Acceptance 5).
8. Restart the daemon with `MAWS_SMINOS_CLI=test/support/sminos-barrier.sh`, `SMINOS_REAL=<doperpowers>/sminos/bin/sminos` and `SMINOS_BARRIER=<a file that does not exist yet>`. Answer one question and press Send: it waits. Ask the agent to rewrite that question, then create the barrier's file: the card says the question changed and the draft is back on it (Acceptance 3's refusal). Remove the file. Answer another question on the page and press Send, run `<doperpowers>/sminos/bin/sminos sheet answer <session> <its handle> --text second` in a shell, then create the file: one answer is applied, and the page reads that the question was already answered or shows its receipt, whichever came first (A.i, Acceptance 19).
9. Close the terminal. `/` lists the session apart, as stopped. Answer a question: the card reads queued, with its take back; take it back; answer again. Resume the session in a terminal and send it any message: the answer goes with it, marked with its age (Acceptance 6).
10. Stop the daemon with `kill`: the registration is gone, and a question the agent asks now ends its result with the sentence that no surface can show it, the terminal's line saying the page is unreachable. Start the daemon: the question is on the page (A.g, Acceptance 19). Stop it with `kill -9`: the file stands, and `sminos sheet surfaces` reads it not alive at once, and after 30 seconds by its age (A.f).
11. The strangers, at this daemon (A.e, Acceptance 11): M1's and M3's `curl` lines, each refused as written there; then `node apps/sheet-page/e2e/second-origin.mjs http://sheet.localhost:47591` and its page opened in the paired browser, every line of which reads refused.
12. The same browser's pairing, a sheet, a Send and a reload, once in Safari and once in Firefox (T27).
13. `pnpm build:app`, then `pnpm exec asar list dist/mac-arm64/MAWS.app/Contents/Resources/app.asar | grep -c '/out/sheet-page/index.html'` prints 1.
14. The rig's screenshots of the page's own screens, written outside the repository, to the composite's writer.
15. Set `SHEET_PAGE_DEFAULT_ON` to true, commit, and run the gate: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:sheet-page,e2e:supervisor-daemon,e2e:daemon-unit,e2e:lane-a,e2e:transcript,e2e:desk-web`.

## Outcomes & Retrospective

Pending — written at finish.

## For the composite's writer

State, like Progress. Three lists: the sentences of the composite, as it stands at the parent pin `760d7ad1a`, that this document makes false or incomplete, each with the replacement proposed; what needs the owner; what C2's and C3's authors should be told while their work is still being built. An advisory sentence this child overturns is this document's text from now on; a binding one stands until the writer rules.

**Sentences.**

1. §8.2, "`mawsd` serves it on loopback only, under the host name `sheet.localhost` and port 47590 (configurable; …)". Incomplete on which `mawsd`, on which addresses, on how it is configured and on a taken port. Proposed: "The machine's default `mawsd` serves it, on `127.0.0.1` and `::1` and no other address, under the host name `sheet.localhost` and port 47590 (`MAWS_SHEET_PORT`, read from `mawsd`'s environment and then the login shell's; a `mawsd` of another profile serves it only under `MAWS_SHEET_PAGE=1`). A port that is taken is not served and not registered: the page's origin includes its port, so it never moves to another." (T2, T3, T4.)
2. §8.2's defence, "another machine on the network". What stops another machine is the loopback bind, which is the section's opening sentence and none of its four rules; and the name resolves to two loopback addresses, so one bind is not enough. Proposed, as a binding sentence beside the four: "It listens on both loopback addresses or on neither: a process on the other address would answer under the page's origin." (T3.)
3. §8.2's second rule, "Everything that reads or changes a sheet requires the credential, and the live connection and every write also an Origin that is exactly the page's." Kept as written; one reading added, since a browser sends no Origin on a same-origin `GET`: "A read carries none and is refused only when it carries another's; the exchange of a pairing code is a write." (§L.)
4. §8.2's third rule, "a content policy that loads nothing from outside the page". The four rules as written do not stop another site from framing the page and steering a click. Proposed addition to the rule: "and that lets no other page frame it". This document adds `frame-ancestors 'none'`, `X-Frame-Options`, and the two cross-origin headers under that reading (T12). **This is the one place the child adds to a binding rule; it stands as built unless you rule otherwise.**
5. §8.2's third rule, its parenthesis: "any other link does nothing, though it is still drawn as a link; drawing it as plain text is a small change to the transcript's Markdown component that C4 carries if Acceptance 11 needs it". It needs it: in a browser a `mailto:` link is an anchor the browser's own gestures follow. Proposed: "any other link is drawn as its text (one optional function on the transcript's context, which C4 adds and the transcript leaves unset)". (T22.)
6. §8.2, "A browser is paired once: an unpaired browser is shown how to get a one-time code (`mawsd sheet pair`), and exchanges it for a credential." Incomplete. Proposed addition: "The code is typed, lives five minutes and works once; each browser pairs for itself; a credential lasts until `mawsd sheet unpair`, the page's own Unpair, or 90 days without use, and `mawsd sheet browsers` lists them." (T8 to T10.)
7. §8.2, "What the page defends against is web content and other hosts … It does not defend against a process running as the same user". Incomplete: three things are not stopped by the four rules and are not that process. Proposed addition: "Nor does it defend against whoever answers on the page's port while `mawsd` is not listening: the origin is the name and the port, so a process of another user of the machine that binds it can read what the browser stored there. The default daemon holds the port from login and refuses to serve on one address alone, which narrows this and does not close it. A browser extension the person gave access to the page reads it, and a web page can tell that something answers on the port." If you want the first closed and not stated, the way is a credential the browser can use and not read (a key that cannot be exported), which needs a secure context and is not built.
8. §7, the registration's example, `"name": "mawsd"` and `"url": "http://sheet.localhost:47590"`. Incomplete. Proposed addition: "`url` is an origin, with no path and no trailing slash; a reader appends the path. The default daemon's `name` is `mawsd`; a daemon of another profile that serves the page registers as `mawsd-<12 hex>`. A surface removes its file at a clean stop, and writes nothing where the sminos home does not exist." (T18.)
9. §8, "Drafts are kept per question in the surface's memory." For the page the memory is kept in the browser's storage for the page's origin, so a draft and what was seen survive a reload and show in a second tab, for 30 days untouched. Proposed addition to §8.2: that sentence. (T19.)
10. C4's Design inheritance, "This is `mawsd`'s first HTTP door: everything else it serves is a token-authenticated socket or a sealed channel (`src/shared/daemon/files.ts`)". `mawsd` already speaks HTTP on `artifacts.sock`, a Unix socket with no token whose file mode is its check, and the tree has one loopback TCP listener, the connectors' OAuth callback. Proposed: "This is the first entrance of `mawsd` a browser can reach: a TCP listener with authority, where everything else is a Unix socket, a peer-checked socket or a sealed channel".
11. C4's Edges, "blocked-by: C2.G2, and C3's first landing". Finer than that: the page server's checks and pairing and the page's shell (M1, M2) wait on neither; the sheet's routes and views (M3, M4) wait on C3's first landing; only the live gate (M5) waits on C2.G2. Proposed: "blocked-by: C3's first landing for its sheet routes and views, C2.G2 for its live gate; its first two milestones on nothing".
12. Verification, "*high* for C2 … and C4". Two landings (T25). Proposed: "*high* for C4's first landing, which holds all of the page server; its second (the live gate and one constant) at the rung its diff warrants".
13. The Tracking Map's row for C4: the artifact is `docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md` (branch `question-sheet-c4`).

**For the owner, through you.**

1. **The look's eight questions** ("The look", "Open with the owner"), each with its recommendation: how a browser is paired; the page's name; the sheet's width; where Send is; dark mode; the count in the tab's title; the tone of "not connected"; whether the pairing screen names the command alone. M2 and M4 draw nothing before the answers.
2. **From C4's second landing every default `mawsd` listens on loopback port 47590 and rewrites its registration every ten seconds**, on every machine, whether or not anyone there uses the sheet. It serves nothing to an unpaired browser and changes no session's tool. Recommended: yes, since C7's default needs a live surface to be there already. The other way is to keep the page behind `MAWS_SHEET_PAGE=1` until C7; it is one constant.
3. **A credential's life**: until unpaired, or 90 days unused, at most 16 browsers. Decided here as a technical default (T10); it is the owner's if a re-pairing every quarter on a rarely used browser is the wrong trade.
4. **Not built, and not proposed for this child**: a pairing code shown in the MAWS app; a sound or a notification from the page; the page for a session on another machine (the composite's §10). Say if any should be.
5. **The built look**, at M5: the pictures of the page's own screens.

**For C3's author, through you**, while its first landing is being built.

1. **The service on the spine's root.** The page server calls the service in process, since the wire's `sheet.put` stamps `by: 'maws'`. It needs `SpineRoot.sheet?: SheetService`, set where `startSpine` makes the service. One line now; otherwise M3 adds it.
2. **`body` for a draft's own image.** The service answers an `upload` only when a queued answer or a pending outcome names it, so an image just pasted, which only a draft names, cannot be read back: a card cannot show it after a remount, and on the page not after a reload. Proposed: `body` answers any regular file under the record's `uploads/` whose name the line's schema allows. The name is random and the caller already has the record.
3. **A row of the overview as a link.** `SheetOverviewProps` has `onOpen(session)`. On the page a row should be an anchor, so that it opens in a new tab. Proposed: an optional `hrefOf?: (session: string) => string`; where given, the row is an anchor with that address and `onOpen` handles a plain click.
4. **"When" inside the service.** That nothing is located or run until a record with something on it is read should hold in `SheetService.read`, not only in the wire's handler, since the page calls the service.
5. **The link's seam** (entry 5 above) changes `R/sheet/SheetMarkdown.tsx` in M4: it will supply one function. If the sheet's policy is one exported predicate there, the seam reuses it.
6. **The bytes of an upload.** The page server checks an image's signature against its claimed type before `upload`. If the service did, both surfaces would hold it at one boundary.
7. **How an image body is drawn.** The page's content policy allows `data:` and `blob:` images. If `ReferenceView` draws an image any other way, say so.

**For C2's author, through you.**

1. **The link is `<url>/s/<session>`**, and the page registers `url` with no trailing slash. A reader that strips one would be safe against a surface that writes it.
2. **With two surfaces alive** (C2's stand-in beside the page, or a scratch daemon beside the default one) "the first alive that suits" needs an order. Proposed: the name `mawsd` first, then by name.
3. **The directories.** `mawsd` makes `sheet/` and `sheet/surfaces/` at mode 0700 when they are absent and the sminos home exists, and writes its file at 0600 by replace through a temporary file beside it whose name does not end in `.json`. Say if the tool expects other modes, or lists that directory by another pattern.
4. **The home.** `mawsd` registers under the home MAWS's reader reads: `SMINOS_HOME`, then `DAEMON_HOME`, from its own environment and then the login shell's, else `~/.claude/sminos`. A terminal whose `SMINOS_HOME` differs from the login shell's finds no surface there and has today's tool. That is a limit of this child and is stated; nothing is asked.
