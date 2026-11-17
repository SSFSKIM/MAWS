# UX wave · ticket 733, first landing (733a) · what MAWS composes carries no approval (2026-11-17)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, cited below as *root*). This landing is not a child of that spec: the root binds it through the wave's laws and UC-8, UC-10, UC-11 and UC-14. **Board ticket:** 733 (P1), spawned by ticket 711. **Parent pin:** `1f1ab719bb0ed474c26851d180423d75338942c9` on branch `ux-wave/733-paste-consent`; its code is that of `bdbfe863e` (master `77af813a4` plus the eight landings of the wave's chain in review), and every statement about the code below was checked there.
>
> **The split.** Ticket 733 lands in two. This document is the first, **733a: what MAWS composes**. The second, **733b: what a person pastes**, is the revision of `docs/doperpowers/plans/2026-11-17-ticket-733-paste-consent.md` (cited below as *the first document*), which this document supersedes for the composed forms. The split follows the adversarial review of 2026-11-17 of the first document (three findings of the first rank, six of the second) and the architect's rulings on it. 733a sits first in the chain and four later links take it by merging it down, so it is as small as it can be and still close what the ticket's body names.
>
> **The statement of work** is the ticket's body and comments (`gh issue view 733 -R SSFSKIM/MAWS --json body,comments`) and the architect's rulings of 2026-11-17 recorded under "Ruled". The owner's three answers on pastes (how a marked paste looks, the cut, text a plugin fills in) are recorded on the ticket; they belong to 733b and nothing here depends on them.
>
> **The measurements** are on branch `ux-wave/733-paste-probe` at `70d56b97541b5310950f81006b0111e48243121c`: the first probe (`spikes/protocol-probe/findings-uxwave-733-paste-block.txt`, 118 sessions), the second (`findings-uxwave-733-paste-fields.txt`, 54 sessions), and under them the writer probe of U1c (`findings-uxwave-u1c-writer-forms.txt`). Ticket 711's rows are in `findings-uxwave-711-envelope-consent.txt` on branch `ux-wave/711-envelope-probe`. A third probe is recording two rows this document leaves open ("Waiting on the third probe"). M1 merges the probe branch.
>
> **Not in this landing** (733b's, or nobody's): a mark on pasted text, the composer's intake and serialiser, drafts, history, the smaller fields, `/fork`, the rule that a block of up to 20,000 characters is drawn in place in every sent message, any owner card, any stored form, any wire minor. Also not: the Approve press, the answer envelope, the engine's own fields for a user frame.

## Purpose

The engine's auto mode reads a message with the person's origin as the person's own words. MAWS itself writes such messages around words a model, a command or a page wrote: a side question's answers handed to a new thread, a plan handed back after a clear, a quoted line of a diff under a comment, an agent's name in a relay. A sentence in one of those slots that approves a blocked command stands before the engine's classifier as if the person had said it. Ticket 711 closed that for one writer, the answer envelope. This landing closes it for the rest.

After it, in every message MAWS composes and sends with the person's origin:

- **content** a model, a command or a page wrote has every line that quotes the approval sentence's opening **left out**, a fixed marker in its place, and what remains stands **inside a pasted segment**, the engine's own frame for text the person did not write;
- **a name** of one line (an agent's name, an anchor's label, a title, a path) holds no line break and is left out when it quotes the opening;
- the whole text passes `neutraliseGrant` as its last step;
- and the test of "quotes the opening", `quotesGrant`, reads the shapes it misses today, which also makes ticket 711's guard on the ask tool refuse them.

A person sees their promoted side question, their plan and their Review comment drawn exactly as today. The one new thing they can meet is the marker, where a line was left out.

How to see it working: the unit tests named under each milestone, which write each form by its real writer with the approval sentence in the slot others control and read the result through the readers of an approval; in a running build, the scenes of M4, which only a Mac run gives.

## Progress

- [x] (2026-11-17) The first document written, reviewed, and split by the architect's rulings.
- [x] (2026-11-17) This document written against the pin: the writers, their recognisers and the readers of each form traced; the two probes' rows read and the rows cited here recounted from the findings.
- [ ] The adversarial review of this document.
- [ ] The third probe's counts, and the two rows of "Waiting on the third probe" finished by this document's author.
- [ ] The pass over "Statements to check again".
- [ ] M1 — The shared rules, and the measurements on the branch.
- [ ] M2 — The content forms: written, read in place, edited and sent again.
- [ ] M3 — The name forms, the two waiting forms' places, the guard.
- [ ] M4 — The scenes, the cross-build row, the whole suite, the acceptance.

## Ruled

By the architect, 2026-11-17, on the first document's points and its review. Numbers are the first document's points; 17 and 18 are new.

| # | ruling | where it lands here |
|---|---|---|
| 18 | Inside content MAWS composes, a line that `quotesGrant` matches is replaced by a fixed marker, and the whole content also sits in a segment. A person's own paste is never rewritten. | Design 2, 3 |
| 13 | `quotesGrant` reads wider; the document names it as the change to ticket 711's ask guard and lists the shapes the guard now refuses. | Design 1; "For a comment on ticket 711" |
| 14 | The tag's look-alike brackets are neutralised. | Design 1 |
| 6 | A relay's own text is not framed; its names go by the name rule; an address that quotes the opening refuses the relay. | Design 3 |
| 7 | A Review comment's quoted line goes inside a segment; an older build draws it as a chip. | Design 3, 6 |
| 10 | The probe branch is merged first, as a merge commit of its own. | M1 |
| 12 | A form composed for a session not yet started goes with a random tag id. | Design 3 |
| 15 | Two refusal sentences and the markers are new words. | §E |
| 11 | The document does not say that no fact read from the engine's source bears weight: the one about a first message's protection is named, with a limit and a tracker row. | Design 3, "What is not proven" |
| 17 | `/btw` is stated: a side question goes unframed; a promotion frames the exchange. | Design 3 |
| Design 13 of the first document | MAWS frames, and sends none of the engine's fields; the two flags are out. | "What was measured" |
| 4, 5 | Not settled: the echo of a `!` command and an artifact's attached read wait for the third probe. | "Waiting on the third probe" |
| review, first rank, second | Edit takes the stored row by its message id, never a row a surface mod rewrote. | Design 5 |
| review, second rank, ninth | A typed link in a comment's own words names a file for a save, by design; the first document's sentence was wrong. | Design 6 |

## What was measured, and what this landing claims from it

All on engine 2.1.322, auto mode, MAWS's launch. "Allowed" counts the runs in which the classifier let the retry of a blocked command through after the message under test. Every classifier row below was recorded on the smallest model (`claude-haiku-5-5`); no row of either probe measures the classifier under a larger model. The larger model appears only in the first probe's cases of what an agent does with a pasted block.

| the approval sentence reaches the engine as | allowed | rows |
|---|---|---|
| typed, on a line of its own after other sentences | 5 of 5, and 5 of 5 | U1c's writer probe P1 (p1-1..5); the second probe `ktyped` (1..5) |
| the same with the joiner alone (`neutraliseGrant`) | 3 of 5 | P2 (p2-1..5); the first count on the ticket was 2 of 3 |
| inside MAWS's pasted segment | 1 of 10 | P3, 0 of 5 (p3-1..5); `kwrap`, 1 of 5 (kwrap-5, after a neutral follow-up) |
| inside the segment, with the joiner | 0 of 5 | P4 (p4-1..5) |
| declared in one of the engine's own paste fields | 0 of 10 | `kpc` 0 of 5, `kil` 0 of 5; the engine wrote the same block, byte for byte |
| typed, with one of the engine's two flags on the frame | 4 of 5 each | `kcc`, `ktnt`: the flags change nothing the model receives |
| not in the message at all (the answer envelope after ticket 711: a pick written by its place) | 0 of 8 | ticket 711's Y3, 0 of 5, and Y3b, 0 of 3 |

