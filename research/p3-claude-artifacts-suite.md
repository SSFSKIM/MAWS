# Claude's Artifacts suite, read from the clients (input to P3)

Read on 2026-10-12. Citation roots:

- `D/` is `~/claude-desktop-re/readable/app-2.16120.0/` (Claude Desktop, shipping the claude.ai web app).
  - `v1/` is `D/web/app/v1/`.
  - `rt/` is `D/web/_frame-rt/_runtime/app/`, the in-frame runtime.
  - `EAP` is `v1/186b60073649e3aeedea83165d035d191ef234dc480eea74-BATYe0qD.js`.
  - `TYP` is `v1/b03b6ea1dc66a73c3f0c8c7056bc585a7ff25b9b2f7b2093-lGAJW5s1.js`.
- `CC:<n>` is line `<n>` of `~/claude-code-bundle/2.1.292/cli.pretty.js` (Claude Code, the agent side); `CC/m/` is its `modules/` directory.

## 0. The shape both clients assume

**Every kind is an Artifact type.** Each type (Slides, Design, Design System, Docs (key `pages`), Sheets, Dashboard, Whiteboard, Tasks, Animation) is itself a server-hosted artifact at `claude.ai/code/artifact/<uuid>`, with fixed slugs (`TYP:128-208`; `v1/shared-12-B9BdYqAB.js:1408-1449`).

**A type's fixed files:**
- the editor page `index.html`;
- `SKILL.md`;
- reference pages under `artifact-type/reference/`: `format.md`, `fonts.md`, `craft.md`;
- for Slides, also `deck-files.md`; for Design, also `design-system-components.md` (`CC:581392-581395`).

These are served by `GET /api/frame/types/{slug}/files/{path}` (`CC:936384-936395`).

**An instance** is "a private copy of the type's current release" plus files of its own (`CC:115788`, `CC:340246`). Agents must never publish `index.html`, `SKILL.md` or anything under `artifact-type/` (`CC:936081`).

**So each kind's editor, content dialect and validator are server-delivered type code that runs in a sandboxed frame. None of it is in either client.** The web app is the shell around the frame: chrome, exports, comments, versions and sharing.

## 1. Slides

**Storage (verified).** A deck is files under `project/` (`CC:936081`; `CC/m/slides-zdpeg77q.md:1`):
- the index `project/deck.json`;
- one `project/slides/<id>.html` per slide, holding "exactly one `<section id="<id>">` in the slide format";
- speaker notes, when present, as a plain-text `<aside>` that is the section's last child.

**The `deck.json` fields** (`CC:936081`; `CC/m/slides-zdpeg77q.md:10-12`; `CC/m/slidesTwoSteps-1shjmnfb.md:11-14`):

| Field | Value |
|---|---|
| `v` | `4` |
| `title` | deck title |
| `order` | slide ids in deck order |
| `sections` | `{id: {description, start: <slide id>}}` |
| `faces` | `{family-id: {family, href}}`, with a Google Fonts `href` or an uploaded `src` |
| `designSystems` | `[]` |
| `attachments` | `{}` |
| `createdOnFiles` or `convertedFrom` | `createdOnFiles` is `{v:1, at}` |

**Editing rules** (`CC/m/slides-zdpeg77q.md:38`):
- Send the index only to retitle, reorder, add or remove slides, or change sections or typefaces, and keep every other key.
- To delete a slide, map its file to `null` and take its id out of `order`.

**The old store layout.** The pre-files layout kept store documents `deck/meta`, `deck/design-systems`, `fonts/<family-id>`, `slides/<id>` and `notes/<id>`. `convertedFrom` marks a deck migrated from it (`CC:936081`).

**The dialect is not in either client.** None of the owner's described rules appear in `D/web`, `D/main-process` or `CC`:
- the 1920x1080 canvas;
- the closed list of inline styles;
- `x-shape`, `x-icon`, `x-connector`, `x-embed`;
- the 16 KB and 8-per-slide limits.

The rules live in the type's `format.md`, which Claude Code inlines on create and prints to the agent (`CC:581395`). A type-side "slide-file check" exists: it once rejected the `<aside>`, and "that check predates notes in slide files" (`CC:936081`). Its rules are not visible.

