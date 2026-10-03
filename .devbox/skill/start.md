# Running MAWS

MAWS is a macOS Electron app (electron-vite). `devenv up maws` installs it (`pnpm install` from the
lockfile, which fetches Electron and readies node-pty); on Linux it installs nothing.

- `devenv start maws` runs `pnpm dev` in tmux session `maws`, window `dev`, and waits until the
  renderer's dev server answers at http://localhost:5173/ (Vite binds `[::1]` on macOS, so use
  `localhost`, not `127.0.0.1`). The app window opens on this Mac's display a few seconds later.
- `devenv status maws` shows whether it runs; `devenv stop maws` ends it and everything it
  spawned; `tmux attach -t maws` shows the dev server's output.

**The dev build's state lives in `.devbox/maws-userdata/`** (gitignored), through `MAWS_USER_DATA`.
Without it, a dev build opens the installed MAWS's `~/Library/Application Support/MAWS` — it
migrates that settings file to its own version and prunes data the installed app still uses, and
the single-instance lock lives there too. Any command that launches Electron by hand
(`pnpm dev`, `electron-vite dev`, `electron-vite --rendererOnly`, `electron .`) needs
`MAWS_USER_DATA="$PWD/.devbox/maws-userdata"` in front of it; `devenv start` already sets it.

The dev build still reads your Claude Code config home (`CLAUDE_CONFIG_DIR`, else `~/.claude` and
`~/.claude.json`) for sessions, history and trust, and sessions you start from it land there.
