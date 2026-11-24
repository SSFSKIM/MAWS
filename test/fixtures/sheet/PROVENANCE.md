# The question sheet's published set, pinned

`set/` is doperpowers' `sminos/types/sheet/`, the published set of the question sheet (contracts X1, X2, X3, X4 and X7
of `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`), copied whole and byte for byte from the merge commit of
doperpowers pull request #628. The gate's runners have no sminos to read it from. Its own `README.md` says what each
file is. MAWS's reader (`src/shared/sheet/read.ts`, `src/services/sheet/reader.ts`) and the parsers of a stored call
and of a delivery are held to it by tests that walk its directories (`src/shared/sheet/*.test.ts`,
`src/services/sheet/reader.test.ts`); `src/shared/sheet/pin.test.ts` recomputes its digest and fails if one byte of
it moves.

| Set | doperpowers merge commit | sminos | set version | digest |
|---|---|---|---|---|
| `set/` | `2594002afc6ce00ddf43808791ac78705e80ab47` (pull request #628) | 1.57.0 | 1 | `594200ae4e539c0688c67b511968861d8ebf03c87d1c45b512903a538326e277` |

The digest is `MANIFEST.json`'s: the SHA-256 of the lines `<sha256>  <path>\n` of every file of the set but
`MANIFEST.json`, sorted by path.

**Never edit a file of the copy**, not even its invented paths (`/Users/me/...`) or its missing final newlines;
`.gitattributes` keeps git from converting any of it, and the linter ignores it. When the composite's writer rules a
change to the set, copy the directory again from the new merge commit itself, never from a checkout's files on disk:

    rm -rf test/fixtures/sheet/set && T="$(mktemp -d)"
    git -C <doperpowers> archive <merge commit> sminos/types/sheet | tar -x -C "$T"
    cp -R "$T/sminos/types/sheet" test/fixtures/sheet/set

then move the row above to that commit, the sminos version it published, and the manifest's `version` and `digest`.