**Editor capabilities belong to the type page and are also invisible.** Traces in the clients:
- the admin blurb "start decks they can present, restyle with a design system, and export to PowerPoint" (`D/i18n-web.json:312`);
- a `/slides` prompt command (`v1/shared-12-B9BdYqAB.js:9447-9475`).

**Export.**
- The page declares its own `actions`, `exports` and `destinations` to the shell (`v1/frame-shell-deferred-Bo71SaTG.js:11644-11672`).
- The Download menu lists the formats, including PDF via the browser print dialog and PowerPoint with three variants: "Current fonts", "Basic fonts" and "Slides as pictures". "Send to" offers Google Slides, Google Docs and Notion (`v1/frame-shell-chrome-CXu04DiJ.js:29171-29302, 29393-29409`).
- To export, the shell calls the page's `download(format, confirm, variant)` (`frame-shell-deferred:11634-11640`). The page returns bytes through the runtime's `downloads.save({filename, bytes})` (`rt/downloads.axDW2QAi.js:185-222`).
- On a timeout the shell reports "The Artifact didn't produce the file in time" (`frame-shell-chrome:29205`).
- The web bundle contains only the PPTX MIME type, no writer (`v1/frame-shell-broker-nYVT-Jae.js:11568`). **So the Slides type's own page builds the PPTX in the browser; which library it uses is unknown.**

## 2. The Artifact tool and publishing

**Actions** (each gated per session, `CC:115674-115702`):
- publish (the default), list, read;
- list_types, describe_type, quickstart;
- comments, reply, resolve, watch;
- read_db, write_db;
- upload_asset, list_assets, read_asset, delete_asset, copy_from;
- list_files, read_file;
- delete, preview, open, pin, share.

**Publish fields** (`CC:115781-115800`):
- `file_path`;
- `files`, a map of published path to one of: a local path, `{from, contentType}`, `{artifact, path, ver}` (a server-side copy), or `null` (remove the path). Files left out of the map are kept.
- `root`, `url`, `type_url`, `title`, `description`, `icon`, `label`, `pin`;
- `force`, "Last-resort overwrite that DISCARDS the newer published version".

**On the wire:**
1. `POST /api/frame/deploy/prepare` reserves a slug (`CC:426508`).
2. `POST /api/frame/deploy/direct` sends `{files, baseVersion | force}` (`CC:426843-426846`).
3. The response is `{slug, version, seq, unchanged, appliedOver, mergedFrom, changed[{path, sha256}]}` (`CC:427580-427587`).

**Three concurrency layers:**
1. **The client guard in Claude Code.** The session records which version it has read. A publish built on an older one is refused before it is sent: "You haven't viewed the latest version of this artifact (the content host is serving version N), so nothing was published" (`CC:629617-629619`).
2. **Server file-level merge.** If no file in the publish changed since `baseVersion`, the server applies the publish on top of the newer version. The agent then gets "Merged over a newer version … Changed or added: …" (`CC:337672-337690`).
3. **The refusal that names the stale files.** Otherwise the server answers 409 `precondition_failed` with `paths`, and the agent sees: "conflict: nothing was published — a newer version (N) saved from inside the page (someone's edits or input on it) changed files this publish writes or removes: … Read it again, re-apply your change" (`CC:427710-427724, 427839-427850`). The `liveEntry` field says whether the newer version came from a human save (`page`/`editor`) or another agent (`publish`).

**Human edits go into the same versioned file set.**
- The type page saves through `artifact.publish(files)`: at most 256 paths, each with an optional `ifMatch` sha256 (`null` means the file must not exist yet). A delete is `{delete:true, ifMatch}` (`rt/artifact.w_ePPE-a.js:435-520, 8685-8696`).
- The agent's store writes carry an `if_version` pin per document (`CC/m/appifact_sdk.js-852e8bcb.txt:119-176`).

**Assets.**
- `upload_asset` accepts images, video, PDF, fonts, CSS, JS and text, and returns `{url, id}`. The `url` goes verbatim into a slide or a `faces` entry (`CC:61699`; `CC/m/slides-zdpeg77q.md:1`).
- The endpoints are `/api/frame/blob/{slug}/agent-upload|agent-list|agent-copy|{id}/agent-delete` (`CC:607771-607780`).

