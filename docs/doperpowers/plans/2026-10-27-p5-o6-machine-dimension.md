# P5 O6: the renderer's machine dimension and org projects (2026-10-27)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child **O6**, parent pin blob `7adc58e71` (master `84dd399cd`).
>
> **What binds.**
> - O6's section in P5 is this document's design, and its contracts bind: **OX2** (machine-scoped addresses) and **OX3** (org projects), as P5 Decision Logs 21 and 22 restate them.
> - So do P5 §3 (the app: the connection manager, addresses, org projects) and §8 (the interface: the sidebar by org project, machine chips, an offline machine's rows greyed, sessions with no project under their machine).
> - So do RL5's machine `ref` (`docs/doperpowers/specs/2026-10-26-remote-layer-design.md` §2.3 and Decision Log 19) and **OX7** (every landing step stays within the local latency budget).
>
> **Inherited from other children.** O6 builds on O1's execution document, `docs/doperpowers/plans/2026-10-27-p5-o1-seams.md`, which is executing and has not landed. Its names are cited as that document defines them, and every step that needs O1's code is marked **(needs O1)**. If O1 lands a name differently, follow O1 and record the difference in Surprises.
>
> **Advisory.** The survey behind O6 is `research/org/headless-cut-survey.md` §4.3–§4.4, with its scan in `research/org/scripts/`.
>
> **What this file holds.** The execution only: constraints, milestones, steps and interfaces. Each decision O6's section leaves open is made here, where it binds, with the alternative that lost. The Decision Log lists them for the architect, who writes P5's own log.

## Purpose

MAWS's renderer has never known that a session lives on a particular machine. Every id it holds is a bare UUID that only one machine can resolve. Every store assumes one source. One engine host's departure blanks every status. A project is a folder path on one Mac. P5 puts sessions on several machines, so the renderer has to learn the machine before any remote session can be shown.

After O6:

- **Every id names its machine.** Every machine-bound id the page holds is an address, `<machine>/<id>`. The machine part is the `MachineRef` that the machine minted at its first run. The renderer's IPC client lifts ids into addresses as they arrive and lowers them as they leave, so call sites route by the address they already hold, and stores key by it. The local machine is a machine like any other: its ids are addressed too.
- **Main reaches every machine through one connection manager.** Each machine has a link. The local machine's is in-process (main's own services). Another profile's machine on the same Mac is reached over a same-uid socket speaking O1's protocol 3. The links O7 and O10 add later (RL2 channels) plug into the same manager.
- **The stores reconcile per machine.** A machine's snapshot replaces only that machine's records, and its departure greys only its rows.
- **The layout keeps the machine, and so do drafts.** The layout carries the machine of every tab and panel key, and a layout from before O6 migrates once. Drafts stay on their session's machine, addressed through it.
- **The sidebar groups by org project.** The same repository checked out on two machines is one row holding both machines' sessions, each of another machine's sessions with its machine chip. A folder the owner added stays a row of its own. Sessions in a folder nobody opened sit under their machine's row. An offline machine's rows grey.

**How to see it working.** Two MAWS profiles on one Mac stand in for two machines. A second profile's app serves its machine services over a socket, and the first profile's app connects to it. The first app's sidebar then shows both profiles' sessions, grouped by org project, each with its machine. Quit the second app and only its rows grey. Relaunch the first and the second's open tab and draft are still there. The commands are in Concrete Steps.

## Progress

- [ ] M1: machine identity and the address codec
- [ ] M2: addresses across the boundary, one machine
- [ ] M3: machine links and the second-profile stand-in
- [ ] M4: per-machine stores, the shell per machine, explicit machines for paths
- [ ] M5: org projects and the sidebar
- [ ] M6: acceptance

## Acceptance

Each item is checked by the command Concrete Steps names. Paths are repository-relative. "A" is the first profile's app. "B" is the second profile's app, serving as a stand-in machine (M3).

1. **One machine, nothing changed but the ids.**
   - Class 1a is green at the head, and so is every Mac e2e group, the adapted specs included.
   - `wireFingerprint()` prints the same value at the head as at the base.
   - The OX7 bench (`e2e:local-latency`) is within budget at M2's commit and at the head. Budget: p50 at most the baseline's plus 2 ms, p95 at most its plus 5 ms (O1 acceptance 1).
2. **Machine identity.**
   - The first launch of a profile writes `<userData>/machine.json` holding one `MachineRef`. A relaunch reads the same ref, and a second profile gets a different one.
   - `machine.identity` answers `{ ref, name, project }`.
   - `src/main/machine/identity.test.ts` pins:
     - atomic publication. A first run paused after writing its temporary file and before linking it, with a second run starting meanwhile, leaves both reading one complete ref. A stray temporary file is removed at the next start;
     - a malformed file is refused loudly, never re-minted;
     - the format is RL5's: `[A-Za-z0-9_-]{16,64}`, from at least 128 random bits.
3. **Addresses.**
   - In A's page, a session tab's DOM id is `session:<ref>/<uuid>`, and `layout.get('main.tabs')` holds addresses.
   - `src/shared/machine/address.test.ts` pins the codec. A ref containing `/` is refused.
   - `src/shared/machine/coverage.test.ts` fails when any schema the renderer sends or receives has an id-shaped field that is not branded. The same failure applies to a record keyed by a plain string with no reviewed entry.
   - A command whose input carries addresses of two machines is refused `invalid_input` in the renderer client, with one `console.error` naming both. Nothing is sent.
4. **Migration.**
   - Over a profile whose `layout.json` holds a pre-O6 `main.tabs` (version 2, bare ids) and a draft written under a bare id, the upgraded app restores every tab, the panel tabs and the draft.
   - It writes `main.tabs` back at version 3 with addresses.
   - A second launch reads version 3 and rewrites nothing.
5. **Two machines, one sidebar.** A runs with B linked (M3). A's sidebar shows the following:
   - One row for the repository both profiles have checked out. It holds A's and B's sessions; B's carry B's machine chip, and A's carry none (T1).
   - A row of its own for a folder A added that is not a repository.
   - B's machine row, holding a session B ran in a folder nobody added.
   - Hovering B's session shows B's name.
6. **One machine leaves.**
   - B quits. Within 2 s B's rows grey with "machine offline", and A's rows, statuses and Needs-you entries are unchanged. An open tab of B's session stays, greyed.
   - B relaunches. Within 5 s of its window loading, B's rows are live again, with no duplicate.
7. **Layout and drafts follow the machine.**
   - A has B's session open in a tab, with a draft typed into its composer. After A quits and relaunches with B up, the tab is restored and the draft is in the composer. The draft is read from B.
   - The same relaunch with B down keeps the tab, greyed, and drops nothing.
8. **A session on B is B's.** Opening B's session in A shows its transcript, read through B, and its panel summary's branch, from B's git. Nothing about it is read from A's machine.
9. **The stand-in's boundaries.** `src/main/machines/serve-gate.test.ts` and `src/main/machines/serve-standin.test.ts` pin:
   - a packaged build never serves, whatever its environment says;
   - the serve directory is 0700, and the socket and token are 0600;
   - a peer whose uid differs from the app's is closed before it reads a byte;
   - with the peer-auth addon unavailable, every peer is refused.
10. **Org projects follow sminos's rule.**
    - `src/main/index/org-project.test.ts` passes sminos 1.15.0's vectors, `test/fixtures/sminos/remote-key.json` and `test/fixtures/sminos/machine-project-id.json`.
    - It pins each derivation case on real temporary repositories:
      - `.smns`;
      - a linked worktree reading its main checkout's `.smns`;
      - origin;
      - the only remote;
      - two remotes and no origin;
      - a local-path remote;
      - no remote;
      - no repository;
      - an enrolled machine against an unenrolled one.
    - An org project's persisted key is the same before and after enrollment.

## Execution

### Constraints (bind every milestone)

- **Contracts.**
  - **OX2** binds as P5 Decision Logs 21 and 22 state it:
    - ids are addresses in the renderer, lifted and lowered by branded-schema identity;
    - one codec owns `machine/id`;
    - a payload that mixes machines fails loudly;
    - `MachineRef` follows RL5's format, is minted once and is independent of the machine key;
    - every contract field named `machine` carries the ref, never the name.
  - **OX3** binds as Decision Log 21 states it:
    - every checkout yields a project;
    - only sessions with no checkout go to their machine's project, where a checkout is a project someone opened (M5);
    - persisted keys survive enrollment.
  - **OX7** binds at M2 and at the head.
  - Where this document narrows or extends a contract, the Decision Log says so.
- **The wire.**
  - O6 adds one `machine`-owned command, `machine.identity`, and so bumps `WIRE_MINOR` once and rewrites the manifest with `pnpm wire:manifest` (O1 M6; **needs O1**).
  - It changes no engine-host schema: `wireFingerprint()` must not move.
  - If O6's bump is the first on master (`git log -S WIRE_MINOR origin/master -- src/shared/ipc/wire.ts`), message the architect when M1 lands. O1's real two-build cross-minor check, which waits for the first bump (O1 Decision Log; P5 Decision Log 20), is then due, and its mechanism is not O6's (Decision Log, residue 38).
  - It adds no `IpcError` code. `IPC_ERROR_CODES` is an enum inside the envelope's `res`, and under O1's rule an added enum member is breaking (O1 M6).
  - Main-owned schemas cross the stand-in link without the minor discipline. So the stand-in is a link between two profiles of one build, and the link says so in its log at connect. Cross-build machine links come when O3 brings the moved namespaces into the manifest.
- **Out of scope, each with its owner.** Name the owner in a comment where code stops at the edge.
  - The "+ Session" machine picker, spawning on another machine, and remote surfaces at depth over RL2: uploads, port forwarding, the artifact endpoint (O7, O5).
  - Notifications, the dock badge and ⌘⇧J across machines. Main's notifier reads the local read model in memory (survey §2 item 3), and its client-side mirror is O3's.
  - Owners on rows, visibility, the per-project toggle for other people's sessions, the project channel, sign-in and the Org page (O8).
  - Lane A controls (O9).
  - RL2 channels, the hub connection and machine discovery from the org state (O10, O11, OX8).
  - The settings split (O3).
  - Connectors, the library, delivery and the catalog across machines (O4).
  - The machine's enrollment as an input to the org-project rule (O10; O6 passes none).
- **The engine is never patched** (D-1).
- **Light theme, tokens only** (charter X7). The interface choices under M5's "Taste decisions" are the owner's answers (P5 Decision Log 28). O6 builds each as answered, and nothing more.
- **Machines and gates.** Gates run on GitHub Actions through `scripts/ci-gate.sh <worktree>`, prefixed `cd /tmp &&` in the shell.
  - Class 1a: `--gates static,unit,probes --class1a pool`.
  - Mac e2e: `--runner macos --lane hosted` for the groups in `.github/workflows/gate.yml`'s `HOSTED_MAC_E2E`.
  - The mini: `--runner macos` alone. It runs `e2e:default`, `e2e:browser-comment`, the `MAC_SECRET_E2E` groups and the measured `e2e:local-latency`.
  - Run on the mini without asking unless the architect has relayed a hold. A red seen only on `ci-kit-mac-ec2` is rerun on the mini before it counts.
  - On this MacBook, run no e2e of an engine or connector scene, and nothing that touches the Keychain or raises a TCC or firewall dialog.
  - One focused vitest file at a time while iterating is fine. The worktree has no `node_modules` until `pnpm install --frozen-lockfile`.
- **Hands off.**
  - The owner's running MAWS, its build output under the main checkout, and its user data.
  - `~/.config/claude-secrets`, which is never read.
  - Never stage `spikes/gws-onboarding/`, `.playwright-cli/`, `node_modules` or `plugin/`.
  - Never edit the charter, P5, the ledgers or `docs/tech-debt-tracker.md`. Debt and residue go to this document's record and the report.
- **Commits.** End every commit message with `Sminos-Session: GUI AI agent workspace charter#37052769 (MAWS on macbook)` as a second `-m`, and add no other trailer.
- **Lint.** `eslint.config.js` gives each file one `no-restricted-imports` block, and a later block's options replace an earlier one's (O1 Constraints).

### Orientation

