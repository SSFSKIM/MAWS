# HTML: format reference

One HTML document, stored and versioned as bytes. MAWS does not parse or rewrite it.

## Structure

A complete document (`<!doctype html>`, `<html>`, `<head>`, `<body>`) is best; a fragment is shown as the browser parses it. In `artifact_publish` and `artifact_read` the page is the artifact's one file, `index.html`.

## What the frame allows

Scripts and styles inline or from `data:` and `blob:` URLs; images, fonts, media and fetches from `data:` and `blob:` only; workers from `blob:`; no frames, objects, forms, base URL or navigation. A request to any other URL fails, and `artifact_create` reports how many external URLs it found.

## Connector calls

`window.mawsConnectors` is defined in every page MAWS frames: `declare([{server, tool}])` answers `{ok: true, declared}`, `call({server, tool, args?})` answers `{ok: true, result, fetchedAt, via}`, and `watch({server, tool, args?, intervalMs}, onUpdate)` answers `{ok: true, watchId, intervalMs, stop(), refresh()}` and passes each refresh to `onUpdate` in the shape of a call's answer; any of them may instead answer `{ok: false, state, reason}`, which has no `stop` or `refresh`. `server` and `tool` are the names the session's MCP status reports; `args` is a JSON object of at most 64 KiB. A page declares at most 128 tools and MAWS runs at most 64 watches at once.

## Limits

16 MiB per page. Every published version is kept until the user deletes the artifact or history thinning drops an automatic one.