**`AppifactRepl`** runs one JavaScript program per call against an artifact, with:
- `claude.use("files")`: `list`, `read`, `readMany`, `dir`, `publish`;
- `claude.use("assets")`;
- `claude.use("db")` (`CC:1009867`).

A new deck streams in as one index call followed by parallel per-slide calls (`CC/m/slidesTwoSteps-1shjmnfb.md:5-33`).

**An instance holds** the type's fixed files, its own `project/` files, an asset store, an optional document store (`CC:61707`), comment threads and versions.

Reading an instance's URL returns the type's `SKILL.md` and marks that version as viewed (`CC/m/slidesTwoSteps-1shjmnfb.md:3`).

## 3. Docs

**Server-owned from end to end.** The client holds none of these:
- the connector's tool schemas;
- its read format (block outline, block ids);
- its write syntax (markdown, chip markers for dates, mentions, dropdowns);
- block kinds or limits;
- the editor.

**The connector.**
- A hosted MCP server at `/v1/pages/mcp`, UUID `1a59c906-04da-521d-bda7-7f71b9f9e01c`, named `Claude_Docs` or `Claude_Pages` (`CC:683514`).
- Its tools are `read`, `create`, `batch`, `update` and `delete` (`v1/c49573414-BNU1LVNS.js:101-102`). Their schemas are fetched at runtime.
- **Addressing goes project → tab → node.** `read` takes `ref {"object":"project","id"}` and returns the tab and root-node ids. Writes target `container {kind:"project", id}`, and `batch` members "update node <nodeId> (the tab's prose root)" (`CC:629302-629310`).
- Creating a Docs instance provisions `{store:"pages", project_id, file_id (tab), node_id (root)}`, and "nothing is published to this URL for its content" (`CC:936209-936216, 629311`).
- The connector renders live charts from rows (`CC:355274`). It ships its own skill, which is not in the bundle (`CC:333805`).

**Comments.**
- **Platform thread anchors** are `{path, x, y, span{start, quote≤512B}, pin, sig, file, file_sha, label, detail, region, moved_at}` (`v1/frame-shell-chrome-CXu04DiJ.js:2512-2650`).
- **Docs uses "custom anchors, headless"**: the page owns its threads and names the anchors, either by an id or by a DOM path (`v1/c1427ca47-Cjb6IW71.js:286-306`; `rt/comments.DrhK3r8W.js:968-1325`).
- **REST:** `/api/frame/comments/{slug}/…`, including `resolve`, `activate`, `move` and `to-claude` (`frame-shell-chrome:3015-3060`).

**Send to Claude.**
1. The server stamps `to_claude_at`.
2. The client posts a seeded user turn, "[Artifact comment(s) sent to Claude]". It carries the comment fenced between nonce'd BEGIN/END lines and a `<comment-anchor-context>` block (`v1/c26621f4a-W16FwhZ_.js:146-178, 566-700`).

If delivery fails, the user sees "Marked as sent to Claude, but …" (`frame-shell-chrome:16079-16160`).

**The agent side** is `ArtifactComments` (read, reply, resolve, watch). Replies go only to threads a writer activated, at most 4096 bytes (`CC:115750, 115781`). For Docs, the agent must instead reply through the connector's own comment tools, whose names are not visible (`CC:332194-332227`).

**The page↔shell contract.** The page reports:
- `saved` as one of `saved`, `saving`, `unsaved`, `reconnecting` or `readonly`;
- an `unresolved` count;
- up to 16 actions and 8 exports (`frame-shell-deferred:3227-3420`).

Its menu ids include `version_history`, spelling, autocorrect, `save_now`, find, `comment_selection`, and export to docx, PDF, markdown, Google Docs and Notion (`v1/shared-frame-Drps9hvI.js:22615-22700`).

## 4. Design System artifacts

**Files layout** (`CC:936081`):
- the index `project/design-system.json` (`v:3`, `layout:"files"`, `title`, `namespace`, `libraries`, `assetGroups`);
- `project/README.md`, the guide;
- `project/tokens.json`;
- `project/components/<Name>/README.md`.

Agents never write the generated `tokens.css`, `api/` cards or `manifest.json`. Icons and images are assets listed under `assetGroups`.