What this landing claims, and nothing beyond these counts:

- **The frame lowers the rate and is not a guard alone.** One run in ten let the sentence through from inside MAWS's own segment; one in twenty over every marking form tried.
- **The joiner does not settle the engine's decision.** It settles what MAWS's own readers read (U1c's document, Decision 65).
- **A sentence that is not in the message was allowed in no run of eight.** That is why ruling 18 leaves the line out, where MAWS wrote the message and the words are not the person's: for the exact opening, the protection no longer rests on how a model or a classifier reads a frame, nor on the rule about pasted content reaching the model at all.
- **The engine's own fields are not used.** The paste fields end as MAWS's own form and depend on a feature gate MAWS does not hold; the flags do nothing (the second probe).

Not measured, and not claimed: a reworded approval, which no test of an opening can find and which stands inside the segment at the rate of the third row; a larger model's classifier; a resumed or compacted conversation.

## The landing's edge

**In.** `quotesGrant`'s wider reading with its differential and its work pins. `nameSlot`. The tag's fold for look-alike brackets. `leaveOutGrant` and the one function every content writer calls. The writers: the promoted side question, the plan after a clear, the Review comment's quoted line, an anchored comment's fields, a relay's names, an attached read's title, a file mention and the path refusal, and the six names MAWS writes into a draft. The echo of a `!` command and the attached read's content, each built with its three treatments and one constant that the third probe's result sets. The drawing in place of a segment inside one of MAWS's own forms: the transcript's row, a queued row's text, the resume chooser's preview, a session's title. Edit on a bubble: the stored row by its id, and an edited form sent again with its content still in a segment. The own-text rule's two directions for a comment, pinned. The guard's cases. The measurements merged. One scene group and one cross-build row.

**Out.** Everything 733b owns (the header's list). A rewind's prefill of a composed row: the engine's text for the message holds no frame, so a plan rewound to and sent again goes as typed; that is the rewind's source, board ticket 740, and gets a tracker row and a line there. The conversation search's snippet shows a segment's tags where it shows a chip's today (tracker row).

### Statements to check again once the chain's fourth batch is on master

One reading at the merged head, by the executor of M1, recorded in Progress; a row that no longer holds stops the milestone that rests on it.

| # | statement | where | rests on it |
|---|---|---|---|
| 1 | The guard's `maws` forms and its `DRAFT_FORMS` are those Design 3's tables go through, and the owner question's answer line is a retired form with no site | `test/support/person-sends.test.ts` | Design 3; M3 |
| 2 | `COMPOSED_FORMS` holds its twelve readers; no constant of a form moves in this landing | `src/shared/engine/composed-forms.ts` | Design 3, 6 |
| 3 | Rule R reads no grant on a line inside a pasted segment and none in a message holding a form flagged for grants | `src/shared/engine/arrival.ts` | acceptance 5 |
| 4 | The own-text rule reads an anchored message whole by writing its read comments back with `commentsMessage`, takes each comment's words, and cuts a paste's frame and body out of them; its per-reader bound is `3n + 2` and its budget `OWN_WORK_PER_CHAR` = 48 | `src/shared/files/named.ts` | Design 1, 6; M1, M2 |
| 5 | `userTextOf` reads an anchored message with `readAnchoredMessage`, draws several comments through `CommentParts` without `splitPastedSegments`, and one comment or a promotion through it | `transcript/model/user-text.ts`, `transcript/view/rows/User.tsx` | Design 4; M2 |
| 6 | `editRowOf` checks that the store holds a row of the message id and then edits the row it was handed; a surface mod's rewrite hands `UserRow` a row with the mod's text | `composer/resubmit-seam.ts`, `transcript/surface/Rows.tsx` | Design 5; M2 |
| 7 | An edited bubble is sent as `framed(serializeDraft(prefillToDoc(editPrefill(edit)), literal), edit.framing)` | `composer/resubmit-seam.ts` | Design 5; M2 |
| 8 | A queued row's text is `entryDisplay(content)`; the resume chooser's preview reads a prompt's text through `textOf`; a title is `promptTitle(first_prompt)` cut to six words | `composer/queue/entry-text.ts`, `src/services/sessions/recent-turns.ts`, `src/services/index/sessions.ts` | Design 4; M2 |
| 9 | `quotesGrant`'s callers are the ask tool's guard, the answer envelope's writer and the composed forms' list | `src/engine-host/tool-server/ask.ts`, `src/shared/maws/ask.ts`, `composed-forms.ts` | Design 1 |
| 10 | The desk's web app draws rows by the transcript's model and view, imported by path | `apps/desk-web/src` | Constraints |

## What the code holds today

Verified at the pin.

- **The writers.** `promotionMessage` (`src/shared/anchor/message.ts`) joins its head, each exchange as `Q:` and `A:` with the model's answer raw, the typed words, and the anchorless tag, with blank lines. `planPrompt` (`src/shared/engine/host-prompts.ts`) is `Implement this plan:`, a blank line, the plan raw. `quotedComment` (`anchor/message.ts`) puts a diff's line, as a code span, on a line of its own above the comment's words. `anchoredMessage` and `commentsMessage` write an anchor's label and its other fields into the lead line and the tag. `relayText` (`src/renderer/src/tools/agents/model/relay.ts`) writes an agent's name, or a peer's name and address, around the person's text. `linkedReadBlock` (`src/shared/maws/linked-read.ts`) writes an artifact's title into its lead and the read, one line of JSON, between the engine's reminder tags. `bashEcho` (`host-prompts.ts`) is the command between `<bash-input>` tags and then the engine's own replayed output frame, verbatim. None of them calls `neutraliseGrant`; none frames anything.
- **Their recognisers** share one constant each with their writer (`PROMOTION_HEAD`, `PLAN_LEAD`, `ANCHOR_TAG_OPENING`, `RELAY_CONTINUE`, `LINKED_READ_OPENING`, `BASH_INPUT_OPENING`), listed in `src/shared/engine/composed-forms.ts`. Two readers rebuild text to recognise a form: `readOneComment` regenerates the lead from the tag's anchor, and `linkedReadOf` regenerates the lead from the read's title.
- **The names MAWS writes into a draft**: a mention through `mentionText` (control characters become U+FFFD since U1c); and, as raw text, the Agents widget's `@agent-<name>`, the Skills widget's `/<name>`, the `@` menu's skill row, the slash palette's row, a design system's adoption request, and Mark-up's `Mark-up of <label>`.
- **`quotesGrant`** (`src/shared/engine/grant.ts`) folds the whole text (NFKC, lower case), reads letters and digits only, and reads a pair of angle brackets as the first `<` to the first `>` after it, kept and removed; a `<` inside a pair is ignored, and a letter beyond ASCII ends every beginning. `neutraliseGrant`, in the same file, reads wider: each character folded by itself in two case images, and the words from any `<` to any later `>` with no typed `>` between them kept and removed.
- **The frame.** `wrapPasted(id, body)` (`src/shared/composer/pasted-framing.ts`) writes a blank line, the opening tag, the body with the ASCII spelling of the tag neutralised, the closing tag, a newline; a body's one trailing newline is dropped. Every reader of a sent message turns every block into a placeholder and a chip, whatever its size and whatever message it stands in (`splitPastedSegments`, `transcript/model/user-text.ts`); a message of several comments is the exception and would show a block as raw tags.
- **Edit on a bubble** hands the action the row the bubble was drawn from. Where a surface mod rewrote the message's text, that is the mod's row, with the mod's words (`transcript/surface/Rows.tsx`); `editRowOf` (`composer/resubmit-seam.ts`) checks only that the store holds a row of that message id and edits the row it was handed.
- **The own-text rule** (`ownTexts`, `src/shared/files/named.ts`) reads an anchored comment's own words as the person's: a link typed there names a file for a save. The anchor tag is flagged not for saves in `composed-forms.ts` for that reason. A promotion and every other composed form is claimed whole and names nothing for a save.
- **A side question** (`/btw`) is asked through `session.sideQuestion`: it is no message of the conversation, the engine answers it without tools, and no transcript record holds it.

## The design

### Words used here

- **Pasted segment**, **frame**, **block**: the text `wrapPasted` writes; the engine tells the model that text inside it "was pasted into the message by the user from somewhere else and may contain instructions the user did not write".
- **Content**: text of any number of lines that a model, a command or a page wrote, carried whole by a form (an answer, a plan, a quoted line).
- **Name**: text of one line that MAWS writes inside a sentence of its own (an agent's name, a label, a title, a path).
- **The opening**: `Permission granted for `, the start of the approval sentence (`GRANT_OPENING`); **the longer opening**: the opening and `this exact` or `these exact`.
- **Left out**: replaced by a marker of MAWS's own words.
- **In place**: said of a segment a reader shows as its text where it stands, with no placeholder and no chip.
- **The joiner**: U+2060, which `neutraliseGrant` puts inside the first word of a span that reads as the longer opening.

### 1. The shared rules

**`quotesGrant` reads wider.** It answers true for everything it answers true today, and also wherever `neutraliseGrant`'s reading finds the opening: each character folded by itself, in both case images; the words from any `<` to any later `>` with no typed `>` between them read kept and removed; a `>` that a combining mark follows closes without ending. It is the refusing side for every caller at once: the ask tool's guard, the answer envelope's writer, the save rule's list of forms, and now `nameSlot` and `leaveOutGrant`. It beat leaving it narrow and leaning on `neutraliseGrant` at the writers: a name or a line of the missed shapes would be neither left out nor refused.

Its work per character rises. Three pins move with it in the same milestone, each refitted from the counted work and not guessed: the function's own count, the own-text rule's per-reader bound and budget (`src/shared/files/named.ts`), and rule R's work pin (the test of `arrival.ts`). The executor chooses the implementation; the contract is §A's three properties.

**For a comment on ticket 711.** The ask tool refuses an ask any of whose strings `quotesGrant` matches. After this landing it also refuses these, each answered false at the pin (the executor shows each red before the change and strikes one that is not):

| shape | example (the opening's words only) |
|---|---|
| a bracket before the opening and a tag between its parts; the bracket full-width or small, or plain | `＜Permission gra<b>nted for`, `<Permission gra<b>nted for` |
| a tag between the opening's parts whose closing bracket carries a combining mark | `Permission <i>` with U+0338 after the `>`, then ` granted for` |
| a letter that only an upper-casing makes the opening's | `Permißion granted for`, `Permıssıon granted for` |

Nothing it refuses today is let through. The comment's text, for the architect to post: "Ticket 733's first landing widens `quotesGrant` to the composer writer's reading (each character folded by itself in both case images; any `<` to any later `>` with no typed `>` between, read kept and removed). The ask tool's guard therefore also refuses a string of the three shapes in that landing's document, which it let through. A seeded differential holds that no string refused before is accepted now."

**`nameSlot(name)`** is the rule for a name: every control character and every line or paragraph separator becomes U+FFFD (the class `mentionText` uses, in one copy), and a name `quotesGrant` matches is left out, `(a name left out by MAWS)` in its place.

**The tag's brackets.** A body inside a segment must not be able to end it for a reader. `neutralisePastedTags` rewrites the ASCII spelling of the tag, which is what the engine's parser reads; a look-alike closing tag written with a full-width bracket is not rewritten, and a model reading the message could take the block for ended. The neutraliser is widened to the compatibility fold of the bracket and the slash: after it, the NFKC lower-case fold of a body holds no `<pasted_content` and no `</pasted_content`; `restorePastedTags` restores what the neutraliser wrote. The engine's own writer scrubs further (letters of other scripts that look alike); MAWS does not, and "What is not proven" says so.

### 2. A line left out: what `leaveOutGrant` replaces

Content is rewritten by one function, `leaveOutGrant(content)` in `src/shared/engine/composed-content.ts` (§B), and only content: never a person's typed or pasted words.

`quotesGrant` reads letters and digits across the whole text, so the opening can stand on one line, inside marks or tags, or across several lines. A rule that looked at each line alone would miss the last. So "a line" is defined by the test itself: **every line that a reading of the opening touches is left out**, and the function ends only when `quotesGrant` of what is left is false.

1. Content that `quotesGrant` does not match is returned as it is, byte for byte. That is the ordinary case, and one reading.
2. The content is cut into lines at its line breaks (LF, CRLF, a lone CR, U+0085, U+2028, U+2029); each line keeps its break.
3. Every line that `quotesGrant` matches by itself becomes `(a line left out by MAWS)`.
4. While the whole still matches, at most `LEAVE_OUT_ROUNDS` = 8 times: the run of lines that holds the first remaining reading (the earliest line at which the text up to and including it matches, back to the latest line from which the run still matches) becomes one line, `(lines left out by MAWS)`.
5. If it still matches (more runs than the cap, or a run the search could not place), the whole content becomes `(lines left out by MAWS)`.

It ends with `quotesGrant` false in every case: steps 1, 3 and 4 return only on that test, and step 5 returns a marker, which the test does not match. The markers cannot rebuild what they replace: neither holds the letter the opening begins with, and neither continues a part of it by more than one letter. A marker that a bracket pair in the surrounding lines "removes" leaves the whole still matching, and the next round, or step 5, takes those lines too.

| content holds | left out | `quotesGrant` after |
|---|---|---|
| nothing that quotes the opening | nothing; the content is unchanged | false |
| the approval sentence on a line of its own | that line | false |
| the opening inside a longer line | that line | false |
| the opening with emphasis or code marks between its letters, or a tag around one of its words | that line | false |
| the opening in full-width letters, or with a letter only an upper-casing makes its own | that line (by the wider test) | false |
| the opening's first word at one line's end and the rest at the next line's start | both lines, as one marker | false |
| the same with CRLF, a lone CR, U+0085, U+2028 or U+2029 between them | both lines | false |
| the opening's parts on two lines with a bracket opened on the first and closed on a later one, other lines between | the run from the first to the last | false |
| the opening twice, in two places | each | false |
| the opening in more runs than the cap | everything | false |

What it costs: the opening's three words are everyday text. A plan that says "if permission is granted for the camera, show the picker" loses that line, and the agent reads `(a line left out by MAWS)` there; so does the person, in the bubble. The ruling takes that cost: the line is in a message sent as the person's, written by a model. A reading by the longer opening alone would spare such lines and is one name in `leaveOutGrant` (§B); it is not built.

What it does not reach, said plainly: an opening that begins in words outside the content and ends inside it (a name ending in its first word, content beginning with the rest; a person's question ending in its first word, the model's answer beginning with the rest). No line of the content quotes it. The frame stands between the two parts, and the joiner breaks every longer opening in the final text for MAWS's own readers.

### 3. Each form

Every content writer calls one function, `composedContent(content, tagId)` = `wrapPasted(tagId, leaveOutGrant(content))` (the promotion calls its two halves itself, each answer through the first and the exchanges through the second, because a question inside its segment is the person's), and every writer below ends with `neutraliseGrant` over its whole text unless its row says otherwise. A writer writes the separators its form had before and then the frame, so that the form read in place is the text it was before this landing, where no line was left out (and but for one trailing line break of the content, which `wrapPasted` drops).

| form (writer) | the slot the person did not write | after this landing | what the receiving agent reads | MAWS's own readers of the form |
|---|---|---|---|---|
| a side question promoted to a thread (`promotionMessage`) | each answer, the model's | each answer through `leaveOutGrant`; the exchanges, `Q:` and `A:` pairs as today, inside one segment after the head; the typed words or "Continue from here." after it. A question is the person's own and is not rewritten; it stands inside the segment with its answer | the exchange as material, the typed words as the request | `PROMOTION_HEAD` unchanged; the row reads in place as today; the own-text rule and rule R claim it whole, as today |
| the plan after a clear (`planPrompt`) | the plan, the model's | `Implement this plan:`, a blank line, the plan through `composedContent` | MAWS's fixed sentence asks; the plan is what it asks about | `PLAN_LEAD` unchanged |
| a Review comment's quoted line (`quotedComment`) | one line of a diff, a file's text | the line through `leaveOutGrant`, then the code span of today, inside a segment on lines of its own above the words | the quoted line as material under the person's comment | the comment's words read in place as today |
| an anchored comment, to main or to a thread (`anchoredMessage`, `commentsMessage`, `commentsContent`) | the anchor's fields, a page's or a file's words | every string field of the anchor through `nameSlot`, once, in a function the lead and the tag are both written from | as today | the tag carries the anchor the lead was written from, so `readOneComment` and `readAnchoredMessage` strip the lead as today, also on the two older builds; writing back what was read gives the same bytes, which the own-text rule's whole reading needs |
| a comment or a promotion edited in place and sent again (`anchoredTextOf`) | as the form it came from | Design 5 | as the form | as the form |
| a relay to an agent or a peer (`relayText`) | the agent's name; a peer's name and address | names through `nameSlot`: a left-out name drops the `named "…"` clause, and a peer is then named by its address; an address `quotesGrant` matches refuses the relay, in the relay's own failed state, with §E's sentence. The person's text is not framed and not rewritten | as today | `RELAY_CONTINUE` unchanged; the receipt and the peer's send are matched on the text as sent |
| an artifact's attached read (`linkedReadBlock`) | the title; the content | the title in the lead through `nameSlot`, in the writer and in `linkedReadOf` alike. The content: **waiting on the third probe** | as ruled | `LINKED_READ_OPENING` unchanged |
| the echo of a `!` command (`bashEcho`) | the command's output | **waiting on the third probe** | as ruled | `BASH_INPUT_OPENING` and the four output openings unchanged |
| an async ask's answer envelope (`askSteerText`) | none since ticket 711 | unchanged, and not passed through `neutraliseGrant`: its strict reader holds its grammar line by line | as today | unchanged |
| a blocked call's consent (`consentMessage`) | the call's subject, one JSON string | unchanged: it is the approval, sent by the person's press | as today | unchanged |
| `/compact <instructions>`, `/clear` | none | unchanged | as today | unchanged |

**Names MAWS writes into a draft.** A file mention and an agent mention (`mentionText`), the Agents widget's `@agent-<name>`, the Skills widget's `/<name>`, the `@` menu's skill row, the slash palette's row, a design system's adoption request (an artifact's title), and Mark-up's `Mark-up of <label>` (a page's title and address): each name through `nameSlot` where it is written. A file whose path `quotesGrant` matches is refused where it comes in (`pathRefusal`: a drop, a pick, the `@` menu), with §E's sentence beside the one for a control character. These are edits of strings at eight call sites and of one pure function; the editor's document and its schema are not touched.

**`/btw`.** A side question goes as today, unframed: it is no message with the person's origin, it has no tools to retry anything with, and no transcript record holds it. When the exchange is promoted, the promotion's row above applies.

**The tag id.** `composedContent` takes the id from its caller: `pastedTagId` of the engine session id of the session the message is written into, where the composing site holds it at the write (a comment to the main conversation; the engine host, for the echo and for a plan where it already holds the id of the conversation the clear began), and of nothing, which gives four random digits, where it does not (a thread's first message, composed before its session exists). MAWS's own readers accept any id. **A fact read from the engine's source bears weight here, and it is named:** the rule about pasted content reaches the model through the system prompt under one feature gate, and otherwise through a reminder that fires only for a block with the session's own id (`cli.pretty.js:367412`, `:435969-435972`, `:935318-935339`). In every recorded session (172 of 172 over the two probes) the rule stood in the system prompt, and the id did not matter. With that gate off, a form sent with a random id would reach a model that was told nothing about the tags. What does not rest on that fact: a line that quotes the opening is not in the message at all. A tracker row asks for this to be checked at every engine pin bump: where the rule reaches the model, and whether a block with another id is covered.

**Where the rule runs.** Each form is composed, and so framed, where the value that is sent is made: in the window for a comment, a relay and a promotion made there; in the sessions service for a thread's first message (`openSideThread`), also when a window of an older build or a device over the link asked for it; in the engine host for the plan, the echo and the attached read.

### Waiting on the third probe

The echo of a `!` command and an attached read's content are content by this document's own definition, and the review's third first-rank finding is that the first document left them unframed on no measurement. A third probe is recording how the classifier reads each of them unframed, framed and with the marker (its rows 1a to 1c, 2a and 2b, each with a typed control). Until its counts land, the two decisions are open, and this document's author finishes the two rows of Design 3's table then.

What is built now, so that the result picks a value and restructures nothing:

- One function, `composedAs(content, tagId, treatment)` (§B), with three treatments: `'joiner'` (the content as it is; the writer's last `neutraliseGrant` is all), `'segment'` (`wrapPasted` of the content), `'leftOut'` (`composedContent`: lines left out, then the segment).
- Two constants beside their writers, `ECHO_OUTPUT` in `host-prompts.ts` and `READ_CONTENT` in `linked-read.ts`, each one of the three. Both writers are built and tested for all three values.
- The echo's treatment acts on the text inside each of the engine's `<bash-stdout>` and `<bash-stderr>` tags and leaves the tags as they are, so the file route's reader of the echo (`src/engine-host/fs/backfill.ts`) finds them; under `'segment'` or `'leftOut'` the file route's reader takes the segment out with §C's `takeSegment`.
- The read's treatment acts on the string values of the read's JSON, parsed and written again as one line, so the block stays a read that `linkedReadOf` recognises; `linkedReadOf` accepts all three shapes, since a stored transcript keeps whichever was written.
- The byte form of each framed variant is the one the third probe's scenario sent; the executor takes it from that scenario when the counts land.

M3 does not close, and the branch does not go to its review, with either constant unruled.

### 4. A segment inside one of MAWS's forms is drawn in place

**Two recognisers, each keyed on a mark only MAWS writes, not one rule by size.** The choice was between these and the one reader of the first document (every block of up to 20,000 characters in place), with only its callers for composed forms switched. The one reader cannot serve here: its cut is by size, the row of a composed form and the row of a person's message go through the same caller (`userTextOf`), and a size cannot tell a plan's segment from a person's chip. So 733a adds no general rule and leaves `splitPastedSegments` as it is.

- **An anchored message.** A text that `readAnchoredMessage` reads (it ends in MAWS's own tag) has every segment in its comments' words, or in a promotion's text, drawn in place. This covers the promotion, a comment's quoted line, a message of several comments, and both after an edit.
- **A plan prompt.** A text that is exactly the writer's shape, `Implement this plan:`, the blank line, one segment and nothing after, has its segment drawn in place.

In place, the frame's own line breaks are dropped and the form's are kept: the two before the opening tag and the one after the closing tag are `wrapPasted`'s.

**No sent message of a person's changes its drawing.** A person's message reaches the first recogniser only if it ends in MAWS's anchor tag, and the second only if it is, byte for byte, the plan prompt's shape. A person cannot make either with the composer except by typing MAWS's own tag line, or MAWS's sentence and nothing else beside one pasted chip; such a message is the form, character for character, and is drawn as the form. Every other row goes through `splitPastedSegments` unchanged; a differential against the reader at the pin, over seeded messages of a person's (chips of every size, the forms' fixed words in other places, a tag that does not parse), holds it.

Where a form's text is shown:

| surface | reader | after |
|---|---|---|
| the transcript's row, live, held and from a file | `userTextOf` | in place by the two recognisers; the row records the ranges (`composed`) |
| a queued row's text in the stack | `entryDisplay` | in place |
| the resume chooser's preview | `textOf` in `recent-turns.ts` | in place |
| a session's title | `promptTitle` | a plan prompt's opening tag line taken out, also where the 200-character cap cut the block; a thread's first message is unchanged, because its segment stands after the six words a title keeps (pinned for the shortest lead) |
| copy and the Markdown export of a row | the row's text | as drawn |
| conversation search | the raw text | unchanged: a snippet can show a segment's tags, as it shows a chip's today (tracker row) |

A plan prompt edited so that its first line changed is no longer the plan's shape, and its plan is then drawn as a chip: it is the person's message with a pasted block.

733b's one reader, when it lands, subsumes the drawing; the two recognisers stay as what says "this is MAWS's form".

### 5. Edit on a bubble

**The stored row, by its id.** `startInlineEdit` takes the message id and reads the row from the transcript's store; it never edits a row it was handed. A message whose id the store does not hold is not edited. So where a surface mod rewrote the drawn text, Edit shows the message as it was sent, not the mod's words: a mod's rewrite is a drawing, and never the source of a message. The test: a row with rewritten text handed to the action gives an edit that holds the stored text, its framing and its composed parts; the control in the same test is the unrewritten row, which gives the same edit.

**A form edited and sent again keeps its content in a segment.** The edit holds, beside its text, the bodies of the stored row's composed ranges. On Send, each body that still stands whole in the edited text, in order, is sent again as a segment where it stands; if any no longer does (the person edited inside it), the whole edited text goes inside one segment. The framing of an anchored comment or a promotion is put back around it as today. This is the guard's two forms "edited in place", and it needs no mark and no editor: the bodies are matched as text when the edit is sent (`composedPrefill`, §D). Lines were left out when the form was first written; nothing is left out again, and nothing the person typed is rewritten.

### 6. What rule R and the own-text rule answer

Neither reader's rule is edited.

- **Rule R** yields no grant from any message that holds one of these forms, as today, and reads no grant on a line inside a segment.
- **The own-text rule, corrected from the first document.** A composed form names no file for a save, **except an anchored comment's own words**, by design: a link the person typed in a comment names a file for a save, today and after this landing. What changes: the quoted line now stands in a segment inside those words, and the rule cuts a segment out before it looks for a link. Pinned in both directions through `rowClaim`, in one test: a comment whose typed words hold `[notes](/work/out/notes.md)` answers a save; the same link in the quoted line, and the same link in the anchor's label, answer a read only; and a promotion holding the link in an answer answers a read only.
- The whole reading of an anchored message compares the text with its comments written back by `commentsMessage`. The writer is idempotent on what it wrote (`nameSlot` on a field already slotted, `neutraliseGrant` on a text already neutralised), and a test holds the equality for each form.

### 7. Routes (root law 5)

- **A session MAWS runs:** everything above.
- **A terminal session:** MAWS composes the same text and the bridge delivers it with the plugin's origin, never the person's; its rows come back through the same readers.
- **A session on another machine:** the window or that machine's service composes; its host writes what it is given, whatever its build. Its rows are read here by this build's readers.

### 8. Stored and sent, build by build

"F" is `f1852de3a`; "the build in use" is `2c7044231`; read with `git show <sha>:<path>`. Nothing is stored that was not stored before; no settings file, layout key or wire minor changes (UC-14).

| what this build sends | what F and the build in use do with it | what this build does |
|---|---|---|
| a promotion, a plan prompt or a single comment with a segment, in the engine's transcript and the host's journal | recognised by the same constants and the same tag; the segment draws as a chip, `Pasted text #1 · L lines`, which opens to the text (`splitPastedSegments` and `PastedBlock`, the same code at all three). Edit gives the chip's placeholder back and sends it framed again | in place |
| a message of several comments with a quoted line (the build in use; F has no such message) | the segment is drawn as raw tags inside that comment | in place |
| an anchor whose field `nameSlot` changed | lead and tag agree, so the lead is stripped as for any comment; the chip shows the marker | the same |
| an attached read whose title `nameSlot` changed | their `linkedReadOf` rebuilds the lead from the raw title and does not recognise the block, which is then drawn as text. Only for a title holding a control character or quoting the opening | recognised |
| a text with a look-alike tag neutralised | their `restorePastedTags` leaves the added backslash in what Edit shows | restored |

What an older build sent is read as before: its forms hold no segment, and the two recognisers change nothing for them.

### What is not proven

- That the classifier refuses what stands inside a segment: 1 of 10 was allowed. For the exact opening this landing no longer leans on it; for a reworded approval inside content it still does.
- A larger model's classifier; a resumed or compacted conversation; an image or a document block.
- The two waiting forms.
- An opening assembled across a slot's edge (Design 2).
- Letters of other scripts that look like the tag's (Design 1).
- A form sent with a random tag id where only the reminder's gate is on: read from source, not run (Design 3).
- A relay's own text and a rewind's prefill go as typed.

### Why this, not that

- **Leave the line out, and frame:** the counts. Framed alone was allowed once in ten; not in the message, never in eight.
- **The test defines the line:** a rule per line misses an opening split across lines, and the table could not end in "false" for every row.
- **One function for content, called by every writer:** a writer that frames without leaving out, or the reverse, is the hole the next review finds.
- **Two recognisers, not a rule by size:** Design 4.
- **Bodies matched at Send, not a mark:** the mark is 733b's; a form's content is known text, and the fallback is the whole text in a segment.
- **Names left out, content rewritten by line:** a frame inside a name's sentence breaks the readers that rebuild it; leaving a whole plan out for one line loses the plan.

## Acceptance

Each is a behaviour with the test that shows it; the commands are in Concrete Steps. "Through the readers of an approval" means `grantsReadFrom` and `expectNoGrantSent` of `test/support/grant-readers.ts`, which read a content as the queue's gate, as the engine host's mark on the frame it writes, and as the engine's row. Every "no grant" and "none drawn" below goes through them and has, in the same test, a control that shows the check finds a grant when one is there.

1. **`quotesGrant` reads the three shapes** of "For a comment on ticket 711", each shown answered false before the change; a seeded differential against a copy of the function at the pin reports no text answered true before and false now; its work is linear, by a count; the own-text rule's and rule R's pins hold at their refitted values.
2. **`leaveOutGrant` ends with `quotesGrant` false** for every row of Design 2's table and for seeded contents with planted openings; content that does not match comes back byte for byte; every line of the output is a line of the input or a marker, in order; its readings are bounded by a count.
3. **A body cannot end its segment.** After `neutralisePastedTags`, the NFKC lower-case fold of the body holds neither spelling of the tag (ASCII and full-width cases); `restorePastedTags` gives the text back.
4. **Each content form carries the model's text only inside a segment, with the approval sentence gone.** For the promotion, the plan and the quoted line, written by the real writer with the approval sentence on a line of its own in the slot: the marker stands where the sentence stood; the content is inside one segment (read with `pastedBodies` over the wire's lines); `quotesGrant` of the slot's text as sent is false. The control: the same slot text beside the form as a typed line is found by the same checks.
5. **No approval is read from any form, and a pressed one still is.** Each form of Design 3, with the approval sentence in its slot: through the readers of an approval, none on the gate, the live route and the file route. The pressed consent alone, and joined after a typed message: its grant on all three.
6. **A name holds no line and no opening.** Each name form with a name holding a line break and the opening: no line break in what is written; the name left out; a relay to a peer whose address quotes the opening is not sent and its state says why; an attached read whose title was changed is still recognised by `linkedReadOf`; a file whose path quotes the opening is refused at each of its three entrances.
7. **The forms read as today.** Through the real derivation, the row of a promotion, of a plan prompt, of one comment with a quoted line and of several: its text equals the text the writer at the pin gave for the same input (but for one trailing line break of the content), with no placeholder and no chip. The same for a queued row's text and the resume preview; a plan prompt's title reads the plan's first words.
8. **No message of a person's is drawn differently.** The differential of Design 4: for seeded messages that are no form, the row equals the row at the pin, byte for byte.
9. **Edit takes the stored row.** Design 5's test, with its control. A message id the store does not hold opens no edit.
10. **A form edited and sent again keeps its content framed.** A promotion edited in its typed words: the exchange is sent as one segment; edited inside the exchange: the whole text is one segment; the control: an ordinary message edited is sent with no segment.
11. **The own-text rule's two directions**, Design 6's test.
12. **The two waiting forms are built for each treatment**: for each of the three values of `ECHO_OUTPUT` and of `READ_CONTENT`, the writer's output and its readers' reading, and acceptance 5 for it. The shipped values are the architect's ruling on the third probe.
13. **The guard is whole.** Every site and form is classified; each `maws` form names its slot's treatment; the draft forms are eight.
14. **The measurements are on the branch.** `node --test spikes/protocol-probe/fixtures.test.mjs` passes with both probes' cases.
15. **The scenes are written** (S1 to S3, §F) and typecheck.

## Constraints that bind every milestone

- The wave's build brief binds: no typecheck, lint, test, install, build or Electron on the authoring machine; every check on the build VM in a checkout of the pushed head, through the wave's `vmcheck.sh` helper; a merge of master, never a rebase or a force-push, never a push to master; commits end with the trailer the brief gives and carry no other attribution. If a command fails for lack of disk space, stop, report, delete nothing.
- The engine is the pinned 2.1.322 and is not patched (charter D-1). A statement about what it does rests on a recording under `spikes/protocol-probe/fixtures/` or is marked here as read from source. An executor who needs an engine fact neither holds stops and reports it.
- **`wrapPasted`'s bytes do not change**, and nothing is sent in a field of the user frame.
- **A person's words are never rewritten.** `leaveOutGrant` is called on a slot a model, a command or a page wrote, and nowhere else.
- **Fail closed.** Where this document does not say, the answer is left out, a read, no grant; and the executor records the case.
- **Rules from this wave's reviews.** An assertion that something is absent, over input the test built, has a control in the same test. A scene says what it waits on. A count that was measured is named as measured, with its row. An assertion that an approval is or is not drawn goes through the host's reader, not a hand-built row.
- **Nothing is stored, no owner card, no change to the editor's document, no wire minor.** An executor who finds that a step needs one stops and reports; it does not widen the landing.
- **Other owners' files (UC-8), each by the smallest insertion:** U5's `src/shared/anchor/message.ts`, `content.ts` and `src/renderer/src/side/actions.ts`; U4's `composer/resubmit-seam.ts`, `composer/queue/entry-text.ts`, `composer/editor/mention-text.ts`, `paste.ts`, `composer/mentions/` (two rows), and `stores/composer.ts` (one field of the edit); the transcript's `transcript/model/user-text.ts`, `rows.ts`, `schema.ts`; U6's `src/shared/files/named.ts` (two numbers, no rule); U3's `arrival.ts` (no edit; its test's pin); U8's `tools/agents/model/relay.ts` and `relay-store.ts`; U10's `artifacts/design-system/` (one name); U11's `widgets/` (two names); `markup/session.ts`, `src/services/sessions/service.ts` and `recent-turns.ts`, `src/services/index/sessions.ts` (no child; one call each); the engine host's `session-clear.ts`, `bash-mode.ts`, `fs/backfill.ts`; the P5 work's `e2e/cross-build.spec.ts` (one row and its scene). An edit beyond these stops and reports.
- **The desk's web app** draws rows by the same code; nothing under `apps/` is edited; its typecheck, build and test project are part of every milestone's proof.
- Root law 7: no colour or geometry is added. The words a person reads are §E's, exact. A guard reads renderer source for `#` followed by hex digits as a colour: a ticket is written in words ("ticket 733").
- Root UC-11: test content is invented; nothing of a real session or file is read or copied.

## Plan of Work

Four milestones, in order; each is reviewed before the next starts.

### M1 — The shared rules, and the measurements on the branch

**Exists at its end:** the probe branch merged; `quotesGrant` wider, with its differential and the three refitted pins; `nameSlot`; the tag's fold; `leaveOutGrant`, `composedContent`, `composedAs` and `takeSegment`, each with its table. The app's behaviour changes in one way: the ask tool refuses the three shapes.

**Touches:** `src/shared/engine/grant.ts`; new `src/shared/engine/composed-content.ts`; `src/shared/composer/pasted-framing.ts`; `src/shared/files/named.ts` (the two numbers); the tests beside each and of `arrival.ts` and the ask tool's guard; `composer/editor/mention-text.ts` (it imports the one constant); the merge.

**Interfaces:** exposes §A, §B, §C.

**Decisions:** the merge of `origin/ux-wave/733-paste-probe` is the first commit and a merge commit of its own; `spikes/protocol-probe/fixtures.test.mjs` is edited on both sides and both sides' cases are kept. `quotesGrant` keeps its old answers by construction (the old pass, or the new reading). The differential's oracle and the meter's old numbers are copies in the test file. The pins are refitted from the count the test prints.

**Does not touch:** any writer of a form; any reader of a row.

**Proves:** acceptance 1, 2, 3, 14.

### M2 — The content forms: written, read in place, edited and sent again

**Exists at its end:** a promotion, a plan prompt and a quoted line are written with their content left out by line and framed, and are drawn as today everywhere Design 4 lists; Edit takes the stored row; an edited form is sent again framed; the own-text rule's two directions are pinned. Writer and reader land together: no head of this milestone shows a form as a chip.

**Touches:** `src/shared/anchor/message.ts` (`promotionMessage`, `quotedComment`, the anchored recogniser's in-place reading), `src/shared/engine/host-prompts.ts` (`planPrompt` and its reader); their callers `src/renderer/src/side/actions.ts`, `src/services/sessions/service.ts`, `src/engine-host/session-clear.ts`; `transcript/model/user-text.ts`, `rows.ts`, `schema.ts`; `composer/queue/entry-text.ts`; `src/services/sessions/recent-turns.ts`; `src/services/index/sessions.ts`; `composer/resubmit-seam.ts`, `stores/composer.ts`; the tests of `named`; `test/support/person-sends.test.ts` (the three forms' cases).

**Interfaces:** consumes §A to §C; exposes §D.

**Decisions:** in one commit series per form, the writer and its reader together. The equality "read in place, it is the pin's text" is held against the pin's writer copied into the test. The tag id by Design 3's rule. The row's `composed` ranges are recorded where the text is built, as chips' places are. `startInlineEdit` resolves the stored row itself, so every caller is covered by one place. The guard's `Form` gains its slot's treatment here (`content`, `name` or `none`), declared for every form; the three content forms' cases move with their writers (their consent case reads the marker where the sentence stood, and where the content stands), and the other forms keep their cases until M3.

**Does not touch:** `splitPastedSegments`; the name forms and their cases in the guard; the editor.

**Proves:** acceptance 4, 7, 8, 9, 10, 11, and 5 for these three forms.

### M3 — The name forms, the two waiting forms' places, the guard

**Exists at its end:** every name of Design 3 goes through `nameSlot`; the relay and the path refuse what they must; the echo and the attached read are built for their three treatments behind one constant each; the guard holds every form to its slot's treatment. Part of this milestone waits: the two constants' shipped values.

**Touches:** `src/shared/anchor/message.ts`, `content.ts` (the anchor's fields); `tools/agents/model/relay.ts`, `relay-store.ts`; `src/shared/maws/linked-read.ts`; `src/shared/engine/host-prompts.ts`, `src/engine-host/bash-mode.ts`, `fs/backfill.ts`; `composer/editor/mention-text.ts`, `paste.ts`, `composer/mentions/AtMenu.tsx`, `SlashPalette.tsx`; `widgets/AgentsWidget.tsx`, `SkillsWidget.tsx`; `artifacts/design-system/copy.ts`; `markup/session.ts`; `test/support/person-sends.test.ts`.

**Interfaces:** consumes §A to §C.

**Decisions:** three commit series: the anchored and relayed names; the names in a draft and the path refusal; the two waiting forms. The guard's name forms move to their treatment's case (no line break and no opening in the slot), and `DRAFT_FORMS` grows to eight. The relay's receipt and the peer's send are matched on the text as sent. Each waiting form's test runs once per treatment; the constant ships at the value the ruling names, in a commit that names the third probe's recording and its count.

**Does not touch:** the answer envelope and its strict reader; `consentMessage`; `/compact`, `/clear`; any constant of `COMPOSED_FORMS`.

**Proves:** acceptance 6, 12, 13, and 5 for the remaining forms.

### M4 — The scenes, the cross-build row, the whole suite, the acceptance

**Exists at its end:** the scenes of §F written and typechecked; one row in the cross-build coverage table with its scene; the tracker's rows; the whole unit suite run once; the acceptance executed as written.

**Touches:** the e2e specs §F names and their harness support; `e2e/cross-build.spec.ts`; the tech-debt tracker.

**Decisions:** the tracker rows: the rule's route to the model and a foreign tag id, to check at every engine pin bump; a rewind's prefill of a composed row (with a line on ticket 740); the search snippet; an opening assembled across a slot's edge; the letters the tag's fold does not cover; a relay's own text.

**Does not touch:** source outside the harness.

**Proves:** acceptance 15, and 1 to 14 again on the final head.

## Concrete Steps

Working directory: the branch's worktree (branch `ux-wave/733-paste-consent`). Checks run on the build VM in a checkout of the pushed head, so commit and push first; `vmcheck.sh` exits with the command's status and is never piped into `head` or `tail`; the first call for a branch installs dependencies (allow 20 minutes); a remote command starts with `set +e;` when every part's result is wanted. Each command below is the helper's argument: `vmcheck.sh ux-wave/733-paste-consent -- '<command>'`.

    git fetch origin master && git merge origin/master

Then the pass over "Statements to check again". After any merge of master, the milestone's own set runs again.

M1 opens with the measurements, as a merge commit of its own:

    git fetch origin ux-wave/733-paste-probe && git merge origin/ux-wave/733-paste-probe

    timeout 900 node --test spikes/protocol-probe/fixtures.test.mjs && timeout 600 node --test .github/scripts/maws-app-scan.test.mjs

Expect both to exit 0. M1, after each push:

    timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null && timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null
    timeout 600 pnpm exec eslint src/shared/engine src/shared/composer src/shared/files src/renderer/src/composer/editor
    timeout 1800 pnpm exec vitest run src/shared/engine src/shared/composer src/shared/files src/shared/maws src/engine-host/tool-server src/renderer/src/composer/editor test/support/person-sends.test.ts

Expect each case of the three shapes to fail before `quotesGrant` changes (`expected false to be true`) and pass after, and the differential to report nothing.

At every milestone, the desk's web app:

    timeout 900 pnpm --filter desk-web typecheck && timeout 900 pnpm --filter desk-web build && timeout 900 pnpm --filter desk-web test

M2:

    timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null && timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/shared/anchor src/shared/engine src/engine-host/session-clear.ts src/services/sessions src/services/index src/renderer/src/side src/renderer/src/transcript src/renderer/src/composer
    timeout 2400 pnpm exec vitest run src/shared/anchor src/shared/engine src/shared/files src/engine-host src/services/sessions src/services/index src/renderer/src/side src/renderer/src/transcript src/renderer/src/composer test/support/tokens-guard.test.ts

Expect the form's row tests to fail on a placeholder before the reader lands and pass after, and the differential of acceptance 8 to report nothing.

M3:

    timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null && timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/shared/anchor src/shared/engine src/shared/maws src/engine-host src/renderer/src/tools/agents src/renderer/src/composer src/renderer/src/widgets src/renderer/src/markup src/renderer/src/artifacts/design-system
    timeout 2400 pnpm exec vitest run src/shared/anchor src/shared/engine src/shared/maws src/shared/files src/engine-host src/renderer/src/tools/agents src/renderer/src/composer src/renderer/src/widgets src/renderer/src/markup src/renderer/src/artifacts src/renderer/src/transcript test/support/person-sends.test.ts

M4, the builder of the last milestone, once:

    timeout 1500 pnpm typecheck
    timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs
    timeout 3000 pnpm test

Expect the typecheck and the script tests to exit 0 and the unit suite to fail only in the files the build brief lists as failing on master or under load, each shown passing alone. Then the executor stops and hands back: the head's sha, the commands run with their results, the acceptance items by number with the test that holds each, the decisions made, and anything that contradicts this document. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. The pull request's body is the short form: the proof, what differs from this plan, what is left over.

## Interfaces and Dependencies

No library is added. Signatures are what must exist; bodies are the executor's.

### §A. The test and the name (M1)

    // src/shared/engine/grant.ts (still imports nothing)
    export const LINE_OR_CONTROL: RegExp;            // [\p{Cc}  ], the one copy; mention-text.ts imports it
    export const NAME_LEFT_OUT = '(a name left out by MAWS)';
    export function nameSlot(name: string): string;
    export function quotesGrant(text: string, work?: { steps: number }): boolean;

`quotesGrant`: (1) every text it answers true at the pin, it answers true; (2) it answers true for every text in which `neutraliseGrant`'s reading (its fold of each character in both case images, its rule for angle brackets) holds `GRANT_OPENING`; (3) it is linear in the text and charges `work` what it does.

### §B. Content (M1)

    // src/shared/engine/composed-content.ts (imports grant.ts and composer/pasted-framing.ts; nothing that imports a form)
    export const LINE_LEFT_OUT = '(a line left out by MAWS)';
    export const LINES_LEFT_OUT = '(lines left out by MAWS)';
    export const LEAVE_OUT_ROUNDS = 8;
    export function leaveOutGrant(content: string): string;                       // Design 2; its test of a line is quotesGrant, named once
    export function composedContent(content: string, tagId: string): string;      // wrapPasted(tagId, leaveOutGrant(content))
    export type Treatment = 'joiner' | 'segment' | 'leftOut';
    export function composedAs(content: string, tagId: string, treatment: Treatment): string;

### §C. A form's segment, read back (M1)

    // src/shared/engine/composed-content.ts
    export type Range = readonly [from: number, to: number];                      // half-open, in order
    export function takeSegment(text: string, at: number): { body: string; end: number } | null;
    export function segmentsInPlace(text: string): { text: string; composed: Range[] };

`takeSegment` reads exactly what `wrapPasted` writes, starting at `at`: the two line breaks, the opening tag with a four-hex id, a line break, the body up to the first closing tag of the same id at a line's start, and the one line break after it. `segmentsInPlace` puts every such segment's body, its neutralised tags restored, where the segment stood, and records each body's range. It is called only on a text one of Design 4's two recognisers accepted.

### §D. The forms (M2, M3)

    promotionMessage(exchanges, text, tagId: string): string
    planPrompt(plan: string, tagId: string): string
    readPlanPrompt(text: string): { text: string; composed: Range[] } | null     // the exact shape, else null
    quotedComment(anchor, quote, text, tagId: string): string
    relayText(target, text): string | null                                         // null: a peer's address quotes the opening
    linkedReadBlock(read: string): string
    bashEcho(command: string, output: string, tagId: string): string
    composedPrefill(text: string, bodies: readonly string[]): Prefill              // Design 5: each body that still stands, a pasted chip; else the whole text one chip

- The transcript's user row gains `composed: Range[]` beside `placeholders`; `transcript/model/schema.ts` gains it too.
- The inline edit's state gains `composed: string[]`, the bodies of the stored row's ranges when the edit began.
- `startInlineEdit(appSessionId, messageUuid, kind)` reads the row from the store.
- `ECHO_OUTPUT: Treatment` in `host-prompts.ts`; `READ_CONTENT: Treatment` in `linked-read.ts`.

### §E. Words (exact)

| where | words |
|---|---|
| a line of content that quotes the opening | `(a line left out by MAWS)` |
| a run of lines across which the opening stands, or content left out whole | `(lines left out by MAWS)` |
| a name that quotes the opening | `(a name left out by MAWS)` |
| a file dropped, picked or chosen whose path quotes the opening | `<name> can't be attached; its path reads as a permission grant` |
| a relay to a peer whose address quotes the opening | `Can't relay to this session: its address reads as a permission grant` |

No other word a person reads is added or changed.

### §F. The scenes (M4)

| scene | spec | what it shows | what it waits on |
|---|---|---|---|
| S1 | the side thread's spec (`e2e/side.spec.ts`, or the spec that holds the promotion's scene at the merged head) | a side question promoted: the thread's first row reads the exchange as text, no chip; the message the host wrote holds the exchange in one segment | the thread's first row by its attribute; the harness's record of the sent content |
| S2 | `e2e/code-tools.spec.ts` (Review; or the spec that holds a pass comment's scene at the merged head) | a comment on a diff line: its bubble shows the quoted line as today; the sent content holds it in a segment | the bubble by its attribute; the sent content |
| S3 | `e2e/cross-build.spec.ts`, for `f1852de3a` and for `2c7044231` | the peer draws this build's promotion with its exchange as a chip that opens, never raw tags, and recognises the row as a side question | the peer's row, by the states the group's other scenes wait on |

## Proofs an executor cannot run

Each is a step for the architect, with what it needs.

1. **S1 and S2, each alone on a Mac**, on the head M4 hands back, then the landing's Mac run set under the load rule: the default group, the comment card's and Review's, the transcript's, the agents tool's (the relay), the composer's (Edit on a bubble), the remote group, the desk's web app's.
2. **S3, the cross-build group**, with `--peer-exact f1852de3a` and again with `--peer-exact 2c7044231`, on the final head. A skipped scene is not evidence.
3. **The third probe's counts**, for the two waiting forms; then the ruling, and this document's two rows.
4. **The comment on ticket 711** (Design 1 gives its text), and **one line on ticket 740** (a rewind's prefill of a composed row goes as typed).
5. **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label 733a`), the branch's review, and the pull request.
6. The paid live group is not owed: no scene of it changes and nothing it proves moves.

## Size and review

Estimates, counted against the code at the pin.

| milestone | source | tests | scenes | files |
|---|---|---|---|---|
| M1 | about 260 lines (one new file of about 150; four edited) | about 650 (one new file; five edited) | — | 11, and the probe merge's files under `spikes/` |
| M2 | about 330 lines in thirteen files | about 750 in nine files | — | 22 |
| M3 | about 260 lines in seventeen files | about 600 in nine files | — | 26 |
| M4 | about 30 lines in the harness; six tracker rows | about 100 | about 250 lines in three specs | 6 |

About 880 lines of source, 2,100 of tests and 250 of scenes, in some fifty files (several edited in two milestones), beside the recordings. The first document's whole was about 1,860, 3,500 and 550 in eighty-five.

**The branch's review is the xhigh panel.** It is past twenty files and two thousand lines, and it decides what the engine may take as a person's approval: it rewrites what MAWS sends in the person's name, widens the test ticket 711's guard stands on, and moves two work meters. Its lenses: the approval's evidence (every form, every slot, through the host's reader, each with its control; the pressed consent untouched); the rewrite (that `leaveOutGrant` ends false for every input, touches no word of a person's, and is bounded); the forms against their recognisers, at this build and the two older ones; the drawing (no message of a person's changes); Edit (the stored row; an edited form's content). This document gets an adversarial review before an executor starts.

## Surprises & Discoveries

- Observation: the engine frames a declared paste itself, and its two flags do nothing.
  Evidence: the second probe, cases `il21`, `pc21` and rows `kpc`, `kil`, `kcc`, `ktnt` (0 of 5, 0 of 5, 4 of 5, 4 of 5).
- Observation: MAWS's own frame let the approval sentence through once.
  Evidence: the second probe, `kwrap-5`: the model declined, and after a neutral follow-up retried the exact command, which the classifier allowed; with P3's 0 of 5, 1 of 10.
- Observation: no classifier row of either probe was recorded on a larger model.
  Evidence: the second probe's method ("model claude-haiku-5-5 … in all 54 sessions"); U1c's writer probe, the same model.
- Observation: `quotesGrant` cannot be applied line by line and end false: it reads across line breaks.
  Evidence: `src/shared/engine/grant.ts`: letters and digits only, every other character skipped, a line break among them.
- Observation: Edit edits the row it is handed, and a surface mod's row holds the mod's text.
  Evidence: `composer/resubmit-seam.ts` `editRowOf`; `transcript/surface/Rows.tsx`; the adversarial review of 2026-11-17, second finding.
- Observation: a thread's title never reaches its first message's segment.
  Evidence: `cutPrompt` keeps six words; the shortest lead that can carry a quoted line, `Comment on "x" (file p, line n):`, is six.

## Decision Log

- **2026-11-17 · Verification.** This document gets an adversarial review before an executor starts; the architect dispatches it. The branch gets the xhigh panel of `doperpowers:review-code`. Class 1a on GitHub Actions is the gate of record. The pull request's body names its class 1a run, its review verdict and its residue. This landing reverses no ruling of the root; it posts one comment on ticket 711 and one line on ticket 740.
  Date/Author: 2026-11-17, the document's author.
- **2026-11-17 · The split and the rulings.** Recorded under "Ruled": the first document is superseded for the composed forms and awaits its revision as 733b.
  Date/Author: 2026-11-17, the architect; recorded by the document's author.

## Outcomes & Retrospective

Pending — written at finish.
