# UX directions: the living record

The ongoing UX discussion with the owner: their observations verbatim, the directions distilled from them, the questions still open, and the architect's proposals. It feeds the enhancement wave cut from the comparative UX assessment (P4) and stays open after it; each entry is dated and appended, never rewritten. The assessment's reports and every vendor screenshot live outside the repo in `MAWS-notes/ux-comparison-2026-10-23/` (the owner's under `owner-notes/`); the owner's general taste note is `../wr/owner-marks-2026-10-23.md`.

## Directions

Each direction cites the observation it comes from (O1, O2, …, below). A direction is the owner's intent in a line, not yet a design.

- **D1. The main area is the main thing; side surfaces are optional and quiet** (O1). The side panel opens only when wanted, takes neither width nor attention by default, and still tells the person what it can do.
- **D2. Side surfaces are icons, one surface per icon, in a compact top-right row** (O1). Terminal, diff, browser, files, and later source control and a subagents view; less-used ones (side chat, background work, plan) behind an overflow menu. Adding a surface then costs no space.
- **D3. The default side view is a column of folded cards that floats over the main area** (O1). It belongs to the main area's right side rather than being a dedicated column: environment (machine, folder, branch, remote control), context, connectors (the MCP servers this session uses), each folded with a one-line summary.
- **D4. Because the side view is cards, new capability arrives as a card** (O2). First candidate: an artifacts card below Connectors, the project's artifacts at a glance, with a way to look at another project's.
- **D5. No Needs-you section; a waiting session is marked by a coloured dot on its own row** (O3). Claude Desktop has no gathered section and marks each session row instead (orange for waiting on the person, blue for running).

## Open questions

- **Q1. What becomes of the tabs inside today's right panel?** Claude Desktop has none (O1). The architect's first position is P1 below; lens 7 of the assessment lays out options with screenshots.
- **Q2. The artifacts card and the Library** (O2). MAWS already has a top-level Artifacts library with Spaces (charter §19, the P3 paragraph) and a session-scoped artifacts surface in the right panel. Is the card the panel's window onto the Library (this project's artifacts, a project switcher, open in place or in the Library), or a new registry with its own scope? Its name is open too ("Artifacts Registry" was the owner's working name).
- **Q3. What carries cross-project attention once the section goes?** (O3) Lens 1 of the assessment judged MAWS's Needs-you section, ⌘⇧J, the Overview and the dock badge ahead of both references: in its run three waiting sessions in three projects sat together at the top while the tree below was filtered by an unrelated search, where Claude Desktop scatters the same state as dots. With dots alone, a waiting session in a collapsed or scrolled-off project is out of sight. The architect's proposal is P2.

## Architect's proposals

- **P1 (2026-10-23, on Q1).** Today's panel tabs become the icon row of D2: a click opens that surface alone, a second click closes it. Tabs survive only inside a surface that holds several of the same thing (browser pages, open files), never to choose between surfaces. The default view is D3's folded floating cards, so the main area keeps its width until something is opened. Would change if supervising many sessions needs two surfaces visible at once (diff beside terminal); then a split inside the panel is the question, not tabs.
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
