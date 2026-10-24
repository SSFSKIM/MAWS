# UX directions: the living record

The ongoing UX discussion with the owner: their observations verbatim, the directions distilled from them, the questions still open, and the architect's proposals. It feeds the enhancement wave cut from the comparative UX assessment (P4) and stays open after it; each entry is dated and appended, never rewritten. The assessment's reports and every vendor screenshot live outside the repo in `MAWS-notes/ux-comparison-2026-10-23/` (the owner's under `owner-notes/`); the owner's general taste note is `../wr/owner-marks-2026-10-23.md`.

## Directions

Each direction cites the observation it comes from (O1, O2, …, below). A direction is the owner's intent in a line, not yet a design.

- **D1. The main area is the main thing; side surfaces are optional and quiet** (O1). The side panel opens only when wanted, takes neither width nor attention by default, and still tells the person what it can do.
- **D2. Side surfaces are icons, one surface per icon, in a compact top-right row** (O1). Terminal, diff, browser, files, and later source control and a subagents view; less-used ones (side chat, background work, plan) behind an overflow menu. Adding a surface then costs no space.
- **D3. The default side view is a column of folded cards that floats over the main area** (O1). It belongs to the main area's right side rather than being a dedicated column: environment (machine, folder, branch, remote control), context, connectors (the MCP servers this session uses), each folded with a one-line summary.
- **D4. Because the side view is cards, new capability arrives as a card** (O2). First candidate: an artifacts card below Connectors, the project's artifacts at a glance, with a way to look at another project's.
- **D5. No Needs-you section; a waiting session is marked by a coloured dot on its own row** (O3). Claude Desktop has no gathered section and marks each session row instead (orange for waiting on the person, blue for running).
- **D6. The sidebar's top carries the app's destinations** (O4). Today it holds only search above Needs you and the project tree. Following Claude Desktop (search, New, Projects, Artifacts, Customize, More): add Projects and a Customize page that gathers skills, plugins, marketplaces, connectors and the like, beside the existing Artifacts library. Lens 8 of the assessment found the same gap from the other side (l8-settings-02: plugins, skills and connectors open only as a modal over a session's composer, Settings has no section for them; it proposes a Customize tab reusing the library components, with a project picker).
- **D5, revised by the owner (batch 1, l1-sessions-05 and -06):** keep Needs you, but smaller: the person only needs to know which session to visit. Per-row status marks (D5's dots) stay compatible with it.
- **D7. A session row carries only what tells sessions apart; detail goes in a hover card** (batch 1, l1-sessions-10; O5). A worktree session shows only a branch mark at the row's left, the status mark moves right beside the age, the branch name and more go in a card on hover, and ⋯ on hover holds rename, fork and the rest. The hover card can answer the session (Claude Desktop's quick reply).
- **D8. The sidebar can narrow to the sessions of one project or a chosen set** (O6): a small button beside the Projects heading shows only the current session's project, a second click shows all again, and hovering it lists projects to choose from. Clicking a project still folds its sessions.
- **D9. Space follows attention** (O6): the sidebar is compact by default and the default side view is small, so the main area is spacious; a surface the person opens from the side (artifact, diff, browser) gets real width, because opening it means looking at it rather than the session.
- **D10. The transcript renders what the agent wrote, structured as it wrote it** (batch 1, l2-transcript-03, -01): line breaks kept, the to-human style's text as produced rather than boxed; tool calls as Claude Desktop's block rows, each named by a one-line summary rather than its raw command ("Ran /skill", "Used <MCP>"), with input and output, and edits, shown only on demand the way Claude Desktop shows them.
- **Settled by the owner, 2026-10-24 about 00:05Z (answers to the architect's questions):** on D10, all as written: MAWS renders no cards for the to-human style (Message, Must read, Insight); the tags are hidden and `<message>` text stays in the flow tinted orange as the mod does, Critical and Insight as the agent wrote them ("We just become a pure mods client. if something is wrong with to-human mods rendering, I'll change the mods not MAWS"). On D7, the row as the architect drew it (⎇ at the left for a worktree, status mark at the right beside the age, branch name in the hover card, ⋯ on hover), with the hover card to the right of the row, not below it. On D1 to D3 and D9, a mockup round first, the owner approving before it is built ("I'll reference Claude Desktop's own design a lot too").

## Open questions

- **Q1. What becomes of the tabs inside today's right panel?** Claude Desktop has none (O1). The architect's first position is P1 below; lens 7 of the assessment lays out options with screenshots.
- **Q2. The artifacts card and the Library** (O2). MAWS already has a top-level Artifacts library with Spaces (charter §19, the P3 paragraph) and a session-scoped artifacts surface in the right panel. Is the card the panel's window onto the Library (this project's artifacts, a project switcher, open in place or in the Library), or a new registry with its own scope? Its name is open too ("Artifacts Registry" was the owner's working name).
- **Q3. What carries cross-project attention once the section goes?** (O3) Lens 1 of the assessment judged MAWS's Needs-you section, ⌘⇧J, the Overview and the dock badge ahead of both references: in its run three waiting sessions in three projects sat together at the top while the tree below was filtered by an unrelated search, where Claude Desktop scatters the same state as dots. With dots alone, a waiting session in a collapsed or scrolled-off project is out of sight. The architect's proposal is P2.

## Architect's proposals

- **P1 (2026-10-23, on Q1).** Today's panel tabs become the icon row of D2: a click opens that surface alone, a second click closes it. Tabs survive only inside a surface that holds several of the same thing (browser pages, open files), never to choose between surfaces. The default view is D3's folded floating cards, so the main area keeps its width until something is opened. Would change if supervising many sessions needs two surfaces visible at once (diff beside terminal); then a split inside the panel is the question, not tabs.
  - *Evidence, 2026-10-23 23:48Z (lens 7's follow-up, hands-on):* Claude Desktop does keep tabs inside one surface, a tab per open file in its Files pane and terminal tabs in its terminal, so its rule is icons between tools and tabs within a tool, which is P1. Lens 7 recommends the same (its option B, `l7-shell-04`): each session remembers its open set (D-10), pinning becomes a right-click on the icon, ⌥-click stacks a second surface below.
- **P2 (2026-10-23, on Q3).** Remove the section and put D5's dots on the rows; keep the cross-project reach without the space: ⌘⇧J still jumps to the next waiting session across projects, a collapsed project shows a dot on its header when a session inside it waits, and the waiting count stays on the dock badge (and, if wanted, as a small count beside the sidebar's title). Would change if the owner wants dots and nothing else.

## Observations

### O1. Side panel and toolbar (2026-10-23, about 23:00Z)

> another note on UX: pursuing simplicity (what meant by efficient use of spaces) -- if you look at [Image #4] (Claud Desktop)'s implementation, they've folded componenets: right top icons all contains browser, folder(editor), and extras on three-dots ([Image #5] has bg jobs there, sidechat (btw), and more) browser, terminal, diff, folding sidebar -- all of those sidebar options are compactly shown via icons. and because it's icon-style placed at the top of app, adding another is not burdening too: like we can add source control, subagents view, and more, through this way (placing them in compact icons that shows only when clicked)
>
> and their default side panel if you look at it, [Image #6] is also made to be quite compact. context, artifacts, connectors (mcp list, especially those that are used in sessions) are folded by default, and the default side panel itself even exists as a floating component, not dedicated panel (and this makes the main space look more spacious, make overview componenet not a dedicated sidebar that takes up a space but a component that belongs to the right side of the main space. putting Env, cwd, branch would be good too.
>
> side panel should be something like optional -- user wants to see main panel as main, and side is only whe they're needed.
>
> side panel is great for functionality, but important part is to make it not distract attention from main. User can know what they can do with side panels but at the same time not taken away enough attention and space by it.
>
> this could be more opened questoin on how we can adop their designs too, but above is my thoughts and observations. Claude Desktop made sidebar functionality to be both very effectively acknowledged by user and compact in space. How to address tab-within-sidebar could be also a question becuase Claude Desktop don't have tabs-within-sidebar

Screenshots (Claude Desktop 3.6556.2): `owner-notes/claude-side-panel-environment.png` (Image #4: the top-right icon row of side panel, terminal, diff, browser, folder and an overflow menu, above folded cards for Environment with machine, folder, branch and Remote Control, Context at 9%, and Connectors with 5 connected), `owner-notes/claude-toolbar-overflow-menu.png` (Image #5: the overflow menu with Side chat ⌘;, Background work, Plan, iOS Simulator and a per-session Prevent sleep toggle), `owner-notes/claude-side-panel-floating.png` (Image #6: the same cards floating over the main area rather than in a dedicated column).

### O2. The side panel as components (2026-10-23, about 23:10Z)

> make this ongoing discussions on UX, collect observations and enhancement directions, [Image #7] like because side panel is component based, it's also easy to add things -- like we can probably add another component below the 'connector' and name it like "Artifacts Registry" (?) that allows user to view artifacts from that project or another project if they choose to

Screenshot: `owner-notes/claude-side-panel-cards.png` (Image #7: Claude Desktop's folded cards, Environment, Context and Connectors, with empty space below where another card would go).

### O3. Needs you (2026-10-23, about 23:20Z)

> another: let's remove Need You. [Image #9] Claude App just replaces this with color dots on each sessions, and that seems better and efficient

Screenshot: `owner-notes/claude-sidebar-status-dots.png` (Image #9: Claude Desktop's sidebar, sessions grouped by project with an orange or blue dot at the end of a row and no gathered section).

### O4. The sidebar's top (2026-10-23, about 23:25Z)

> they have 'customization' and Projects too on left top panel which I think is good too. Our left top panel has too-nothing, and adding 'Projects' and 'Customization' (loads Skills, Plugins, Marketplaces and more) could be good.[Image #10]

Screenshot: `owner-notes/claude-sidebar-top-nav.png` (Image #10: Claude Desktop's sidebar top, search, New, Projects (beta), Artifacts, Customize and More, above the sessions grouped by project with status dots).

### O5 and O6. Hover cards, a project filter, spaciousness (2026-10-23, about 23:55Z, with marks batch 1)

Screenshots: `owner-notes/claude-sidebar-hover-quick-reply.png` (Image #19: Claude Desktop's hover card on a sidebar session: title, "Claude asked · …", and a reply field); the tool-row references named in batch 1 are copied as `owner-notes/claude-tool-rows-summaries.png`, `claude-turn-receipt.png` and `claude-tool-input-output.png`.

> [Image #19] --> hovering on sidebar's session showing and allowing human to choose on that seems good. This implementation is in Claude Desktop
> another observation: 
> 
> 4. On project view — let’s add an option on sidebar to:
>     1. Optionally make only the session from certain project shows up on sidebar. Currently the default behavior when user clicks the project card on the left sidebar is that it folds the list of sessions under that project card. Keep that behavior, but we can add another small button next to  “PROJECTS” that, when clicked, make right sidebar show only the sessions from the project of currently loaded sessions, (clicking again brings it back to show projects of all sessions on right sidebar). When hovered on that button, it shows the lists of projects, which when user clicks, loads the sessions of those projects only on the sidebar. Click button, does the same — shows all projects lists on right sidebar
>     2. ￼
> 
>     1. Another observation is this sense of spaciousness I felt from Claude Desktop. If you look at it, its left sidebar is default to being very compact on the side. Much shorter. The ratio of each left/right sidebar and main is much greater, giving spacious feeling for main tab.
>  Same for its right side component that shows up as default. On the other hand, when it opens actual thing from the right sidebar, it opens it to be bigger. And this is right decision because what you mean by opening something, browser, dev panel, whatever, from the right sidebar means that you are going to look at it, not the session. So making default sidebar component small and giving space for it only when they’re actually opened (artifact, diff panel, whatever) is correct.
> 