- **The boundary today.**
  - The renderer calls `ipc.invoke(name, input)` (`src/renderer/src/ipc/client.ts`) and subscribes with `ipc.on(name, listener)`. That client validates outputs and events.
  - The preload (`src/preload/bridge.ts`) is a name-checking pipe onto `ipcRenderer`.
  - Main's router (`src/main/ipc/router.ts`) checks the sender, validates the input, and dispatches by the registry entry's owner. After O1 M5 it does so through `createRouter<R>`, with `registerMainHandler` and `registerMachineHandler` (**needs O1**).
  - Main sends events with `emit` (`src/main/ipc/events.ts`). Host events reach the renderer through the same `emit` (`src/main/hosts/supervisor.ts`, the relay), and `onEmitted` taps let main's own services hear what main told the renderer.
- **Ids.**
  - Every id is a branded `z.string().min(1)` (`src/shared/graph/ids.ts`; `PtyIdSchema` is in `src/shared/ipc/schema/pty.ts`).
  - Because a brand is type-only, the same schema instance is reused everywhere an id is typed. O6's codec finds ids by that identity.
  - An address `<ref>/<uuid>` still validates under every id schema.
- **The shell's stores.**
  - `connectShell` (`src/renderer/src/ipc/events.ts`) subscribes before it snapshots. It then feeds:
    - `useSessions` (`stores/sessions.ts`, reconciled by one index-wide revision counter);
    - `useAttention` (`stores/attention.ts`, one snapshot);
    - `useLayout` (`stores/layout.ts` with `layout-model.ts`, hydrated once the sessions are known).
  - `useHosts` (`stores/hosts.ts`) holds one engine host and one pty host.
  - Path-keyed stores: `useGit` (`stores/git.ts`), `useFiles` (`tools/code/files/store.ts`) and `useViewer` (`tools/code/viewer/viewer-store.ts`).
- **The sidebar.**
  - `src/renderer/src/sidebar/Sidebar.tsx` draws Codex's flat tree from `projectList` (`sidebar/derive.ts`).
  - Listed projects are the user-added ones that are not hidden. Every other session falls into "Other sessions" (`OTHER_SESSIONS`).
  - The tree's keys are `ProjectKey`s, and its expanded rows persist in `regions.sidebar.expandedProjects`.
  - Tab sets are kept per project (`main.tabs.sets`, W12). Tabs move between sets through `refileTabs` when a session's project changes.
- **Projects on a machine.**
  - The index (`src/main/index/projects.ts`) keeps one `ProjectRecord` per directory. The directory may be user-added (`origin: 'user'`) or discovered: an existing directory with a session that has messages.
  - Membership is by realpath and worktree.
  - sminos's project identity is `resolve_project` in `/Users/new/.claude/plugins/cache/doperpowers/sminos/1.15.0/skills/sminos/scripts/sminos.py`, with `smns_at`, `derivation`, `parse_remote`, `remote_key`, `remote_name`, `repo_project_id` and `machine_project_id`. Read it; never run a state-changing verb.
- **Profiles.**
  - A profile is a `userData` directory (`MAWS_USER_DATA`, `src/main/index.ts`). Its supervisor is per profile (`src/engine-host/supervisor-files.ts`).
  - Every e2e launch gets a fresh profile with its own `CLAUDE_CONFIG_DIR` (`e2e/support/launch.ts`, `e2e/support/scratch-env.ts`).
  - The engine host's discovery reads `CLAUDE_CONFIG_DIR` (`src/engine-host/fs/paths.ts`), so two profiles list different sessions.
- **The stand-in.** P5 §2 (two composition roots) is the reason it works. Until O3, main's embedded root is its profile's machine services. A second profile's main therefore answers that profile's `session.list` with its own index, exactly as its `mawsd` will after O3.

### Plan of Work

The order is M1, M2, M3, M4, M5, M6.

- M1 is pure and shared code, plus one machine-owned command.
- M2 must land whole. Lifting ids without migrating the layout in the same change would drop every restored tab at hydrate, because `known(id)` would compare bare stored ids against address-keyed records.
- M3 adds the second machine. Until M4 it is reachable at the link level only: its records are not yet reconciled per machine, and it is configured only in tests and dev runs.
- M4 makes the stores per machine.
- M5 builds org projects and the sidebar on top of M4.
- Every milestone needs O1 to have landed. M1 needs its `machine` owner, grades and wire manifest. M2 needs `ClientRef` and the router. M3 needs the host runtime and the forwarding seam.

### M1 — Machine identity and the address codec

**At its end.**
- Every profile has a `MachineRef`, minted at its first run into `<userData>/machine.json` and never changed.
- `machine.identity` answers it through the `machine` owner's embedded binding (**needs O1**: `registerMachineHandler`).
- `src/shared/machine/address.ts` is the one codec for addresses. It is compiled once per schema into a lifter and a lowerer.
- A coverage test holds the registry to branded ids.

**Touches.**
- `src/shared/machine/ref.ts` (new: `MachineRefSchema`, `MachineRef`) and `src/shared/machine/identity-file.ts` (new: the identity file's reader and minter, with no Electron import, so O2's `mawsd` uses the same module; whichever of O2 and O6 lands first creates both, P5 Decision Log 27);
- `src/shared/machine/address.ts`, `address.test.ts`, `coverage.test.ts`, `address-paths.json` (new);
- `src/main/machine/identity.ts`, `identity.test.ts` (new);
- `src/shared/ipc/schema/machine.ts`, `src/shared/ipc/names/machine.ts`, `src/shared/ipc/grades/machine.ts` (new), and their composition into `src/shared/ipc/schema.ts`, `names.ts` and `grades.ts`;
- `src/shared/ipc/wire.ts` (`WIRE_MINOR` + 1) and `src/shared/ipc/wire-manifest.json` (rewritten);
- `src/shared/graph/ids.ts` and `src/shared/ipc/schema/pty.ts` (the loose aliases below), and every schema whose field or record key the coverage test names, `src/shared/ipc/schema/browser.ts` among them;
- `src/main/index.ts` (mint at startup; register the handler).

**Decisions.**
- **The ref** (RL §2.3 and Decision Log 19; P5 Decision Logs 21 and 22).
  - Format and randomness:
    - It is 22 characters of base64url without padding, drawn from 16 random bytes (`crypto.randomBytes`).
    - That is 128 bits, inside RL5's `[A-Za-z0-9_-]{16,64}`.
    - `MachineRefSchema` accepts the whole RL5 range, so a ref another daemon minted reads here.
  - The file is `<userData>/machine.json`, holding `{ "version": 1, "ref": "<ref>", "mintedAt": "<ISO time>" }`.
    - It is published atomically and never replaced:
      1. The minter writes the complete JSON to a same-directory temporary file (`machine.json.<pid>.<random>`, mode 0600) and `fsync`s it.
      2. It publishes the file with `link(temp, machine.json)`, which fails with `EEXIST` when an identity already exists.
      3. It unlinks the temporary file either way.
    - So a reader never sees a partial file. A process that loses the race reads the winner's complete file. A crash before the link leaves only a stray temporary file, which the next start deletes (any `machine.json.*` older than a minute).
    - Rejected: `open(…, 'wx')` then write. That exposes an empty or partial file to a racing reader, and leaves a profile unable to start after a crash mid-write.
    - A `machine.json` that exists but does not parse, or whose ref breaks the format, stops startup with an error naming the path. Re-minting would silently re-address everything persisted under the old ref.
    - Nothing ever rewrites the file.
  - The interface O2 shares (P5 Decision Log 27). `<userData>` is the profile's root, O2's `<profile>`, never its `mawsd/` directory. This file, its shape and these rules are how a profile's identity survives O2 and O3:
    - O2's `mawsd` reads and mints it through the same module, `src/shared/machine/identity-file.ts`, so whichever of the app and `mawsd` runs first in a profile mints it, and the link makes that race safe without a shared lock;
    - O3's data-directory migration moves it with the index.
  - Rejected: minting in memory and reporting it only through `machine.identity`. The ref has to exist before the first window opens (M2 hands it to the preload), and a crash before the write would mint twice.
- **The machine's name.** It is `MAWS_MACHINE_NAME` when that is set, else the short hostname (`os.hostname()` up to its first `.`).
  - It is a display attribute, never an identity. Once the machine is enrolled, the name is shown from the org state (OX2), which is O8's and O11's.
  - Two profiles on one Mac share a hostname, so the e2e names each profile.
- **`machine.identity`.**
  - Input `void`, output `MachineIdentity` (Interfaces), owner `machine`, grade `list` (a listing read, like `session.list`). Record the grade as an O1 rubric line.
  - It is the first production `machine`-owned command. It joins the manifest as an additive command, so `WIRE_MINOR` goes up by one.
  - Until M5, `project` is the machine project, `{ key: 'machine:<ref>', name: <the machine's name>, smnsId: null }`. M5 fills `smnsId` for an enrolled machine, which no machine is until O10.
