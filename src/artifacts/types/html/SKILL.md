# HTML: guide

A self-contained HTML page you write and the user views inside MAWS: a report, a prototype, a visualisation, anything a browser renders from one file.

## When to use this kind

Use it for a page that should be looked at rather than co-edited: the user comments on it and you publish new versions. For a document the user writes in with you, use a `document`; for slides, a `presentation`.

## Creating one

Write the page to a file in the working directory, then call `artifact_create` with `kind: "html"` (the default), the file's `path` and a `title`; or give the page's text as `content` instead of a path. You may give a short `handle` (letters, digits, `.`, `_`, `-`; up to 64 characters) to name it in later calls instead of its id; a handle belongs to your session and the sessions above it, and another session may use the same handle for its own artifact. The page is copied into MAWS's store; the file you wrote is not watched afterwards.

## Reading and editing

`artifact_read` returns the page as its one file, `files: {"index.html": "…"}`, with its `revision`; `artifact_create` and `artifact_publish` return the revision they wrote too. To change the page, call `artifact_publish` with the artifact, the `baseRevision` your last read (or create, or publish) of it returned, and `files: {"index.html": "<the whole new page>"}`. If the user changed the page since (an edit, or a restore of an older version), the publish is refused naming it: read again, apply your change to what you read, and publish again; `force: true` overwrites their change, as a last resort. A `baseRevision` other than your last read's is refused and names the live revision; after MAWS restarts, read before you publish. Every publish is a new version the user can open and restore.

## How it is shown

The page renders in a sandboxed frame with no network access: no external scripts, styles, fonts, images or requests. Inline everything (styles in `<style>`, scripts in `<script>`, images and fonts as `data:` URLs). Scripts run; forms, popups, navigation and nested frames do not. `artifact_screenshot` shows you the page as the user sees it, with the console errors it logged.

## Live data from connectors

A page may read an MCP tool the user's sessions have (a connector, a local server) through `window.mawsConnectors`, never through the network. It declares the tools it uses, and the user allows each one from the page's Connectors action in the header; a declaration allows nothing by itself. Each call runs only while the page is on screen, through a live session in the artifact's project that has the server connected; with none, the call reads `paused` and the user may start the session from the same place.

```js
const tool = { server: 'analytics', tool: 'daily_signups' };
await mawsConnectors.declare([tool]);
const show = (answer) => (answer.ok ? draw(answer.result, answer.fetchedAt) : showState(answer.state, answer.reason));
show(await mawsConnectors.call({ ...tool, args: { days: 30 } }));
const watch = await mawsConnectors.watch({ ...tool, args: { days: 30 }, intervalMs: 300000 }, show);
if (watch.ok) stopButton.onclick = () => watch.stop(); // only a started watch has stop() and refresh()
else showState(watch.state, watch.reason);
```

The answers have different shapes:

- `call` and each `onUpdate` of a watch: `{ok: true, result, fetchedAt, via}`, the tool's result.
- `declare`: `{ok: true, declared}`, the tools declared so far; it allows nothing.
- `watch`: `{ok: true, watchId, intervalMs, stop(), refresh()}`, the watch itself; its data arrives through `onUpdate`.
- Any of them refused: `{ok: false, state, reason}`, with `state` one of `paused` (hidden, closed, noRoute, unavailable), `revoked` (notGranted, fingerprintChanged, wrongMode, revoked), `invalid` (request, lease, undeclared, notReadOnly, watchLimit) or `failed` (toolError, malformed, tooLarge, routeFailed). A refused watch has no `stop` or `refresh`.

A watch refreshes a read-only tool every 30 seconds to 24 hours while the page is shown. A tool that may change data is never watched and runs only when the user allowed it once. Show the state the page is in (for example "Waiting for permission", "Paused: no live session") and the time of the data you show, never an empty chart.

## Before you finish

Check the page with `artifact_screenshot` at the size the user will see it. Keep the page under 16 MiB.
