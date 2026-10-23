# Reconciliation of the owner’s 80 sitting marks

## Basis and reading rules

Source pin: **bc6b78ae97712ef10d802970f6f6dd06269bbc74**, the read-only master checkout at `/private/tmp/maws-arch`, inspected on 2026-10-23.

Inputs and decision references:
- [Original candidates](/private/tmp/maws-arch/docs/doperpowers/evidence/p3-finish/sitting-findings.md).
- [Owner’s marks](/private/tmp/maws-arch/docs/doperpowers/evidence/p4/wr/owner-marks-2026-10-23.md).
- [P3-F recomposition §3c](/private/tmp/maws-arch/docs/doperpowers/evidence/p3-finish/recomposition.txt#L190).
- **P3-F** below means [P3-F finish plan](/private/tmp/maws-arch/docs/doperpowers/plans/2026-10-18-p3-f-finish.md). Its wave-S triage starts at line 259; DL36, DL37, DL38 and DL39 are at lines 550, 552, 554 and 556. DL37 records the fix batches; DL39 records the final gate union.
- **P4** below means [P4 smoothing plan](/private/tmp/maws-arch/docs/doperpowers/plans/2026-10-19-p4-smoothing.md). Relevant landing records: DL18 line 302; DL20 line 306; DL21 line 308; DL22 line 310; DL28 line 322; DL34 line 334; DL37 line 340; DL42 line 350; DL49–51 lines 364–368; DL55 line 376; DL59–61 lines 384–388; DL65–67 lines 396–400; DL71 line 408.
- [Open debt tracker](/private/tmp/maws-arch/docs/tech-debt-tracker.md).
- [W1 closure ledger](/private/tmp/maws-arch/docs/doperpowers/ledgers/2026-10-19-P4-W1.md).

“Fixed” means the source implements the requested behavior, supported by the cited commit and closure record; it does not mean I personally reran its historical gates or saw the owner’s installed build. Tests and recorded gate results were read, not executed. “Partly fixed” separates an older defect’s closure from a remaining facet or the owner’s additional requirement. For a keep/dismiss item, “open” can mean the described behavior remains **and is accepted**, not that it belongs in the fix wave. “Changed shape” is not shorthand for fixed.

## 1. Ask Claude within a Space

**Owner:** “yes Space’s Ask Claude start in the Space’s linked folder and name the Space in the request.”

**State: fixed.** Wave-S F5, `d6bbd386e`, recorded in P3-F DL37/39; follow-up `d217e447a`, P4 DL22, prevents asking before the narrowed Space is known. [MakeSomethingNew.tsx:44–53](/private/tmp/maws-arch/src/renderer/src/library/MakeSomethingNew.tsx#L44) adds the linked directory to its project, creates the session there, and includes the Space name in the prefill. With no linked directory it deliberately uses the focused project.

**Change asked:** already implemented; preserve the Space in both session placement and request text. **Question:** none. **GUI check:** not required to establish the implementation.

## 2. Session overview heading wraps letter by letter

**Owner:** fix.

**State: fixed.** `7973106da` specifically keeps “Session overview” on one line and truncates the competing long session title. P3-F F3, DL37/39.

**Change asked:** prevent heading collapse during start, not merely after renaming. Already implemented. **Question:** none.

## 3. Starting session briefly reports unknown workflow session

**Owner:** fix.

**State: fixed.** `a190545f3` renders Starting while the session is registering and rereads workflow runs once it is registered. P4 W1-A, DL22, closes the starting-summary row.

**Change asked:** do not display a red failure for the normal registration interval. Already implemented. **Question:** none.

## 4. Seeded design systems say edited by You

**Owner:** fix.

**State: partly fixed.** P4 W2-L made relative ages English (DL59; merges `cb2dbcf51`, `abdc1898b`), but attribution is unchanged. [seed.ts:20,72–75](/private/tmp/maws-arch/src/engine-host/design-systems/seed.ts#L20) deliberately seeds under the human actor because X29 has no system actor. [Row.tsx:160](/private/tmp/maws-arch/src/renderer/src/library/Row.tsx#L160) renders the last editor as “Edited … by …”.

**Change asked:** stop presenting installation/seeding as an edit the owner performed. English dates do not fix that. A provenance-aware “Built in”/seeded label can avoid a misleading statement; introducing a real system actor requires an explicit X29 amendment rather than silently inventing one. **Question:** none; the desired distinction is clear.

## 5. Agent cannot create into a Space

**Owner:** fix — “They should be able to.”

**State: fixed.** `d6bbd386e`, P3-F F5 and DL37/39. [artifact-tools.ts:141,184–204](/private/tmp/maws-arch/src/engine-host/tool-server/artifact-tools.ts#L141) resolves `space`, creates there and reads the Space’s governing default. [artifact-tools.test.ts:225–239](/private/tmp/maws-arch/src/engine-host/tool-server/artifact-tools.test.ts#L225) pins Space placement and the Space-default versus owner-default distinction.

**Change asked:** agent creation in the named Space with its default system, without requiring a human move. Already implemented. This does not close the separate existing-artifact inspection gap in 32. **Question:** none.

## 6. Agent uses cua against the owner’s GUI

**Owner:** keep — “We can allow them to use computer use.”

**State: changed shape; the permission to use it is retained.** P4-A2P added an app-wide launch profile, `a439eae1c`, landed `2b1fa898b`, P4 DL55. [launch-profile.ts:29–41](/private/tmp/maws-arch/src/shared/engine/launch-profile.ts#L29) defaults to no plugins disabled, user output style and user hooks. [launch.ts:47–59](/private/tmp/maws-arch/src/engine-host/launch.ts#L47) retains user/project/local settings and deliberately avoids strict MCP isolation.

**Keep/dismiss divergence:** no blanket ban on cua landed. The owner may now opt individual plugins out in MAWS Settings, but that is not the default. Do not route this mark into disabling computer use. **Question:** none.

## 7. Agent-created/read artifacts appear as edited by You in This session

**Owner:** fix.

**State: partly fixed.** English ages landed with W2-L, P4 DL59. Attribution still follows the actor of the actual stored write, and the session list includes linked/read artifacts, not only artifacts authored by that session. [library/register.test.ts:137–150](/private/tmp/maws-arch/src/engine-host/library/register.test.ts#L137) explicitly checks the last-editor transition from session to human to another session. [List.tsx:49](/private/tmp/maws-arch/src/renderer/src/tools/artifacts/List.tsx#L49) uses the session/lineage library filter. A GUI operation performed by cua goes through the human UI path; it is not automatically tagged with the driving agent’s identity.

**Change asked:** distinguish actual authorship from merely reading/using an artifact, and avoid implying the agent’s GUI move was a human content edit. Do not replace every “You” with “Claude”: that would falsify real human edits.

**Question:** Should This session include read-only artifacts but label their relationship (“Read”, “Created”, “Edited”), or exclude read-only artifacts? **I would retain them with relationship labels**, since they remain useful session context. This is a presentation choice, not an unanswered code question.

## 8. Leading blank paragraph and trailing `&#160;`

**Owner:** fix.

**State: cannot tell from source for the observed leading blank.** `fdacfd3f0` plus `0ebc8292e`, P4 DL21, traced creation and pinned that imported Markdown starts with its first content block; the closure expressly interprets the observed blank band as page padding, not a proven inserted paragraph. The trailing encoding is not mysterious: [markdown.ts:31,105](/private/tmp/maws-arch/src/artifacts/document/markdown.ts#L31) deliberately represents empty blocks using a no-break-space placeholder. The generic Markdown export preserves the document dialect; see 65. Later `9ad3385cb` prevents a provisional redraw from creating a trailing repair paragraph, but that is not proof of the sitting’s original cause.

**Change asked:** remove spurious blocks, not intentional page padding or authored empty paragraphs.

**GUI check:** create a fresh Markdown document, inspect its first/last stored nodes and exported Markdown, and compare the visible top gap with the page’s padding. Determine whether an actual empty node exists before changing layout. **Question:** none.

## 9. Highlight resembles a low strike-through

**Owner:** fix — “this is certainly not ‘highlight’ … use Google Doc’s style. People most used to it.”

**State: open.** [theme.css:93–96](/private/tmp/maws-arch/src/artifacts/document/editor/theme.css#L93) still uses `box-shadow: inset 0 -0.4em …`, coloring only the lower portion of the text background.

**Change asked:** a familiar full text-background highlight, not the present accent underline/band. The sitting routed this as taste; the new mark supplies the missing direction. **Question:** none.

## 10. Two MAWS builds share one profile

**Owner:** dismiss — “I mean, we can handle this easily.”

**State: changed shape / not a current-master lock omission.** The original candidate itself establishes that the old `a37d35f10` build predated the lock, whereas the sitting build already locked before opening stores. Current [profile-lock.ts](/private/tmp/maws-arch/src/main/files/profile-lock.ts) remains the guard. P3-F recomposition §3c routed this as environment, not a product fix.

**Keep/dismiss divergence:** no reason to weaken/remove the current lock. It cannot compel an old executable that never participates in locking to cooperate. Do not add a WR product fix for the dismissed old-build circumstance. **Question:** none.

## 11. Links violate the governing system’s accent law

**Owner:** fix.

**State: fixed.** `b0ec1fb81`, review follow-up `35e6a9d33`; P3-F F18, DL36/37/39. [theme.css:77–91](/private/tmp/maws-arch/src/artifacts/document/editor/theme.css#L77) makes links inherit text color and uses underline/focus treatment rather than accent. The corresponding Office hyperlink correction belongs to the same fix.

**Change asked:** obey the existing system law, not rewrite the law to excuse the editor. Already implemented. **Question:** none.

## 12. Floating session card covers document content

**Owner:** fix — “it definitely doesn’t have to … more spaces on the top … longer … Or making a chatting more transparent is also the way.”

**State: changed shape, not fully resolved.** P4-B3 moved both cards to the bottom right, added the main-area split float and retained resize behavior; merge `75806cb37`, P4 DL37. LC3 later made the main split card open at 560 px, merge `ea5aa18c3`, DL65. [FloatingCard.tsx:258–289](/private/tmp/maws-arch/src/renderer/src/shell/FloatingCard.tsx#L258) still paints an opaque floating surface over content. Only Browser has the special reserved live column.

**Change asked:** prevent the card from obscuring the work; moving it from left to right does not establish that goal.

**Question:** Reserve document space for the open conversation, or keep an overlay but change height/opacity? **I would reserve space when the window allows and retain an explicit overlay at narrow widths**; transparency alone leaves text competing underneath.

**GUI check:** on the rebuilt layout, inspect the document’s first/last columns and selected paragraph with the card open at its default and resized dimensions.

## 13. Bullets have no glyphs

**Owner:** fix.

**State: fixed.** `2fb897a82`, P3-F F8, DL37/39. [theme.css:139–155](/private/tmp/maws-arch/src/artifacts/document/editor/theme.css#L139) explicitly supplies unordered and ordered list markers, including nesting.

**Change asked:** visible bullet markers, not an intentional house-style omission. Already implemented. **Question:** none.

## 14. Insert Math does not focus its field

**Owner:** fix.

**State: fixed.** `c27d507bc`, P3-F F8, DL37/39, fixes focus after insertion.

**Change asked:** immediate typing edits the new LaTeX field rather than the surrounding paragraph. Already implemented. **Question:** none.

## 15. Date chip and picker use different locales

**Owner:** dismiss — “tech debt. not worth fixing now.”

**State: changed shape.** This already went through the opposite route: the owner’s earlier P4 DL4 ruling selected English throughout, and W2-L implemented the app-authored date/age/time sweep, including the document chip, in `493bf1bb2`; P4 DL59 records closure. Native date-input presentation can still be platform-controlled, so this is not a claim that every operating-system picker’s pixels are English.

**Keep/dismiss divergence:** code work has already happened under the earlier explicit English-language decision. Do not revert it or reopen a Korean localization project on this dismiss mark. **Question:** none.

## 16. Return in date picker deletes/splits the chip

**Owner:** fix.

**State: fixed.** `0fc9a0dc4`, with composing-Return follow-up `e185e9288`; P3-F F8, DL37/39.

**Change asked:** Return commits/closes the picker without sending the key through as a document split; preserve IME composition. Already implemented. **Question:** none.

## 17. Tab adds a table row but leaves the caret behind

**Owner:** fix.

**State: fixed.** `3763a59e0`, `4131e6c9a`; P3-F F8, DL37/39.

**Change asked:** move the caret into the newly created row so following text lands there. Already implemented. **Question:** none.

## 18. Space mirror omits document assets

**Owner:** fix.

**State: fixed.** `5818b943d`, P3-F F11, DL37/39, adds document assets to the mirror. Current [mirror.ts:359–398](/private/tmp/maws-arch/src/engine-host/library/mirror.ts#L359) collects the artifact’s assets alongside its state for the kind’s mirror writer.

**Change asked:** referenced local images accompany the mirrored Markdown; no broken `assets/…` references from omitted copies. Already implemented. **Question:** none.

## 19. New-changes pill overlays the page

**Owner:** dismiss — “this is fine.”

**State: open, accepted.** [chrome.css:933–942](/private/tmp/maws-arch/src/artifacts/document/editor/chrome.css#L933) still positions the pill absolutely at the top center of the page. [DocumentEditor.tsx:883–895](/private/tmp/maws-arch/src/artifacts/document/editor/DocumentEditor.tsx#L883) retains open/retry/dismiss controls.

**Keep/dismiss divergence:** no contrary removal found. Preserve this accepted behavior; 25 concerns collisions with other chrome, not a reversal of this acceptance. **Question:** none.

## 20. Mermaid palette changes without an edit

**Owner:** fix.

**State: fixed for accidental theme leakage.** `92a9dcc35`, `82c39e75c`, P3-F F8, DL37/39, scope the diagram to the page’s palette while retaining front matter. P4 DL60 later explicitly preserves an author-named Mermaid theme; merge `a2ef4d175`.

**Change asked:** stop unrelated app-theme state from recoloring an unchanged diagram. Already implemented. Do not overwrite an explicitly authored theme: that would contradict the later owner ruling in DL60. **Question:** none.

## 21. No visible agent editing presence

**Owner:** fix.

**State: fixed beyond the original wave-S fix.** F19 (`ddc11b4f4`, `8c9d7e2ab`) proved and held the after-commit outline for four seconds, P3-F DL36/37/39. P4 DL6/13 deliberately superseded the commit-only reading with streamed provisional edits. Document support landed `044767eff`, DL28; slides/designs/dashboard completion landed `22978fa00`, DL71. [Tracker line 178](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L178) records the document half and its later-surface scope.

**Change asked:** visible presence while an edit streams, once the target can be identified, followed by the real committed state; a refusal removes provisional content. This is now the design and implementation, not merely a longer post-edit flash. **Question:** none.

## 22. Panel document loses undo after a tab switch

**Owner:** fix.

**State: fixed.** `c3c85feb2`, P4-B3 M5, landed `75806cb37`, P4 DL37; [tracker line 104](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L104) closes the undo half specifically. [tab-state.ts:337–351](/private/tmp/maws-arch/src/renderer/src/tools/document/tab-state.ts#L337) retains an UndoManager per document tab body, and [DocumentPanel.tsx:116–122](/private/tmp/maws-arch/src/renderer/src/tools/document/DocumentPanel.tsx#L116) reuses it after remount.

**Change asked:** preserve undo across switching and moving surfaces. Already implemented. The still-open editor-remount/redraw issue is not the same defect. **Question:** none.

## 23. Side-thread trust must be answered elsewhere

**Owner:** fix — “let them be able to trust folder from the comment. from the conversation they are at.”

**State: open for an already-created side thread.** [CardThread.tsx:88–118](/private/tmp/maws-arch/src/renderer/src/side/card/CardThread.tsx#L88) displays the setup state but offers only Open in Side pane / Open as tab, not trust decisions. [thread.ts:48–52](/private/tmp/maws-arch/src/renderer/src/side/card/thread.ts#L48) still maps the held trust card to that status strip.

**Change asked:** show the actual folder/trust choices in this conversation and continue its pending operation in place. Do not confuse this with 26: the pre-comment artifact-session gate does have inline trust now. **Question:** none.

## 24. Duplicate artifact/tab name in comment title

**Owner:** fix.

**State: fixed.** `fe6c0b705`, P4 W1-B DL21, removes a tab title equal to the document title. B1 `874ce7b82`, landed `42a27a968` and recorded in P4 DL34, also removes redundant tab naming in a one-tab document.

**Change asked:** a nonduplicated, meaningful passage title. Already implemented. **Question:** none.

## 25. New-changes pill intersects the comments drawer

**Owner:** fix.

**State: changed shape; collision avoidance still needs a check.** P4-B1 replaced the document’s comment layout with margin cards/icons and an All comments surface (`42a27a968`, P4 DL34). The old screenshot is not the current layout. However [chrome.css:533–544](/private/tmp/maws-arch/src/artifacts/document/editor/chrome.css#L533) still has an absolute drawer and explicitly layers the centered pill above it; the pill itself remains absolute.

**Change asked:** avoid a control straddling the boundary between the page and a drawer. Keeping the pill itself is consistent with 19.

**GUI check:** narrow the document panel, open All comments and separately Version history, trigger a new-changes pill, and inspect whether it overlaps either drawer’s header or actionable area. **Question:** none.

## 26. Standalone artifact comment cannot proceed through trust

**Owner:** fix — “they should have no friction. easily be able to trust folder and start editing using comments.”

**State: fixed for this standalone-start case.** Wave-S F4 (`2466b4980`, `949d4c435`, `d399c9e2a`, `37c31c732`), P3-F DL37/39; later continuation-race fix `30d9d9af6`, P4 DL21. [comment-session.tsx:267–278](/private/tmp/maws-arch/src/renderer/src/tools/document/comment-session.tsx#L267) shows folder details, Trust and start, and Start without trusting in place. [comment-session.test.tsx:330–403](/private/tmp/maws-arch/src/renderer/src/tools/document/comment-session.test.tsx#L330) covers kept drafts and continuation.

**Change asked:** trust and proceed where the owner is commenting. Already implemented without silently granting trust. 23 remains a different continuation surface. **Question:** none.

## 27. History exposes tool IDs and mixed-locale times

**Owner:** fix.

**State: fixed for the stated ID/grammar/locale defects.** `f8b587e71`, P4 DL21, translates tool lines into readable block/comment descriptions; [history/model.ts:103–126](/private/tmp/maws-arch/src/artifacts/document/editor/history/model.ts#L103) includes replacement, table-cell, reply and pluralization mappings. W2-L `493bf1bb2`, P4 DL59, gives the history consistent English time formatting.

**Change asked:** readable version history. Already implemented for these forms. The agent’s own authored summary is still not the history source, and multi-edit turns show one summary line: [tracker lines 201–203](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L201). The owner did not specifically require those additional changes here. **Question:** none.

## 28. First away-edit fails to raise new-changes pill

**Owner:** fix.

**State: partly fixed.** `b45ad711c`, P4 DL21, records a look on every return to a still-mounted document. The same decision explicitly separates the sitting’s mid-turn case, still open at [tracker line 199](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L199): a turn version lands only at turn end, and an auto version taken when the owner looked can be upgraded in place with the later turn time.

**Change asked:** base the notification/count on edits the owner has not seen, including a return during a still-running turn. Do not close this merely because ordinary away-and-back now works. **Question:** none; implement the seen-state semantics and regression rather than asking the owner to solve timestamp bookkeeping.

## 29. Editors-of-selection popover is cramped

**Owner:** fix — “yes card should make clean.”

**State: fixed.** `4407ae2d1`, P3-F F3’s document portion, DL37/39, places the list below a one-line heading and the close button at the far end of the header.

**Change asked:** clean, readable popover layout. Implemented. **Question:** none.

## 30. Answered question echoes raw JSON

**Owner:** fix — “very bad in visibility … Question --> answer style … with card.”

**State: fixed.** `934d51e98` and held-tail fix `d0b8d034c`, P4 DL22, remove the duplicate internal answer envelope from “Your message”. Crucially, [AskCapsule.tsx:19–29,51–56](/private/tmp/maws-arch/src/renderer/src/transcript/view/rows/AskCapsule.tsx#L19) renders each question followed by an arrow and its answer inside the answered card. [derive.ts:133](/private/tmp/maws-arch/src/renderer/src/transcript/model/derive.ts#L133) keeps ask rows as visible human-facing rows rather than ordinary collapsed work.

**Change asked:** human-readable question/answer pairs, not JSON. Already implemented. DL22’s decision not to add a separate user row is compatible with this: it removes duplication, not the existing answer card. **Question:** none.

## 31. Output style appears dissolved into prose

**Owner:** fix — “I’ll fiㅌ the output style. But the first one just looks broken in structure though unless agent actually spoke that way; why did it dissolved into pure prose with no structure”.

**State: cannot tell from source for the specific reported message.** The current [Markdown.tsx:20–34](/private/tmp/maws-arch/src/renderer/src/transcript/view/markdown/Markdown.tsx#L20) passes completed text to Streamdown in static mode; it does not generically flatten Markdown into prose. P4-R7/R7x introduced the native message-tool path (`04bf48caa`, `1e16836b4`; P4 DL48/49), and A2P made output style an explicit optional app setting (DL55). Those changes do not establish what the original reply’s raw text contained.

**Change asked:** diagnose/fix renderer structure if the agent supplied structure; the owner will handle their style. Do not interpret this as permission to turn off the owner’s config.

**GUI check:** replay the exact message through the current Report view and compare the raw recorded text/tool-message body with rendered headings, lists, rules and line breaks at the original width. If the source itself was plain Unicode dividers/prose, report that fact rather than inventing a rendering defect. **Question:** none.

## 32. Agent cannot place deck in Space or inspect actual system

**Owner:** fix — “clear defect … put its work into a Space and confirm an artifact’s actual design system. Humans should have least possible action.”

**State: partly fixed.** Space creation is fixed by `d6bbd386e`, P3-F F5. The inspection half is not. [artifact-tools.ts:117–118](/private/tmp/maws-arch/src/engine-host/tool-server/artifact-tools.ts#L117) still calls `designSystemContextFor({})` for `artifact_describe_type`, i.e. a kind/default context, not a specified existing artifact. [documents.ts:594](/private/tmp/maws-arch/src/engine-host/tool-server/documents.ts#L594) constructs the read result without the artifact’s resolved governing system. The store already has an artifact-aware internal seam at [store.ts:1316–1326](/private/tmp/maws-arch/src/engine-host/documents/store.ts#L1316).

**Change asked:** expose the actual resolved system for the artifact being inspected, including Space/default/explicit assignment, rather than asking the human or inferring from what a new create would get. Consistent with the existing governing chain; no new authority model is needed. **Question:** none.

## 33. Inspector numbers stale after manipulation

**Owner:** fix.

**State: fixed.** `6d4821ff9`, landed `b0db20b35`, P4 DL61, fixes React Compiler memoization by reading a document version and reactive editor state. `ca2b4754e`, landed with B2 `7ce6c4455`, P4 DL67, settles at gesture end and displays whole pixels. Both the stale values and fractional-width residue were addressed.

**Change asked:** current, legible W/H/X/Y immediately after drag/resize/detach. Already implemented. **Question:** none.

## 34. Inspector names disagree with toolbar and expose tokens

**Owner:** fix.

**State: fixed.** `30737966b`, P4 W1-C DL20; [W1 ledger rows L281/L282](/private/tmp/maws-arch/docs/doperpowers/ledgers/2026-10-19-P4-W1.md#L159). Element headings use the text-style role lookup and token fields use friendly names.

**Change asked:** consistent human-readable element/style/token names. Already implemented. **Question:** none.

## 35. Detach causes flow siblings to move into the element

**Owner:** fix — “not natural structure … free-move like Google Slides or Canvas, not stacked-style structured components flow. I don’t think this should happen.”

**State: open.** [transform/commands.ts:126–131](/private/tmp/maws-arch/src/artifacts/slides/editor/transform/commands.ts#L126) still detaches a flow child into its measured pinned box. The underlying flow/pinned model is explicit in [P3-C plan:29,81,91](/private/tmp/maws-arch/docs/doperpowers/plans/2026-10-12-p3-c-presentations.md#L29); removing a child from flow allows siblings to reflow. B2’s click-to-edit work did not remove that layout model.

**Change asked:** human manipulation should behave like free placement and not unexpectedly re-stack neighboring content. This reaches a substantive recorded design, not just a missing hint.

**Question:** Preserve structured layouts for agents/templates but convert the affected layout into fixed positions on the first human move/detach, or make slide contents free-positioned by default? **I would preserve structured authoring and make the human transition preserve every sibling’s visual position.** The broader default change needs the owner’s choice.

## 36. New shapes consume Accent by default

**Owner:** fix.

**State: fixed.** `5172f5438`, P4 W1-C DL20, makes a new shape use the raised surface plus a border-color edge instead of Accent; the landing explicitly records the print-safe edge choice.

**Change asked:** do not violate “accent once” merely by inserting a shape. Implemented. This is not a claim that the editor globally enforces every accent-law violation an author can create. **Question:** none.

## 37. Narrow deck toolbar and tiny stage

**Owner:** fix.

**State: partly fixed.** F3 `e7304de46` plus review fixes `3b5ecadfb`, `60d91907c`, P3-F DL37/39, make whole toolbar controls wrap instead of letter-wrapping/overlapping. [chrome.css:49–58](/private/tmp/maws-arch/src/artifacts/slides/editor/chrome.css#L49) retains this. The stage-size complaint is not closed by that change: filmstrip and rails still consume space, and below 720 px rails overlay rather than reserve space ([chrome.css:32–46](/private/tmp/maws-arch/src/artifacts/slides/editor/chrome.css#L32)).

**Change asked:** usable controls **and** a perceivable working slide. The latter belongs with 45, not another toolbar-wrap patch.

**GUI check:** test the current deck at the narrow panel width with filmstrip, history, inspector and session panel combinations; record actual slide dimensions, not just the percentage label. **Question:** none beyond 45’s layout decision.

## 38. Reorder announces internal IDs

**Owner:** fix.

**State: fixed for announcements.** `5f913cb7b`, `e8ccd74d9`, `871f4ab4f`, P4 W1-C DL20, replace dnd-kit’s default ID announcements with position/title language and restore compiled rendering coverage.

**Change asked:** meaningful reorder feedback. Implemented.

**GUI check:** the original candidate separately left real pointer dragging unverified. Drag a thumbnail with a normal held pointer gesture and verify order and announcement. The keyboard/e2e closure should not be misrepresented as the owner’s manual pointer observation. **Question:** none.

## 39. Speaker notes require a faint Save button

**Owner:** “should be autosave. User shouldn’t even be thinking about clicking save button. Autosave as default for every edit.”

**State: partly fixed in the sense that normal editing already autosaves; an exceptional recovery path still asks for Save.** [Notes.tsx:42–47,88–104](/private/tmp/maws-arch/src/artifacts/slides/editor/Notes.tsx#L42) writes each valid input/composition result. The Save button at lines 107–115 appears for a retained refused draft that is now within the 4,000-character bound, e.g. after a remote rebase. Lines 17–19 explicitly document that deliberate recovery rule.

**Change asked:** eliminate manual-save thinking for valid edits, including recovery into a valid state; retain an actual refusal when the model limit prevents writing. Do not rewrite the ordinary notes editor as if it lacked autosave, and do not silently discard over-limit text. **Question:** none.

## 40. Deck panel toolbar wraps labels vertically

**Owner:** fix.

**State: fixed.** The same F3 `e7304de46` family as 37, P3-F DL37/39, covers the narrow 280 px panel and family toolbars, not just a wide main-tab deck.

**Change asked:** intact controls and readable labels at panel widths. Already implemented. **Question:** none.

## 41. Artifact tab cannot put deck in pinned tool

**Owner:** fix.

**State: changed shape; the original “only from a session tab” conclusion is no longer true.** P3-F F16 `37fe3d6f2`/`a9239ae6b` added Show in panel on an artifact tab and made Open in tab a move. P4-B3 added cross-surface transfer and restore (`75806cb37`, DL37); W2-D’s `8ce1fb008` adds the app-level Show in panel regression (P4 DL58). [ArtifactsTool.tsx:72–75](/private/tmp/maws-arch/src/renderer/src/tools/artifacts/ArtifactsTool.tsx#L72) explicitly supports a null session by pinning the artifact tool.

The list’s **This session** state still correctly says no session when none is shown; [List.tsx:49–65](/private/tmp/maws-arch/src/renderer/src/tools/artifacts/List.tsx#L49) also offers All, which does not require a session.

**Change asked:** reach the panel directly from the artifact. Already available; do not manufacture a fake session just to satisfy a list filter. **Question:** none.

## 42. Agent publish merges instead of refusing the whole changed slide

**Owner:** keep — “consider agents as a co-editor … But I don’t know if we’re handling this correctly currently.”

**State: changed shape around interaction, with the requested merge policy retained.** [publish.ts:1–7](/private/tmp/maws-arch/src/artifacts/slides/publish.ts#L1) is explicit: compare base/sent/live property by property; untouched agent keys remain untouched; nonoverlapping text changes merge; conflicting keys refuse the whole publish unless explicitly forced. This matches [P3-C D3:91](/private/tmp/maws-arch/docs/doperpowers/plans/2026-10-12-p3-c-presentations.md#L91), and explains why the sitting’s independent font/position/text changes survived. B2 and A2 G2 now also hold/compose remote presentation around human gestures (P4 DL67/71).

**Keep/dismiss divergence:** no blanket stale-slide rejection was substituted. The source supports co-editing rather than last-writer wholesale overwrite. That does not mean same-property conflicts are silently accepted. **Question:** none.

## 43. Several double-clicks before heading text edits

**Owner:** fix.

**State: fixed by the later click-to-edit rebuild.** Wave-S F9 `755c8787f`/`0cf1f326d` first prevented silent loss for selected-element typing; P4-B2 `7ce6c4455`, DL67, replaces the old interaction with the approved select-first state machine, nested target handling and native edit-key behavior. Korean-input follow-up evidence is recorded separately in P4 DL69; do not claim every platform-input case was perfect.

**Change asked:** a predictable human click/select/edit sequence with no discarded typed words. The old three-double-click path is not the current design. **Question:** none.

## 44. Fit zoom does not refit / leaves blank stage

**Owner:** fix.

**State: partly fixed.** `1b96e0bc2`, P4 W1-C DL20, fixes the live stage’s observer reattachment and preserves a nonzero size across 0×0 readings. However [tracker line 194](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L194) explicitly carries the history-preview sibling: [HistoryPreview.tsx:158–171](/private/tmp/maws-arch/src/artifacts/slides/editor/history/HistoryPreview.tsx#L158) accepts every measured size and can fall to the 5% floor while hidden.

**Change asked:** Fit must remain usable across panel changes and preview transitions. Close the preview path too; the live-stage fix alone is not enough.

**GUI check:** with history preview active, resize/close the session panel, switch away/back and choose Fit. Check both a stale tiny slide and a blank frame. **Question:** none.

## 45. History and Inspector leave an imperceptibly small slide

**Owner:** fix — floating version-history card instead of whole sidebar, or moving the right side down like Claude Desktop; supplied reference screenshot.

**State: open.** [DeckHistoryRail.tsx:12–17](/private/tmp/maws-arch/src/artifacts/slides/editor/history/DeckHistoryRail.tsx#L12) is still a rail. [chrome.css:16–46](/private/tmp/maws-arch/src/artifacts/slides/editor/chrome.css#L16) lays out the deck body horizontally and switches rails to overlay sheets only under 720 px. B3’s main split float is a helpful surrounding capability, not a new version-history layout.

**Change asked:** keep the slide large enough to work on while history/inspection/conversation are available.

**Question:** Make history a floating/overlay card, or reorganize the session/right-side surface below the canvas? **I would make history an overlay card first**, preserving useful slide width without changing the entire workstation layout; moving the conversation below is a broader taste decision.

**GUI check:** compare current wide and narrow layouts using actual slide pixel size, with history and Inspector open. The old 5% reading is not a new measurement of master.

## 46. Open history does not refresh with a new version

**Owner:** fix.

**State: cannot tell from source whether the sitting failure still reproduces.** Current [history/controller.ts:115–120,156–159](/private/tmp/maws-arch/src/artifacts/slides/editor/history/controller.ts#L115) subscribes to version refresh. [history-api.ts:61–69](/private/tmp/maws-arch/src/renderer/src/tools/document/history-api.ts#L61) listens to `artifacts.changed`; [store.ts:1551–1556](/private/tmp/maws-arch/src/engine-host/documents/store.ts#L1551) emits after an automatic version. Blame shows the notification plumbing predates the sitting (`b8c445cda3`, `89bcebc7c9`), so its mere presence cannot be credited as a new fix. I found no defensible closure commit for the reported incident.

**Change asked:** new committed versions appear without reopening history.

**GUI check:** leave history open, make a human edit, wait through the automatic-version interval, then complete an agent turn. Compare the version service’s rows, `artifacts.changed` delivery and the visible list at each step. **Question:** none.

## 47. Change navigation lacks n-of-total and clear current stop

**Owner:** fix.

**State: open.** [slides/history/HistoryBar.tsx:22–32](/private/tmp/maws-arch/src/artifacts/slides/editor/history/HistoryBar.tsx#L22) shows only the total and ↑/↓. [HistoryPreview.tsx:98–113](/private/tmp/maws-arch/src/artifacts/slides/editor/history/HistoryPreview.tsx#L98) colors changes by author and marks the shown slide, not an explicit numbered change stop. The existing P3-C history design specifies total “N changes”; the new mark asks for a better navigation presentation.

**Change asked:** distinguish current stop, display progress through the changes and make the first navigation action coherent with the initially shown change. **Question:** none.

## 48. Duplicate element-comment labels and colliding pins

**Owner:** fix — “we can probably distinguish them by color or smth”.

**State: partly fixed / rebuilt interaction, unresolved identity collision.** B2 added per-element pin popovers, thread counts and shared drafts (`7ce6c4455`, P4 DL67). But [CommentsRail.tsx:113–117](/private/tmp/maws-arch/src/artifacts/slides/editor/comments/CommentsRail.tsx#L113) still labels threads by slide and quote; two copied elements can have identical labels. [Pins.tsx:73,85–98](/private/tmp/maws-arch/src/artifacts/slides/editor/comments/Pins.tsx#L73) places each element’s pin at its upper-right box corner and derives its label from the quote/count, without collision separation or stable per-element distinction.

**Change asked:** make the target of each comment distinguishable; color is a suggested means, not the complete requirement. Add a text/position distinction and collision-safe hit targets so color is not the only cue.

**GUI check:** comment on two coincident or nearby identical copied elements in the rebuilt editor; verify labels, hit targets and selection feedback. **Question:** none.

## 49. Deleted-element comments remain in open list

**Owner:** fix — “hide deleted comments. shown only when user choose to optionally.”

**State: open.** [CommentsRail.tsx:36–41,67–74,117,134–138](/private/tmp/maws-arch/src/artifacts/slides/editor/comments/CommentsRail.tsx#L36) separates only open/resolved; an orphan remains open, listed, replyable and resolvable. Its opening contract explicitly preserves orphan threads.

**Change asked:** interpret “deleted comments” in this candidate as comments whose **target element was deleted**: hide those by default, exclude them from the ordinary visible-open count, and offer an explicit way to reveal them. Preserve the conversation rather than deleting data. This amends P3-C D9’s presentation, not its data-retention rule. **Question:** none.

## 50. Export always starts in Downloads with the same base filename

**Owner:** keep.

**State: open, accepted.** [files.ts:66](/private/tmp/maws-arch/src/main/library/files.ts#L66) still opens the save dialog at Downloads plus the artifact’s default filename. The three PowerPoint variants share the same extension/base title.

**Keep/dismiss divergence:** W1-D’s `633cc389c` isolates each export with `ownFile`/`exportId` so concurrent same-format exports cannot swap the saved bytes, but it does not change the accepted dialog defaults. No UX change needed. **Question:** none.

## 51. PNG export and three top-level PowerPoint entries

**Owner:** fix — “Let’s make one for PNG. Let’s also Fold three PowerPoint to one … show three options … three Powerpoint up front doesn’t seem necessary.”

**State: open.** [exports.ts:26–33,50–52](/private/tmp/maws-arch/src/renderer/src/tools/presentation/exports.ts#L26) still maps three PowerPoint variants directly into the menu and already includes **PNG (cover slide)**.

**Change asked:** one PowerPoint parent entry with the three variants one level down. PNG already exists, so “make one” must not accidentally add a duplicate.

**Question:** Should PNG continue to mean the cover, export the selected slide, or export all slides as separate PNGs? **I would use selected slide as the ordinary action**, with an explicit all-slides option only if wanted. Keep the submenu change independent of this decision.

## 52. Highlight toolbar color stays at old accent

**Owner:** fix.

**State: cannot tell from source whether the reported color mismatch still reproduces; not closed.** [Tracker line 175](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L175) explicitly requires reproduction. [Toolbar.tsx:277–278](/private/tmp/maws-arch/src/artifacts/document/editor/Toolbar.tsx#L277) draws a glyph, not a dedicated governed-color swatch; the toolbar and page occupy different token scopes.

**Change asked:** the control’s visual sample must reflect the governing highlight style after live system changes. Coordinate with 9; replacing the highlight style may change what its sample should show.

**GUI check:** change the governing accent/system with a highlighted passage and the toolbar visible; inspect computed variables on the glyph and page mark, then verify live refresh. **Question:** none.

## 53. Unticked task boxes look filled in dark app theme

**Owner:** fix.

**State: fixed.** `ca4f2ccaa`, P3-F F8, DL37/39, makes checkbox appearance follow the document ground rather than leaking the app’s dark color scheme. `5c793f796`, P4 W1-B DL21, carries the ground/color-scheme behavior into HTML/PDF exports too.

**Change asked:** distinguish checked from unchecked on the actual page. Implemented. **Question:** none.

## 54. History banners contain unnecessary internal chatter

**Owner:** fix — “none of these kinds of message are needed. 앱은 깔끔해야한다. 불필요한 공간을 차지하고 어텐션을 분산시키는것들을 쳐내나가는것이 중요.”

**State: partly fixed.** `f8b587e71`, P4 DL21, humanizes raw deck keys and comment IDs. But [slides/history/copy.ts:26](/private/tmp/maws-arch/src/artifacts/slides/editor/history/copy.ts#L26) still produces “Deck settings changed: …”, and [document/history/HistoryRail.tsx:100–116](/private/tmp/maws-arch/src/artifacts/document/editor/history/HistoryRail.tsx#L100) still draws summary chatter.

**Change asked:** remove these space/attention-consuming informational messages, not merely translate their keys. The owner’s new direction is stronger than the older readability closure. Keep actionable failures and the meaningful version identity; do not hide all errors under this aesthetic instruction. **Question:** none.

## 55. Creating from All has no Space context; document shows no system

**Owner:** fix.

**State: partly fixed.** F5 fixes Space-scoped Ask Claude/create, but [MakeSomethingNew.tsx:65–73](/private/tmp/maws-arch/src/renderer/src/library/MakeSomethingNew.tsx#L65) still creates outside a Space when `spaceId` is null. [DocumentPanel.tsx:195](/private/tmp/maws-arch/src/renderer/src/tools/document/DocumentPanel.tsx#L195) applies the system scope; applying tokens is not a visible label identifying the governing system. P3-F’s F5 grouping must not be treated as closing every facet of this candidate.

**Change asked:** easy intentional placement from All and visible knowledge of which system the document uses. The latter is clear and pairs with 32.

**Question:** From All, choose a Space at creation, remember the last chosen Space, or retain outside-Space creation with an explicit destination control? **I would show a lightweight destination control with the last choice remembered and an explicit No Space choice**, rather than silently assign to an arbitrary Space.

## 56. Possible dropped initial letters under cua/load

**Owner:** fix — “diagnose or tech debt”.

**State: cannot tell from source.** The original record explicitly calls this unverified under load 83 and says the owner’s hands lost nothing; P3-F §3c routes it as environment. P4’s later editor/IME work is not evidence that this specific document typing event was fixed.

**Change asked:** establish whether input is lost inside MAWS or before delivery, then fix or retain a precisely bounded debt item.

**GUI check:** in a disposable fresh document, type the original short bursts both manually and by the driver under a quiet host; capture beforeinput/input/composition events and resulting document text. Repeat under load only if the quiet comparison requires it. No speculative editor rewrite on the old screenshot alone. **Question:** none.

## 57. First tab click after Settings popup does nothing

**Owner:** fix — “Verify and Fix if true.”

**State: cannot tell from source.** The sitting records two driver observations and P3-F routes them as environment; neither is a proven product cause. No verified closure commit was found. Popup outside-click dismissal can consume a click, but that hypothesis is not proof of this incident.

**Change asked:** verify the exact click sequence and fix a real swallowed navigation click if present.

**GUI check:** open the same Settings popup, choose/dismiss it, immediately click a different main tab with a real pointer, and inspect popup dismissal, pointer events and active-tab transition. Distinguish “first click dismisses an open modal/menu” from “popup already closed but next tab click is lost.” **Question:** none.

## 58. Float over artifact hides the entire main area

**Owner:** fix.

**State: fixed.** Wave-S F6 `30fc75111`, `1bb9b9f45`, `3d9ac78fd`, P3-F DL37/39, refuses a panel float without a session and restores invalid persisted states instead of blanking tabs. P4-B3 subsequently introduced a real session/artifact main split float (`75806cb37`, P4 DL37).

**Change asked:** never disappear the main area/tab strip with no conversation card. Implemented; use the supported split float for the newer session-plus-artifact workflow. **Question:** none.

## 59. Pill placement and invisible resize affordance

**Owner:** fix — “add resize grip … instead of … fully shrunk pill … like Codex shrank composer”.

**State: partly fixed.** P4-B3 moved both pills/cards to bottom right and added top/left/corner resize hit regions; P4 DL37 and LC3 DL65. [FloatingCard.tsx:292–302](/private/tmp/maws-arch/src/renderer/src/shell/FloatingCard.tsx#L292) still renders invisible `aria-hidden` hit regions, not a visible grip. [FloatingPill.tsx:16–37](/private/tmp/maws-arch/src/renderer/src/shell/FloatingPill.tsx#L16) is still a pill. The B3 reference record explicitly says MAWS has no compact composer form ([B3 plan:305](/private/tmp/maws-arch/docs/doperpowers/plans/2026-10-20-p4-b3-layout.md#L305)).

**Change asked:** a visible resize affordance and a compact usable composer instead of the fully collapsed pill. This supersedes the old keep-pill ruling; movement alone did not satisfy it. **Question:** none.

## 60. False contrast failure in GOV.UK sample

**Owner:** fix.

**State: open.** [Tracker line 174](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L174) remains open. [check.ts:344–362](/private/tmp/maws-arch/src/artifacts/design-system/check.ts#L344) explicitly does not resolve the stylesheet cascade. The inline/tree branch does inherit declared parent values; therefore the precise limitation is **cross-rule/computed CSS**, not “all parent backgrounds are ignored”.

**Change asked:** make the checker’s contrast conclusion correspond to the rendered foreground/ground. Resolve the relevant cascade or use computed rendering, with the offending canon component as regression. Do not simply suppress all white-on-white reports. **Question:** none.

## 61. Canon previews crop components; aliases expose raw references

**Owner:** fix.

**State: fixed for the recorded implementation defects, visual quality still to inspect.** `b62be2e22`, P4 W1-C DL20/L279, draws components on a fixed 1920×1080 canvas scaled to their card and names alias targets. [Canon.tsx:12–17,58–85](/private/tmp/maws-arch/src/artifacts/design-system/page/Canon.tsx#L12) is the current scale mechanism. DL20 explicitly says the scale had not yet been judged on screen and carries that as residue.

**Change asked:** visible whole previews and friendly alias values. The code fix is present; tiny but technically uncropped previews would still fail the owner’s usability intent.

**GUI check:** inspect the original inset/panel/banner components at normal library/card widths, ensuring readable content rather than merely no clipping. **Question:** none.

## 62. Agents lack design inspection/checking tools

**Owner:** fix — “give a design inspection tools too … see the design, both Docs, slide — Like visually.”

**State: open for the requested first-class multi-kind inspection.** [artifacts.ts:33–46](/private/tmp/maws-arch/src/engine-host/tool-server/artifacts.ts#L33) limits `artifact_screenshot` to HTML artifacts; [capture.ts:47–50](/private/tmp/maws-arch/src/main/artifacts/capture.ts#L47) enforces that. [design-system/page/Check.tsx](/private/tmp/maws-arch/src/artifacts/design-system/page/Check.tsx) is a GUI check surface, not an agent tool. Deck PNG/HTML exports and allowed computer use offer indirect routes, so “an agent can never see any rendered work” would be false; they are not an equivalent Docs/slide inspection API.

**Change asked:** rendered inspection for documents and slides, plus the relevant system checks available without forcing human GUI operations. Do not treat the old 14-minute duration as a measurement of current performance; 79 has later evidence. **Question:** none.

## 63. Design-system chooser origin/subtitle/skipped state

**Owner:** fix.

**State: partly fixed.** `da18f5ed2`, P4 W1-D DL18, records duplicate provenance; [ask/copy.ts:77–94](/private/tmp/maws-arch/src/renderer/src/tools/maws/ask/copy.ts#L77) now displays “Copy of …” before evaluating Built in and clips source phrases. However [AskSheetTool.tsx:130,165](/private/tmp/maws-arch/src/renderer/src/tools/maws/ask/AskSheetTool.tsx#L130) still labels all untouched answers as skipped immediately. [design-system.test.tsx:206](/private/tmp/maws-arch/src/renderer/src/tools/maws/ask/design-system.test.tsx#L206) explicitly expects “Submit · 1 skipped”.

**Change asked:** truthful provenance and clean source summary, and do not label an unanswered initial state as an intentional skip. The duplicate-origin fix is not a closure of that last interaction. **Question:** none.

## 64. Mark-up toolbar cannot move

**Owner:** fix — “make it movable”.

**State: open.** [MarkupLayer.tsx:1–6](/private/tmp/maws-arch/src/renderer/src/markup/MarkupLayer.tsx#L1) fixes the toolbar above the surface’s bottom edge. The layer tracks the underlying surface and drawing, not a toolbar drag position; text marks remain point-placed rather than resizable boxes. W1’s `2b46246cb` fixed inert/focus coverage, not movement.

**Change asked:** allow moving the Mark-up toolbar out of the content being annotated. The explicit note settles that requirement; text-box resizing can be scoped separately rather than smuggled into a toolbar fix. **Question:** none.

## 65. Document Markdown export has no Save As and leaks dialect

**Owner:** fix.

**State: partly fixed.** `9d65b2de2`, P3-F F7, DL37/39, routes document/dashboard header exports through the save dialog and exports the shown version. W1-D `633cc389c`, P4 DL18, protects the exported file’s identity. But [export/markdown.ts:1–12,31–37](/private/tmp/maws-arch/src/artifacts/document/export/markdown.ts#L1) still intentionally writes the document dialect where GFM cannot express it, and [markdown.ts:11,31](/private/tmp/maws-arch/src/artifacts/document/markdown.ts#L11) retains chip forms and empty-block `&#160;` encoding.

**Change asked:** a normal user-owned export destination and reader-friendly Markdown. The first is fixed; chip-to-readable-text and spurious trailing-empty handling remain. This changes the current lossless-dialect export choice, so record that distinction while keeping agent read/import serialization separate. **Question:** none.

## 66. Version preview export is inconsistent; add history export

**Owner:** fix — “Let the Version history card have an export button of their version too.”

**State: partly fixed.** `9d65b2de2`, P3-F F7, closes the old live-versus-preview inconsistency: the header exports what is shown and disables ambiguous comparison export. But [HistoryRail.tsx:57–73,97–117](/private/tmp/maws-arch/src/artifacts/document/editor/history/HistoryRail.tsx#L57) has save/filter/select controls and no export action for a version; [slides/history/HistoryBar.tsx:36–49](/private/tmp/maws-arch/src/artifacts/slides/editor/history/HistoryBar.tsx#L36) has restore/copy/name but no export.

**Change asked:** expose export on the history version/card itself, with that version bound explicitly. Do not close this new affordance request merely because the header’s semantics were fixed. **Question:** none.

## 67. File-backed dashboard data stays stale

**Owner:** fix.

**State: open.** [Tracker line 173](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L173) remains open. [datasets.ts:1–14](/private/tmp/maws-arch/src/engine-host/tool-server/datasets.ts#L1) binds a stored snapshot from the project file; connector refresh is a separate capability. There is no file-change notification/re-read UX satisfying this candidate.

**Change asked:** detect that the source file changed and make rereading easy. The existing closing clause specifies a stale signal plus one-action reread, while retaining each history version’s original dataset and attributing the new reread. Implement that without retroactively mutating historical data. **Question:** none.

## 68. Overlapping repeated bars, “agg” warning and near-black ink

**Owner:** fix.

**State: partly fixed.** `0f287ba7b`, P4 W1-C DL20/L191, gives repeated unaggregated rows separate subslots and removes `VIEW_STATES.repeatedX`, so the old overlap/“agg” warning is addressed. [Tracker line 190](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L190) explicitly retains the figure-ink issue: [render.ts:7](/private/tmp/maws-arch/src/artifacts/dashboard/render/render.ts#L7) uses text ink under the current house law, which has no categorical palette.

**Change asked:** readable bars/labels in a suitable governing-system color. The owner’s fix mark supplies the earlier missing direction; update the relevant law/token choice rather than introducing a hardcoded chart palette that silently contradicts it. **Question:** none.

## 69. “1 edits” and wrong dashboard export author

**Owner:** fix.

**State: fixed.** `f8b587e71`, P4 DL21, pluralizes stored summary forms; [history/model.ts:126](/private/tmp/maws-arch/src/artifacts/document/editor/history/model.ts#L126) handles old “N edits” strings. `9b0f887ac`, P4 W1-C DL20/L287, supplies the session title to dashboard exports through `exportAuthorName`.

**Change asked:** grammatical counts and the same meaningful session attribution as the UI. Implemented. Do not confuse the still-open document DOCX session-author plumbing with the dashboard fix. **Question:** none.

## 70. Quit sheet contradicts Keep sessions running

**Owner:** fix.

**State: fixed.** `96b710765`, P4 W1-A DL22/L289, changes the keep-question detail to distinguish keeping from stopping/quitting. DL22 expressly accepts the wording while leaving the owner free to tune it.

**Change asked:** describe what each offered quit choice actually does. Implemented. **Question:** none.

## 71. Relaunch flashes no tabs and loses pinned artifact tool

**Owner:** fix.

**State: fixed.** `145033310`, P4 W1-A DL22, suppresses the empty main-state until saved layout applies. `2cebe67cb`, P4-B3 M3, landed `75806cb37`, P4 DL37, restores the pinned Artifacts record and reader write-back. [ArtifactsTool.tsx:271](/private/tmp/maws-arch/src/renderer/src/tools/artifacts/ArtifactsTool.tsx#L271) consumes restored parameters.

**Change asked:** restore the actual prior surface without a misleading empty-state flash. Both recorded halves are implemented. **Question:** none.

## 72. Fonts-by-name PowerPoint opens with missing fonts in Keynote

**Owner:** fix — “It should.”

**State: open.** [exports.ts:26–29](/private/tmp/maws-arch/src/renderer/src/tools/presentation/exports.ts#L26) still offers Fonts by name first, then Basic fonts and Slides as pictures; there is no Keynote compatibility note there. The old P3-F routing kept the existing choice; this new mark reverses that disposition, but “it should” does not select between the candidate’s two proposed remedies.

**Change asked:** warn about named-font portability and/or make the portable variant the sharing default.

**Question:** Add a compatibility note while retaining fonts-by-name as primary, or make Basic fonts the default sharing choice and keep named fonts as an explicit option? **I would make Basic fonts the ordinary sharing choice and explain that named fonts require installed matching faces.** Coordinate with 51’s submenu rather than add another top-level item.

## 73. DOCX comments use Owner and omit orphan/resolved threads

**Owner:** fix.

**State: partly fixed.** `7e9892ab8`, P4 W1-C DL20/L288, preserves passageless threads as Word comments in a removed-passage note; [docx.ts:538–570](/private/tmp/maws-arch/src/artifacts/document/export/docx.ts#L538) keeps resolved status too. Human identity still deliberately becomes **Owner**: [source.ts:89–95](/private/tmp/maws-arch/src/artifacts/document/export/source.ts#L89). A separate document DOCX issue still defaults titled session comments to Claude because its context is not supplied ([tracker line 189](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L189)).

**Change asked:** preserve the comments and identify their real author. Preservation is fixed; export identity is not.

**Question:** Which human-facing identity should an exported file carry—an explicit MAWS author name, the user’s account/display name, or a privacy-preserving neutral label? **I would use an explicit export author name with an account-name suggestion**, not infer a personal identity from filesystem/login names. This is a user-visible document identity decision.

## 74. Needless ptc call and relationship to owner config

**Owner:** fix — “diagnose: having plugin is not a problem and is normal … full owner setting … important condition … [full user’s Claude Code config + MAWS’s own(like artifact] … why did it call it for no reason.”

**State: cannot tell from source why that particular model invocation chose the call; config behavior is established.** [launch.ts:47–59](/private/tmp/maws-arch/src/engine-host/launch.ts#L47) loads user/project/local sources and does not use strict MCP isolation. [launch-profile.ts:29–41](/private/tmp/maws-arch/src/shared/engine/launch-profile.ts#L29) defaults to the owner’s plugins/style/hooks; optional app-wide overrides landed in `a439eae1c` / `2b1fa898b`, P4 DL55. MAWS adds its own tools and communication contract, and app MCP settings are merged into launches, not substituted for all user configuration. [Speed grounding:209,334–339](/private/tmp/maws-arch/research/p4-edit-speed-grounding.md#L209) records the actual read → ptc exec → publish → read → reply detour; it does not establish the model’s reason.

**Change asked:** diagnose the irrelevant call while retaining full configuration by default. The exposure of ptc explains **how it was possible**, not **why it was chosen**. Blanket plugin removal would contradict this mark and the default/profile decision.

**Trade-off, explicitly:** full config preserves the owner’s workflows and instructions but also preserves irrelevant-tool opportunities and conflicting guidance. Optional profiles let the owner trade those off; they are not a proven cure for this call and should not be silently enabled.

**GUI/reproduction check:** replay an equivalent design edit in a disposable session with the same profile, recording the prompt, advertised tools, tool selection and any available explanation. Compare only if needed against a controlled profile; absence of the call once does not prove a fix. Do not claim access to an unrecorded internal model reason. **Question:** none—the owner has already decided to retain configuration.

## 75. Command-click link selects block instead of opening

**Owner:** fix.

**State: fixed.** `a8cd41caa`, `8aced9a8a`, `2a52dc61e`, P3-F F1, DL37/39, correct the editor’s link activation/selection interaction.

**Change asked:** Command-click opens the link rather than being intercepted as block selection. Implemented. **Question:** none.

## 76. Are two Notion connections necessary?

**Owner:** “Do we still need MAWS’ own connection? … exporting directly to Notion … each live session just use Notion connector MCP … do we need two connection?”

**State: changed shape.** The old candidate was about a connector-backed artifact choosing engine route E before direct route D. Header/library delivery now deliberately calls **D directly**, bypassing that race: `57e63322b`, P4 DL42. [owner-delivery.ts:3–18](/private/tmp/maws-arch/src/main/connectors/owner-delivery.ts#L3) explicitly uses MAWS’s own sealed OAuth, not the engine’s credential, and no model turn. Meanwhile engine sessions use their configured MCP connection. P4-R8 (`df022af49`, DL51) adds app-scoped MCP definitions and records that the engine reuses the owner’s existing login by server identity.

**Important current gap:** D still discovers sources from observed engine reports ([owner-delivery.ts:77–100,128–142](/private/tmp/maws-arch/src/main/connectors/owner-delivery.ts#L77)), and [provenance.ts:428](/private/tmp/maws-arch/src/engine-host/connectors/provenance.ts#L428) accepts only user/local scopes. App-configured MCP entries are dynamic and thus engine-only. DL51 explicitly calls for D to attest the app setting. The fact that the user can configure Notion for agents does not prove direct Send can use that entry today.

**Trade-off, not a disguised fact/recommendation:**
- **Current separate custody:** deterministic app delivery without a model turn and, after discovery, without needing that engine to perform the write; costs a separate app sign-in/token lifecycle and the discovery gap.
- **Engine-mediated deterministic delivery:** could reuse the engine’s Notion connection without asking the model, but requires an available authenticated engine and suitable host control/authorization plumbing. That is not today’s header implementation.
- **One app-owned broker for both agent and direct calls:** could unify custody, but changes the connector/permission architecture and cannot be treated as a cosmetic removal of the second Connect button.

**Question:** Is genuinely engine-independent direct delivery the priority, or is depending on an available/background engine acceptable to avoid the second sign-in? **My near-term pick is to retain direct custody and fix source attestation/discovery**, because no-session/no-turn delivery is already an approved requirement; investigate a shared broker only if unified sign-in is itself a product requirement. This is a recommendation, not an assertion that two credentials are inherently necessary.

## 77. Notion receives attached Markdown instead of a readable page

**Owner:** fix.

**State: partly fixed.** `57e63322b`, P4 DL42, changes delivery to `notion-create-pages` with enhanced Markdown page content. [notion.ts:1–12,20–29](/private/tmp/maws-arch/src/artifacts/document/export/notion.ts#L1) creates Notion blocks, strips trailing editor-empty paragraphs and renders chips as readable text. The old attachment-only behavior is gone. Store/data images still become placeholders ([notion.ts:139–144](/private/tmp/maws-arch/src/artifacts/document/export/notion.ts#L139)); [tracker lines 256–257](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L256) retain image upload and live-render fidelity work.

**Change asked:** a readable Notion page, not a renamed attached file. Implemented for text/content serialization, incomplete for embedded assets and unconfirmed cases.

**GUI check:** send a disposable representative document to Notion and inspect lists/code/callouts/table/date/tab behavior and images. Use a known admissible direct source; 76/78’s source gap can otherwise prevent the test before rendering. **Question:** none.

## 78. Export to Notion should not need a model turn/session

**Owner:** fix — “As I know, we already fixed it. Like we can directly export to Notion, right?”

**State: partly fixed.** **Yes, direct export exists:** `57e63322b`, P4 DL42, removes the model-turn/session-send flow from header and library delivery. The delivery e2e recorded exactly one app-owned Notion page write and no new session/model turn. **No, that does not yet mean every cold/current configuration works without a session:** [owner-delivery.ts:7–17,77–100](/private/tmp/maws-arch/src/main/connectors/owner-delivery.ts#L7) still needs a live observation to discover a source; [tracker line 254](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L254) records the cold case. App-only dynamic scope adds the explicit DL51/provenance limitation in 76.

**Change asked:** finish source discovery/attestation so direct delivery is usable from a cold app and the app’s own Notion configuration, without requiring the human to start a chat. Preserve no-turn deterministic send. **Question:** none beyond 76’s broader custody decision.

## 79. Slow edits and Desktop parity

**Owner:** fix — “I think we addressed this?”

**State: fixed against the approved bounded benchmark/guard requirement.** P4 DL7 corrects the original attribution: the 14 s publish and 11 s reply intervals included server-side holds; MAWS execution there was approximately 0.02–0.19 s. A1 first found Desktop faster on B3 (ratio 1.273), so A3 was actually dispatched, not waived. `1bb83c5da`, [P4 DL66](/private/tmp/maws-arch/docs/doperpowers/plans/2026-10-19-p4-smoothing.md#L398), records the interleaved remeasure: MAWS **19.05 s** versus Desktop **25.19 s**, ratio **0.756**, 11 valid reps per arm, with the 95% bootstrap upper bound below 1.2. The other three judged tasks retained A1 parity. Changes were always-loaded edit tools and linked artifact reads, not an unapproved effort downgrade. X34 tool-time guards and streamed provisional feedback also landed.

**Change asked:** evidence-backed diagnosis and parity, not merely “feels faster.” Addressed for the defined tasks. This is not a universal latency guarantee: model/inference conditions, payload and host load still matter; render-tool bounds have their own unrun-live residue ([tracker line 221](/private/tmp/maws-arch/docs/tech-debt-tracker.md#L221)). **Question:** none.

## 80. Send sheet falsely promises a session approval

**Owner:** keep — “Just delete the, ‘you approved the connector in this session, as for any tool.’”

**State: fixed.** `57e63322b`, P4 DL42, retires P3-H’s session-route Send sheet and closes its untrue approval-line row. The new app-wide direct sheet is [SendToSheet.tsx](/private/tmp/maws-arch/src/renderer/src/delivery/SendToSheet.tsx); it does not depend on an Auto-mode session presenting an approval card.

**Keep/dismiss divergence:** more than the sentence changed before this mark arrived: the whole model-mediated delivery route was replaced under the earlier direct-send ruling. Preserve that approved direct behavior; do not restore the old route merely because this mark says keep. The requested misleading sentence is gone. **Question:** none.

## Summary table

“GUI check” means a targeted current-build observation/reproduction is still needed for the aspect stated above, not that no tests exist. A known source-open defect does not automatically require a GUI check to establish that it is open.

| Number | State | Needs GUI check | Open question |
|---:|---|:---:|:---:|
| 1 | fixed | no | no |
| 2 | fixed | no | no |
| 3 | fixed | no | no |
| 4 | partly fixed | no | no |
| 5 | fixed | no | no |
| 6 | changed shape | no | no |
| 7 | partly fixed | no | yes |
| 8 | cannot tell from source | yes | no |
| 9 | open | no | no |
| 10 | changed shape | no | no |
| 11 | fixed | no | no |
| 12 | changed shape | yes | yes |
| 13 | fixed | no | no |
| 14 | fixed | no | no |
| 15 | changed shape | no | no |
| 16 | fixed | no | no |
| 17 | fixed | no | no |
| 18 | fixed | no | no |
| 19 | open — accepted | no | no |
| 20 | fixed | no | no |
| 21 | fixed | no | no |
| 22 | fixed | no | no |
| 23 | open | no | no |
| 24 | fixed | no | no |
| 25 | changed shape | yes | no |
| 26 | fixed | no | no |
| 27 | fixed | no | no |
| 28 | partly fixed | no | no |
| 29 | fixed | no | no |
| 30 | fixed | no | no |
| 31 | cannot tell from source | yes | no |
| 32 | partly fixed | no | no |
| 33 | fixed | no | no |
| 34 | fixed | no | no |
| 35 | open | no | yes |
| 36 | fixed | no | no |
| 37 | partly fixed | yes | no |
| 38 | fixed | yes | no |
| 39 | partly fixed | no | no |
| 40 | fixed | no | no |
| 41 | changed shape | no | no |
| 42 | changed shape | no | no |
| 43 | fixed | no | no |
| 44 | partly fixed | yes | no |
| 45 | open | yes | yes |
| 46 | cannot tell from source | yes | no |
| 47 | open | no | no |
| 48 | partly fixed | yes | no |
| 49 | open | no | no |
| 50 | open — accepted | no | no |
| 51 | open | no | yes |
| 52 | cannot tell from source | yes | no |
| 53 | fixed | no | no |
| 54 | partly fixed | no | no |
| 55 | partly fixed | no | yes |
| 56 | cannot tell from source | yes | no |
| 57 | cannot tell from source | yes | no |
| 58 | fixed | no | no |
| 59 | partly fixed | no | no |
| 60 | open | no | no |
| 61 | fixed | yes | no |
| 62 | open | no | no |
| 63 | partly fixed | no | no |
| 64 | open | no | no |
| 65 | partly fixed | no | no |
| 66 | partly fixed | no | no |
| 67 | open | no | no |
| 68 | partly fixed | no | no |
| 69 | fixed | no | no |
| 70 | fixed | no | no |
| 71 | fixed | no | no |
| 72 | open | no | yes |
| 73 | partly fixed | no | yes |
| 74 | cannot tell from source | yes | no |
| 75 | fixed | no | no |
| 76 | changed shape | no | yes |
| 77 | partly fixed | yes | no |
| 78 | partly fixed | no | no |
| 79 | fixed | no | no |
| 80 | fixed | no | no |

Counts: **33 fixed; 18 partly fixed; 14 open (including two accepted keeps/dismissals); 8 changed shape; 7 cannot tell from source.** GUI/reproduction checks: **16**. Genuine open owner questions: **9**.

## Grouped by surface

Candidates can appear in more than one group when a fix crosses a surface boundary; this is an ownership map, not another census.

- **Documents:** 8, 9, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 25, 27, 28, 29, 52, 53, 56, 62, 65, 66, 73, 75. Main remaining work: highlight presentation; seen-state history semantics; reproduce blank/input/color issues; reader-oriented Markdown; per-version export.
- **Decks:** 32, 33, 34, 35, 36, 37, 38, 39, 40, 42, 43, 44, 45, 46, 47, 48, 49, 51, 54, 59, 62, 66, 72. Main remaining work: free-move/flow decision; preserve usable stage area; preview Fit; change navigation; pin/target distinction; orphan filtering; compact conversation; export menu/history actions.
- **Design systems:** 4, 11, 20, 32, 36, 52, 55, 60, 61, 62, 63, 68. Main remaining work: truthful seed provenance; actual governing-system inspection/label; cascade-correct checks; visual inspection tools; initial chooser state; figure-ink law/token update.
- **Dashboards:** 21, 27, 28, 65, 66, 67, 68, 69. Main remaining work: file-source staleness/re-read and system-colored charts; shared document history/export work applies.
- **Comments and side threads:** 23, 24, 25, 26, 27, 29, 48, 49, 54, 73. Main remaining work: trust in a live side-thread card; duplicate-target identity; hide orphaned threads by default; remove nonactionable history chatter; export identity.
- **Spaces and library:** 1, 4, 5, 7, 18, 32, 41, 55, 63, 71. Main remaining work: relationship/actor presentation; creation destination from All; actual system visibility. Space-aware creation/mirroring should not be rebuilt.
- **Session panel and transcript:** 2, 3, 7, 12, 21, 22, 30, 31, 41, 57, 58, 59, 71, 74, 79. Main remaining work: float obstruction/compact composer and exact-message rendering diagnosis. Question→answer cards and benchmark parity are already implemented.
- **Shell and quit:** 10, 12, 57, 58, 59, 64, 70, 71. Main remaining work: movable annotation toolbar; compact/visible-resize conversation affordance; verify popup/tab click. Do not reopen the dismissed old-binary/profile circumstance.
- **Export and delivery:** 18, 50, 51, 65, 66, 69, 72, 73, 76, 77, 78, 80. Main remaining work: submenu/PNG meaning; reader Markdown; version-card export; author identity; direct-source discovery/attestation; Notion assets/fidelity. Save As, direct no-turn delivery and removal of the false approval promise already landed.
- **Agent config:** 6, 21, 31, 32, 62, 74, 76, 78, 79. Preserve full owner configuration by default. Diagnose pointless tool use without treating plugins themselves as the defect. Resolve actual system/visual inspection and the app-MCP/direct-connector boundary explicitly.

## Decisions to ask the owner, in one pass

1. **7 — This-session list:** retain read-only artifacts with Read/Created/Edited labels, or hide read-only artifacts? Pick: retain with labels.
2. **12 — Conversation over documents:** reserved space versus an overlay with adjusted height/transparency? Pick: reserved space when wide, explicit overlay when narrow.
3. **35 — Slide layout model:** preserve structured layouts with a visually stable conversion to free positioning on manipulation, or make slides free-positioned by default? Pick: preserve structured authoring, make human manipulation preserve sibling geometry.
4. **45 — History layout:** floating history card versus move conversation/right-side content below the slide? Pick: overlay history card first.
5. **51 — PNG:** cover, selected slide, or all slides? Pick: selected slide as ordinary action.
6. **55 — Creation from All:** choose destination, remember it, or always create outside Space? Pick: lightweight remembered destination control with explicit No Space.
7. **72 — PowerPoint sharing:** warn only, or Basic fonts as ordinary sharing default? Pick: Basic fonts plus a named-font compatibility explanation.
8. **73 — Export author:** explicit MAWS export name, account name, or neutral label? Pick: explicit export identity with account-name suggestion.
9. **76 — Notion custody:** independent app delivery versus dependence on an authenticated engine to avoid a second sign-in? Pick for the current wave: keep direct custody, repair discovery/attestation; consider one broker separately if unified sign-in is a product priority.

Everything else is either already answered by source/decisions, a clear owner instruction, or a reproduction task—not a reason to ask the owner to rediscover the implementation.