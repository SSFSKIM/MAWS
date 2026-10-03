# Running MAWS

MAWS is an Electron app (electron-vite). `devenv up maws` installs it (`pnpm install`).

- `devenv start maws` runs `pnpm dev` in tmux session `maws`, window `dev`, and waits until the
  renderer's dev server answers at http://127.0.0.1:5173/. The app window opens on this Mac's
  display (it needs one: macOS only).
- `devenv status maws` shows whether it runs; `devenv stop maws` ends it.
- `tmux attach -t maws` shows the dev server's output.