- **The codec.** `src/shared/machine/address.ts` is the only module that joins or splits an address.
  - An address is `<ref>/<bare>`: the first `/` separates them, and the bare part may contain `/`.
  - `MachineRefSchema` excludes `/` (RL5's alphabet has none).
  - Every other module goes through `addressOf`, `machineOf`, `bareOf` and `isAddress`. A reviewer refuses string surgery on ids elsewhere.
- **What is lifted.**
  - Four id kinds are machine-bound and are what stores and routing key by: `AppSessionIdSchema`, `ProjectIdSchema`, `PtyIdSchema` and `AttentionIdSchema`.
    - An `AttentionId` embeds its `AppSessionId` as a prefix (`src/engine-host/broker.ts`), so prefixing the machine keeps that true.
  - Not lifted:
    - the engine's `SessionId`. Commands keyed by it alone (`fs.sessionText`, `fs.holders`, `settings.usage`) take an explicit machine (M4);
    - `EventId`, which is scoped by its session and sits on the hot path inside `session.eventBatch`;
    - within-session ids (`ToolUseId`, `RequestId`, `MessageUuid`, `AgentId`, `TaskId`), each of which travels beside its `appSessionId`;
    - artifact ids. Engine text names them (`maws-artifact:<id>`), so they are resolved by context: the session's machine, or the tab's `machine` field (M2).
  - Rejected: lifting every machine-scoped id. It puts a rewrite inside every engine frame on the delta path that OX7 measures, and it cannot reach ids written in free text.
- **Compiling a schema.**
  - `compileAddressing(schema)` walks the zod 4 definition tree once (`schema._zod.def`; check it against the pinned zod, never from memory). It records where the four schema instances occur:
    - object properties;
    - array and tuple elements;
    - record keys and values;
    - optional, nullable, default, readonly and catch wrappers;
    - `pipe`: the input side for lowering, the output side for lifting;
    - `lazy`, memoised, so recursive schemas terminate;
    - discriminated unions, dispatched by the discriminator;
    - plain unions.
  - The plain-union rule:
    - a key is rewritten at a path when every option that has that key at that path agrees it is one of the four kinds;
    - options that disagree make compilation throw, naming the path;
    - so lifting a plain union applies the union of its options' rewrites to whichever keys are present.
  - Branches with no id compile to the identity, so an id-free schema costs nothing.
  - The result is two functions:
    - `lift(value, machine)` returns a new value with each id `x` replaced by `addressOf(machine, x)`;
    - `lower(value)` returns `{ value, machines }`, with each address replaced by its bare id and every machine it named collected.
  - A value already lifted, or a bare id met while lowering, is a programming error, and both functions throw. Lifting returns a copy along the touched paths only; untouched subtrees are shared.
- **Coverage** (P5 Decision Log 21's condition). `coverage.test.ts` walks every command's input and output and every event payload in `REGISTRY` (**needs O1**). It fails on:
  - an object key named like a machine-bound id whose schema is not one of the four. The key names are `appSessionId(s)`, `appId`, `parentAppSessionId`, `projectId(s)`, `ptyId(s)`, `attentionId(s)`, and any key ending in `AppSessionId`, `ProjectId`, `PtyId` or `AttentionId`;
  - a `z.record` whose key schema is a plain string, unless `REVIEWED_STRING_RECORDS` lists its path with what its keys are. A record keyed by session ids, such as `browser.tabs.list`'s `selected`, gets a branded key schema instead;
  - a plain union whose options disagree;
  - any difference from the committed snapshot of addressed paths, `src/shared/machine/address-paths.json`. It lists, per command input, command output and event, every path at which one of the four kinds is lifted, as the compile step found them.
    - The name rule cannot see a machine id held in a field named `id` or by its role. Examples are `ProjectRecord.id`, `AttentionItem.id` and `LaunchSpec.inheritGrantsFrom`. If such a field were re-typed as a plain string, its path would vanish from the snapshot, and the test would fail.
    - A change that adds an addressed path shows it in the snapshot's diff for review. The snapshot is rewritten only with `MAWS_ADDRESS_PATHS_WRITE=1`.
  - Tests against fixture schemas show that an unbranded `appSessionId` field fails the name rule.
  - Three mutations show that the snapshot catches the role-named and `id` escapes (Concrete Steps 9). Each re-types one field as a plain `z.string()`: `ProjectRecordSchema.id`, `AttentionItemSchema.id` or `inheritGrantsFrom`.
- **Fixing what coverage finds, with no wire change.** Every field and record key the test names is re-typed in M1, so the test is green at M1's end.
  - The canonical schemas check `min(1)` (`AppSessionIdSchema` and the other two from `brandedId`). A field that is a plain `z.string()` today is re-typed with a loose alias instead: `LooseAppSessionIdSchema = z.string().brand<'AppSessionId'>()` beside the canonical one in `src/shared/graph/ids.ts`, and likewise for the others it needs. `PtyIdSchema` is already loose.
  - A brand is type-only, so the alias renders the same JSON Schema as the plain string. `wireFingerprint()` and the manifest do not move (Concrete Steps 8).
  - `ADDRESSED_SCHEMAS` holds the canonical instances and their aliases.
  - Rejected: re-typing with the canonical schema. Its `minLength` would change the JSON Schema of engine-host fields, which O1's rule classes as breaking and the fingerprint would show.

**Does not touch.** The renderer, preload and router (M2). Any store. The index.

**Proves.** Acceptance 2, and acceptance 3's codec and coverage parts.
- `address.test.ts` covers the following:
  - compilation of every command input and output, and every event payload, in the registry, none throwing;
  - round trips on fixture schemas for each construct the compile step names;
  - round trips on one real value per payload family the renderer receives most: a `SessionRecord`, a `ProjectRecord`, an `AttentionItem`, a `PtyInfo` and a `session.eventBatch`, each built with the repository's existing test builders;
  - the nested and recursive cases (a lazy tree, a record keyed by an id, a discriminated union carrying ids in one option);
  - lowering a value that names two machines, which reports both;
  - the throw on double lifting.
- `identity.test.ts` is listed under acceptance 2.

### M2 — Addresses across the boundary, one machine

**At its end.** The page holds only addresses, and the local machine's ref is the only machine. With one machine, nothing behaves differently except the persisted keys.
- **The preload** passes a machine with every invoke and delivers it with every event. It also exposes the local machine's ref as `window.maws.localMachine`.
- **The router** accepts the machine. In M2 a non-local machine answers `host_unavailable`; the connection manager arrives in M3.
- **`emit`** stamps every event with the local ref.
- **The renderer client** lowers every input, routes it, lifts every output and event, and refuses mixed or missing machines.
- **The layout** migrates once to addresses, and main's readers of layout content understand them.
- **The e2e specs** that compare DOM or layout ids address them.

**Touches.**
- `src/preload/bridge.ts`, `src/preload/index.ts`, `src/main/window.ts` (`additionalArguments`);
- `src/shared/ipc/schema.ts` (the `MawsBridge` and `PreloadBridge` types);
- `src/main/ipc/router.ts`, `src/main/ipc/events.ts`;
- `src/renderer/src/ipc/client.ts`, `client.test.ts`;
- `src/shared/ipc/routes.ts` (new: the route classes);
- `src/shared/ipc/schema/layout.ts` (the versions and migrations below), `src/renderer/src/stores/layout.ts`, `layout-model.ts` and their tests;
- `src/main/layout/store.ts` (the panel-key check and drop), `src/main/layout/open-session-tabs.ts`;
- `src/renderer/src/app/scenario-session-creator.ts`;
- `e2e/shell.spec.ts` (the migration scene);
- `e2e/support/address.ts` (new), and the e2e specs and helpers that build tab ids or read layout values. At the base, about 47 tab-id constructions in about 25 files, and 11 files that call `layout.get`.

**Decisions.**
- **The local ref reaches the page synchronously.**
  - Main passes `--maws-local-machine=<ref>` in every app window's `webPreferences.additionalArguments`. The preload reads it from `process.argv` and exposes it as `window.maws.localMachine`.
  - Rejected: an async `machines.list` read before the first command. Every module-level caller would have to wait for it, and the layout migration needs the ref at hydrate.
- **The preload.**
  - Commands: `invoke(name, input, machine?)` sends `ipcRenderer.invoke(channel, input, machine)`.
  - Events: listeners receive `(payload, machine)`, and main sends `webContents.send(channel, payload, machine)`.
  - The preload checks nothing about the machine; main's router validates it with `MachineRefSchema`.
  - **An invoke with no machine is the local machine's.** This is the raw bridge's convenience for e2e specs and harness pages, which call `window.maws` with bare ids. The renderer client always passes one.
  - Rejected: requiring the machine on the raw bridge, which would edit about 50 e2e files to pass the local ref for nothing.
- **Route classes** (`src/shared/ipc/routes.ts`), computed once from the registry and O1's grades (**needs O1**: `gradeOf`).
  - **`client`**: a command graded with the routing class `client` (O1 M4) is answered by the local app.
    - The machine its addressed ids name is handed to main's handler as `ctx.target`.
    - When that target is another machine, the router answers `host_unavailable` with the message "not available for a session on another machine yet", and no handler runs. At O1's rubric these are `browser.*`, `attention.pendingNavigate`, `presentations.present`, `artifacts.downloadAsset`, `library.saveAs` and whichever reveal and open commands O1 grades `client`. An app effect has no app to run in on another machine.
    - The one exception is `attention.viewing`, which the router answers with no effect, since its only effect is the local notifier's.
    - A reveal or open command that O1 grades machine-bound routes to its machine like any other. On the stand-in that is B's Finder; record it in Surprises.
  - **`addressed`**: the input schema always carries at least one of the four kinds. The command goes to the machine those addresses name.
  - **`path`**: the input carries none of the four on some valid input, and carries a machine path. Path keys are the survey's: `path`, `paths`, `cwd`, `directory`, `directories`, `additionalDirectories`, `repoRoot`, `root`, `projectPath`, `linkedDir`, `binaryPath`, `files`, `filename` and `location`. The same holds for an engine-`SessionId`-only command. These need an explicit machine.
  - **`machine-wide`**: everything else, which carries neither. These default to the local machine. They are machine-wide reads and writes (`settings.*`, `plugins.*`, `connectors.*`, `library.*`, `catalog.*`, ...) whose surfaces stay the local machine's until their own child spans machines.
  - A test pins each class's list against the registry, so a new command lands in a class its author sees. A zod-free const list of the `path` names feeds the type below.
  - Rejected: an explicit machine on every id-less command. That edits about 150 sites to pass the local ref, for surfaces that are local until O3, O4 and O7.
- **The renderer client.**
  - It computes the machine:
    - from the addresses in the input: all must agree, else `invalid_input` with a `console.error` naming every machine. Nothing is sent;
    - else from `opts.machine`. An explicit machine that disagrees with the input's addresses is refused the same way;
    - else, for `path` commands, the local ref in M2, and from M4 `invalid_input` "names no machine" (see Typing);
    - else the local ref.
  - It then lowers the input and calls `bridge.invoke(name, lowered, machine)`. On success it validates the output as today, then lifts it with the same machine. An event is validated, then lifted with the machine it arrived with.
  - The validation order is decided: validate on the bare form, then lift. The schemas admit both forms, but this order keeps every error message bare-id, as main logged it.
  - Every machine-bound command passes through the codec, and so does every output and event. The local machine is no exception: its ids are lifted like any other's.
- **Typing.**
  - `MawsBridge.invoke(name, input, ...rest)` takes `[opts: { machine: MachineRef }]` when `name` is a `path` command, else `[opts?: InvokeOptions]`.
  - In M2, `path` commands still compile without the option: the required form is switched on in M4, together with the sites that pass it. Until then a `path` command with no machine goes to the local machine and logs nothing.
  - Listeners gain a second parameter, `from: { machine: MachineRef }`. Existing listeners ignore it.
  - The wrappers `useEngineRead`, `useCommand`, `useOperation`, `usePluginsRead` and `invokeRead` forward `opts`. Their query keys include the machine for `path` and `machine-wide` commands, and `addressed` commands already key by their addressed input.
- **No new error codes.** An unreachable machine answers `host_unavailable`, and a missing or mixed machine answers `invalid_input` (Constraints).
- **The router and `emit`** (**needs O1**: `createRouter`, `HandlerContext`).
  - The router validates the machine argument and treats an absent one as local. `MainContext` gains `target: MachineRef`.
  - For a non-local machine, M2's router answers `host_unavailable`. M3 replaces that with the connection manager.
  - `emit` and `emitTo` send the local ref as the event's machine.
  - `emitFrom(machine, name, payload)` (new) sends a remote machine's event to the windows. It validates as `emit` does and calls no `onEmitted` tap: main's own services must never hear another machine's events.
- **Main's readers of layout content.** Each understands addresses and acts only on the local machine's:
  - `open-session-tabs.ts` (the sweep) reads version 3 and keeps the local machine's sessions, lowered;
  - `layout/store.ts`'s `panel.<address>` check accepts another machine's key unchecked, and checks a local one against `known(bareOf(...))`. A bare `panel.<id>` key is still read as the local machine's, so the migration can read it and an e2e spec can write it through the raw bridge;
  - its removed-session drop deletes `panel.<localRef>/<id>`;
  - `sessions/panel-lifetime.ts` does the same.
  - The renderer drops another machine's panel keys itself, when that machine reports a removal (M4).
- **The layout migration** (`StoredMainSchema` and friends, renderer-side, in the readers' preprocess). It lifts every bare id with the local ref, since every pre-O6 id is local. Each key whose meaning changes takes a version.

  | Key | From | To |
  |---|---|---|
  | `main.tabs` | version 2 (version 1 still read) | version 3. Every tab's `appSessionId` becomes an address. `file` and `artifact` tabs gain `machine: MachineRef`. Tab ids are recomputed by `tabId()`: `session:<address>`, `file:<machine>:<path>`, `artifact:<machine>:<artifactId>`. `sets` keys and `current` that are project ids become addresses. `closedTabs` is converted the same way. |
  | `regions` | version 4 | version 5. `expandedProjects` entries that are project ids become addresses. `'other'` stays until M5. `floatingCard` keys that are main-tab ids are recomputed. |
  | `panel.<appSessionId>` | bare key | `panel.<address>`, written, then the bare key deleted with `layout.set(key, null)`. Add that deletion to `layout.set` if it lacks one, as `store.delete`. |
  | `panelTools.surfaces` | version 1 | version 2. `stacks` keys that are session ids, and every value of `contexts` and its project keys, become addresses. |
  | `sessions.attachTabs` | version 1 | version 2, with addresses. |
  | `panelTools.params` | version 1 | unchanged. A tool that persisted an addressed id in its params lifts it in its own reader. The Artifacts tool's record is the one known case: an artifact id gains its machine. |

  - Version 3's `file` tab carries its machine because the same path on two machines is two files. Rejected: deriving it from the tab's `appSessionId`, which is null for a file opened from no session.
  - The downgrade cost is written in the schema comment: an older build rejects version 3 and opens its default tabs, as it does for a floating set (P4-B3).
  - Rejected: keeping bare tab ids. Two machines holding one id would merge into one tab, and OX2 has the layout's keys carry the machine.
- **Drafts stay on their session's machine.**
  - `session.drafts.get` and `session.drafts.set` are `addressed`, so a draft is read and written in its session's machine's index, keyed there by the bare id. Nothing migrates on disk.
  - This is OX2's "drafts key by it": the draft is addressed by `{machine, id}`, and the machine keeps it under its own id.
  - Rejected: moving drafts into the client keyed by address. It would split a draft from the record its store checks (`DraftStore.requireSession`), migrate rows out of `index.sqlite`, and lose a draft typed on one device and continued on another.
- **Ids the renderer mints.** Every id the renderer mints for itself is an address of the local machine, built with `addressOf(window.maws.localMachine, …)`. Fixed ids are built once at module initialisation. An id drawn per use is built where it is drawn. The lowerer throws on a bare id, so a missed one breaks its feature even with one machine. At the base these are:
  - the scenario creator's `app-new-<uuid>`. Its UUID is still drawn inside the creation callback, once per new session, and addressed there. A test creates two in a row and expects two distinct addresses;
  - the synthetic pty owners, which reach `pty.spawn.appSessionId` through the terminal registry or directly:
    - `ENGINE_UPDATE_OWNER` (`src/renderer/src/settings-tab/engine-update.ts`);
    - `GWS_OWNER` (`src/renderer/src/delivery/SendToSheet.tsx`);
    - `DIAGNOSTICS_SESSION` (`src/renderer/src/stores/echo.ts`);
  - the harness pages' fixtures (`PROBE_SESSION`, `REGISTRY_SESSION`, the document harness's two).
  - Find the full set with `rg "'[^']+' as (AppSessionId|ProjectId|PtyId|AttentionId)" src/renderer/src`, excluding tests. A literal that never crosses IPC, such as `transcript/dev/journal.ts`'s local normaliser, stays as it is, with a comment saying so.
  - The engine update terminal, the Drive setup terminal and the pty echo diagnostics each keep their spawn path working: a unit test per owner through the terminal registry, and `e2e:settings` for the engine update.
- **The e2e adaptation.**
  - `e2e/support/address.ts` exports two helpers:
    - `localRef(page)`, read once per launch through `window.maws.invoke('machine.identity')`;
    - `addressed(page, id)`.
  - Specs that compare a DOM tab id or a stored layout value with a bare id from the raw bridge use them. Nothing else in a spec changes.

**Does not touch.** Per-machine store logic (M4). Any second machine (M3). The sidebar's grouping (M5).

**Proves.**
- Acceptance 1 (the bench at M2's commit included), acceptance 3's page and refusal parts, and acceptance 4.
- `client.test.ts` pins:
  - lowering, routing and lifting for each route class;
  - the two refusals, with nothing sent;
  - a `client` command's `ctx.target`;
  - an event with no machine read as local.
- `layout-persist.test.ts` gains the version-2 fixture with bare ids, restored, written back at version 3, and idempotent on a second read.
- `open-session-tabs.test.ts` reads version 3.
- `e2e/shell.spec.ts` gains the upgrade scene (acceptance 4).
  - First launch: it seeds sessions, then reads their bare ids through the raw bridge.
  - Through the raw bridge it writes three things:
    - a version-2 `main.tabs` with a session tab and a file tab;
    - a bare `panel.<id>` key;
    - a draft (`session.drafts.set`).
  - It then quits and relaunches over the profile.
  - After the relaunch: the tabs, the panel tab and the draft are back, and `layout.get('main.tabs')` answers version 3 with addresses.
  - A third launch rewrites nothing.
- Hosted e2e: `shell`, `sessions`, `panel`, `transcript`, `code`, `scm`, `layout-transfer`, `side`, `agents`, `tools`, `statusline`, `c7`, `supervisor`, and every group whose spec the adaptation touched.
- The mini: `e2e:local-latency` at M2's commit, and `e2e:default`.

### M3 — Machine links and the second-profile stand-in

**At its end.**
- **A connection manager in main** holds one link per machine: the local, in-process one, plus a connect-only socket link for every other profile's serve directory that `MAWS_LOCAL_MACHINES` names.
  - The router dispatches non-local machines through it.
  - Events from a link reach the windows with that link's machine.
  - `machines.list` and `machines.changed` report every known machine with its state.
- **A profile started with `MAWS_MACHINE_SERVE=1`**, in a build that is not packaged, serves its machine services on a same-uid socket on protocol 3: every machine-bound command through its router, and every link event through an `onEmitted` tap.
- **One e2e scene** shows A reaching B's sessions through the link.

**Touches.**
- `src/main/machines/manager.ts`, `local-link.ts`, `socket-link.ts`, `known-machines.ts`, `link-surface.ts`, `config.ts` (new);
- `src/main/machines/serve-standin.ts`, `serve-gate.ts` (new; **O3 deletes both**: one header comment says so, and names this document);
- their tests;
- `src/shared/ipc/schema/machines.ts`, `names/machines.ts`, `grades/machines.ts` (new);
- `src/main/ipc/router.ts` (`Router.dispatchLocal`; the non-local branch);
- `src/shared/host/socket-server.ts` (an `admit` option; **needs O1** for the v3 server);
- `src/main/index.ts` (composition);
- `e2e/machines.spec.ts` (new);
- `package.json` (`e2e:machines`), `.github/workflows/gate.yml` (`CLASS1_E2E`), and whatever `.github/scripts/gate-plan.test.mjs` then requires. The group joins `HOSTED_MAC_E2E` only by gate-offload's admission rule: three green `Lane: hosted` runs with it listed, on one tree, whose count lines equal a `Lane: no-hosted` run's. Record those run ids in Outcomes; the architect writes the gate-offload Decision Log entry (P5 Decision Log 27).

**Decisions.**
- **The link surface** (`link-surface.ts`). It is the same for the stand-in, for O3's `mawsd` and for O7's channels.
  - Commands: every command whose route class is not `client`, plus no `internal` one, presented with owner `machine`. This is a derived `WireRegistry` (**needs O1**: `WireRegistry`, injectable into `createHostRuntime` and the codec).
  - Events: the link events. An event is a link event when its payload names a session, a pty or a path in a session's checkout, or reports the machine's engine or pty host:
    - `session.*`;
    - `attention.changed`;
    - `engine.hostState`, `pty.hostState`, `pty.data`, `pty.exit`;
    - `fs.*`;
    - `git.changed`, `files.changed`;
    - `scm.remote.output`;
    - `ownerChannel.changed`, if its payload names a session; record which it is.
  - Every other event is the app's own until the child that spans its surface moves it: `layout.*`, `voice.*`, `browser.*`, `attention.navigate`, `attention.notified`, `maws.*` (the host-to-app bridges, which B's own app answers), `settings.*`, `catalog.*`, `connectors.*`, `delivery.*`, `library.*`, `spaces.*`, `artifacts.*`, `plugins.*`, `engine.budget`, `host.status` and `host.supervisorStatus`.
  - `link-surface.test.ts` keeps `LINK_EVENTS` and `CLIENT_EVENTS` a partition of the registry's events.
  - The main-owned schemas on the link are outside the manifest (Constraints).
- **The local link** dispatches through the router's own local path, so behaviour with one machine stays M2's.
- **The socket link** (`socket-link.ts`) never starts, replaces, stops or kills the far side, and never sends `exit`. Survey §4.2: a client must never stop a shared daemon.
  - **Connecting.** It connects to `<dir>/machine.sock`, reads the token from `<dir>/machine.token`, sends O1's v3 hello and serves O1's envelope through `SocketPort` (**needs O1**: `ClientHelloSchema` v3, `ServerWelcomeSchema` v3, `SocketPort`, the tolerant readers, `codecOf(registry)`).
  - **Identity.** At welcome it asks `machine.identity`. A ref that differs from the one `known-machines.json` holds for this directory is logged and adopted: the directory now holds another profile.
  - **Requests.** Each request carries the asking page's `ClientRef` id in `req.client`, and the page's end is relayed as `clientGone`. The sending side is O1's `src/shared/host/client-refs.ts` (**needs O1**).
  - **States.** A link is `connecting`, `up` or `down`.
    - A close or a failed connect is `down`, then a retry every 1 s for the first minute and every 2 s after. A failed connect to a local socket costs microseconds, and acceptance 6 wants a returning machine back within 5 s.
    - A request to a machine not `up` answers `host_unavailable` at once. It is not held: a held request to an absent machine would hang the page's action.
  - **The log line at connect** names the far build, wire version and ref, and says that main-owned commands cross unversioned.
- **Known machines** (`known-machines.ts`). The client keeps `<userData>/known-machines.json`, holding `{ version: 1, machines: [{ ref, name, carrier: { kind: 'socket', dir } }] }`. Its rules:
  - it is rewritten when a link learns or changes an identity;
  - `machines.list` lists every entry from launch, as `connecting`, before any link is up, so the layout can tell a known machine that is down from one no longer configured (M4);
  - an entry whose carrier is no longer configured is dropped at launch;
  - O10 and O11 add carriers and sources (the org state, RL2 endpoints).
  - Rejected: listing only connected machines. A relaunch with B down would then drop B's tabs, which acceptance 7 forbids.
- **Configuration** (`config.ts`). `MAWS_LOCAL_MACHINES` is a `:`-separated list of serve directories. It is honoured only when the build is not packaged, like the serve gate, and otherwise ignored with one log line. In production, until O10, the manager holds only the local machine.
- **The stand-in** (`serve-standin.ts`, gated by `serve-gate.ts`). P5 Decision Log 21's conditions are its rules.
  - **The gate.** `machineServeAllowed({ packaged, env })` is false whenever `packaged` is true, and otherwise requires `MAWS_MACHINE_SERVE=1`. The composition root constructs the adapter only behind it, and `serve-gate.test.ts` pins the packaged case for every combination of the variables.
  - **The directory and its files.** The adapter uses `<userData>/machine-serve/`, which it creates or corrects to 0700 after an `lstat` that refuses a symlink. It holds:
    - `machine.token`: 32 random bytes as hex, 0600, written through a temporary file and a rename, as `src/engine-host/detached.ts` writes its token;
    - `machine.sock`: chmod 0600 after `listen`.
  - **The peer check.** Every accepted socket is checked before the server reads a byte. The check uses the peer-auth addon: `loadPeerAddon`, `socketFd` and `peer(fd).uid` from `src/main/browser/cua/peer.ts`, with the path from `peerAddonPath`.
    - A uid other than `process.getuid()` is destroyed.
    - No addon means every peer is refused. It fails closed, and logs once.
    - The check enters O1's socket server as an `admit(socket): boolean` option, consulted on `connection` before the hello timer starts. The supervisor passes none.
  - **What it serves.** It runs `createHostRuntime` over the link surface's registry (**needs O1**). Its register callback receives `on` and `emit`, as `HostRegister` does at the base (`src/shared/host/runtime.ts`), and the adapter keeps both.
    - Each command is registered with `on(name, handler)`. The handler awaits `router.dispatchLocal(name, input, { client: ctx.client, target: localRef })`, which is the router's route minus the sender check, with the runtime's remote `ClientRef`. Add `dispatchLocal` to `Router` for this.
    - `dispatchLocal` answers a `CommandResult` envelope, but a host handler must answer the bare output and fail by throwing (O1 M5's `HostOn<R>`). So the handler returns `result.value` on success, and on failure throws `new HostCommandError(result.error)`, keeping the `IpcError` whole (O1 M5: one typed failure for both roots).
    - Each link event is tapped with `onEmitted` and sent with the kept `emit`. The runtime object itself exposes no `emit`.
    - `serve-standin.test.ts` drives the real adapter, over a real socket, against a router that has a main handler registered. It checks:
      - a success's output;
      - a typed failure (`CommandFailure` with `timeout`) arriving at A's link with the same `IpcError`;
      - an emitted event reaching the link.
    - The server's `onExit` ignores `exit`: a client never stops this machine.
    - One client at a time, as O1's server does. Two clients are O3's RL3.
    - The welcome's `liveSessions` and `rows` are B's supervisor's counts, or 0 when its host is utility.
    - A machine-bound command that reaches B's client port shows its dialog or notice in B's app, since O1's Electron port draws unparented UI for a ref with no page. O3's `mawsd` answers `noClient` instead. The stand-in accepts this, as it runs only in tests and dev runs; no O6 surface calls such a command for another machine.
  - **The swap at O3.** O3 deletes `serve-standin.ts` and `serve-gate.ts`. Profile B's private `mawsd` (O2's per-profile daemon) then serves the same link surface from its own directory, and the e2e scene starts that daemon instead of a second app. The connection manager, the socket link, the link surface, known machines and every renderer change stay as they are.
- **`machines.list` and `machines.changed`.** Both are main-owned, graded `client` (the app's connection manager), and part of no link.

**Does not touch.** Per-machine reconciliation in the stores (M4): until M4, B's records are not yet partitioned, which only a configured second machine exposes. The sidebar (M5). RL2 (O7, O10).

**Proves.** Acceptance 9.
- `socket-link.test.ts` runs O1's real socket server and runtime in one process against a fixture registry. It pins:
  - connect, then `up`;
  - a request with its `client` id, and `clientGone` on the page's end;
  - an event delivered with the link's machine;
  - close, then `down`, then backoff;
  - a request while `down` answering `host_unavailable` at once;
  - no `exit` ever sent.
- `serve-standin.test.ts` pins the modes, the symlink refusal, and the peer check with a fake addon: another uid, then no addon.
- `manager.test.ts` pins dispatch by machine and `machines.changed` on each transition.
- `e2e/machines.spec.ts`'s first scene launches B with `MAWS_MACHINE_SERVE=1`, `MAWS_MACHINE_NAME=standin-b` and one seeded session (`seedTranscripts`, `e2e/support/maws-tools.ts`). It then launches A with `MAWS_LOCAL_MACHINES=<B userData>/machine-serve` and checks that:
  - `machines.list` shows B `up` with B's ref;
  - `window.maws.invoke('session.list', {}, <B ref>)` lists B's seeded session and not A's;
  - closing B turns B `down` within 2 s.

### M4 — Per-machine stores, the shell per machine, explicit machines for paths

**At its end.**
- **Each machine's records live in their own partition.** Every store that a machine feeds reconciles per machine:
  - a machine's snapshot replaces that machine's records only;
  - its revisions are judged against its own counter;
  - its host's departure forgets its statuses only;
  - its link going down marks its partition offline while keeping its records.
- **The shell runs per machine.** `connectShell` subscribes once and snapshots each machine when its link comes up. The layout hydrates after the local machine's snapshot. It keeps tabs of known machines that are not yet loaded, and settles each machine's tabs after its first snapshot.
- **Path-keyed stores key by machine and path.**
- **Every `path` command names its machine at the type level**, and every one of its call sites passes the machine of the session or project it is about.
- **A's sidebar shows B's sessions.** They appear under B's projects as rows of their own, since M5 groups them.

**Touches.**
- `src/renderer/src/stores/machines.ts` (new: `useMachines`);
- `stores/sessions.ts`, `stores/attention.ts`, `stores/hosts.ts`, `ipc/events.ts` (`connectShell` and the other connectors there), `stores/layout.ts` (known and settle);
- `stores/git.ts`, `stores/git-diagnostics.ts`, `tools/code/files/store.ts`, `tools/code/viewer/viewer-store.ts`, `terminal/registry.ts`;
- their tests;
- the `path` call sites. At the base they are 63 sites in about 37 files: `research/org/scripts/scan2.py`'s list minus the five `client` commands. Rerun it as Concrete Steps says, since it is the executor's checklist.

**Decisions.**
- **One store per kind, partitioned inside.** Today's store factories stay single stores with the shapes their consumers read: `records: Map<AppSessionId, SessionRecord>`, whose keys are now addresses. The reconciliation state is partitioned per machine:
  - `listRevision`, `projectsRevision`, the tombstones and `recordRevs` are kept per machine;
  - `known(id)` reads the id's own machine's;
  - `applyList(snapshot, machine)` removes only that machine's records that the snapshot does not list;
  - `applyProjects(list, machine)` replaces only that machine's projects;
  - `applyStatuses(statuses, machine)` and `forgetStatuses(machine)` act on one machine;
  - the attention store's `beginSnapshot(machine)` and `applySnapshot(items, machine)` buffer and replace per machine;
  - `useHosts` keeps one `{ engine, pty }` per machine. `supervisor` (`host.status`) stays the local machine's.
- **Membership is never parsed from id strings.** The store records the machine each id was written for, from the call that wrote it.
- **Each link generation starts its counters afresh.** A machine's counters belong to its process: the index counter starts at 0 in every main (`src/main/index/index.ts`, `stamped = 0`), and so do the read model's digest revisions. So B restarted answers revision 5 where A's partition remembers 900, and would be refused for good.
  - Every `up` of a non-local machine opens a new **generation**. `MachineState.generation` is incremented by main's connection manager on each welcome, and is sent in `machines.changed` before any event of the new connection is relayed. Electron delivers one window's IPC messages in order.
  - On a new generation, the partition resets everything it reconciles by:
    - `recordRevs` and the tombstones;
    - `listRevision` and `projectsRevision`;
    - the digest revisions and `forgottenDigestRevs`;
    - the attention snapshot's buffer;
    - `connectShell`'s queued events for that machine, which are dropped.
  - It keeps its records, digests and attention for display, and the generation's first snapshot then replaces them authoritatively: what the snapshot does not list goes. Events of the new generation that race that snapshot are reconciled against the fresh counters, as today.
  - The local machine's generation never changes: its services share the app's process.
  - Rejected: keeping counters across reconnects. A restarted machine's lower counters would freeze its rows.
- **The API change.** Every apply method that needs a machine takes it explicitly, and the tests name one.
- **Rejected for the partitioning:** a store instance per machine with a merged view, which would make each of about 145 consumer files choose a partition.
- **`useMachines`** holds `{ ref, name, local, state: 'connecting' | 'up' | 'down', generation, loaded }` per machine. It is fed by `machines.list` and `machines.changed`.
  - A machine whose state is not `up` is offline.
  - Its records, digests and attention stay as last known.
  - Its statuses are forgotten as on a host departure: a down link took its host along (E10's rule).
  - Its `loaded` is false until its first snapshot of this run. A new generation keeps `loaded` true, since its records are still displayed.
- **`connectShell` per machine.**
  - The event subscriptions are made once and route each event to its machine's partition through the listener's `from.machine`.
  - For each machine, on `up`, it runs the snapshot reads, `ipc.invoke(name, input, { machine })` for `session.list`, `session.projects.list`, `session.digests`, `attention.list` and `engine.sessions`, under today's ordering rule (subscribed first, then the snapshot reconciled with the events that raced it).
  - Each machine's reads have their own freshness stamp, so a reply from a link that has since gone down applies nothing.
  - `engine.hostState` from machine *m* forgets *m*'s statuses only, and re-reads *m*'s `engine.sessions` on regaining ready. That ends survey §7.11's blanking.
  - A non-local machine's `engine.hostState` is unknown until its first event, and counts as ready while its link is `up`.
- **The layout across machines.** Hydration waits for two things: the local machine's snapshot, and the first answer to `machines.list` (the roster). `known(address)` then decides each tab:
  - the local machine's: as today;
  - a machine in the roster that has not loaded this run: kept;
  - a machine absent from an answered roster: dropped, because it is no longer configured.
  - **The roster has three states:** not yet read, answered, or failed. A failed or missing roster is never an absence: every non-local tab is kept until a roster answers.
  - Rejected: reading the roster independently of hydration. The local reads can finish first, and a persisted machine that is down would then look unconfigured and lose its tabs.
  - `settleMachine(machine)` (new) runs after the first snapshot of each of a machine's generations. It drops that machine's tabs and `panel.<address>` keys whose session it does not list, unless the registered tab retention keeps them.
  - Removals during the run arrive as events and drop tabs as today, and the renderer deletes a non-local `panel.<address>` key on its removal.
- **Path-keyed stores.**
  - `useGit`, `useFiles`, `useViewer` and `useGitDiagnostics` key by `checkoutKey(machine, path)`, which is the codec's `addressOf(machine, path)`: the codec owns this join too. Their watch, unwatch and diff calls pass the machine.
  - `git.changed` and `files.changed` events apply to the key of the event's machine.
  - `connectPanelEvents`' scm invalidation compares the session's machine as well as the repository root.
  - The terminal registry already keys by lifted `ptyId`. Its `pty.spawn` carries the session's address, so its route is `addressed`.
- **Explicit machines** (P5 §3: "the 75 that carry only a path take an explicit machine"). The `path` class's required form is switched on, and every site passes `{ machine }`:
  - the machine of the session or project the call is about, from the address in scope (`machineOf(appSessionId)`, `machineOf(projectId)`);
  - else, where the surface is about no session or project, `window.maws.localMachine`. Those surfaces are the Engine settings section, the plugin and marketplace widgets outside a session, Discover's `catalog.*`, the library's `spaces.*` and `artifacts.create`, Add project, Hidden projects, Make something new, and replay diagnostics.
  - "+ Session"'s setup intent (`useSetupIntent.ts`: `session.trust.check`, `git.worktree.list`, `engine.models`, `session.projects.addFolder`) passes the intent's machine, which is the local ref until O7's picker. The intent gains no field in O6.
  - `fs.sessionText`, `fs.holders` and `settings.usage` pass the machine of the session in scope, else the local ref.
- **The Overview, Needs you, the palette and the resume chooser** read the stores' union and span machines with no change of their own. The routing of their actions is already addressed.

**Does not touch.** Org projects and the sidebar's grouping (M5). Main's notifier and badge (Constraints).

**Proves.**
- Acceptance 6's store half, and acceptance 8.
- `sessions.test.ts` and `attention.test.ts` gain two-machine cases:
  - machine B's snapshot at revision 5 is applied while A's counter is at 900;
  - B's list removes none of A's records;
  - a stale B event after B's newer snapshot is refused;
  - `forgetStatuses(B)` keeps A's.
- `events.test.ts` pins `connectShell` with two fake machines:
  - per-machine snapshots on `up`;
  - an event routed by `from.machine`;
  - a down link leaving the records and dropping the statuses;
  - an up link re-snapshotting with no duplicate.
- `sessions.test.ts`, `attention.test.ts` and `events.test.ts` also pin B restarting. B comes back as a new generation with lower counters, one record changed and one deleted. The new snapshot replaces B's partition: the changed record is shown, the deleted one is gone, and a queued event of the old generation is dropped.
- `layout.test.ts` pins the three `known` cases, `settleMachine`, and the roster barrier. In that case the roster answers after the local snapshot and the layout reads, B is down, and its persisted tab survives. A failed roster keeps it too.
- `git.test.ts` keeps two machines' identical paths apart.
- `e2e/machines.spec.ts` gains a scene: B's seeded session in A's sidebar, and opening it in A showing B's transcript and B's panel branch.

### M5 — Org projects and the sidebar

**At its end.**
- **Each machine derives the org project of every checkout** by sminos's rule, extended as OX3 now says, and reports it on `ProjectRecord.org`. `machine.identity` reports the machine's own project.
- **The renderer assembles `OrgProject`s from every machine's checkouts.**
- **The sidebar groups by org project:**
  - other machines' session rows carry machine chips (T1);
  - an offline machine's rows grey;
  - each machine has its machine project row in place of "Other sessions".
- **The layout's project keys refile to org project keys.**

**Touches.**
- `src/main/index/org-project.ts`, `org-project.test.ts` (new);
- `test/fixtures/sminos/remote-key.json`, `machine-project-id.json` and `PROVENANCE.md` (new: vendored from sminos 1.15.0's `tests/`, with the source path and the files' sha256);
- `src/main/index/projects.ts`, `src/main/index/migrations.ts` (one additive migration), `src/main/index/index.ts` (the start-up refresh);
- `src/shared/ipc/schema/session.ts` (`ProjectRecord.org`, optional);
- `src/main/machine/identity.ts` (the machine project);
- `src/renderer/src/stores/org-projects.ts` (new: selectors);
- `src/renderer/src/sidebar/derive.ts`, `Sidebar.tsx`, `SessionRow.tsx`, `ProjectRow.tsx`, `HoverCard.tsx`, `ProjectHoverCard.tsx`, `menus.tsx`, `tree.ts`, `project-actions.ts`;
- `src/renderer/src/projects/ProjectsView.tsx`, `src/renderer/src/sidebar/project-groups.ts`;
- `src/renderer/src/keymap/actions-runtime.ts` (`focusedProject`, `unstartedProjectOf`);
- `src/renderer/src/stores/layout.ts` (`setOfTab` by org key; running `rekeySets`), `src/renderer/src/stores/layout-model.ts` (`rekeySets`);
- their tests.

**Decisions.**
- **The derivation** (machine side; `src/main/index/org-project.ts`). Each checkout directory `D` is resolved by the first matching rule:

  | # | When | Key (persisted identity) | `smnsId` | Name | `source` |
  |---|---|---|---|---|---|
  | 1 | `.smns` found walking up from `D`, else the owning repository's (sminos `smns_at`) | `smns:<project>` | the file's `project` | the file's `name` | `smns` |
  | 2 | `D`'s owning repository has a remote, `origin` else the only one, whose URL derives a remote key `K` (sminos `derivation`, `parse_remote`, `remote_key`) | `remote:<K>` | enrolled in org `O`: `uuid5(URL, "smns-repo:O:K")` (sminos `repo_project_id`); else null | sminos `remote_name` | `remote` |
  | 3 | `D` is in a git repository whose remote derives none | `repo:<ref>:<sha256(owning repo realpath), first 16 hex>` | null | the repository's basename | `repository` |
  | 4 | `D` is no repository | `folder:<ref>:<projectId>` | null | the project's name | `folder` |
  | — | The machine itself | `machine:<ref>` | enrolled: `uuid5(URL, "smns-machine:O:<name lower-cased>")` (sminos `machine_project_id`); else null | the machine's name | `machine` |

  - **Keys survive enrollment** (P5 Decision Log 21's condition). The persisted identity is the key. sminos's id depends on the org, so it is an attribute, `smnsId`, used only to join with sminos and the hub (O8).
    - So signing in changes no key, and no layout, tab set or expanded row moves.
    - Rejected: persisting sminos's ids, which change at enrollment because the org is in the UUID, and a migration at enrollment, which the keys make unnecessary.
  - Rows 1 and 2 are sminos's rule. Rows 3 and 4 are OX3's extension (every checkout yields a project), and they key by the machine because nothing else names them across machines.
  - Rejected: sminos's unenrolled `local-<name>`, which merges unrelated repositories that share a basename.
  - **The `OrgProject`'s `id` is the key** (OX3 extended: Interfaces).
  - **Reading git config.**
    - Find the common git directory as sminos's `_common_git_dir_fs` does: read the nearest `.git` and follow a linked worktree's `gitdir` and `commondir`, with no process.
    - Read the remotes with `git config --file <common>/config --no-includes --get-regexp '^remote\..*\.url$'`, keeping each remote's first URL in file order. This is git's own parser, with sminos's no-includes semantics.
    - Rejected: porting sminos's config parser (about 80 subtle lines).
  - **uuid5** is RFC 4122 §4.3 over `crypto.createHash('sha1')`, with the URL namespace `6ba7b811-9dad-11d1-80b4-00c04fd430c8`. The vectors check it.
  - **The enrollment input** is one function, `machineEnrollment(): { org: string; machine: string } | null`. It returns null in O6, and O10 replaces it with the endpoint's enrollment. Tests inject it.
    - Rejected: reading sminos's `$SMINOS_HOME/daemon/hub.json`. That couples MAWS to sminos's private files, and the enrollment moves to the endpoint (RL §2.1).
    - Flag for O9: until O10, a terminal session's sminos project and MAWS's key agree only through the rule, not through ids.
  - **Persisting and refreshing.** The derivation is stored on the project row, in nullable columns `org_key`, `org_name`, `org_source` and `org_smns_id` (one additive migration, no re-index), so the first paint groups at once.
    - It is computed when a row is created or relocated.
    - It is recomputed asynchronously at every index start, with the warm-up's concurrency (`warmLinkedWorktrees`).
    - A change emits `session.projects.changed`.
    - A `.smns` added or a remote changed mid-run shows at the next launch. Rejected: watching `.smns` and git config for a rare event.
  - **`ProjectRecord.org`** is optional (`ProjectOrg`, Interfaces). A row not yet derived is drawn as its own folder-like project until its derivation arrives.
- **What a checkout is.** OX3 says that only sessions with no checkout go to their machine's project. The architect's condition for Decision Log 21 names the cases: "a session started in the home directory, in /tmp, or in a folder nobody opened". So **a checkout is a project someone opened on that machine**: a `ProjectRecord` with `origin: 'user'`.
  - A directory the index only discovered is not a checkout, even though it has a `ProjectRecord` and a key.
  - `OrgProject.checkouts` lists checkouts only.
  - This is the reading O6 builds. P5's OX3 text says "checkout" without defining it, so the architect records the definition in P5.
- **Which sessions sit under their machine's project.** A session sits under the org project of its directory's key when that org project is **listed**, else under its machine's project.
  - An org project is listed when at least one of its checkouts, on any machine, is not hidden.
  - A discovered directory's sessions join the row of the org project their key names, when that project is listed. That is one repository, opened on another machine.
  - Otherwise they have no checkout, and sit under the machine. So the machine row holds:
    - sessions started in the home directory, in `/tmp`, or in any folder nobody opened. Discovery made a `ProjectRecord` for each of these, but no machine has a checkout under its key;
    - sessions whose directory no longer exists, which have no `ProjectRecord`.
  - It never holds a session in a discovered clone of a repository opened on another machine, which joins that repository's row.
  - This is today's "Other sessions", per machine, and it picks out real rows: a folder the owner opened is a checkout, so its sessions are never in the machine row.
- **Hiding.** It stays per checkout.
  - A hidden checkout's sessions show nowhere, as today.
  - An org project's row shows while one of its checkouts is listed.
  - "Remove from sidebar" on an org row sends `session.projects.update { hidden: true }` for every checkout of it on every machine that is `up`. A checkout on an offline machine stays listed, and re-shows the row when that machine returns. "Hidden projects…" lists hidden checkouts with their machine.
- **The tree's keys.** `ProjectKey` becomes the org project key. The machine rows' keys are `machine:<ref>`, which replace `'other'`. An org key is never an address: its prefix holds a `:`, which a `MachineRef` cannot. So **any persisted project key that is an address is a pre-M5 key, still to migrate.** That makes the migration resumable, without a version, across machines that load late.
- **Migrating project-keyed state: `layout-model.ts`'s `rekeySets` (new), run at hydrate and again after each machine's projects arrive.** It is a whole-set migration, not W12's per-tab refile. `refileTabs` moves only session tabs, so it would strand a set's file and artifact tabs under an obsolete key.
  - **`main.tabs.sets`.** Each address key `<m>/<projectId>` whose machine's projects are known maps to that project's `org.key`.
    - Sets that map to one key merge into a single set. Its panes are pane 0 and pane 1 of the set that was `current`, else of the first set in key order. The other sets' tabs are appended to its focused pane, in their order, with no duplicate tab id. Focus and split ratio come from that base set.
    - `current` follows its set's new key.
    - An address key whose machine has loaded but no longer has that project is re-homed. Its session tabs go where `setOfTab` files them, and its sessionless tabs (file, artifact, diff) go to the `'none'` set. Nothing is dropped.
    - An address key whose machine has not loaded is left as it is until it loads.
  - **`regions.sidebar.expandedProjects`.**
    - An address entry maps to its org key and is deduplicated.
    - An entry whose project is gone on a loaded machine is dropped: losing an expanded state costs nothing.
    - `'other'` maps to `machine:<localRef>`.
  - **`panelTools.surfaces.contexts`**, keyed by project and read through `main.current`, is rekeyed by the same map. On a merge it keeps the entry of the set that was `current`, else the first.
  - **The `'none'` set** stays for tabs of no session and for an unfiled New chat. A session of a machine project files into its machine row's set through `setOfTab`, and W12's `refileTabs` keeps moving session tabs as before.
  - **No version bump.** `TabSetKeySchema` and `ProjectKeySchema` already accept these strings.
  - **Fixtures in `layout-model.test.ts`**, each starting from an M2 version-3 layout:
    - two checkout sets mapping to one key (a merge, `current` among them);
    - a set holding only file tabs;
    - a set whose project is gone;
    - a set of a machine that loads later, migrated on its arrival;
    - `contexts` across a merge.
  - Rejected: a tab set per (machine, local project). The strip would not follow the sidebar's row.
- **Assembly** (`stores/org-projects.ts`). `selectOrgProjects` groups every machine's `ProjectRecord`s by `org.key` into `OrgProject`s.
  - The name is the local machine's checkout's derived name when it has one, else that of the first machine in ref order.
  - `selectSessionsOfOrg(key)` is the union of sessions across machines, filed by the rule above.
  - Ordering, caps, "Show more", lineage nesting, search and sort are today's `projectList` and `projectSessions` over the union.
  - A machine project row sorts after the org projects. With several machine rows, the local machine's comes first, then the rest by name.
- **The Projects view** lists every machine's checkouts, in its three groups as today. Each of another machine carries its machine chip (T1), and its actions route by the project's address.
- **Offline.** A machine's rows are greyed when `useMachines` says it is not `up`. A greyed row:
  - still opens its tab, whose content says the machine is offline;
  - says "machine offline" (P5 §8);
  - keeps its waiting count, which is as last known.
  - A session's hover card always names its machine. For an offline machine it also says when the machine was last seen (`useMachines`' `since`).

**Taste decisions, settled by the owner on 2026-10-27 (P5 Decision Log 28).** Build each as answered, with existing tokens and components.
- **T1, the machine chip.** `@<name>` in the row's secondary text style, after the title, on rows of other machines only. The local machine's rows look as they do today. (This replaces the provisional form, which put it on every row.)
- **T2, an offline machine's rows.** They grey in place: the disabled text token on the row, "offline" in the chip's place, sort unchanged.
- **T3, the machine project row.** The machine's name, as the last rows, one per machine.
- **T4, an org row whose checkouts span machines.** The project row shows no machines; each session row shows its own (T1).
- **T5, a kept tab of an offline machine.** The tab's title in the disabled token, and the content replaced by one line, "<name> is offline".
- **T6, the toggle for other people's sessions,** which P5 §8 names, is O8's and is not built here.

**Does not touch.** The per-project toggle for other people's sessions, owners and visibility (O8). The "+ Session" machine picker (O7). The hub's listings (OX8).

**Proves.**
- Acceptance 5, 6 and 10, and acceptance 7's org half.
- `org-project.test.ts` runs the vectors, then the cases of acceptance 10 on temporary git repositories made with `git init`, `git remote add` and `git worktree add`, plus a key computed before and after an injected enrollment.
- `derive.test.ts` and `Sidebar.test.tsx` pin, with two machines' fixtures:
  - grouping across machines;
  - the machine row's membership by the rule above;
  - a folder project's row;
  - greying;
  - hiding across checkouts.
- `layout-model.test.ts` pins `rekeySets` on the fixtures above, and `layout.test.ts` pins its runs at hydrate and on a machine's arrival.

### M6 — Acceptance

**At its end.** Acceptance 1 to 10 hold at the head, each with its evidence in Outcomes & Retrospective.

**Touches.**
- `e2e/machines.spec.ts`, which completes the scene below;
- this document's Progress, Surprises, Decision Log and Outcomes.
- Nothing else, unless a check fails, in which case the fix goes to the milestone that owns the failing part.

**Decisions.** The scene runs in five phases, each asserted before the next.
1. **Setup.** One temporary git repository with `origin` set to `https://github.com/example/shared.git`, and a linked worktree of it on a branch named `standin-b`. Profile A adds the main checkout as a project. Profile B adds the worktree. The two checkouts' branches differ, so the panel summary's branch shows which machine answered (acceptance 8).
   - Each profile seeds a session in its own checkout (`seedTranscripts` into its own `CLAUDE_CONFIG_DIR`).
   - B also seeds one in a fresh folder it never adds.
   - A adds a plain folder (no repository) as a project, with a session in it.
   - B launches with `MAWS_MACHINE_SERVE=1` and `MAWS_MACHINE_NAME=standin-b`. A launches with `MAWS_LOCAL_MACHINES` naming B's serve directory and `MAWS_MACHINE_NAME=standin-a`.
2. **The sidebar.**
   - One `shared` row holds both seeded sessions, chipped `@standin-a` and `@standin-b`.
   - A's folder has its own row.
   - A `standin-b` row holds B's unadded-folder session.
3. **The draft.** Open B's `shared` session in A, check its transcript (acceptance 8), and type a draft.
4. **The departure.** Close B. Within 2 s B's rows and the tab grey, and A's rows and statuses are as they were.
   - While B is down, seed one more session into B's config.
   - Relaunch B over its profile. Within 5 s the rows are live with no duplicate, and the new session is listed.
   - The new session proves the generation reset: B's restarted index numbers it from a counter that starts again at zero.
5. **The relaunches.** Quit A and relaunch it over its profile with B up: the tab and the draft are back. Quit and relaunch A again with B closed: the tab is kept, greyed.

The migration of acceptance 4 is the shell spec's, from M2. The stand-in's boundaries (acceptance 9) are unit tests. If the bench misses OX7's budget at the head, run it twice more. A miss in two of three runs is a finding: record the numbers, suspect the codec's lifters on `session.eventBatch` and `pty.data` first, and message the architect.

**Proves.** Acceptance 1 to 10, by Concrete Steps 6 and 7.

### Concrete Steps

Run from the worktree root unless a line starts with `cd /tmp &&`. `W` is the worktree's absolute path.

1. **Setup.**

        pnpm install --frozen-lockfile

2. **While iterating, one focused file at a time.**

        pnpm vitest run src/shared/machine/address.test.ts

   Expect `Test Files 1 passed`.

3. **Class 1a, at every milestone's end.**

        cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool

   Expect a `PASS` line per gate, then `GREEN <run-url>`.

4. **The `path` call sites (M4's checklist), at the start of M4.** Rerun the survey's scan against the worktree:
   - Copy `research/org/scripts/introspect.ts` to a scratch directory outside the worktree, with its import path pointed at `W/src/shared/ipc/schema`.
   - Bundle it with `NODE_PATH=W/node_modules W/node_modules/.bin/esbuild <copy> --bundle --platform=node --format=esm --tsconfig=W/tsconfig.node.json --external:electron --outfile=<scratch>/introspect.mjs`.
   - Run `node <scratch>/introspect.mjs > <scratch>/registry.json`, then `python3 -I W/research/org/scripts/scan2.py W <scratch>/registry.json --list`.
   - Keep the rows whose command is in `routes.ts`'s `path` class.
   - At the base: 293 machine-dimension sites, 75 of them path-only, 63 of those not `client`.

5. **Hosted Mac e2e, per milestone** (the groups each milestone names).

        cd /tmp && W/scripts/ci-gate.sh W --gates e2e:shell,e2e:sessions,e2e:panel --runner macos --lane hosted

6. **The bench, on the mini.** Run it at M2's commit and at the head.

        cd /tmp && W/scripts/ci-gate.sh <sha> --gates e2e:local-latency --runner macos --evidence

   The job log holds `[local-latency] delta-to-frame p50 <a> ms p95 <b> ms … · round trip p50 <c> ms p95 <d> ms …`. Each p50 must be at most the baseline's plus 2 ms, and each p95 at most its plus 5 ms (`test/support/local-latency.ts`).

7. **Acceptance, at the head.**

        cd /tmp && W/scripts/ci-gate.sh W --gates all --runner macos --lane hosted

   Expect `GREEN <run-url>`, with `e2e:machines` among the groups. Then run step 6 at the head. Record each run id with its tree (`git rev-parse HEAD^{tree}`) in Outcomes.

8. **The fingerprint.** Print `wireFingerprint()` from a throwaway focused vitest file (not committed), at the base in a scratch worktree and at the head. Expect the same 16 hex characters.

9. **The mutations.** Make each change, see it fail as stated, then revert. Commit none of them.
   - Change `browser.tabs.list`'s `selected` key back to `z.string()`. `pnpm vitest run src/shared/machine/coverage.test.ts` fails, naming the record's path.
   - Add a field `parentAppSessionId: z.string().optional()` to `SessionRecordSchema` (`src/shared/graph/session.ts`). The same test fails, naming the key.
   - Re-type `ProjectRecordSchema.id`, then `AttentionItemSchema.id`, then `LaunchSpec`'s `inheritGrantsFrom` as a plain `z.string()`, one at a time. The same test fails each time on the snapshot of addressed paths, naming the vanished path.
   - Call `git.watch` without `{ machine }` in `src/renderer/src/stores/git.ts` (from M4). `pnpm typecheck` fails at that call, and only there.

### Interfaces and Dependencies

No new dependency. zod 4, Node's `crypto`, the peer-auth addon already in the tree, and O1's modules.

**`src/shared/machine/ref.ts`** (M1):

    export const MachineRefSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).brand<'MachineRef'>(); // RL5's `ref`
    export type MachineRef = z.infer<typeof MachineRefSchema>;

**`src/shared/machine/identity-file.ts`** (M1; no Electron import, shared with O2's `mawsd`, P5 Decision Log 27):

    export const IDENTITY_FILE = 'machine.json';                            // in the profile's root: { version: 1, ref, mintedAt }, 0600
    export function readMachineRef(profileDir: string): MachineRef | null;  // null when absent; throws naming the path on a malformed file
    export function readOrMintMachineRef(profileDir: string): MachineRef;   // temporary file, fsync, link; EEXIST reads the winner's file
    // O2's M8 adds an optional `{ prefix }`, a devcloud VM's delegation id, so its ref is `<id>_<random>` (P5 Decision Log 30)

**`src/shared/machine/address.ts`** (M1; the one codec):

    export const ADDRESS_SEPARATOR = '/';
    export function addressOf<T extends string>(machine: MachineRef, bare: T): T;    // `${machine}/${bare}`, typed as the id it addresses
    export function isAddress(value: string): boolean;                              // a valid MachineRef, then '/', then at least one character
    export function machineOf(address: string): MachineRef;                         // throws on a non-address
    export function bareOf<T extends string>(address: T): T;                        // throws on a non-address
    export const ADDRESSED_SCHEMAS: readonly z.ZodType[];                           // [AppSessionIdSchema, ProjectIdSchema, PtyIdSchema, AttentionIdSchema]
    export interface Addressing {
      lift<T>(value: T, machine: MachineRef): T;                                     // throws on an address already present
      lower<T>(value: T): { value: T; machines: ReadonlySet<MachineRef> };           // throws on a bare id where an address belongs
    }
    export function compileAddressing(schema: z.ZodType): Addressing;               // throws on a plain union whose options disagree
    export function addressingOf(registry: WireRegistry): { input(name: string): Addressing; output(name: string): Addressing; event(name: string): Addressing };

**`src/shared/ipc/routes.ts`** (M2):

    export type RouteClass = 'client' | 'addressed' | 'path' | 'machine-wide';
    export function routeOf(name: CommandName): RouteClass;
    export const PATH_COMMANDS = ['git.watch', /* …every `path` command, pinned equal to the computed class */] as const satisfies readonly CommandName[]; // a literal tuple, so its element union is the subset
    export type PathCommandName = (typeof PATH_COMMANDS)[number];

`src/shared/ipc/routes.test-d.ts` asserts three things: a `path` command invoked without `{ machine }` is a type error; an `addressed` command without options compiles; and a `machine-wide` command without options compiles. A `readonly CommandName[]` annotation would widen `PathCommandName` to every command.

**The bridge types** (`src/shared/ipc/schema.ts`, M2):

    export interface InvokeOptions { machine?: MachineRef }
    export interface MawsBridge {                                                    // the renderer client's
      readonly localMachine: MachineRef;
      invoke<N extends CommandName>(name: N, input: CommandInput<N>, ...opts: N extends PathCommandName ? [opts: { machine: MachineRef }] : [opts?: InvokeOptions]): Promise<CommandResult<N>>;
      on<N extends EventName>(name: N, listener: (payload: EventPayload<N>, from: { machine: MachineRef }) => void): () => void;
      pathForFile(file: File): string;
    }
    export interface PreloadBridge {                                                 // window.maws, the raw pipe
      readonly localMachine: MachineRef;
      invoke(name: string, input: unknown, machine?: MachineRef): Promise<unknown>;   // no machine: the local one
      on(name: string, listener: (payload: unknown, machine: MachineRef | undefined) => void): () => void;
      pathForFile(file: File): string;
    }

`PATH_COMMANDS`' required form is switched on in M4; in M2 the conditional resolves to the optional form.

**`machine.*`** (owner `machine`, M1) and **`machines.*`** (owner `main`, grade `client`, M3):

    export const MachineProjectSchema = z.strictObject({ key: z.string().min(1), name: z.string(), smnsId: z.string().nullable() });
    export const MachineIdentitySchema = z.strictObject({ ref: MachineRefSchema, name: z.string(), project: MachineProjectSchema });
    'machine.identity': { input: z.void(), output: MachineIdentitySchema, owner: 'machine' }
    export const MachineStateSchema = z.strictObject({ ref: MachineRefSchema, name: z.string(), local: z.boolean(), state: z.enum(['connecting', 'up', 'down']), since: z.string(), generation: z.number().int().nonnegative() }); // generation: +1 per welcome (M4)
    'machines.list': { input: z.void(), output: z.strictObject({ machines: z.array(MachineStateSchema) }), owner: 'main' }
    'machines.changed': z.strictObject({ machines: z.array(MachineStateSchema) })   // event; the whole list

**`ProjectRecord.org`** (M5, `src/shared/ipc/schema/session.ts`; optional, additive):

    export const ProjectOrgSchema = z.strictObject({
      key: z.string().min(1),                                                        // the persisted identity: smns:…, remote:…, repo:…, folder:…
      name: z.string(),
      source: z.enum(['smns', 'remote', 'repository', 'folder']),
      smnsId: z.string().nullable(),                                                 // sminos's project id where one exists, for joins (O8)
    });
    // ProjectRecordSchema gains `org: ProjectOrgSchema.optional()`

**`OrgProject`** (M5, renderer; OX3 extended with the key as id, `smnsId`, and the machine kind):

    export interface OrgProject {
      id: string;                                                                    // the key
      name: string;
      kind: 'project' | 'machine';
      smnsId: string | null;
      checkouts: { machine: MachineRef; path: string; projectId: ProjectId }[];      // opened projects only (origin 'user'); projectId is an address; none for a machine project
    }

**The connection manager** (`src/main/machines/manager.ts`, M3):

    export interface MachineLink {
      readonly machine: MachineRef | null;                                           // null until its identity is known
      state(): 'connecting' | 'up' | 'down';
      dispatch(name: CommandName, input: unknown, client: ClientRef): Promise<CommandResult<CommandName>>;
      onEvent(listener: (name: EventName, payload: unknown) => void): () => void;
      close(): void;                                                                 // stops reconnecting; never stops the far side
    }
    export interface ConnectionManager {
      local: MachineRef;
      dispatch(machine: MachineRef, name: CommandName, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>; // host_unavailable when not up
      list(): MachineState[];
      onChanged(listener: (machines: MachineState[]) => void): () => void;
    }
    export function createConnectionManager(deps: { local: MachineRef; localName: string; localLink: MachineLink; knownMachinesFile: string; configured: string[]; emitFrom: typeof emitFrom }): ConnectionManager;

**The router** (M2, M3; on O1's `Router<R>`):

    export type MainContext = HandlerContext & { readonly target: MachineRef };
    // Router<R> gains:
    dispatchLocal(name: NameOf<R>, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>; // the route minus the sender check; the stand-in's entry, which unwraps it for HostOn (M3)
    // src/main/ipc/events.ts gains:
    export function emitFrom<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): boolean; // windows only, no taps

**The socket server's admission** (M3; `src/shared/host/socket-server.ts`, on O1's v3 server):

    // SocketServerOptions gains:
    admit?(socket: Socket): boolean;                                                 // false: destroy before any byte is read

**The stand-in** (M3; O3 deletes):

    export function machineServeAllowed(opts: { packaged: boolean; env: NodeJS.ProcessEnv }): boolean;   // serve-gate.ts
    export function serveMachineStandIn(deps: { userData: string; router: Router<typeof REGISTRY>; localRef: MachineRef; peer: PeerAddon | null; log(line: string): void }): { close(): Promise<void> };

**Files on disk.**
- `<userData>/machine.json` is the machine's own (M1; O2 honours it):

      { "version": 1, "ref": "<MachineRef>", "mintedAt": "<ISO-8601>" }

  It is created exclusively (`wx`, 0600), never rewritten, and a malformed file stops startup.
- `<userData>/known-machines.json` is the client's (M3):

      { "version": 1, "machines": [{ "ref": "<MachineRef>", "name": "<string>", "carrier": { "kind": "socket", "dir": "<absolute path>" } }] }

- `<userData>/machine-serve/` is the stand-in's (M3; 0700): `machine.sock` (0600) and `machine.token` (0600, 64 hex characters).

**The org-project rule** (M5): the table in M5's decisions, with `machineEnrollment(): { org: string; machine: string } | null` as its one input beyond the filesystem.

## Surprises & Discoveries

- Observation: neither of the edge's two readings holds as posed. The sidebar's rows are main-owned reads served by main's index, so only O3's services host or a stand-in answers them; a detached supervisor or O2's `mawsd` doesn't (P5 Decision Log 21).
  Evidence: in `src/shared/ipc/schema/session.ts`, `'session.list'`, `'session.projects.list'`, `'session.digests'`, `'session.drafts.get'` and `'session.drafts.set'` are all `owner: 'main'`, as is `'attention.list'` in `attention.ts`. And `src/shared/host/runtime.ts` throws "a host cannot serve it" for any main-owned command.
- Observation: an id schema checks only `min(1)`, so an address validates wherever a bare id does. That makes lifting schema-compatible with no schema change.
  Evidence: `src/shared/graph/ids.ts`: `const brandedId = <B extends string>() => z.string().min(1).brand<B>();`. `PtyIdSchema = z.string().brand<'PtyId'>()`.
- Observation: on the pinned zod (4.6.5), `.brand()` returns the same schema instance, and wrappers expose it, so identity finds ids through them. A loose branded string renders the same JSON Schema as a plain one, and a canonical id does not.
  Evidence: a scratch check printed `brand returns same instance: true`, then `plain vs loose JSON equal: true` and `record plain vs loose key JSON equal: true`, then `nullable inner is the instance: true array element is the instance: true`. The canonical id rendered with `"minLength":1`.
- Observation: `IpcErrorSchema.code` is a `z.enum` inside the envelope, so under O1's rule a new error code would take a major.
  Evidence: `src/shared/ipc/errors.ts`, `IPC_ERROR_CODES`. O1 M6: "a changed type, `const`, `enum` or union member set (an added enum member included…)" is breaking.
- Observation: the renderer scan at this base matches the survey's exactly. The 75 path-only sites split into 5 `client` commands and 63 machine-bound sites.
  Evidence: `scan2.py` at `84dd399cd`'s `src`: "machine dimension: 293 sites in 135 files, 167 distinct commands", with path-only `75 sites in 42 files`.
- Observation: sminos's unenrolled rule names a repository `local-<basename>`, which merges unrelated repositories that share a name. Its enrolled ids hash the org, so they change at enrollment. Both shaped M5's keys.
  Evidence: `sminos.py` `resolve_project` (`"local-" + name`) and `repo_project_id` (`uuid5(NAMESPACE_URL, "smns-repo:%s:%s" % (org, key))`).
- Observation: two pieces of main's machine-side code read the client's layout content: the inactive sweep's open tabs and the panel-key lifetime. Both must understand addresses until OX5 replaces the first.
  Evidence: `src/main/layout/open-session-tabs.ts`, and `src/main/layout/store.ts`'s `SESSION_PANEL_KEY` check and `dropPanelKeysOfRemovedSessions`.

## Decision Log

- Decision: the verification.
  - This document gets one `doperpowers:adversarial-reviewer` buildability review before execution (P5 Decision Log 12).
  - Each milestone gets doperpowers:subagent-driven-execution's task review.
  - The branch gets doperpowers:review-code at the **high** rung. The reviewer is pointed at the parts where a quiet error writes to the wrong machine or loses the owner's layout:
    - the codec's compile rules and its coverage test (M1);
    - the client's routing and refusals (M2);
    - the layout migration (M2) and the refile (M5);
    - the stand-in's gate and peer check (M3).
  Rationale: the diff is broad, renderer-wide plus e2e adaptation, and the boundary it changes carries every command. P5 names medium as the default, and O1 took high for a boundary every later child builds on, which is O6's case too: O7, O8 and O9 build on it.
  Date/Author: 2026-10-27, O6's planner.

- Decision: P5 Decision Logs 21 and 22, the architect's acceptance of this document's four divergences with conditions, are folded in where each binds.
  - The stand-in's gate, 0600 files and peer check, deleted at O3 (M3).
  - The codec's coverage, single ownership and loud mixed lowering (M1, M2).
  - The ref minted once, in RL5's format, written as the file O2 honours (M1).
  - Every checkout yields a project. The machine row's membership is said concretely, and keys survive enrollment (M5).
  Date/Author: 2026-10-27, O6's planner, on the architect's messages.

- Decision: the buildability review's round, folded in. Nine of its ten findings were adopted; the tenth was handed to the architect. Each was checked against the code first: `Index`'s `stamped = 0`; the three synthetic owners; `HostRegister`'s `emit`; `inheritGrantsFrom: AppSessionIdSchema`.
  - M4:
    - a generation reset on each link `up`, because a restarted machine's counters start at zero;
    - a roster barrier before hydration, with an unanswered roster dropping nothing.
  - M5:
    - a lossless, resumable whole-set migration of project-keyed layout state (`rekeySets`), with merge and re-home rules and `contexts` included;
    - "checkout" defined, per the architect's condition, as a project someone opened, for P5 to record.
  - M1:
    - a committed snapshot of addressed paths, for the `id` and role-named fields the name rule cannot see;
    - atomic publication of `machine.json` by link.
  - M2: the synthetic pty owners addressed.
  - Interfaces: `PATH_COMMANDS` as a literal tuple with type assertions.
  - M3: the stand-in adapter unwrapping `dispatchLocal`'s envelope for `HostOn`, and keeping the register callback's `emit`.
  - Handed to the architect: the two-build cross-minor check, inherited if O6's bump is first (residue 38).
  Date/Author: 2026-10-27, O6's planner, on doperpowers:adversarial-reviewer's findings (three P1, seven P2).

Residue decisions O6's section leaves open, made above, for the architect to record in P5. Each line names the alternative rejected. **[x]** marks one that extends or narrows a P5 contract.

1. **The stand-in is a second profile's app serving its embedded root over a same-uid socket** (M3; Decision Log 21). Rejected: blocking O6 on O3.
2. **Ids are addresses in the renderer, lifted and lowered at its client by branded-schema identity** (M1, M2; Decision Log 21). Rejected: P5 §3's id-to-machine map.
3. **Four id kinds are lifted: `AppSessionId`, `ProjectId`, `PtyId` and `AttentionId`** (M1). Engine `SessionId`, `EventId`, within-session ids and artifact ids are not; artifact ids resolve by context. Rejected: lifting every machine-scoped id.
4. **[x] `MachineRef` is 22 base64url characters from 16 random bytes, kept in `<userData>/machine.json`, created exclusively, never rewritten, and fatal when malformed. This file is the interface O2 honours** (M1; RL5, Decision Logs 21 and 22). Rejected: an in-memory mint reported only by command.
5. **The machine's name is `MAWS_MACHINE_NAME`, else the short hostname, and is display only** (M1). Rejected: the profile directory's name.
6. **`machine.identity` is the first production `machine`-owned command, graded `list`, and bumps `WIRE_MINOR`** (M1). Rejected: main-owned, then retagged at O3, which O1's rule makes breaking.
7. **Route classes: addresses route to their machine; `path` commands need an explicit machine; `machine-wide` commands default to the local one; `client` commands are the app's own, with `ctx.target`** (M2). Rejected: an explicit machine on every id-less command.
8. **No new `IpcError` codes: `host_unavailable` and `invalid_input` carry the machine cases** (M2). Rejected: new codes, which O1's rule makes a major.
9. **The local ref reaches the page through `additionalArguments`, as `window.maws.localMachine`** (M2). Rejected: an async read before the first command.
10. **A raw-bridge invoke with no machine is the local machine's** (M2). Rejected: requiring the machine of e2e specs.
11. **The layout migrates once: `main.tabs` to version 3, `regions` to 5, `panelTools.surfaces` to 2, `sessions.attachTabs` to 2, and panel keys renamed. `file` and `artifact` tabs carry `machine`, and tab ids carry addresses** (M2). Rejected: bare tab ids.
12. **[x] Drafts stay in their session's machine's index, addressed through routing, so OX2's "drafts key by it" is met by the address, not by a client store** (M2). Rejected: drafts moved into the client.
13. **The router answers `host_unavailable` for a `client` command whose target is another machine, before any handler runs. `attention.viewing` is answered with no effect** (M2). Rejected: forwarding app effects to a machine with no app.
13a. **Coverage fixes re-type plain-string id fields with loose branded aliases, so no JSON Schema, manifest entry or fingerprint changes** (M1). Rejected: the canonical `min(1)` schemas, which O1's rule makes breaking on engine-host fields.
14. **The link surface is every non-`client` command as owner `machine`, plus the declared link events, kept a partition with the client events by a test** (M3). Rejected: forwarding every event, which would feed B's machine-wide facts into A's local-only surfaces.
15. **The socket link is connect-only, never stops the far side, and answers `host_unavailable` at once while down** (M3). Rejected: holding requests to an absent machine.
16. **Known machines persist in the client's `known-machines.json`, so a configured machine that is down keeps its tabs** (M3). Rejected: listing only connected machines.
17. **The second machine is configured only by `MAWS_LOCAL_MACHINES`, in builds that are not packaged** (M3). Rejected: a settings entry, before O10's sources exist.
18. **The stand-in admits a peer through an `admit` option of O1's socket server, checked with the peer-auth addon, and fails closed** (M3; Decision Log 21). Rejected: relying on file modes alone.
19. **One store per kind with per-machine reconciliation inside, and the machine passed explicitly to every apply** (M4). Rejected: a store instance per machine with a merged view.
20. **Path-keyed stores key by `addressOf(machine, path)`** (M4). Rejected: leaving them to O7, which would let a remote session's panel read local paths.
21. **The layout keeps tabs of known machines not yet loaded, and settles each machine's tabs after its first snapshot** (M4). Rejected: dropping non-local tabs until their machine connects.
22. **[x] An org project's persisted identity is its key (`smns:`, `remote:`, `repo:`, `folder:`, `machine:`). sminos's id is an attribute, `smnsId`, for joins. `OrgProject.id` is the key, and it gains `kind` and `smnsId`** (M5; Decision Log 21's condition). Rejected: persisting sminos's ids, or migrating at enrollment.
23. **[x] Every checkout yields a project. A repository with no remote, and a folder with no repository, key by their machine** (M5; Decision Log 21). Rejected: sminos's `local-<name>` while unenrolled.
24. **[x] A checkout is a project someone opened (`origin: 'user'`). A session sits under its machine's project when its directory's org project has no checkout on any machine that is not hidden, or when it has no project at all** (M5; Decision Log 21's condition). Rejected: counting every discovered directory as a checkout, which would make a row for the home directory and `/tmp`. For the architect: P5's OX3 should define "checkout".
25. **The derivation runs machine-side, is persisted in four nullable project columns, and is refreshed asynchronously at each index start** (M5). Rejected: watching `.smns` and git config.
26. **Remotes are read with `git config --file <common>/config --no-includes`** (M5). Rejected: porting sminos's config parser.
27. **sminos 1.15.0's two vector files are vendored with their provenance and sha256** (M5). Rejected: reading them from the plugin cache at test time, which the gate's runners lack.
28. **The enrollment input is `machineEnrollment()`, null until O10** (M5). Rejected: reading sminos's `daemon/hub.json`.
29. **Hiding stays per checkout. "Remove from sidebar" on an org row hides every reachable checkout** (M5). Rejected: an org-level hidden flag with no machine to keep it.
30. **Tab sets and expanded rows key by org key, through W12's refile, with no version bump** (M5). Rejected: sets per (machine, local project).
31. **Notifications, the dock badge and ⌘⇧J stay the local machine's in O6** (Constraints). Rejected: feeding remote events to main's notifier before O3's mirror exists.
32. **The identity file is published with a link from a complete temporary file** (M1). Rejected: `wx` and then write.
33. **Every `up` of a non-local link is a new generation that resets that machine's reconciliation counters. Its records stay displayed until the generation's first snapshot replaces them** (M4). Rejected: counters kept across reconnects.
34. **Hydration waits for the roster as well as the local snapshot. A missing or failed roster drops nothing** (M4). Rejected: an independent roster read.
35. **Project-keyed layout state migrates by whole set in `rekeySets`, resumably, keyed on "an address key is a pre-M5 key". Sets merge, and sessionless tabs re-home to `'none'`** (M5). Rejected: W12's per-tab refile alone.
36. **A committed snapshot of addressed paths guards the `id` and role-named fields that the name rule cannot see** (M1). Rejected: the name rule alone.
37. **The ids the renderer mints, its synthetic pty owners among them, are local addresses** (M2). Rejected: an exemption for synthetic owners in the lowerer.
38. **O1's deferred two-build cross-minor check is not built by O6.** O6's `machine.identity` may be the first `WIRE_MINOR` bump on master. If it is, the executor messages the architect when M1 lands, so the check (`docs/tech-debt-tracker.md`'s row) is scheduled with its mechanism: a gate job that builds a second commit. Rejected: building that mechanism inside O6, whose purpose it is not.

## Outcomes & Retrospective

Pending — written at finish.
