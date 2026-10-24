# Hands-on acceptance of UX1 and UX2, 2026-10-24

The owner approved this run ("Go now", 2026-10-24). An opus agent drove a separate MAWS build through cua on the owner's MacBook screen. The build was master 64cbab57b, unpackaged Electron 44.4.5, worktree /tmp/maws-accept, own profile /tmp/maws-accept-profile, bound by its full app path. The run took about 19:13 to 19:50Z.

Screenshots: `/Users/new/Developer/MAWS-notes/ux-comparison-2026-10-23/acceptance-2026-10-24/` (71 files). The numbers in parentheses are filename prefixes.

## Conditions

- Other apps kept taking the foreground, and cua silently dropped input while MAWS was in the background. The agent brought its own instance forward with a second launch on the same profile, which hands off to the running instance.
- cua cannot drive the native "Choose folder" panel. Two scratch projects were inserted into the test profile's index.sqlite while MAWS was quit.
- Sizes tested: 1280x820; 1512x900, which is the screen's maximum (not 982); narrow 901 and 621, by dragging the window edge.
- Two scratch sessions on Haiku, started with "Start without trusting". No owner session was sent to or changed.
- The unsigned build cannot post macOS notifications (UNErrorDomain 1). MAWS falls back to a dock bounce and an in-app toast.

## Checklist

### UX1

- **Needs you:** pass. One line per session; ⌘⇧J jumps; the Overview badge shows ◐1 (32, 33). Minor: the Needs you row keeps ◐ after the request becomes a question (35).
- **Session row:** pass. Status mark at the right; ⋯ on hover with the full menu; ⎇ on worktree rows (47, 48, 40).
- **Hover card:** placed to the right of the row, pass. Reply on a question fails: defect 1 (36, 37).
- **Projects:** pass in function. Same-named projects are told apart; Remove from sidebar works (02, 03).
- **Project filter:** pass (45, 46).
- **Search results:** partial. Uncapped with per-project counts; see defect 5 (40).
- **New chat keeps focus:** pass for the project row's + and for ⌘N (04, 66).
- **Automatic archive:** pass; the default is Never (65).
- **Turn-finished toast:** pass in-app (39). The OS banner was not checkable.
- **Reply and Allow once from a notification:** not checkable on an unsigned build.
- **Session chords:** pass.
- **Conversation search:** pass through ⌘K (43). The sidebar row is partial (41).
- **Tool rows named by description; heredoc expansion; Copy command:** pass (09, 10).
- **Mermaid full-screen zoom:** pass (11).
- **Single line breaks; `<message>` tint:** pass (39, 44).
- **Stopped-turn line:** pass (63).

### UX2

- **Default window:** pass at 1280 (06) and 1512 (31).
- **One chrome row, full-height surface:** pass (12).
- **Stacking:** pass. Two at most; a third replaces the lower slot; clicking an open icon closes it; the cards return when every surface is closed (13 to 16).
- **Widths:** pass. Review 60%; Terminal and Session info 420 (12, 69, 22).
- **Overflow menu and pinning:** pass (21 to 23).
- **Cards:** pass. Connectors is partial: it lists "connected" servers, not what this session used (17 to 20).
- **700 to 1100:**
  - Pass: the sidebar steps aside, ⌘B shows it as an overlay, and the cards hide below 960 (24, 26, 27).
  - Fail: the Overview button disappears, defect 7.
- **Below 700:** a sheet, but not dismissible; defect 4 (29, 30).
- **Deck and document toolbars:** pass. Tools are in the document's own toolbar as floating cards; Fit adapts; Arrange is a menu; the filmstrip is placed by width; History is a card (55 to 58, 60).
- **Usage pill in the footer:** pass. Not captured, because it shows account emails.
- **Shortcut sheet:** pass, searchable (67). Stale names, defect 10 (68).
- **F6:** partial; defect 12.
- **Tab chords and ⌃Tab:** pass.
- **Sidebar top:** pass; Search's Enter goes to the palette at All (01, 42).
- **Projects page:** pass (49, 50).
- **Customize:** pass (51 to 53, 64).
- **Expand:** not examined; it is being rebuilt to the owner's ruling (fold the conversation to a composer-only view).

## Defects, ranked by how much the owner would notice

