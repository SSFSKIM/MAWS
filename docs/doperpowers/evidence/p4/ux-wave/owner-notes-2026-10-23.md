# The owner's notes for the UX wave, 2026-10-23

Input to the enhancement wave cut from the comparative UX assessment (P4; the assessment's reports live outside the repo in `MAWS-notes/ux-comparison-2026-10-23/`, with the three Claude Desktop screenshots this note refers to under `owner-notes/`). Recorded verbatim; the earlier taste note is `../wr/owner-marks-2026-10-23.md`.

## Side panel and toolbar (23:0xZ, while the assessment ran)

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

Open for the wave's design: how MAWS's tabs within the right panel map onto a toolbar of icons that each open one surface, since Claude Desktop has no tabs within its side panel.