The older store layout used `ds/meta` and `ds/tokens` (`CC:694320-694414`).

**The client's import limits** are 100 files, 8 MB in total, 1 MB per file and 12 fonts (`CC:8445-8500`).

**`tokens.json` is not described in either client.**

**How a design system is built.** The type's start screen offers three paths:
- "Sync from GitHub" (import tokens and components from code);
- "Build from connectors" (design tool, repo, drive, wiki; with none, a few brand questions);
- "Upload brand files" ("logos, fonts, brand guidelines, token files") (`TYP:1754-1790`).

Settings also offer "Using Claude Code: Extract the design system from this codebase" (`TYP:2523-2535`). The older `/design-sync` skill instead pushes a bundled React system (`_ds_bundle.js`, `styles.css`, `tokens/`, `components/…`) to the standalone claude.ai/design product (`CC/m/SKILL-b6859017.md:14-21`).

**How a deck or canvas picks one.**
- `quickstart` lists Design System instances via `/api/frame/types/{slug}/instances`.
- The default is resolved effective → user → org, and the agent uses it "without asking unless the user named another". The default's README is attached (`CC:936758-936800, 332855, 694283-694300`).
- The deck or canvas's first publish installs `project/ds/<folder>/tokens.json` and a `designSystems` record. Slides marks the record `"unpinned": true`; Design also copies `components/bundle.js`, `bundle.css` and `tokens.css` (`CC:8703`).
- `tokens.json` goes in "so the editor offers its colors" (`TYP:2689-2693`).

**Defaults.**
- `GET /api/frame/types/defaults` and `PUT /api/frame/types/{type}/default/org {artifact_slug}` (`v1/c2f2bf079-BvH43cBt.js:172-440`).
- A 422 means the system is not yet shared org-wide.

**Restyle** is visible only as product copy.

## 5. The Artifacts library page

**Tabs.** `/artifacts` (also `/code/artifacts`) has five tabs, which map to the server's `rel` value (`v1/c230724a2-DWuksccS.js:1735-1781, 1914-1920`):
- All;
- Pinned, shown once something is starred;
- Yours;
- Shared with you;
- Projects (gated).

**Data.** `GET /api/frame/artifacts?rel&q&type&org`, paged by `page_token` (`v1/shared-12-B9BdYqAB.js:701-703`).
- Search is the server-side `q`, with the caveat "Search covers only the artifacts loaded so far" (`c230724a2:2519-2531`).
- The type filter, "Filter by type", takes up to 16 slugs or "Other" and shows a count per type (`EAP:5676-5852`).

**Grouping.**
- The list view groups by Pinned, Today, Yesterday, each day of the last week, each month, Older, and "By invitation" (`v1/cabf52553-rjq4kRuw.js:775-820`).
- The grid view is flat. There is no sort control.

**Cards** show title, audience (Private, Organization, People or Public), "By {name}", "Edited {time}", view count and thumbnail. The menu offers Pin, Rename, Duplicate, Copy link, Share and Delete (`cabf52553:490-1000`).

**Pins** use `POST`/`DELETE /api/frame/favorite/{uuid}` and are private to the user (`shared-12:7596-7690`).

**"Make something new"** shows "By Anthropic" cards, one per type, each with a prompt prefill (`EAP:4801-4880, 5048-5060`). A blank create calls `POST /api/frame/types/{slug}/create` (`v1/ea9bd7236523e603ba8205a2647e1d349c9c35aac3d9e1dd-ZBYpHIem.js:39-60`).

**"Spaces"** are share audiences, not library groups. Each artifact has a "Show in Artifacts list" toggle (`frame-shell-chrome:37128-37136`).

## 6. Design and Dashboard

**Design** (slug `bcd2878f-…`, beta):
- **Index:** `project/canvas.json` (`v:3`, `title`, `launch:{view:"canvas"}`, `pages`, `notes`, `designSystems`, `attachments`) with `boards: {"<Name>.dc.html": {x, y, w, h, …options}}` in CSS px and `order` back to front.
- **Artboards:** one `project/<Name>.dc.html` per artboard, with support files beside it (`CC/m/design-6m4nsdef.md:10-19`; `CC:936081`).
- **What `.dc.html` is:** the examples write HTML fragments (`CC/m/designTwoSteps-g0bev2xr.md:21`). Whether it is a stricter dialect is in the server's `format.md`.
- **Who writes the index:** only the editor writes `canvas.json` (`CC:936081`).
- **PDF:** the desktop `DesignPdf` service prints the standalone claude.ai/design window, not artifacts (`D/main-process/index.chunk-kXuYPTnM.js:286650-287295`).

