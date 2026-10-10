# peer-auth: the peer identity addon

`peer-auth.c` is a Node-API addon of three system calls that tells a Unix-domain socket's server who is on the other end:
`peer(fd)` (the peer's pid through `LOCAL_PEERPID` and its uid through `getpeereid`), `process(pid)` (its parent and start
time through `proc_pidinfo`) and `version`. The policy over it, whether the peer descends from a known process instance,
lives in `src/main/browser/cua/peer.ts` and guards MAWS's per-session browser socket. cua carries the same addon for its
client-mode relay (`native/peer-auth/` and `src/chrome/peer.mjs` there). The design is cua's
`docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md`.

`prebuilds/darwin-arm64/peer-auth.node` is committed: Node-API is ABI-stable, so the one file loads under Electron's Node
in the app and under the Node that runs the unit tests, and a checkout needs no compiler. `electron-builder.yml` copies it
to `Resources/peer-auth/peer-auth.node` in the packaged app. If it is missing or fails to load, the browser socket refuses
every peer (`module_unavailable`).

## Rebuilding

Only when `peer-auth.c` changes, on an Apple silicon Mac with the Xcode command line tools:

```sh
pnpm build:peer-auth   # scripts/build-peer-auth.sh; prints the prebuild's path
```

Then keep the two repositories in step:

1. If an export changed shape or meaning, bump `PEER_AUTH_VERSION` in `peer-auth.c` and in both loaders
   (`src/main/browser/cua/peer.ts` here, `src/chrome/peer.mjs` in cua).
2. Copy `peer-auth.c` and `prebuilds/darwin-arm64/peer-auth.node` to cua's `native/peer-auth/`. The two copies of the
   source must be byte-identical; the build fixes the install name, so either repository builds the same bytes.
3. Update `PEER_AUTH_SOURCE_SHA256` (the source's `shasum -a 256`) in `src/main/browser/cua/peer.test.ts` here and in cua's
   `test/chrome-peer.test.mjs`; each test fails until its repository's copy matches the pinned hash.
