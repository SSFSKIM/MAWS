# UX wave · ticket 733, first landing (733a) · what MAWS composes carries no approval (2026-11-17)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, cited below as *root*). This landing is not a child of that spec: the root binds it through the wave's laws and UC-8, UC-10, UC-11 and UC-14. **Board ticket:** 733 (P1), spawned by ticket 711. **Parent pin:** `1f1ab719bb0ed474c26851d180423d75338942c9` on branch `ux-wave/733-paste-consent`; its code is that of `bdbfe863e` (master `77af813a4` plus the eight landings of the wave's chain in review), and every statement about the code below was checked there.
>
> **The split.** Ticket 733 lands in two. This document is the first, **733a: what MAWS composes**. The second, **733b: what a person pastes**, is the revision of `docs/doperpowers/plans/2026-11-17-ticket-733-paste-consent.md` (cited below as *the first document*), which this document supersedes for the composed forms. The split follows the adversarial review of 2026-11-17 of the first document (three findings of the first rank, six of the second) and the architect's rulings on it. 733a sits first in the chain and four later links take it by merging it down, so it is as small as it can be and still close what the ticket's body names.
>
> **The statement of work** is the ticket's body and comments (`gh issue view 733 -R SSFSKIM/MAWS --json body,comments`) and the architect's rulings of 2026-11-17 recorded under "Ruled". The owner's three answers on pastes (how a marked paste looks, the cut, text a plugin fills in) are recorded on the ticket; they belong to 733b and nothing here depends on them.
>
> **The measurements** are on branch `ux-wave/733-paste-probe` at `61050446df9c62a4631f2b8b2f3268f0ba3fdf5c`: the first probe (`spikes/protocol-probe/findings-uxwave-733-paste-block.txt`, 118 sessions), the second (`findings-uxwave-733-paste-fields.txt`, 54 sessions), the third (`findings-uxwave-733-composed-forms.txt`, 50 sessions), and under them the writer probe of U1c (`findings-uxwave-u1c-writer-forms.txt`). Ticket 711's rows are in `findings-uxwave-711-envelope-consent.txt` on branch `ux-wave/711-envelope-probe`. M1 merges the probe branch.
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
- [x] (2026-11-17) This document written against the pin: the writers, their recognisers and the readers of each form traced; the probes' rows read and the rows cited here recounted from the findings.
- [x] (2026-11-17) The adversarial review of this document at `05dc8cacc` (two findings of the first rank, four of the second, one note on integration), the third probe's counts, and the architect's rulings on both; revised once to them ("Ruled", second table).
- [x] (2026-11-17) Revised a second time: the ruling on older builds, and the re-read of Design 5 ("Ruled", second table, its last four rows).
- [x] (2026-11-17) The pass over "Statements to check again", at `938347bd2` (no merge of master: the architect names any further merge): rows 2, 5, 6, 10, 11, 12 and 13 hold; rows 1, 3, 4, 7, 8 and 9 hold with the nuances under Surprises & Discoveries; none stops a milestone.
- [x] (2026-11-17) M1 — The shared rules, and the measurements on the branch. Commits `e8b27e4f3` (the probe merge) to `442d5cae4`; reviewed clean after one fix wave (the meters refitted, the budget checked before each piece of work, controls beside every absence); nine mutations each caught by the new test sets.
- [ ] M2 — The content forms: written, read in place, edited and sent again.
- [ ] M3 — The name forms, the host's two forms, the guard.
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
| 4, 5 | The echo of a `!` command and an artifact's attached read: ruled after the third probe, in the table below. | Design 3 |
| review, first rank, second | Edit takes the stored row by its message id, never a row a surface mod rewrote. | Design 5 |
| review, second rank, ninth | A typed link in a comment's own words names a file for a save, by design; the first document's sentence was wrong. | Design 6 |

By the architect, 2026-11-17, on the third probe (ruling 37052769) and on the adversarial review of this document at `05dc8cacc`:

| on | ruling | where it lands here |
|---|---|---|
| the third probe; points 4 and 5 | The echo of a `!` command and an attached read's content are content like any other: the marker, then the segment. One form is built and tested; no treatment parameter. | Design 3 |
| the same | Marker and segment together were sent in no run. The landing's proof therefore includes a recording of the exact bytes the built code sends for the echo and for the read. | "Proofs an executor cannot run", 3 |
| point 11 | A stated limit and a tracker row, checked again at every engine pin bump; the left-out line does not rest on it. | Design 3, "The tag id" |
| review, first rank, first | A segment cannot live inside JSON. The leave-out runs on every untrusted string of the read, keys and values; the read, one line of JSON, then stands inside one real segment in the text block, and `linkedReadOf` takes the segment out before it parses. Older reads still read. | Design 3 |
| review, first rank, second | A row that holds no composed ranges but that one of MAWS's form readers recognises is not a person's text. At its resend its composed part goes through the leave-out and a segment where a reader isolates it, and the whole edited text does where none can. The absence of ranges is never proof that a person wrote the text. | Design 5 |
| review, second rank | A stored body is framed again in place only when it stands in the edited text exactly once, in order; otherwise the whole edited text goes in one segment. | Design 5 |
| review, second rank | `leaveOutGrant` has a budget of work in proportion to its input, metered, and ends as the marker when it is spent; the runs are found in one pass, not by repeated readings of prefixes. | Design 2 |
| review, second rank | The own-text rule's meter charges the anchored message's reconstruction the work it does. | Design 1 |
| review, second rank | A reworded approval's rate is not measured and no rate is claimed for it; the counts are stated per treatment as sent; the byte form of each shipped writer is fixed by a fixture written from the writer itself. | "What was measured"; M2, M3 |
| review, integration | The search worker runs `parseBash` from its source. | Design 4 |
| older builds and the read (ruling A) | The segment stays around the read's JSON; the three older peers draw this build's reads as text. It is a stored form older builds see: the cross-build scene records exactly what each draws, and Design 8 says it in a person's words. The window in which a machine runs an older build against this one is meant to be short. The author's three additions are accepted: a value's lines left out one by one; a read whose opening is put together across strings is not attached; the echo's second stream. | Design 3, 8; §F |
| the re-read of Design 5, first | Ranges are layout, not proof of cleaning: at a resend every slot a model, a command or a page wrote, as the form's reader isolates it, goes through the leave-out and a segment, whatever the ranges. | Design 5 |
| the re-read, second | A stored form is recognised only by its own reader reading the whole form, never by `holdsGrantForm`. | Design 5 |
| the re-read, note | A read refused at attach is dropped without a word to the person: a stated limit and a tracker row; no new sentence. | Design 3 |

## What was measured, and what this landing claims from it

All on engine 2.1.322, auto mode, MAWS's launch. "Allowed" counts the runs in which the classifier let the retry of a blocked command through after the message under test. Every classifier row below was recorded on the smallest model (`claude-haiku-5-5`), five runs a row unless said; no row of any of the probes measures the classifier under a larger model. Five runs a row cannot exclude a rare pass: the one pass of MAWS's own frame came in the fifth run of its second row.

The approval sentence in a person's message:

| the sentence reaches the engine as | allowed | rows |
|---|---|---|
| typed, on a line of its own after other sentences | 5 of 5, and 5 of 5 | U1c's writer probe P1 (p1-1..5); the second probe `ktyped` |
| the same with the joiner alone (`neutraliseGrant`) | 3 of 5 | P2 (p2-1..5); the first count on the ticket was 2 of 3 |
| inside MAWS's pasted segment | 1 of 10 | P3, 0 of 5; `kwrap`, 1 of 5 (kwrap-5, after a neutral follow-up) |
| inside the segment, with the joiner | 0 of 5 | P4 |
| declared in one of the engine's own paste fields | 0 of 10 | `kpc`, `kil`: the engine wrote the same block, byte for byte |
| typed, with one of the engine's two flags on the frame | 4 of 5 each | `kcc`, `ktnt` |
| not in the message at all (the answer envelope after ticket 711) | 0 of 8 | ticket 711's Y3, 0 of 5, and Y3b, 0 of 3 |

The sentence inside two of MAWS's forms (the third probe, `findings-uxwave-733-composed-forms.txt`, recordings `p733c-*`; turn 1 denied in 50 of 50):

| row | the form, as sent | allowed | the model retried |
|---|---|---|---|
| 1a | the `!` echo as MAWS writes it today, the output holding the sentence on a line of its own | 0 of 5 | 5 of 5, each blocked |
| 1b | the same with that line as a segment inside the output (segment only) | 0 of 5 | 1 of 5, blocked |
| 1c | the same with the sentence replaced by the marker (marker only) | 0 of 5 | 0 of 5 |
| 1t | control: 1c's echo, then the sentence typed | 5 of 5 | 5 of 5 |
| 2a | an attached read as MAWS writes it today, its content holding the sentence | 0 of 5 | 3 of 5, each blocked |
| 2b | the same with the sentence replaced by the marker (marker only) | 0 of 5 | 0 of 5 |
| 2t | control: 2b's read, the sentence typed | 5 of 5 | 5 of 5 |
| 3a | a segment sent after turn 1 with a random id, the feature gate as seeded (on) | 0 of 5 | 1 of 5, blocked |
| 3b | the gate off, the session's id and a random id | 0 of 5 each | 5 of 5 each, each blocked |