1. **The hover card's Reply on a waiting question queues a follow-up message instead of answering.** It shows "Queued, Sends at the next step"; the question stays waiting and Needs you is unchanged. The text was later injected as "Sent during this turn". The card never shows the question text or its options (36, 37).
2. **Tabs that overflow the strip vanish without an affordance.** At 1280, with a session, Projects, Customize, Artifacts, a document, a presentation and Settings open, "Untitled presentation" is invisible (it remains in the AX tree) and "Untitled document" is clipped. Tabs keep full width and the strip clips; the mockup compresses tabs first (59, 64, 66).
3. **The composer footer overlaps and clips in a narrow main column**, at 1280 with Review open or at 900 with a surface. The project label drops and leaves an orphan "·"; "main ●" overlaps "Auto"; "kairos off" is cut to "kair" (12, 25).
4. **The sheet below 700 does not dismiss on Esc or an outside click.** Only × or the icon closes it (30).
5. **The sidebar's "Search in conversations for '…'" row is unreachable in practice.** It comes after about 785 uncapped rows for "test", and is absent from the AX tree (40, 41).
6. **The Questions surface auto-opens and stays open and empty after the answer** ("No open questions"), taking about 540 pt (35, 38).
7. **At 900 with a surface open, the header loses the Overview button and its waiting badge**, and every surface icon collapses into ···. The mockup moves Overview with its count into the header when the sidebar hides (24, 28).
8. **In Manual mode, an agent's question first arrives as an approval of `mcp__maws__ask` showing raw JSON.** Needs you, the toast and the hover card say "Approval needed · ask", and the hover card covers the main approval card (32, 34, 71).
9. **Under the default Priority sort the sidebar's project order changes about once a minute** as other sessions work, so rows move between actions. It caused one misclick (01, 05, 65).
10. **Stale vocabulary.** The shortcut sheet and menus say "Toggle right panel ⌘⇧B", "Maximize right panel" and "Move to panel" while the icon says "Session cards · ⌘⇧B". Searching "cards", "terminal" or "review" finds nothing, and no surface lists a shortcut (68).
11. **After sending while scrolled up, the transcript does not follow to the new turn** (62).
12. **F6 visits only three regions: sidebar, tabs and main.** The cards are never a stop, and with a surface open F6 lands on the resize divider instead of the content.
13. **Small issues:**
    - The composer keeps reading "Resume" after a stopped turn, even after later turns complete (70).
    - The palette's conversation snippet shows a raw `<message>` (43).
    - Esc does not close the Overview opened by its button when focus is elsewhere.
    - Open cards in the deck toolbar have no pressed state; the document toolbar shows one (57, 60).
    - Customize's Skills and MCP tabs show an alarming orange "Some configuration could not be read" for a known limitation (52).

## Passes that feel wrong against the owner's taste (the main area is the main thing; nothing takes space it does not earn)

- **Report mode folds twice.** "Working record · 4 tool calls" opens onto "Worked for 12s · 4 tool calls" (07, 08).
- **Session titles are squeezed to about 13 characters** by the status mark, age, ⋯ and the unread dot (47).
- **Repeated or stacked chrome:**
  - Terminal and Files each name themselves twice (13, 14).
  - A document has four chrome rows above its content: tabs, breadcrumb, document tabs and toolbar (59).
  - At 1280 the deck stage gets about 40% of the height (58).
  - Customize has five rows of chrome before its first item (51).
- **Files opens collapsed at the project root** (15).
- **The Projects page and the Add-project chooser list about 200 discovered folders alphabetically**, with "/", ".claude" and /tmp first. The person's sidebar projects are not grouped first (02, 49).
- **Environment's "Remote control is not available in MAWS" line** says nothing useful (17).
- **Misleading marks:**
  - "Remove from sidebar" uses an archive icon (03).
  - The Session cards icon shows pressed on a New chat tab, where no cards exist.
- **User bubbles render single line breaks as paragraph gaps**; assistant text keeps them tight (44).
- **The narrow sidebar overlay has no shadow or scrim** (26).

## Not checked

- OS notification banners, notification Reply and Allow once, and the dock badge (unsigned build).
- The exact 1512x982 size.
- The native Choose folder panel.
- The composer's Connectors and Plugins submenus.
- ⌥⌘U, Archive older…, Hide from sidebar, and a worktree session of the agent's own.
- The dark theme, and the to-human 0.7.0 mod's view.