**Dashboard** (slug `7dfcf06e-…`):
- Described as "Charts, numbers and tables from your data, each marked with its source" (`EAP:4880`).
- It is absent from the file-layout map, so its storage is defined by its `SKILL.md`, which is not visible (`CC:340244`).
- Pages can draw on these runtime capabilities:
  - `mcp.callTool` and `watchTool`, with refetch clamped to 30 s to 24 h, at most 64 watches, user-gated (`v1/frame-shell-broker-nYVT-Jae.js:21701-21702, 24774, 26405-26480`);
  - `db` (`rt/db.zFlAA4qL.js:907-919`);
  - `endpoints`, `sample` and `network`.

## 7. Version history

**The server's version model** is `{live, history[], versions{id: {seq, created_at, title, label, author, note, snapshot_id}}}`, delivered to owners and writers (`v1/c1427ca47-Cjb6IW71.js:250-284`).

**The title menu** shows "Version history, {count} versions". Each row reads "Version {n} · {when} · by {name}" plus "Current" (`v1/c2bb74286-Caggaaau.js:1495-1515`; `v1/ca324bb72-Dr1L0BAy.js:178-290`).
- **Authors** come from the `author` account, resolved through the org directory. An agent-owned version with no author shows "Claude".
- **Endpoint:** `GET /api/frame/versions/{uuid}` (`ca324bb72:326`).

**Viewing and copying old versions.**
- An old version opens as a preview with "back to live" (`frame-shell-chrome:12995, 55380`).
- "Duplicate Version {n}" calls `POST /api/frame/duplicate/{uuid}?ver=` (`v1/cb15bff45-DrHCn1Sk.js:59-61`).

**There is no restore button and no diff.**
- "Restore this version" belongs to the admin settings (`v1/c71860c77-XW5MG7G9.js:13417-13458`).
- Only "Same doc as v{n}" (two versions with equal `snapshot_id`) and "Older versions are no longer available" exist (`frame-shell-chrome:12881-12935`).

**Named checkpoint ("Save version").** Live docs offer a "Save version" dialog with "Label" (placeholder "e.g. Draft to legal") and "What changed". It posts `POST /api/frame/self/{uuid} {mode:"patch", label, note, baseVersion}` (`frame-shell-chrome:54202-54300`; `v1/frame-shell-broker-nYVT-Jae.js:22763-22880`).

**Pinning what viewers see.** The permissions field `shared` is either `""` (Latest) or a pinned version id: "A numbered version stays the same until you pick a new one" (`frame-shell-chrome:33337-33346, 37581`).

**For type instances whose content lives outside frame versions** (`contentOutsideVersions`, e.g. Docs), the page supplies `version_history` itself (`frame-shell-chrome:56208-56226`).

**The agent side.**
- `list` with a `url` returns that artifact's versions.
- `read` with `url` and `version` saves that version to a file, "which you can publish to the same `url` to put it back" (`CC:61707, 115559-115590`).

## Unknowns

All of these are server-owned, or not found in either client:

- The slide dialect and its validator (`format.md`, the slide-file check). This is where the owner's described rules would be confirmed.
- The slide editor's UI: theme menu, text-style menu, presenter mode, zoom.
- The PPTX library.
- The Docs connector's schemas: read outline, block ids, chip syntax, block kinds, comment tools.
- The Docs editor's node schema and history UI.
- `tokens.json` and the `designSystems` record shape.
- What `.dc.html` allows, and the board options.
- Dashboard's storage and refresh.
- The server's merge rule beyond "no sent file changed", and version retention.

**Next probe.** In a claude.ai-authenticated Claude Code session, read each type's files (`describe_type`, then `GET /api/frame/types/{slug}/files/artifact-type/reference/format.md`) and run `tools/list` on `/v1/pages/mcp`.
