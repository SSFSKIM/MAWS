# HTML: guide

A self-contained HTML page you write and the user views inside MAWS: a report, a prototype, a visualisation, anything a browser renders from one file.

## When to use this kind

Use it for a page that should be looked at rather than co-edited: the user comments on it and you publish new versions. For a document the user writes in with you, use a `document`; for slides, a `presentation`.

## Creating one

Write the page to a file in the working directory, then call `artifact_create` with `kind: "html"` (the default), the file's `path` and a `title`. You may give a short `handle` (letters, digits, `.`, `_`, `-`; up to 64 characters) to name it in later calls instead of its id; a handle belongs to your session and the sessions above it, and another session may use the same handle for its own artifact. The page is copied into MAWS's store; the file you wrote is not watched afterwards.

## Reading and editing

`artifact_read` returns the page's text and its `revision`. To change the page, call `artifact_publish` with the artifact, the `baseRevision` your last read returned, and `files: {"index.html": "<the whole new page>"}`. A publish against an older revision than the live one is refused and names the live revision: read again, apply your change to what you read, and publish again. Every publish is a new version the user can open and restore; after the user restores an older version, your next publish must start from a fresh read.

## How it is shown

The page renders in a sandboxed frame with no network access: no external scripts, styles, fonts, images or requests. Inline everything (styles in `<style>`, scripts in `<script>`, images and fonts as `data:` URLs). Scripts run; forms, popups, navigation and nested frames do not. `artifact_screenshot` shows you the page as the user sees it, with the console errors it logged.

## Before you finish

Check the page with `artifact_screenshot` at the size the user will see it. Keep the page under 16 MiB.
