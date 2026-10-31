# maws-session-host: the session host

One small native process per lane B `claude` process (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M1; the holder
design's session host). It owns the child's pipes, numbers every stdout and stderr line into one sequence held in a
ring until the writer acknowledges it, applies stdin by offset exactly once, holds the writer fence, writes its roster
entry and serves one Unix socket, so the engine host above it can be replaced while the session runs. The protocol is
the document's Interfaces §A; the files are §B; the TypeScript side is `src/engine-host/holder/` (`protocol.ts` mirrors
`host/limits.go`, `files.ts` resolves the binary per shape).

    maws-session-host <launchId>.sock-path --hosts <profile>/supervisor/hosts    # the token on stdin, then EOF
    maws-session-host --version

The layout: `main.go` (arguments, signals, the token), `host/` (the process: the socket, the connections, the child,
stdin, the linger), `ring/` (the output ring), `proto/` (the wire form), `roster/` (the entry's atomic write). Std only,
no cgo, Go as `go.version` names it.

`prebuilds/{darwin-arm64,linux-x64,linux-arm64}/maws-session-host` are committed. The app carries the darwin build in
`Resources/session-host/` (electron-builder.yml), `mawsd`'s Linux pack its platform's build in `bin/`
(scripts/mawsd-pack.mjs), and a checkout runs the prebuild for its platform.

## Rebuilding

After any change here, with the Go `go.version` names first on PATH (the build script refuses another):

```sh
pnpm build:session-host          # scripts/build-session-host.sh: all three targets, each line `<target> <bytes> <sha256>`
scripts/check-session-host.sh    # rebuilds into a temp directory and compares bytes (the gate's static job runs it)
(cd native/session-host && go vet ./... && go test -race ./...)
```

Commit the prebuilds with their source, naming the Go version that built them. The builds are reproducible byte for
byte across build hosts (`-trimpath -buildvcs=false`, cgo off, every build variable pinned by the script), so CI's Linux
runner checks the darwin build too.