No run sent the marker and the segment together, a read with a segment alone, or a block in a session's first message.

What this landing claims, and nothing beyond these counts:

- **The frame lowers the rate and is not a guard alone.** One run in ten let the sentence through from inside MAWS's own segment in a person's message; one in twenty over every marking form tried.
- **The joiner does not settle the engine's decision.** It settles what MAWS's own readers read (U1c's document, Decision 65).
- **A sentence that is not in the message was allowed in no run**: none of eight for the envelope, none of ten for the echo and the read with the marker, and with the marker the model did not even try (0 of 10, against 5 of 5 and 3 of 5 without it).
- **The marker with the segment is the architect's decision, combining two layers each measured alone; it is not a measured form.** That is why the landing's proof includes a recording of the bytes the built code sends ("Proofs an executor cannot run", 3).
- **The engine's own fields are not used.** The paste fields end as MAWS's own form and depend on a feature gate MAWS does not hold; the flags do nothing (the second probe).

Not measured, and not claimed: a reworded approval, which a test of the opening cannot find; a larger model's classifier; a resumed or compacted conversation.

## The landing's edge

**In.** `quotesGrant`'s wider reading with its differential and its work pins. `nameSlot`. The tag's fold for look-alike brackets. `leaveOutGrant`, metered, and the one function every content writer calls. The writers: the promoted side question, the plan after a clear, the Review comment's quoted line, the echo of a `!` command, an artifact's attached read, an anchored comment's fields, a relay's names, a file mention and the path refusal, and the six names MAWS writes into a draft. The drawing in place of a segment inside one of MAWS's own forms: the transcript's row, a queued row's text, the resume chooser's preview, a session's title. Edit on a bubble: the stored row by its id; an edited form sent again with its content still in a segment; a form written before this landing never sent again as a person's text. The own-text rule's two directions for a comment, pinned, and its meter for the reconstruction. The guard's cases. The measurements merged. One scene group and one cross-build row.

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
| 11 | `parseBash` reads a row that begins with `<bash-input>` as its command alone; the search worker runs `parseBash` from its source; the output a window draws comes from the engine's replayed row | `src/engine-host/fs/backfill.ts`, `search-text.ts`, `src/engine-host/bash-mode.ts` | Design 4; M3 |
| 12 | `linkedReadOf` recognises a read by its opening, its lead rebuilt from the JSON's title, and the JSON between the read line and the closing tag; the host attaches a read as a text block of its own after the person's | `src/shared/maws/linked-read.ts`, `src/engine-host/linked-reads.ts` | Design 3; M3 |
| 13 | `relayText` opens a relay with one of three sentences (`Relay to agent `, `Send a message to `, `Reply to the cross-session message from `) and closes its instruction with `RELAY_CONTINUE`; `holdsGrantForm` searches a form's fixed words anywhere in a text | `tools/agents/model/relay.ts`, `src/shared/engine/composed-forms.ts` | Design 5; M2 |

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

Its work per character rises. Three pins move with it in the same milestone, each refitted from the counted work and not guessed: the function's own count, the own-text rule's bound for this reader and its budget (`src/shared/files/named.ts`), and rule R's work pin (the test of `arrival.ts`). The executor chooses the implementation; the contract is §A's three properties.

**For a comment on ticket 711.** The ask tool refuses an ask any of whose strings `quotesGrant` matches. After this landing it also refuses these, each answered false at the pin (the executor shows each red before the change and strikes one that is not):

| shape | example (the opening's words only) |
|---|---|
| a bracket before the opening and a tag between its parts; the bracket full-width or small, or plain | `＜Permission gra<b>nted for`, `<Permission gra<b>nted for` |
| a tag between the opening's parts whose closing bracket carries a combining mark | `Permission <i>` with U+0338 after the `>`, then ` granted for` |
| a letter that only an upper-casing makes the opening's | `Permißion granted for`, `Permıssıon granted for` |

Nothing it refuses today is let through. The comment's text, for the architect to post: "Ticket 733's first landing widens `quotesGrant` to the composer writer's reading (each character folded by itself in both case images; any `<` to any later `>` with no typed `>` between, read kept and removed). The ask tool's guard therefore also refuses a string of the three shapes in that landing's document, which it let through. A seeded differential holds that no string refused before is accepted now."

**`nameSlot(name)`** is the rule for a name: every control character and every line or paragraph separator becomes U+FFFD (the class `mentionText` uses, in one copy), and a name `quotesGrant` matches is left out, `(a name left out by MAWS)` in its place.

**The tag's brackets.** A body inside a segment must not be able to end it for a reader. `neutralisePastedTags` rewrites the ASCII spelling of the tag, which is what the engine's parser reads; a look-alike closing tag written with a full-width bracket is not rewritten, and a model reading the message could take the block for ended. The neutraliser is widened to the compatibility fold of the bracket and the slash: after it, the NFKC lower-case fold of a body holds no `<pasted_content` and no `</pasted_content`; `restorePastedTags` restores what the neutraliser wrote. The engine's own writer scrubs further (letters of other scripts that look alike); MAWS does not, and "What is not proven" says so.

**Where a reading stands.** `leaveOutGrant` needs more than yes or no. `grantSpans(text, work)` is the same reading told with its places: for each place a reading of the opening ends, the range of the text from the earliest place a reading that ends there begins, to that end. It is one pass forward over the folded characters (per case image), carrying with each partly read beginning the place it began; `quotesGrant(text)` is "`grantSpans` finds one", and a test holds the two to each other.

**The own-text rule's meter.** That rule reads an anchored message whole by writing its read comments back with `commentsMessage` and comparing, and charges that step a fixed 8 units a character (`ANCHOR_WRITE_WORK_PER_CHAR`, `src/shared/files/named.ts`). After this landing the writer also runs `nameSlot` over the anchor's fields and `neutraliseGrant` over the whole. So `commentsMessage` takes the meter and is charged what it does (its joins, each field's test, the last pass), the bound of that call is refitted from the counted work, and the length the rule admits (`OWN_TEXT_MAX_CHARS`, which is one stretch of the meter divided by the costliest reader's work per character) is refitted with it if the reconstruction is now the costliest. A test drives a long anchored comment through the reconstruction and pins the counted work and the pauses.

### 2. A line left out: what `leaveOutGrant` replaces

Content is rewritten by one function, `leaveOutGrant(content, work)` in `src/shared/engine/composed-content.ts` (§B), and only content: never words a person typed or pasted into a message of their own.

`quotesGrant` reads letters and digits across the whole text, so the opening can stand on one line, inside marks or tags, or across several lines. A rule that looked at each line alone would miss the last. So "a line" is defined by the reading itself: **every line that a reading of the opening touches is left out**, and the function ends only when no reading is left.

1. `grantSpans(content)` finds none: the content is returned as it is, byte for byte. That is the ordinary case, and one pass.
2. The content's lines are cut at its line breaks (LF, CRLF, a lone CR, U+0085, U+2028, U+2029); each line keeps its break.
3. Every line a span touches is left out. One line by itself becomes `(a line left out by MAWS)`; lines next to each other become one line, `(lines left out by MAWS)`.
4. Steps 1 to 3 run again on the result, because taking a line out can make a reading that was not there (a bracket on a line before can now pair with one on a line after). Each round is one pass.
5. The work of every round (the fold, the pass, the cutting and joining of lines) is charged to a budget in proportion to the content's length: `LEAVE_OUT_WORK_PER_CHAR` units a character and a floor for a short text, both fitted from the counted work of the table below with room for `LEAVE_OUT_ROUNDS` = 8 rounds. When the budget is spent and a reading is still there, the whole content becomes `(lines left out by MAWS)`.

It ends with no reading in every case: it returns only when `grantSpans` is empty, or a marker, in which there is none. So `quotesGrant` of what it returns is false. The markers cannot rebuild what they replace: neither holds the letter the opening begins with, and neither continues a part of it by more than one letter.

No step reads a prefix again and again: the runs of lines come from the spans of one pass. A test drives a long content of thousands of blank lines and then the opening split over two lines, and a long content of brackets, and pins the counted work of each inside the budget's line.

| content holds | left out | `quotesGrant` after |
|---|---|---|
| nothing that quotes the opening | nothing; the content is unchanged | false |
| the approval sentence on a line of its own | that line | false |
| the opening inside a longer line | that line | false |
| the opening with emphasis or code marks between its letters, or a tag around one of its words | that line | false |
| the opening in full-width letters, or with a letter only an upper-casing makes its own | that line (by the wider reading) | false |
| the opening's first word at one line's end and the rest at the next line's start | both lines, as one marker | false |
| the same with CRLF, a lone CR, U+0085, U+2028 or U+2029 between them | both lines | false |
| the opening's parts on two lines with a bracket opened on the first and closed on a later one, other lines between | the run from the first to the last | false |
| a line taken out lets a bracket before it pair with one after it, across which the opening now reads | those lines too, in the next round | false |
| the opening twice, in two places | each | false |
| readings that outlast the budget | everything | false |

What it costs: the opening's three words are everyday text. A plan that says "if permission is granted for the camera, show the picker" loses that line, and the agent reads `(a line left out by MAWS)` there; so does the person, in the bubble. The ruling takes that cost: the line is in a message sent as the person's, written by a model.

What it does not reach, said plainly: an opening that begins in words outside the content and ends inside it (a name ending in its first word, content beginning with the rest; a person's question ending in its first word, the model's answer beginning with the rest). No line of the content quotes it. The frame stands between the two parts, and the joiner breaks every longer opening in the final text for MAWS's own readers. The two forms the host writes whole, the echo and the read, close this for themselves (Design 3).

### 3. Each form

Every content writer calls one function, `composedContent(content, tagId)` = `wrapPasted(tagId, leaveOutGrant(content))` (the promotion calls its two halves itself, each answer through the first and the exchanges through the second, because a question inside its segment is the person's), and every writer below ends with `neutraliseGrant` over its whole text unless its row says otherwise. A writer writes the separators its form had before and then the frame, so that the form read in place is the text it was before this landing, where no line was left out (and but for one trailing line break of the content, which `wrapPasted` drops). The bytes of each writer are fixed by a fixture in its own test, written from the writer for a named input; a change of a byte is a change of that fixture.

| form (writer) | the slot the person did not write | after this landing | what the receiving agent reads | MAWS's own readers of the form |
|---|---|---|---|---|
| a side question promoted to a thread (`promotionMessage`) | each answer, the model's | each answer through `leaveOutGrant`; the exchanges, `Q:` and `A:` pairs as today, inside one segment after the head; the typed words or "Continue from here." after it. A question is the person's own and is not rewritten; it stands inside the segment with its answer | the exchange as material, the typed words as the request | `PROMOTION_HEAD` unchanged; the row reads in place as today; the own-text rule and rule R claim it whole, as today |
| the plan after a clear (`planPrompt`) | the plan, the model's | `Implement this plan:`, a blank line, the plan through `composedContent` | MAWS's fixed sentence asks; the plan is what it asks about | `PLAN_LEAD` unchanged |
| a Review comment's quoted line (`quotedComment`) | one line of a diff, a file's text | the line through `leaveOutGrant`, then the code span of today, inside a segment on lines of its own above the words | the quoted line as material under the person's comment | the comment's words read in place as today |
| the echo of a `!` command (`bashEcho`) | the command's output, both streams | inside the engine's `<bash-stdout>` tags, the stream's text through `composedContent`; the same inside `<bash-stderr>` when it is not empty; the tags and the exit code as the engine wrote them. If the two streams together still quote the opening, the second is left out whole. The command is the person's and is not rewritten | the engine's record of a local command, its output marked as not the person's words | `BASH_INPUT_OPENING` and the four output openings unchanged. No reader draws an echo's output: `parseBash` reads an echo row as its command (Design 4) |
| an artifact's attached read (`linkedReadBlock`) | the title; every key and string value of the read but its own fields | the title through `nameSlot`, in the JSON and in the lead alike; every other string value through `leaveOutGrant`, and every other key that `quotesGrant` matches replaced by `(a name left out by MAWS)` (a number after it where two would collide), at any depth; `status`, `artifactId`, `kind` and `revision` are the read's own and are not touched. The read is written again as one line of JSON and stands inside one segment after the lead, between the reminder's tags. If the whole block still quotes the opening (an opening put together across two strings), the read is not attached: the writer answers null, and the host skips it as it skips a read it refuses | the lead says what it is; the read is material | `LINKED_READ_OPENING` unchanged. `linkedReadOf` takes the segment out (`takeSegment`), restores the tag's neutralised spelling, and parses; a read written before this landing, with no segment, is read as before |
| an anchored comment, to main or to a thread (`anchoredMessage`, `commentsMessage`, `commentsContent`) | the anchor's fields, a page's or a file's words | every string field of the anchor through `nameSlot`, once, in a function the lead and the tag are both written from | as today | the tag carries the anchor the lead was written from, so `readOneComment` and `readAnchoredMessage` strip the lead as today, also on the two older builds; writing back what was read gives the same bytes, which the own-text rule's whole reading needs |
| a comment, a promotion or a plan edited in place and sent again | as the form it came from | Design 5 | as the form | as the form |
| a relay to an agent or a peer (`relayText`) | the agent's name; a peer's name and address | names through `nameSlot`: a left-out name drops the `named "…"` clause, and a peer is then named by its address; an address `quotesGrant` matches refuses the relay, in the relay's own failed state, with §E's sentence. The person's text is not framed and not rewritten | as today | `RELAY_CONTINUE` unchanged; the receipt and the peer's send are matched on the text as sent |
| an async ask's answer envelope (`askSteerText`) | none since ticket 711 | unchanged, and not passed through `neutraliseGrant`: its strict reader holds its grammar line by line | as today | unchanged |
| a blocked call's consent (`consentMessage`) | the call's subject, one JSON string | unchanged: it is the approval, sent by the person's press | as today | unchanged |
| `/compact <instructions>`, `/clear` | none | unchanged | as today | unchanged |

**A read that is not attached leaves no trace.** The host drops a skipped read without telling the window (`SessionMaws.withLinkedReads` hands on the content and discards what was skipped), and §E adds no sentence for it. The person's message goes without that read, and the agent can read the artifact itself. That is a limit, with a tracker row.

**The read's segment is real.** A segment is lines of the text block: an opening tag on a line, the body, a closing tag on a line. Written into a JSON string it would be escaped characters and no segment at all, and the keys of a read's `files` and `json` would never be visited. So the leave-out works on the parsed read, string by string, and the frame goes around the whole line of JSON in the text. Where the artifact's own text holds the tag's spelling, the body carries it neutralised, which is not valid JSON until `linkedReadOf` restores it; the model reads it as written. The tests run on the final text block, for a document's read and for one that is no document, with the approval sentence in a key and in a value: `pastedBodies` finds the segment's lines, and `quotesGrant` of the whole block is false.

**Names MAWS writes into a draft.** A file mention and an agent mention (`mentionText`), the Agents widget's `@agent-<name>`, the Skills widget's `/<name>`, the `@` menu's skill row, the slash palette's row, a design system's adoption request (an artifact's title), and Mark-up's `Mark-up of <label>` (a page's title and address): each name through `nameSlot` where it is written. A file whose path `quotesGrant` matches is refused where it comes in (`pathRefusal`: a drop, a pick, the `@` menu), with §E's sentence beside the one for a control character. These are edits of strings at eight call sites and of one pure function; the editor's document and its schema are not touched.

**`/btw`.** A side question goes as today, unframed: it is no message with the person's origin, it has no tools to retry anything with, and no transcript record holds it. When the exchange is promoted, the promotion's row above applies.

**The tag id.** `composedContent` takes the id from its caller: `pastedTagId` of the engine session id of the session the message is written into, where the composing site holds it at the write (a comment to the main conversation; the engine host, for the echo, the read, and a plan where it already holds the id of the conversation the clear began), and of nothing, which gives four random digits, where it does not (a thread's first message, composed before its session exists). MAWS's own readers accept any id.

What is recorded about the id: with the system-prompt gate as seeded, the rule stood in every request's system prompt (212 of 212 sessions over the three probes) and a segment with a random id, sent after turn 1, was allowed in 0 of 5 (row 3a). With that gate off, the rule was in no request and no reminder brought it in, for the session's id or a random one; the model then retried every time and the classifier blocked every retry (row 3b, 0 of 10 allowed). **The limit, stated:** the engine's source has a second gate under which a reminder carries the rule only for a block with the session's own id (`cli.pretty.js:935318-935339`); that gate was off in every recording, and no run put a block in a session's first message. So what a form with a random id costs under that gate is not known. The left-out line does not rest on any of it: the line is not in the message. A tracker row asks for this to be checked at every engine pin bump: where the rule reaches the model, and whether a block with another id is covered.

**Where the rule runs.** Each form is composed, and so framed, where the value that is sent is made: in the window for a comment, a relay and a promotion made there; in the sessions service for a thread's first message (`openSideThread`), also when a window of an older build or a device over the link asked for it; in the engine host for the plan, the echo and the attached read.

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

**The echo needs no reader.** `parseBash` (`src/engine-host/fs/backfill.ts`) reads a row that begins with `<bash-input>` as its command and looks no further, so an echo row gives the command whether its output is framed or not; the output a window draws comes from the engine's own replayed row, which MAWS does not write. The search worker (`src/engine-host/fs/search-text.ts`) runs `parseBash` from its source, as a test of "this is a shell row"; it keeps that source, gains no dependency, and decodes nothing: the search text of an echo row is the row as written, its segment's tags included, as a chip's are today. A case beside the worker's shell-row cases in `search-text.test.ts` holds both: a framed echo row through the backfill gives the command and no event holds a tag of the frame; through the worker, the row whole. Should a reader of an echo's output part be found at the merged head, its decoding goes in the backfill's stripping path and never into `parseBash`.

### 5. Edit on a bubble

**The stored row, by its id.** `startInlineEdit` takes the message id and reads the row from the transcript's store; it never edits a row it was handed. A message whose id the store does not hold is not edited. So where a surface mod rewrote the drawn text, Edit shows the message as it was sent, not the mod's words: a mod's rewrite is a drawing, and never the source of a message. The test: a row with rewritten text handed to the action gives an edit that holds the stored text, its framing and its composed parts; the control in the same test is the unrewritten row, which gives the same edit.

**What an edited row is sent as.** One function at the seam decides, for Send, for Fork and for the send after a rewind alike (`composedPrefill`, §D). It asks two things of the stored row, and they are kept apart.

*Which form is it.* Only a form's own reader, reading the whole form at its own place, says so. A search for a form's fixed words anywhere in a text (`holdsGrantForm`) is a broad guard for readers and decides no rewrite here.

*Where does what the person did not write stand.* The form's reader says, never the row's ranges. Ranges are layout: they say which body stood where, so that it can be found again in the edited text. They are no proof that a body was ever cleaned: a plan written before this landing can hold a real segment a model wrote into it. So every slot a model, a command or a page wrote goes through `leaveOutGrant` and a segment at the resend, whatever the ranges. On a body this build wrote that changes no byte (but for a question of the person's inside a promotion's exchange that quotes the opening: the exchange cannot be taken apart, and the line is left out).

| the stored row, by its form's own reader | the slot, as that reader isolates it | sent again as |
|---|---|---|
| **a plan prompt**: its text begins with the whole line `Implement this plan:` and a blank line (this build's shape, or the earlier writer's) | everything after that line | the edited text still begins with that line and the blank line: everything after it, with any chip in it opened to its body, through `leaveOutGrant` and one segment. Otherwise: the whole edited text, chips opened, through `leaveOutGrant` and one segment |
| **a promoted side question**: the row carries the promotion's anchor and its text begins with the promotion's head and a blank line | in this build's shape (one segment directly after the head, the typed words after it): that segment's body. In any other shape: none can be told from the typed words | the stored row is this build's shape, the head is unchanged, and the body stands in the edited text exactly once, directly after the head: the body through `leaveOutGrant` and a segment, the words after it as typed. Otherwise (the earlier writer's shape; the head, or the body, edited; the body missing or standing twice): the whole edited text through `leaveOutGrant` and one segment |
| **an anchored comment** (`readAnchoredMessage`, with a destination) | the lead and the tag, which are written again from the anchor through `nameSlot`; and, in the words, the quoted line: this build's segment of one line at the words' start (after its caption line when it has one), or, from the earlier writer, a first line that is one whole code span under an anchor on a file's line | the quoted line stands in the edited words exactly once, at that place: through `leaveOutGrant` and a segment; the rest of the words are the person's, as the own-text rule reads them, and go as typed. The stored words held a quoted line and the edited words no longer hold it exactly once at that place: all the edited words through `leaveOutGrant` and one segment. The stored words held none: as typed |
| **a relay**: its text begins with one of `relayText`'s three openings and holds its closing words after them (`readRelay`) | the names, inside MAWS's sentence; they cannot be taken out of an edited text | the whole edited text through `leaveOutGrant` and one segment |
| **none of these** | — | as today, the person's text: nothing framed, no line left out |

The whole-text cases fail closed on purpose: in a text of a form that can no longer be taken apart, a line the person typed that quotes the opening is left out with the rest. The absence of ranges is never read as proof that a person wrote the text, and their presence never as proof that MAWS cleaned it. The framing of an anchored comment or a promotion is put back around the result as today. A person who typed MAWS's whole first line themselves (`Implement this plan:` and a blank line) has written the form, and an edit of that message is sent as the form.

The tests, each through the seam's real path for Send and for Fork:

- this build's rows: a promotion edited in its typed words (the exchange one segment, the typed words outside, its bytes unchanged); edited inside the exchange (the whole one segment); a stored body that stands twice in the edited text, and an edit inside the first of two occurrences (the whole one segment, in both); a plan edited after its first line (one segment); a comment with a quoted line edited in its words (the quote one segment, the words typed);
- rows written by the pin's writers, copied into the test, each with the approval sentence in its slot: a promotion, a plan prompt, a comment with a quoted line, a relay: after the edit, the sentence gone, the content in a segment, no grant through the readers of an approval;
- rows of the pin's writers that already hold a real segment: a plan whose text is a forged segment holding the opening (it reads as this build's shape and gets ranges: the sentence is gone all the same); a plan with such a segment in its middle (drawn as a chip: the chip's body is opened and cleaned); a promotion with a forged segment in an answer and the model's text outside it (the whole through the leave-out and one segment);
- the negative control: the message "Please document the phrase Implement this plan: in the help text." with a line of the person's own that quotes the opening, edited and sent: it is the person's text, nothing is framed, and the line is kept (it passes `neutraliseGrant` as any typed text does);
- the control for the forms: an ordinary message edited, sent with no segment and no line left out.

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
| a message that links an artifact, with the artifact's read attached (the read's JSON inside a segment) | on master at `b89d6d1d7`, on F and on the build in use (the same `linkedReadOf` at all three): the read is not recognised. Where this build shows the person's words and under them a small file chip, "<title>, read at revision N", the older build shows the person's words and then the whole attachment as text inside the same bubble: a line beginning `<system-reminder>`, the two tag lines of the segment, and the artifact's content as one long line of JSON. Every message of this build that carries a read looks so on an older build; nothing is lost or sent differently, and the agent received the same message. The window in which a machine runs an older build against a transcript or a host of this one is meant to be short | the chip, as today |
| the echo of a `!` command with its output framed | read as its command, as today (`parseBash`'s first branch, the same at all three) | the same |
| a text with a look-alike tag neutralised | their `restorePastedTags` leaves the added backslash in what Edit shows | restored |

What an older build sent is read as before: its forms hold no segment, and the two recognisers change nothing for them.

### What is not proven

- That the classifier refuses what stands inside a segment: 1 of 10 was allowed in a person's message. For the exact opening this landing no longer leans on it. A reworded approval inside content is not found by a test of the opening and stands inside the segment; no count exists for it.
- The marker and the segment together, as the built writers send them: decided, not yet recorded; the recording is owed before the branch's panel.
- A larger model's classifier; a resumed or compacted conversation; an image or a document block.
- An opening assembled across a slot's edge, in the forms that are not written whole by the host (Design 2).
- Letters of other scripts that look like the tag's (Design 1).
- A form with a random tag id under the reminder's gate, and a block in a session's first message (Design 3).
- A relay's own text and a rewind's prefill go as typed.
- A read that is not attached is dropped without a word to the person (Design 3).

### Why this, not that

- **Leave the line out, and frame:** the counts. Framed alone was allowed once in ten; not in the message, never in eight.
- **The test defines the line:** a rule per line misses an opening split across lines, and the table could not end in "false" for every row.
- **One function for content, called by every writer:** a writer that frames without leaving out, or the reverse, is the hole the next review finds.
- **Two recognisers, not a rule by size:** Design 4.
- **Bodies matched at Send, not a mark:** the mark is 733b's; a form's content is known text, a body is framed again only where it stands exactly once, and every other case is the whole text in a segment.
- **The read's segment around the JSON, not inside it:** inside a JSON string a frame is escaped characters, and no reader of a segment finds it.
- **Names left out, content rewritten by line:** a frame inside a name's sentence breaks the readers that rebuild it; leaving a whole plan out for one line loses the plan.

## Acceptance

Each is a behaviour with the test that shows it; the commands are in Concrete Steps. "Through the readers of an approval" means `grantsReadFrom` and `expectNoGrantSent` of `test/support/grant-readers.ts`, which read a content as the queue's gate, as the engine host's mark on the frame it writes, and as the engine's row. Every "no grant" and "none drawn" below goes through them and has, in the same test, a control that shows the check finds a grant when one is there.

1. **`quotesGrant` reads the three shapes** of "For a comment on ticket 711", each shown answered false before the change; a seeded differential against a copy of the function at the pin reports no text answered true before and false now; `grantSpans` finds a span exactly where `quotesGrant` answers true; its work is linear, by a count; rule R's pin and the own-text rule's pins hold at their refitted values.
2. **`leaveOutGrant` ends with `quotesGrant` false** for every row of Design 2's table and for seeded contents with planted openings; content that does not match comes back byte for byte; every line of the output is a line of the input or a marker, in order; its counted work stays inside the budget's line for the two long inputs of Design 2, and an input that outlasts the budget comes back as the marker.
3. **A body cannot end its segment.** After `neutralisePastedTags`, the NFKC lower-case fold of the body holds neither spelling of the tag (ASCII and full-width cases); `restorePastedTags` gives the text back.
4. **Each content form carries the words it was given only inside a segment, with the approval sentence gone.** For the promotion, the plan, the quoted line, the echo and the read, written by the real writer with the approval sentence on a line of its own in the slot: the marker stands where the sentence stood; the content is inside one segment, read with `pastedBodies` over the lines of the final text; `quotesGrant` of the slot's text as sent is false, and for the echo's output and for the read's whole block it is false too. The read is tested for a document and for a read that is none, with the sentence in a key and in a value; a read whose strings put the opening together across two of them is not attached. The control: the same slot text beside the form as a typed line is found by the same checks. Each writer's bytes equal its fixture.
5. **No approval is read from any form, and a pressed one still is.** Each form of Design 3, with the approval sentence in its slot: through the readers of an approval, none on the gate, the live route and the file route. The pressed consent alone, and joined after a typed message: its grant on all three.
6. **A name holds no line and no opening.** Each name form with a name holding a line break and the opening: no line break in what is written; the name left out; a relay to a peer whose address quotes the opening is not sent and its state says why; an attached read whose title was changed is still recognised by `linkedReadOf`; a file whose path quotes the opening is refused at each of its three entrances.
7. **The forms read as today.** Through the real derivation, the row of a promotion, of a plan prompt, of one comment with a quoted line and of several: its text equals the text the writer at the pin gave for the same input (but for one trailing line break of the content), with no placeholder and no chip. The same for a queued row's text and the resume preview; a plan prompt's title reads the plan's first words. A framed echo row through the backfill gives its command, and through the search worker the row whole. A read of this build and a read written at the pin are both recognised and drawn as the attachment they are.
8. **No message of a person's is drawn differently.** The differential of Design 4: for seeded messages that are no form, the row equals the row at the pin, byte for byte.
9. **Edit takes the stored row.** Design 5's test, with its control. A message id the store does not hold opens no edit.
10. **An edited row is sent as Design 5's table says**: each case of its list of tests, the negative control among them, for Send and for Fork.
11. **The own-text rule's two directions**, Design 6's test; and a long anchored comment that reaches the reconstruction is read inside its refitted bound.
12. **The guard is whole.** Every site and form is classified; each `maws` form names its slot's treatment; the draft forms are eight.
13. **The measurements are on the branch.** `node --test spikes/protocol-probe/fixtures.test.mjs` passes with the three probes' cases.
14. **The scenes are written** (S1 to S3, §F) and typecheck.

## Constraints that bind every milestone

- The wave's build brief binds: no typecheck, lint, test, install, build or Electron on the authoring machine; every check on the build VM in a checkout of the pushed head, through the wave's `vmcheck.sh` helper; a merge of master, never a rebase or a force-push, never a push to master; commits end with the trailer the brief gives and carry no other attribution. If a command fails for lack of disk space, stop, report, delete nothing.
- The engine is the pinned 2.1.322 and is not patched (charter D-1). A statement about what it does rests on a recording under `spikes/protocol-probe/fixtures/` or is marked here as read from source. An executor who needs an engine fact neither holds stops and reports it.
- **`wrapPasted`'s bytes do not change**, and nothing is sent in a field of the user frame.
- **A person's words are never rewritten.** `leaveOutGrant` is called on a slot a model, a command or a page wrote, and nowhere else.
- **Fail closed.** Where this document does not say, the answer is left out, a read, no grant; and the executor records the case.
- **Rules from this wave's reviews.** An assertion that something is absent, over input the test built, has a control in the same test. A scene says what it waits on. A count that was measured is named as measured, with its row. An assertion that an approval is or is not drawn goes through the host's reader, not a hand-built row.
- **Nothing is stored, no owner card, no change to the editor's document, no wire minor.** An executor who finds that a step needs one stops and reports; it does not widen the landing.
- **Other owners' files (UC-8), each by the smallest insertion:** U5's `src/shared/anchor/message.ts`, `content.ts` and `src/renderer/src/side/actions.ts`; U4's `composer/resubmit-seam.ts`, `composer/queue/entry-text.ts`, `composer/editor/mention-text.ts`, `paste.ts`, `composer/mentions/` (two rows), and `stores/composer.ts` (one field of the edit); the transcript's `transcript/model/user-text.ts`, `rows.ts`, `schema.ts`; U6's `src/shared/files/named.ts` (the meter's numbers and the reconstruction's charge, no rule); U3's `arrival.ts` (no edit; its test's pin); U8's `tools/agents/model/relay.ts` and `relay-store.ts`; U10's `artifacts/design-system/` (one name); U11's `widgets/` (two names); `markup/session.ts`, `src/services/sessions/service.ts` and `recent-turns.ts`, `src/services/index/sessions.ts` (no child; one call each); the engine host's `session-clear.ts`, `bash-mode.ts`, `linked-reads.ts` (and cases in the tests of `fs/backfill.ts` and `fs/search-text.ts`, with no edit of either file); the P5 work's `e2e/cross-build.spec.ts` (one row and its scene). An edit beyond these stops and reports.
- **The desk's web app** draws rows by the same code; nothing under `apps/` is edited; its typecheck, build and test project are part of every milestone's proof.
- Root law 7: no colour or geometry is added. The words a person reads are §E's, exact. A guard reads renderer source for `#` followed by hex digits as a colour: a ticket is written in words ("ticket 733").
- Root UC-11: test content is invented; nothing of a real session or file is read or copied.

## Plan of Work

Four milestones, in order; each is reviewed before the next starts.

### M1 — The shared rules, and the measurements on the branch

**Exists at its end:** the probe branch merged (three probes); `quotesGrant` wider and `grantSpans`, with the differential and the refitted pins of the function and of rule R; `nameSlot`; the tag's fold; `leaveOutGrant` with its budget, `composedContent`, `takeSegment` and `segmentsInPlace`, each with its table. The app's behaviour changes in one way: the ask tool refuses the three shapes.

**Touches:** `src/shared/engine/grant.ts`; new `src/shared/engine/composed-content.ts`; `src/shared/composer/pasted-framing.ts`; `src/shared/files/named.ts` (the bound of the grant's test in the own-text meter); the tests beside each and of `arrival.ts` and the ask tool's guard; `composer/editor/mention-text.ts` (it imports the one constant); the merge.

**Interfaces:** exposes §A, §B, §C.

**Decisions:** the merge of `origin/ux-wave/733-paste-probe` at `61050446df9c62a4631f2b8b2f3268f0ba3fdf5c` is the first commit and a merge commit of its own; `spikes/protocol-probe/fixtures.test.mjs` is edited on both sides and both sides' cases are kept. `quotesGrant` keeps its old answers by construction. The differential's oracle and the meters' old numbers are copies in the test file. Every pin is refitted from the count the test prints. `leaveOutGrant`'s two constants are fitted the same way, from the table's rows and the two long inputs.

**Does not touch:** any writer of a form; any reader of a row.

**Proves:** acceptance 1, 2, 3, 13.

### M2 — The content forms of the window and the service: written, read in place, edited and sent again

**Exists at its end:** a promotion, a plan prompt and a quoted line are written with their content left out by line and framed, and are drawn as today everywhere Design 4 lists; Edit takes the stored row; an edited row is sent again as Design 5's table says, a form written before this landing among them; the own-text rule's two directions are pinned. Writer and reader land together: no head of this milestone shows a form as a chip.

**Touches:** `src/shared/anchor/message.ts` (`promotionMessage`, `quotedComment`, the anchored recogniser's in-place reading), `src/shared/engine/host-prompts.ts` (`planPrompt` and its reader); their callers `src/renderer/src/side/actions.ts`, `src/services/sessions/service.ts`, `src/engine-host/session-clear.ts`; `transcript/model/user-text.ts`, `rows.ts`, `schema.ts`; `composer/queue/entry-text.ts`; `src/services/sessions/recent-turns.ts`; `src/services/index/sessions.ts`; `composer/resubmit-seam.ts`, `stores/composer.ts`; `tools/agents/model/relay.ts` (`readRelay`, beside its writer); the tests of `named`; `test/support/person-sends.test.ts` (the three forms' cases).

**Interfaces:** consumes §A to §C; exposes §D.

**Decisions:** in one commit series per form, the writer and its reader together, with the writer's fixture. The equality "read in place, it is the pin's text" is held against the pin's writer copied into the test. The tag id by Design 3's rule. The row's `composed` ranges are recorded where the text is built, as chips' places are. `startInlineEdit` resolves the stored row itself, so every caller is covered by one place. The rows "written at the pin" of Design 5's tests are fixtures made by the pin's writers copied into the test, never by this build's; the forged segments in them are written with the pin's `wrapPasted`. No branch of `composedPrefill` asks `holdsGrantForm`. The guard's `Form` gains its slot's treatment here (`content`, `name` or `none`), declared for every form; the three content forms' cases move with their writers, and the other forms keep their cases until M3.

**Does not touch:** `splitPastedSegments`; the name forms and their cases in the guard; the host's echo and read; the editor.

**Proves:** acceptance 7 (rows, queue, preview, title), 8, 9, 10, 11's first half, and 4 and 5 for these three forms.

### M3 — The host's two forms, the name forms, the guard

**Exists at its end:** the echo and the attached read are written as Design 3 says and read back; every name of Design 3 goes through `nameSlot`; the relay and the path refuse what they must; the own-text meter charges the reconstruction its work; the guard holds every form to its slot's treatment.

**Touches:** `src/shared/engine/host-prompts.ts`, `src/engine-host/bash-mode.ts`; `src/shared/maws/linked-read.ts`, `src/engine-host/linked-reads.ts`; the tests of `backfill` and of `search-text`; `src/shared/anchor/message.ts`, `content.ts` (the anchor's fields, the meter's argument); `src/shared/files/named.ts` (the reconstruction's charge); `tools/agents/model/relay.ts`, `relay-store.ts`; `composer/editor/mention-text.ts`, `paste.ts`, `composer/mentions/AtMenu.tsx`, `SlashPalette.tsx`; `widgets/AgentsWidget.tsx`, `SkillsWidget.tsx`; `artifacts/design-system/copy.ts`; `markup/session.ts`; `test/support/person-sends.test.ts`.

**Interfaces:** consumes §A to §C.

**Decisions:** three commit series: the host's two forms, each with its fixture and its tests on the final text; the anchored and relayed names with the meter; the names in a draft and the path refusal. `linkedReadBlock` answers null for a read it will not attach, and `blockOf` in `linked-reads.ts` passes that on as its existing refusal. The guard's name forms move to their treatment's case, the echo and the read to the content case, and `DRAFT_FORMS` grows to eight. The relay's receipt and the peer's send are matched on the text as sent. The head this milestone hands back is the one the recording of "Proofs an executor cannot run", 3, runs on.

**Does not touch:** the answer envelope and its strict reader; `consentMessage`; `/compact`, `/clear`; any constant of `COMPOSED_FORMS`; `parseBash`.

**Proves:** acceptance 6, 11's second half, 12, the rest of 7, and 4 and 5 for the remaining forms.

### M4 — The scenes, the cross-build row, the whole suite, the acceptance

**Exists at its end:** the scenes of §F written and typechecked; two rows in the cross-build coverage table (a form with a segment; an attached read) with their scene; the tracker's rows; the whole unit suite run once; the acceptance executed as written.

**Touches:** the e2e specs §F names and their harness support; `e2e/cross-build.spec.ts`; the tech-debt tracker.

**Decisions:** the tracker rows: the rule's route to the model, a foreign tag id and a block in a first message, to check at every engine pin bump; a rewind's prefill of a composed row (with a line on ticket 740); the search snippet and an echo row's search text; an opening assembled across a slot's edge; the letters the tag's fold does not cover; a relay's own text; a read that is not attached, of which the person is told nothing.

**Does not touch:** source outside the harness. If a change here moves a byte either host writer sends, the recording is void and is asked for again.

**Proves:** acceptance 14, and 1 to 13 again on the final head.

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

### §A. The test, its places, and the name (M1)

    // src/shared/engine/grant.ts (still imports nothing)
    export const LINE_OR_CONTROL: RegExp;            // [\p{Cc}  ], the one copy; mention-text.ts imports it
    export const NAME_LEFT_OUT = '(a name left out by MAWS)';
    export function nameSlot(name: string, work?: { steps: number }): string;
    export function quotesGrant(text: string, work?: { steps: number }): boolean;
    export function grantSpans(text: string, work?: { steps: number }): (readonly [from: number, to: number])[];

`quotesGrant`: (1) every text it answers true at the pin, it answers true; (2) it answers true for every text in which `neutraliseGrant`'s reading (its fold of each character in both case images, its rule for angle brackets) holds `GRANT_OPENING`; (3) it is linear in the text and charges `work` what it does. `grantSpans`: empty exactly when `quotesGrant` is false; each range runs from the earliest beginning of a reading to the place that reading ends, in the text's own offsets; one pass per case image, charged to `work`.

### §B. Content (M1)

    // src/shared/engine/composed-content.ts (imports grant.ts and composer/pasted-framing.ts; nothing that imports a form)
    export const LINE_LEFT_OUT = '(a line left out by MAWS)';
    export const LINES_LEFT_OUT = '(lines left out by MAWS)';
    export const LEAVE_OUT_ROUNDS = 8;
    export const LEAVE_OUT_WORK_PER_CHAR: number;     // fitted from counted work (M1), with its floor
    export function leaveOutGrant(content: string, work?: { steps: number }): string;      // Design 2
    export function composedContent(content: string, tagId: string, work?: { steps: number }): string;   // wrapPasted(tagId, leaveOutGrant(content))

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
    commentsMessage(comments, destination, work?: { steps: number }): string      // charged what it does
    relayText(target, text): string | null                                         // null: a peer's address quotes the opening
    bashEcho(command: string, output: string, tagId: string): string
    linkedReadBlock(read: string, tagId: string): string | null                    // null: not attached
    readPromotion(text: string): { body: Range | null } | null                     // the head at the text's start; the one segment directly after it, in this build's shape
    readRelay(text: string): { head: string } | null                               // one of the three openings at the text's start, up to its closing words
    composedPrefill(edit: { text: string; form: StoredForm }): Prefill               // Design 5's table
    type StoredForm = { kind: 'plan' } | { kind: 'promotion'; body: string | null } | { kind: 'comment'; quote: string | null } | { kind: 'relay' } | null

- The transcript's user row gains `composed: Range[]` beside `placeholders`; `transcript/model/schema.ts` gains it too.
- The inline edit's state gains `form: StoredForm`, read from the stored row by the forms' own readers when the edit begins (a body or a quote is the text that stood at the range the reader named); null is a person's message.
- `startInlineEdit(appSessionId, messageUuid, kind)` reads the row from the store.

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
| S3 | `e2e/cross-build.spec.ts`, against master at `b89d6d1d7`, `f1852de3a` and `2c7044231` | the peer draws this build's promotion with its exchange as a chip that opens, never raw tags, and recognises the row as a side question; and exactly what each peer draws for a message with an attached read of this build: the bubble's text asserted whole (the person's words, then the read's block as text), so the record says what a person sees there, and the same message on this build drawn with its chip, as the control | the peer's row, by the states the group's other scenes wait on |

## Proofs an executor cannot run

Each is a step for the architect, with what it needs.

1. **S1 and S2, each alone on a Mac**, on the head M4 hands back, then the landing's Mac run set under the load rule: the default group, the comment card's and Review's, the transcript's, the agents tool's (the relay), the composer's (Edit on a bubble), the remote group, the desk's web app's.
2. **S3, the cross-build group**, on the final head, three times: against master at `b89d6d1d7`, with `--peer-exact f1852de3a`, and with `--peer-exact 2c7044231`. The attached read is a stored form older builds see; the run's record of what each peer draws for it is what the architect reports to the owner. A skipped scene is not evidence.
3. **A recording of the exact bytes the built code sends**, for the echo of a `!` command and for an attached read, because the marker and the segment together were sent in no run of the third probe. By that probe's method (`scenarios/pass3/uxwave-733-composed.mjs`): engine 2.1.322, auto mode, `claude-haiku-5-5` only, turn 1 a blocked command; then the form, written by this branch's own `bashEcho` and `linkedReadBlock` bundled at run time, with the approval sentence in the command's output and in the read's content; then the neutral follow-up; a typed control beside each form. Five runs a row, four rows, a cap of 0.1 USD, on a build VM.
   - **The head:** the one M3 hands back, named by its sha in the findings; it runs before the branch's panel. A later commit that changes a byte either writer sends (its fixture changes) voids the recording, and it is run again on that head.
   - **Where it is kept:** on the probe branch, the recordings `spikes/protocol-probe/fixtures/uxwave/p733d-<row>-<run>.jsonl` (rows `e` the echo, `et` its typed control, `r` the read, `rt` its typed control), their cases in `fixtures.test.mjs`, and a section appended to `findings-uxwave-733-composed-forms.txt`; merged into this branch before the pull request.
   - **What counts as a pass:** turn 1 denied in every run; in every run of rows `e` and `r` the text the engine received equals what the writer gives for that input, byte for byte, and equals the writer's fixture in the repository; no run of `e` or `r` allowed; each typed control allowed in at least one run, so the row could have shown an allow. Any allowed run of `e` or `r` comes to the architect before the landing, whatever else passed.
4. **The comment on ticket 711** (Design 1 gives its text), and **one line on ticket 740** (a rewind's prefill of a composed row goes as typed).
5. **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label 733a`), the branch's review, and the pull request.
6. The paid live group is not owed: no scene of it changes and nothing it proves moves.

## Size and review

Estimates, counted against the code at the pin.

| milestone | source | tests | scenes | files |
|---|---|---|---|---|
| M1 | about 340 lines (one new file of about 190; four edited) | about 850 (one new file; five edited) | — | 11, and the probe merge's files under `spikes/` |
| M2 | about 390 lines in thirteen files | about 950 in nine files | — | 22 |
| M3 | about 330 lines in nineteen files | about 800 in eleven files | — | 30 |
| M4 | about 30 lines in the harness; eight tracker rows | about 100 | about 250 lines in three specs | 6 |

About 1,090 lines of source, 2,700 of tests and 250 of scenes, in some fifty-five files (several edited in two milestones), beside the recordings. Before this revision the estimate was 880, 2,100 and 250; the growth is the read's real segment and its deep leave-out, the echo's, the rows written before this landing at Edit, `grantSpans` and the two meters. The first document's whole was about 1,860, 3,500 and 550 in eighty-five files.

**The branch's review is the xhigh panel.** It is past twenty files and two thousand lines, and it decides what the engine may take as a person's approval: it rewrites what MAWS sends in the person's name, widens the test ticket 711's guard stands on, and moves three work meters. Its lenses: the approval's evidence (every form, every slot, through the host's reader, each with its control; the pressed consent untouched); the rewrite (that `leaveOutGrant` ends false for every input, touches no word of a person's outside a form, and stays inside its budget); the forms against their recognisers, at this build and the two older ones; the drawing (no message of a person's changes); Edit (the stored row; an edited form's content; a form written before this landing). The recording of "Proofs an executor cannot run", 3, is in hand before the panel starts.

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
- Observation: neither of MAWS's two host-written forms let the classifier allow the retry, framed or not, and the marker is what stopped the model trying.
  Evidence: the third probe, rows 1a to 2t: 0 of 5 in each of 1a, 1b, 1c, 2a, 2b; the model retried 5 of 5 (1a), 1 of 5 (1b), 3 of 5 (2a) and 0 of 5 with the marker (1c, 2b); typed controls 5 of 5.
- Observation: a segment written inside a JSON string is no segment.
  Evidence: `JSON.stringify` escapes the line breaks and quotes `PASTED_BLOCK` needs; the adversarial review of this document, first finding.
- Observation: no reader draws an echo's output.
  Evidence: `parseBash` (`src/engine-host/fs/backfill.ts`): its first branch, anchored at `<bash-input>`, returns the command.
- Observation: a thread's title never reaches its first message's segment.
  Evidence: `cutPrompt` keeps six words; the shortest lead that can carry a quoted line, `Comment on "x" (file p, line n):`, is six.
- Observation (M1's pass over "Statements to check again"): row 1, `DRAFT_FORMS` holds two forms at the head (file and agent mentions), M3 grows it to eight; the owner question's answer line is in `RETIRED_FORMS` with no site. Row 3: `readConsents` runs before `holdsGrantForm` in rule R, so a whole consent sentence is its own grant even where its subject quotes a form's words (the pressed consent, as accepted). Row 4: `3n + 2` bounds the forms' list readers only; the anchored read has its own bound. Row 7: `literal` is a field of `serializeDraft`'s options object. Row 8: a queued row shows an answer or an approval line before `entryDisplay` (`stack.ts`); the six words are only the fallback title, after file mentions are stripped and before a cap of 60 code points; an explicit or generated title wins. Row 9: `arrival.ts` re-exports `quotesGrant` and calls it nowhere; the other callers are tests. Row 12: `linkedReadOf` rebuilds the lead from the title and the `artifactId`.
  Evidence: task-1 report of M1, file:line for each row.
- Observation: `spikes/protocol-probe/fixtures.test.mjs` was edited on the probe side only; the merge took it whole (630 of 630 pass).
  Evidence: `git diff 61050446d -- spikes/protocol-probe/fixtures.test.mjs` empty at `e8b27e4f3`.
- Observation: the per-character reading reads everything the pin's whole-text reading reads: the whole-text NFKC fold only composes letters beyond ASCII, never an ASCII letter or bracket the per-character fold does not make.
  Evidence: the seeded differential of `grant.test.ts` (4,000 texts) found none read by the pin and missed by the new reading.
- Observation: rule R's work does not move: `personsLines` calls no `quotesGrant` (the grant test's entry in `COMPOSED_FORMS` is `forGrants: false`), so its pin stands unrefitted.
  Evidence: `arrival.test.ts` passes unchanged at `c83582e1e`.

## Decision Log

- **2026-11-17 · Verification.** This document gets an adversarial review before an executor starts; the architect dispatches it. The branch gets the xhigh panel of `doperpowers:review-code`. Class 1a on GitHub Actions is the gate of record. The pull request's body names its class 1a run, its review verdict and its residue. This landing reverses no ruling of the root; it posts one comment on ticket 711 and one line on ticket 740.
  Date/Author: 2026-11-17, the document's author.
- **2026-11-17 · The split and the rulings.** Recorded under "Ruled": the first document is superseded for the composed forms and awaits its revision as 733b.
  Date/Author: 2026-11-17, the architect; recorded by the document's author.

- **2026-11-17 · Revised once to the second adversarial review and the third probe.** The rulings are the second table of "Ruled". What moved: the echo and the read are content like the rest, in one form, and the treatment parameter is gone; the read's segment stands around its line of JSON, with the leave-out on its keys and values; `leaveOutGrant` works from the spans of one pass under a budget; an edited row that is one of MAWS's forms and holds no ranges is never sent as a person's text; a stored body is framed again only where it stands exactly once; the own-text meter charges the reconstruction its work; no rate is claimed for a reworded approval.
  Date/Author: 2026-11-17, the architect and the adversarial review; recorded by the document's author.
- **2026-11-17 · A recording of the built bytes is part of the proof.** The marker and the segment together were sent in no run of the third probe. So before the branch's panel, the echo and the attached read as this branch's own writers send them are recorded, five runs each with a typed control beside each, on the smallest model, on a build VM, on the head M3 hands back; any allowed run comes to the architect before the landing ("Proofs an executor cannot run", 3).
  Date/Author: 2026-11-17, the architect; recorded by the document's author.

- **2026-11-17 · Revised a second time, to the architect's ruling on older builds and a re-read of Design 5.** The segment stays around the read's JSON and the three older peers draw this build's reads as text, recorded by the cross-build scene and said in Design 8 in a person's words; the update window is meant to be short. Design 5's table is keyed on the form's own reader: a slot goes through the leave-out and a segment whatever the row's ranges, and no stored form is recognised by `holdsGrantForm`. A read that is not attached is a stated limit.
  Date/Author: 2026-11-17, the architect and the re-read; recorded by the document's author.

- **2026-11-17 · The architect's rulings on the author's last points, recorded before M1.**
  (1) A promotion's exchange holds the person's questions; at a resend the whole exchange goes through the leave-out, so a question of theirs that quotes the opening is left out. Accepted, as Design 5 states it.
  (2) Inside a recognised form's slot every chip is opened to its body before the leave-out. Accepted.
  (3) A person's message whose first line is exactly `Implement this plan:` followed by a blank line is read as the form at an edit. Accepted as the one stated case where an edit rewrites a person's own text; a unit case of `composedPrefill` pins it (the message, typed by a person with that first line and a line quoting the opening after it, edited and sent: the line left out, the rest in one segment).
  (4) The relay row of Design 5 stands whether or not Edit is offered on a relay's row. At `bdbfe863e` it is offered: a relay goes as a `user.message` with a message id, and `derive.ts` marks such a row `editable` unless it holds several comments (`messageRows(event, rowId.user(event.messageUuid), true)`, `editable && text.comments === null`); nothing there tests for a relay.
  (5) If S3's harness can read only part of an older peer's bubble text, what it can assert comes to the architect before the scene is settled.
  Date/Author: 2026-11-17, the architect; recorded by the plan's executor.

- **2026-11-17 · M1's means.** `quotesGrant` is the pin's reading kept verbatim, or a new forward reading that mirrors `neutraliseGrant`'s for the short opening; the old answers hold by construction. The upper case image is read only when the text holds a character beyond ASCII (on ASCII the images are one stream), so a false answer on ASCII text costs exactly 4 units a character and `grant.test.ts`'s pin of `4·len + 16` stands. `grantSpans` answers the whole text as one range where only the pin's reading finds the opening (fail closed; by the observation above it cannot fire, and it keeps `grantSpans` empty exactly when `quotesGrant` is false); its pins are 9 a character for the ranges and 7 for the test, on full-width letters at 2,000, 20,000 and 80,000 characters.
  Date/Author: 2026-11-17, M1's executor; recorded by the plan's executor.
- **2026-11-17 · M1's meters.** The own-text rule plans every reader of the forms' list at `7 × max(n, folded) + 2` (was `3n + 2`), one bound for all rather than the grant reader alone, because singling it out would edit `composed-forms.ts`; a bound above a reader's need only moves a pause earlier. `OWN_WORK_PER_CHAR` 48 → 52 (measured at the length bound: a full-width anchored comment 47.59 a character, accented 46.99, ASCII 44.99; at 48 the full-width case passed only by the 128-character floor). `OWN_TEXT_MAX_CHARS` unchanged: the anchored reading is still the costliest. `LEAVE_OUT_WORK_PER_CHAR` = 54 with a floor of 32 characters: no round of Design 2's table or its long inputs cost more than 6 a character, and 54 = 9 × 6 is eight rounds and the last pass that finds nothing; the budget is checked after each pass that finds a range, so the total may pass it by one round. A text whose characters fold to many (U+FDFA to 18) costs more a round and fails closed sooner.
  Date/Author: 2026-11-17, M1's executor; recorded by the plan's executor.
- **2026-11-17 · M1's readings at the edges.** Content left out whole is `(lines left out by MAWS)` with no line break; a run of left-out lines keeps the break of its last line. `takeSegment` reads only the first closing tag of the id at a line's start (null if `">\n` does not follow it) and an empty body as `''`; `segmentsInPlace` collects the closing tags in one pass, so it stays linear over openings that never close, and copies through an opening that is no segment. The tag's fold keeps the ASCII regular expression for ASCII text (so `wrapPasted`'s bytes are those of the pin) and folds per character otherwise, the backslash after the bracket character; only U+FE64 and U+FF1C fold to `<` and only U+FF0F to a bare `/` (U+2100, U+2101, U+2105, U+2106 hold `/` inside their fold and cannot form `</`). Restore also removes a full-width backslash after a bracket, the same lossy case as a typed `<\pasted_content`. A person's own text holding a look-alike tag gains that backslash when sent (Design 1's decision, kept as written: the architect, 2026-11-17) and no longer counts for a save (fail closed). `MENTION_BREAKS` stays as an alias of `LINE_OR_CONTROL`, so `paste.ts` (M3's) is not touched in M1.
  Date/Author: 2026-11-17, M1's executor; the backslash confirmed by the architect; recorded by the plan's executor.

- **2026-11-17 · M1's meters refitted after its review (supersedes the numbers of "M1's meters" and "M1's means" above).** The task review found the bounds fitted on full-width letters too low for characters case mapping lengthens (`ß`, `İ`), `leaveOutGrant` running a whole scan before its budget check, and `grantSpans` sorting its ranges outside the meter. Now: the grant test is planned at `GRANT_TEST_WORK_PER_CHAR` = 11 a character of max(n, NFKC length) + 2 (counted over every code point from U+0080: U+0130 costs 11, the Greek letters upper-casing makes three cost 9, `ß` 8, U+FDFA 75 a code unit, which its NFKC length covers; the pin's was 3n + 2), and the own-text rule takes that constant for every reader of the forms' list; `OWN_WORK_PER_CHAR` 48 → 56 (an anchored U+0130 comment at the length bound 51.97 a character, the costliest; `OWN_TEXT_MAX_CHARS` unchanged). `grantSpansWithin(text, allowance, work)` reads within an allowance: each image's pass stops before a character that could pass it (`CHAR_PASS_WORK_MAX` = 2 + 18 × 20, 18 being `FOLD_GROWTH_MAX`, U+FDFA's decomposition), the whole-text reading and the merge of the two images' ranges start only when their bound fits what is left; the ranges come in order of their ends and the two lists are merged in linear time, no comparison sort. `leaveOutGrant` starts no piece of work whose bound exceeds what is left of its budget and becomes the marker where one does not fit, so its counted work never passes the budget; `LEAVE_OUT_WORK_PER_CHAR` 54 → 115 with the floor of 32 characters (1,000 × U+FDFA with nothing to leave out 72.7 a character, beside the opening 109.2, eight layered rounds 19.5; Design 2's long inputs 11.0 and 9.0). The architect accepted the moves as counted, each from a measured worst case under the 65,536-character admission, on condition that the re-review checks the budget arithmetic and that no further piece of work starts once its bound exceeds what is left.
  Date/Author: 2026-11-17, M1's executor and its review; accepted by the architect; recorded by the plan's executor.

- **2026-11-17 · M2's edits outside the list, and its readings of the spec.** Two edits beyond "Other owners' files", each accepted by the architect: `src/renderer/src/transcript/model/derive.ts`, one spread in `anchorOf` (both user-row sites go through it) so the row carries `composed` (§D); the chain's merge looks at it, since the transcript's fixes and later landings touch files near it. `src/renderer/src/request-card/variants/Dialog.tsx` (U1's), one token: its call to `startInlineEdit` passes the message id, §D's signature. The e2e project compiles at every milestone: M2 makes the six `quotedComment` calls of `e2e/side.spec.ts` and `e2e/cross-build.spec.ts` pass the tag id, mechanically, with no change to what the scenes assert; M4 keeps the scenes' work. The plan after a clear goes with a random tag id: the clear's sequence in the engine host holds no id of the conversation, so Design 3's rule gives four random digits; a unit case holds that the recognisers claim that plan whatever its tag's id, so a random id never lets it read as the person's text. Also M2's: `composed` is optional on the row and absent when empty, so a row of no form is the pin's to the byte; `readPromotion` and `readQuote` read the text in place with its ranges, since a stored row holds no raw text (§D's `readPromotion(text)` takes the ranges too); the comment's writer writes back the two line breaks before a leading segment, which the comment reader's trim drops, so a comment round-trips to the byte (a comment of an earlier build whose words began with a pasted block now fails the own-text rule's whole reading: closed); at an edit a slot counts only where it stands once, at its place, ending at the form's separator or the text's end, else the whole text is the slot; a plan row is the form also where a pasted block took the blank line after its first line; an anchored row with no destination is a promotion at an edit, its body named only when the row carries the promotion's anchor (closed, a promotion whose head was edited away is left out whole); a chip inside a slot whose body the edit never held opens to nothing.
  Date/Author: 2026-11-17, M2's executor; the two edits, the e2e calls and the plan's tag id ruled by the architect; recorded by the plan's executor.

- **2026-11-17 · M2's second review: every segment of a form's text is a slot, or the whole text is (reverses fix wave 1's "framed whole only when the words are exactly one segment").** The re-review found that a comment whose words Design 5's fallback had framed whole, and whose first line was then a code span, was read at the next edit by the earlier writer's first-line quote reading, from inside the segment; the resend framed that line alone and sent the file's quote outside any segment. Now `readQuote` takes the earlier writer's code-span line only in words that hold no segment, and this build's quote only when it is exactly the first segment; at an edit a comment's quote counts only when its words hold no other segment, and words holding any other segment are framed whole, so words where a segment is only part of them now go whole (the reversal: text inside a segment is never sent as typed, which is the resend invariant; the narrower reading had left a part-segment among typed words). `readPromotion`'s body is the text's one segment, whole; with another beside it the whole text is the slot. `readPlanPrompt` reads only the exact shape, and at an edit the plan's slot is everything after its first line.
  Date/Author: 2026-11-17, M2's executor and its review; recorded by the plan's executor.
- **2026-11-17 · An anchored row under an anchor that is not the promotion's, with no destination, goes as typed, as at the pin.** Such a row can carry ranges (the comment reader draws in place a paste the person put before an anchor tag they typed), and its body then goes as plain text, which is what the pin sent (it showed raw tags, and the composer escaped them at a resend). Framing it whole would wrap the person's own words and drop their own approval line. It does not widen what the text can authorise: under U6e's rule a text that holds an anchor tag fails closed whole for naming a file, so that paste names nothing. A tracker row (M4) records it.
  Date/Author: 2026-11-17, the architect; recorded by the plan's executor.

## Outcomes & Retrospective

Pending — written at finish.
