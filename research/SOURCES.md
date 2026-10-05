# Readable sources of the reference apps

The research under this directory reads the code of the three apps that set MAWS's bar: the ChatGPT/Codex
desktop app (UX quality), Claude Desktop (engine integration, the same engine) and T3 Code (source readability;
open source, so its tree is a plain clone). Their extractions live
outside the repository, because the vendors' terms forbid redistribution, and are regenerated per build by one
toolchain. This page says where everything is and how to cite it.

| | location | current build | older builds kept |
|---|---|---|---|
| ChatGPT / Codex app | `~/codex-app-src/readable/<build>/` | `chatgpt-26.928.40906` (published 2026-10-01, runtime 0.0.27, `@oai/cua` 0.2.5) | `chatgpt-26.928.31416`, `chatgpt-26.924`, `chatgpt-26.917`, `codex-26.623`, `cua-node-0.0.24` |
| Claude Desktop | `~/claude-desktop-re/readable/<build>/` | `app-2.16120.0` (2026-09-29, Electron 44.4.3) | `app-2.9939.2` |
| claude.ai web app | inside `app-2.16120.0/web/` (shipped with the app from 2.16120 on) | | `~/claude-desktop-re/readable/web-2026-09-25/` (cache capture) |
| T3 Code (open source, MIT) | `~/t3code-src` (git clone of `pingdotgg/t3code`) | `148e6dee` (2026-10-01) | `git -C ~/t3code-src log` holds the history; cite `<path>:<line>` at a named commit |
| toolchain | `~/app-source-tools` (git) | | |

## What a build directory contains

Start at `MAP.md`. Then:

- `INDEX.md`: every top-level declaration of the big files with line ranges; regions named by log tag (one region
  is roughly one original source file); classes with their method names. The minified main process is not split
  into files (module boundaries do not survive scope hoisting), so this index is the way in.
- `CATALOGS.md` and `catalogs/*.json`: env vars (reads vs. sets), log tags, IPC channels or services, Statsig
  gates, GrowthBook features, analytics events, routes, RPC method names, sockets and pipes, test ids, utility
  processes, contextBridge keys, native-addon strings. Every entry carries `file:line`.
- Claude only: `ipc-services.md`, the full IPC surface (93 services, 1,096 methods in 2.16120) with zod parameter
  schemas, events, stores, and the declaration and `setImplementation` sites; `i18n-web.json`, the hashed message
  id to English text map the web UI uses.
- `ui-strings*.json`: react-intl messages (id, defaultMessage, description, chunk). Grep an on-screen string here,
  then grep the id in the prettified renderer to reach the component.
- `CHANGES-<old>..<new>.md`: what changed since the previous build, from the catalogs.
- `extracted/<build>/BUILD.json`: version, bundle id, Electron, asar sha256, Sentry release, acquisition time.

## Citing

Cite `readable/<build>/<file>:<line>` with the build named, as the existing documents do. Line numbers hold for
that build only. Names hold across builds: a log tag, an IPC service or method, a class method name, a test id, a
UI string id. When a claim must survive the weekly builds, anchor it on a name and let the catalogs give the line.

Two legacy conventions remain valid: `research/codex-computer-use/` and `research/codex-shell-ux.md` cite
`chatgpt-26.924` lines, whose files were left byte-for-byte unchanged; `research/claude-desktop-ux-and-engine.md`
cites the raw 2.9939.2 files (`index.chunk-9hgN2KD3.js:1` and the like), which are not line anchors; the same
chunk prettified is `~/claude-desktop-re/readable/app-2.9939.2/main-process/<name>`, and its INDEX lists the
`[LocalSessionManager]`-style regions to search in.

## Regenerating for a new build

```
cd ~/app-source-tools
node bin/ast.mjs acquire chatgpt --latest   # newest build from the appcast into _dist/; or: acquire chatgpt / acquire claude for the installed app
node bin/ast.mjs all chatgpt chatgpt-<v>    # prettify, index, catalogs, map (about 10 minutes)
node bin/ast.mjs diff chatgpt chatgpt-<prev> chatgpt-<v>
```

The toolchain's README explains the stages. Verify wire-level claims against `spikes/protocol-probe/fixtures/` or a
probe, as CLAUDE.md requires; the readable source shows what the app's code does, not what the engine emits.
