# Choices

Record for `choices` (order 0.5, directly after Layers). The contract is `mockups/lab/BRIEF.md` and
`mockups/lab/ROUND2.md`; the style it stands in is `../layers/DESIGN.md`, sections 0 to 12, under the Paper
colouring. Variant names live in `parts.ts`, the frame in `board.tsx` and `Choices.tsx`, the variants in
`transcript.tsx`, `composer.tsx`, `needs.tsx`, `motion.tsx`, `ground.tsx` and `together.tsx`, their styles in
`choices.css`.

## 0. What this is

Not a design. After two rounds the owner chose Layers as the style and Paper as its colouring, and judged the large
parts: the pane, the tabs, the composer as a whole, the tool-run summary, the approval, settings. The smaller parts
of the session view were never put in front of them ("sessions just have so many components that I may not have
covered"). This is a board where each of those parts stands in two to four variants, so the owner can answer with
a letter per part.

A is always the part as Layers has it today: Layers' markup on Layers' classes, drawn by Layers' stylesheet. The
other letters answer the owner's direction for the next wave: "just too many word that overwhelms users, most of
which isn't even necessary"; "nothing unnecessarily adds stuffs to screen"; what is stiff and gauge-like made round
and soft; "less descriptive, but more intuitive"; progressive disclosure and graphical meaning over labels. So the
variants of a part differ in what they treat as necessary, never in a radius or a number, and at least one per part
is plainly simpler than A.

If a decision about the board is ever ambiguous: the thing being judged is shown as it would be in the app, and
everything the board adds stays outside it.

## 1. How the board works

- **One window in the Layers style.** The same field (Paper's picture, painted by Layers' own painter), the same
  glass runtime with the same settings, Layers' stylesheet, Layers' pane. The pane is the index of parts; the main
  space holds one part with all its variants together. Fifteen pages in five groups, and a sixteenth, Together.
- **Paging: one part per page, not one long page.** Three reasons. A page's variants fit one window at 1440 by 900,
  so comparing needs no scrolling and no memory. The glass runtime carries a page's four to six surfaces easily,
  where thirty on one page would not be the app's own condition. And the part is in the address
  (`#/choices/session?part=diff`), so a page can be linked, captured and stepped through with the arrow keys.
- **True size, true place.** Transcript parts stand in the reading column exactly where it stands in a session with
  the side column open (680 wide, centred between the pane and where the modules would be), so a block is over the
  same part of the field as in the app. Their tags stand to the right, where the modules would be. Composer parts
  are whole composers, two abreast at 520 wide (the composer is as wide as its column, which is that narrow in a
  smaller window; every control in it is at its own size). Small parts stand side by side. The two "needs you"
  parts (2.14, 2.15) take a page of four each: above, what the waiting capsule's list would hold, as Layers' own
  platter at its own 348 px; below, what the session would hold, at the 520 px the composers use.
- **A tag per variant**, outside the thing judged: a letter in a ring, a plain name, and where a variant shows
  nothing of itself at rest, a few words. Clicking a tag marks the pick: the ring fills, the letter appears on the
  part's row in the pane, and the button in the pane's foot copies all picks as one line ("your message B, diff C").
  Picks are kept in the browser's local storage.
- **At rest and Opened.** Parts with something behind a click or a hover have a switch at the top right that opens
  every variant on the page at once (key O), so the disclosed states are compared together too. Each variant also
  answers its own click.
- **Motion plays.** The two motion pages play on arrival and on Replay (key R), all variants at once. The pane's
  collapse is the one part that cannot be shown three times at true size, so it is shown twice: three small
  drawings of the window that move together, and a button under each that plays that way on the real pane.
- **Together.** The last row of the pane sets the session's own transcript and composer in one set of letters, laid
  out as the session is (Layers' scroller, column and scroll rule; the composer at the foot of the window; read from
  its end). A switch chooses the set: Yours (the picks so far, A where nothing is picked), Today (all A, which is
  Layers' session as it stands) and Suggested (the picks of section 2). It is there because letters interact: a
  tinted message and a dashed waiting message are one decision seen twice, and the sum of many small removals is
  only visible in one column. The board shows the builder's picks nowhere else.
- **Both schemes.** D flips the scheme, as everywhere in the lab. Every variant was looked at and measured in both.
  The Ground page has different candidates in each scheme, so it keeps a letter for each.
- **Knobs: two.** Part (the page), and Dark ground (repaints the whole board on Paper's own ground or one of the
  owner's four candidates, so any part can be looked at on any of them). Address aids for captures, never design
  states: `x=open`, `x=nopane`, `x=rail`, `x=melt`, `s=running-typed|idle|idle-typed` (the send page's state),
  `s=yours|today|suggested` on Together, `pose=inactive`, `tier=css`, `dev=1`.

## 2. The parts

Each row: what the variant argues, and what it costs. "Pick" is the builder's recommendation, for the owner to
overrule; the reasons are about the owner's stated direction, not taste.

### 2.1 Your message

| | argues | costs |
|---|---|---|
| **A Glass** (today) | Everything that is not the agent's prose is an object, and objects are glass. | In light it is a white card with a shadow, the heaviest thing in a turn, for words the person already knows. One glass surface per message in a transcript of hundreds. |
| **B Tint** | The person's words need a place, not a material: a wash of the ink (6 % light, 8 % dark), as wide as the words, flush right. | No rim and no shadow, so it is quiet over the field's picture; it is told from prose by position and fill alone. |
| **C Heading** | No object at all. The message is the heading of the turn it starts: left, weight 620, its answer 8 px under it. The transcript reads as a document. | The conversational geometry is gone, and with it the landmark a right-hand shape gives when scanning a long session; a long message is a long bold paragraph. |

**Pick: B.** Glass then means one thing in the transcript, "something the agent made that you can open", and the
person's own words step back from it. It keeps the right-hand landmark C gives up, and removes a surface per
message from the second glass root.

### 2.2 Thinking (found; not on the list)

| | argues | costs |
|---|---|---|
| **A Timer** (today) | Thinking is an event with a duration: "Thought for 9s", opening to its summary. | The line says how long, which nobody acts on, and hides what, which is the only reason to look. |
| **B What it thought** | The summary is the caption; the duration waits for the pointer. One line, nothing to open. | A second grey line above every run of work: more words at rest than A. |
| **C Folded in** | Thinking leaves no line of its own. It is the first row of the run it led to, with its duration where a result would be. | A thought that leads to no tool call has no run to live in, and falls back to B's line. |

**Pick: C.** It is the only one that removes a line from the transcript, and it loses nothing: the summary is one
click away, in the place the person already opens to see what happened.

### 2.3 Diff

| | argues | costs |
|---|---|---|
| **A Card** (today) | An edit is a card with its own head: an icon, the file, its folder, the count, and under a hairline every line with its sign. | Four kinds of chrome around the code (icon, head row, hairline, a column of plus signs). Open by default, so twenty edits are twenty cards. |
| **B One line** | An edit is one more grey caption, the file's name and its count, and opens in place into the code. | At rest the transcript shows no code at all; the agent's main product is always a click away. |
| **C Code only** | The file is a caption on the field, in the grammar every other caption already uses; the glass holds code and nothing else; a run of added lines is one green bar where A prints a plus per line. | The count stands on the field, not on glass, where it needs a deeper green in light (§5). A removed line has only its bar and wash to say so (the fixture has none to show). |

**Pick: C,** with B as its folded state (C's caption can carry B's chevron). It keeps the code in sight, which is
what a person supervising wants to see, and drops everything around it that is not code.

### 2.4 Running command

| | argues | costs |
|---|---|---|
| **A Card** (today) | What is running shows its command, its clock and its last three lines of output, always. | Three lines of test output are read only when something is wrong. The largest live object on the page. |
| **B One line** | A running command is the latest caption, with a breathing dot before it; the clock waits for the pointer; the output opens in place. | Nothing marks it as the one live thing but a 7 px dot; in a page of grey captions it is easy to miss. |
| **C Capsule** | What is live earns one small round object: dot, command, clock. It opens into A's card, travelling between its two measured widths. | Still a surface per running command. The tail is a click away when a test hangs. |

**Pick: C.** It is the owner's "round and soft" taken literally, and it keeps the one distinction worth an object
(this is happening now) while dropping the output nobody reads until it matters.

### 2.5 Agents started (found; not on the list)

| | argues | costs |
|---|---|---|
| **A Sentence** (today) | A line of the log: "Key migration check and Load profile started working". | It is true for a second. It does not say whether they still are, and its three last words are the same every time. |
| **B Live chips** | One chip per agent, with its own breathing dot; what it is doing waits for the pointer (and is the check mark's place when it is done). No verb. | Two filled shapes in the transcript where A had one grey line; the side column's Agents module says the same. |
| **C A count** | A glyph, a number and a dot; the names and their lines open from it. | The names are the useful part, and they are hidden. |

**Pick: B.** It replaces a sentence with state, which is the owner's "graphical meaning over labels" in one line.
If the side column's module is always open in practice, C is enough.

### 2.6 Queued message

| | argues | costs |
|---|---|---|
| **A Chip inside** (today) | The queue is part of the composer: a chip above the field. | The composer grows by a row and holds an object inside an object. |
| **B Waiting above** | A queued message is a message that has not happened yet, so it stands where it will be sent from, in a message's shape, with a dashed outline in place of a fill. | It is outside the composer, a short way from where it would be edited. |
| **C In the field** | Nothing new on screen: the queued words rest in the field where the placeholder was. | Typing a second message has to say what happens to the first. |
| **D A mark** | One glyph with a dot; the words on hover. | The person cannot see what they queued without asking. |

**Pick: B.** With the message as a tint (2.1) it is one grammar: outlined while it waits, filled once sent.

### 2.7 Model picker

| | argues | costs |
|---|---|---|
| **A Chip** (today) | The model's name is always there, and opens the model, effort, mode, folder and branch. | One word on screen that changes perhaps once a week. |
| **B On approach** | The same chip, there only while the pointer is over the composer or the caret is in it. | It cannot be seen without moving; a person glancing at the window does not know the model. |
| **C Spelled out** | Model, effort and mode, all three, at rest. | Three words where A had one: the direction the owner is leaving. Shown as the far pole. |
| **D Behind the plus** | The composer has one menu, not two: attach, then the model's rows. | A click to learn the model; attaching and choosing a model are unrelated acts under one glyph. |

**Pick: B.** At rest the composer then holds a field and one button. D is the cleaner drawing and the worse menu.

### 2.8 Context mark

| | argues | costs |
|---|---|---|
| **A Ring** (today) | A 17 px ring, always; its number in a tooltip. | At 41 % it says nothing a person acts on, and it is the kind of small gauge the owner named. |
| **B Away** | Under a threshold (80 % is proposed) there is no mark; the number is a row of the model's menu. Near full, the ring returns by itself, and is seen because it is new. | A rule to explain once. The board can only show its quiet state: the fixture is at 41 %. |
| **C On the chip** | The ring takes the chevron's place on the model chip: one control for "the model and how full it is". | Still a gauge at rest; and it goes with 2.7 A or C only. |
| **D Number** | "41%" as text, for people who think in numbers. | A number is more to read than a ring, and it is one more word. |

**Pick: B.** It is "nothing unnecessarily adds stuff to screen" stated as a rule.

### 2.9 Send and stop

Four states are switched at the top right: running, running with text typed, idle, idle with text typed.

| | argues | costs |
|---|---|---|
| **A One solid button** (today) | One round button: stop while a turn runs, send once there is text. | With text typed during a turn it is send, and there is no stop on screen. Solid ink is the heaviest thing in the composer, for the least wanted action. |
| **B Hollow stop** | The same one button, but stop is a ring: it is not what the composer is for. Send is solid. | The same missing stop while typing during a turn. |
| **C Two buttons** | Send is always the round button; while a turn runs, a small quiet square stands beside it. Both acts are there whenever both are possible. | One more control while a turn runs. |

**Pick: C.** It is the only one with no state in which a person cannot stop the agent.

### 2.10 Usage mark

| | argues | costs |
|---|---|---|
| **A Two rings** (today) | Both limits at once, nested; the numbers one click away. | Two arcs at 18 px are read as "a gauge", not as two quantities; which ring is which has to be learned. |
| **B One drop** | One round glass that fills: the limit that will bite first, and only that. The popover has both, each as its own drop. | The other limit is a click away. Full means "used up", which has to be read once. |
| **C Time left** | One fact in words, the one a person acts on: when the five-hour window resets. No level is drawn. | Words, where the rest of the pane's foot is glyphs; it does not warn that a limit is near. |

**Pick: B.** One soft shape in place of two hard ones, with the same meaning at a glance (how close am I).

### 2.11 Pane collapse

| | argues | costs |
|---|---|---|
| **A Slides away** (today) | The pane has a place: it leaves to the left in one move of 460 ms and the main space goes with it. | The runtime re-measures a 272 by 884 surface on every frame of the move. |
| **B Folds to a rail** | Collapsed, the pane keeps what matters about the sessions: one glyph for each that is not idle, and usage. | 60 px stay taken, and the glyphs can be counted but not told apart without a hover. The waiting capsule at the top right already says who needs you. |
| **C Melts into its button** | Glass does not travel: the pane dematerialises where it stands while its content draws toward the toggle, then the main space takes the room; returning is the reverse. | Two beats (200 ms, then 460 ms) where A has one; it does not say where the pane went. |

**Pick: A,** held loosely: motion was judged here from held frames and traces, not watched. C is the one to prefer
if the slide proves heavy in the real renderer, since nothing large moves in it.

### 2.12 Menu motion

All four open the same menu from the same chip. A, B and C are the CSS platter Layers uses for a menu whose control
stands on glass; D is the library's own.

| | argues | costs |
|---|---|---|
| **A Grows from its corner** (today) | 210 ms in from the corner nearest its control (scale 0.95, 5 px, a fade), 130 ms out. | It fades, which glass should not; it is the motion every popover has. |
| **B Unrolls** | It is let down from the control's edge by its height over 320 ms and its rows follow 25 ms apart; it rolls back in 190 ms. | The longest of the four, on the most frequent interaction. |
| **C Becomes the menu** | The control's own box grows into the menu on a light spring (420 ms) and shrinks back into it (240 ms): nothing appears from nowhere. | The open menu covers its control, so it closes by a press outside or Escape, not by pressing the control again. |
| **D Glass** | A platter of real glass that materialises beside its control (the library's `GlassMenu`). | Only where the control is not itself on glass, or is its own glass: the library refuses glass on glass, so it cannot open from a chip inside the composer in the app. It is shown from a fill on a block. |

**Pick: A** for menus that open from a control on glass (they are frequent, and it is the quickest), and **D**
wherever the control stands alone (the waiting capsule's list, a settings select, which already uses it). C is the
one to revisit for value pickers.

### 2.13 Ground

One window painted in bands: the same slice of Paper's picture on each ground, with the same prose, caption and
glass bubble in each, and the pane crossing all of them. Measured on the page (§5): the glass draws the same body
on every dark ground (level 0.22), so what a ground changes is how far the glass stands from it.

| dark | glass against the ground under it | reads as |
|---|---|---|
| **A `#181614`** Paper's own | 1.34:1 | warm, the paper's shadow still visible on the floor |
| **B `#191919`** | 1.32:1 | the same depth with the warmth taken out; next to the warm ink it is faintly cool |
| **C `#191c19`** | 1.29:1 | a green cast, which Paper has no other green to answer |
| **D `#1f1f1f`** | 1.25:1 | lifted: the least distance between ground and glass, and the least contrast under prose |
| **E `#000000`** | 1.59:1 | glass stands out most; the floor is gone, so the picture's shadows and the blocks' own have nothing to fall on |

**Pick: A.** Shadow is one of the colouring's four materials and black removes it. Of the owner's four, B is the
nearest to it (they differ by three levels of blue) and E is the one that does the glass the most good.

In the light scheme the page shows three: Paper's ivory `#e8e1db` (glass 1.14:1 against it), `#faf9f5` (1.04:1)
and `#ffffff` (1.02:1). It is Layers' finding (its section 12.2) in one picture: on white a glass block is its
shadow and nothing else.

### 2.14 A question (found; drawn on a second pass)

A session waits on a question: one or several, each with a few options (a short label and a sentence), some of them
"any of these", and always the option of answering in one's own words. It is a "needs you" state, as the approval
is, and the owner already chose how the approval is found and answered: the waiting capsule at the top right opens
a list in which it is answered in place, and the waiting row in the pane opens the same card. So each variant is
also a statement about that capsule.

| | argues | costs | beside the approval |
|---|---|---|---|
| **A A line in the list** (today) | What Layers implies: the capsule's list shows the session's one line, "Which events should retry?". | Nothing can be answered anywhere. The list says a question waits and stops there. | Found exactly as the approval is; not answered as it is. |
| **B In the card** | A question is answered where the approval is: the list's item opens into the questions, each with its options as chips (labels only, the sentence on hover; squarer chips for "any of these", round ones for "one of these"; a chosen chip takes a ring of the ink and keeps its width), a field for "Something else", and Send. No visit to the session. | A form in a 348 px platter. The sentences that explain an option are a hover away, and the agent's reasoning above the question is a visit away. | The same place and the same gesture. The approval's card has two buttons; this one has five chips, a field and a button. |
| **C In the composer** | Answering is replying, so the composer asks: one question at a time over the field, its options as chips, dots for how many. Typing is the "other" answer, which therefore needs no control of its own. Send goes to the next question, then sends. | One question in sight at a time; the sentences are a hover away. | The capsule and the row find it (A's line); the session answers it, with its transcript in view. One click more than the approval. |
| **D A form in the transcript** | Everything in sight: every option a row with its sentence under its label, a square for "any of these", a circle for "one of these", the field, Send. The last block of the transcript. | The largest block the transcript has, all words, and it scrolls away with the transcript. | As C, and it has to be scrolled to. |

**Pick: C,** with B as its remote: they are one component (chips, a field, Send) shown in two places, as the
approval's two buttons are, so a short question can be answered from anywhere and any question in its session. D is
the fallback for the question whose options cannot be told apart without their sentences.

### 2.15 A plan (found; drawn on a second pass)

A session waits with a plan: a document (here two paragraphs and five steps) that the agent wants approved before
it acts. The person approves it, or sends it back with a comment.

| | argues | costs | beside the approval |
|---|---|---|---|
| **A A line in the list** (today) | What Layers implies: "Plan is ready for review". | Nothing to read and nothing to approve. | Found as the approval is; not answered. |
| **B In the card** | The steps are the part of a plan a person scans, so the card holds the steps and two buttons, Send back and Approve; Send back opens one field for the reason, in place. | It invites approving a plan whose paragraphs were never on screen. | The approval's card exactly: what will happen, then two answers. |
| **C Prose, and the composer** | A plan is the agent's own prose, and Layers reads prose on the field, never on glass: a heading line, the paragraphs, a numbered list. The decision is the composer's one action: Approve while the field is empty; type, and the same button is Send back, with what was typed as the reason. | Approve lives in the composer, where a person does not expect a decision the first time. Nothing marks the plan as a thing apart from the answer above it but its heading. | The capsule and the row find it; the session decides it. |
| **D A document in the transcript** | The plan is an object: a sheet of glass with its heading, paragraphs, steps and its own two buttons. | Prose on glass, which Layers keeps off glass everywhere else, and its largest block. A second place where buttons live. | As C, and it has to be scrolled to. |

**Pick: C.** It adds no component: the plan is read where everything the agent writes is read, and sent back the
way anything is said to the agent. B is its remote for a plan already read. Taken together with 2.14 the rule is
one sentence: what a session waits on is answered in its composer, and the capsule's card is the same answer from
elsewhere. The approval the owner chose is the second half of that sentence already; the first half would give it
an Approve in the composer of its own session, which no round has drawn.

## 3. Found, and not found

Put on the board though not on the list: **thinking** (2.2) and **agents started** (2.5). Both are transcript
items in the fixtures that Layers draws and nobody judged.

Found, and at first not drawable: a session that **asked a question** and one whose **plan is ready** are states
in the fixtures with one line each and nothing to answer. No round had drawn how either is answered. Content for
both was then added to the fixtures (two questions with their options; a plan of two paragraphs and five steps,
and a comment a person might send back), and they are parts 2.14 and 2.15.

Left out on purpose: tooltips, the row's hover card, the state glyphs and the tabs (chosen with Quiet's content and
Instrument's capsule); the side column's contents (the owner: the app's own will be used).

## 4. Material: the record

```
register, plane, thickness, shadows: Layers' (its section 4), unchanged. Paper colouring, Field strength Full.
roots: one, viewport-attached (Layers has two). A board page does not scroll at 1440 by 900, so the second,
  container-attached root is not mounted; where a page does scroll (Opened, a smaller window, Together) the blocks'
  glass is re-placed from their boxes on each scroll event and cut by hand to the scroller's box, or on Together to
  the band in which content is at full strength. So on Together a block leaving the band is a card that shortens,
  where in Layers its glass thins with its words: the one place the board's material is not Layers' own.
groups: xl-pane (the index); xl-lead (the sidebar toggle, present while the pane is away); xc-blocks (every
  block on the page); one more while the library's menu is open on the menu page.
surfaces at rest: the pane, and two to five blocks.
```

| surface | path |
|---|---|
| the pane, the sidebar toggle | library glass, the host is the element (Layers' own) |
| every block of a variant: bubbles, diff and command cards, the capsule, the composers, the pane-foot pieces, the menu page's strips, the question's form and the plan's sheet | library glass, a decorative surface under an element in flow, through Layers' `GlassLayer` |
| menus and popovers opened from a variant (model, usage, agents), and the capsule's list as it stands on the two "needs you" pages | Layers' CSS platter, standing in the page instead of in a portal |
| menu D | library glass platter (`GlassMenu`) |
| the wash (2.1 B), chips (2.5 B), the dashed message (2.6 B), tags, the small drawings of the window | CSS fills on the field; no blur except the tags' |

A composer in the app is a glass host whose ink is the runtime's; here it stands on a decorative surface so that
four can share a page, and takes the page's ink, as a transcript block does. The two inks are within a few levels
of each other and every line was measured where it stands.

What the runtime reported (`dev=1`, 1440 by 900): every group `webgpu`, refraction `true`, analysis `exact`, health
`ok`, and no diagnostic on any page at rest, opened, scrolled, with the pane as a rail, or melted (36 routes in the
last sweep, both schemes). One was met and
removed: a melted pane left standing where blocks then came to stand (`same-plane-overlap`), so once it has
dematerialised it steps out of the window without a slide.

## 5. Legibility, measured

Layers' own `measure.mjs` (every line of text and every icon against the pixels behind it; floors 4.5 for text, 3
for icons) was run on every page in both schemes, at rest and opened, on the send page's four states, on Together
(today's letters and the suggested ones), on the rail, and on six pages over other dark grounds: 66 routes, 4,401
gated readings, none under its floor (run on the merged lab, after Layers gained its five switches).

| | light | dark |
|---|---|---|
| lowest text | 4.69: a count on the field (2.3 B, opened), where the picture's paper is in shadow | 4.74: the capsule's clock (2.4 C) on `#1f1f1f`, on Together |
| lowest text on Paper's own ground | the same | 4.93: a row of the library's menu (2.12 D) |
| lowest icon | 3.09: the caret in the pane-foot piece (Layers' own mark, at its own 70 %) | 3.43: the same |
| glass and platter bodies, drawn level | 0.82 to 1.00 | 0.09 to 0.29 |

No body is in the band where neither ink holds (0.39 to 0.49). On the two "needs you" pages the lowest lines are
5.05 in light (prose on the field) and 5.25 in dark (an option's sentence on the form), 4.97 on `#1f1f1f`.

Two things were changed by it. A count that stands on the field (2.3 B and C) read 3.71 in light where the picture's
paper is in shadow, because Layers' green was chosen for glass; on the field it takes a deeper step (`#135a36`, and
`#92281a` for removed) and reads 4.69 at the same place. And the board keeps no disabled control at a reduced
opacity.

Not measured: text that appears only on hover, frames during a transition, the receded pose, Reduce Transparency,
forced colours.

## 6. What it takes from Layers

Imported, and never edited: `layers.css` (the root carries Layers' class, so every token and every `xl-` rule
applies), `colour.ts` (`colouringOf`), `paint.ts` (`paintField`), `paper.ts` (`paintPaper`, for the ground bands),
`glass.tsx` (`GlassLayer`, `useGlassUnder`, `useKick`, `PLANE`, `THICKNESS`), `parts.tsx` (`cx`, `Fold`, `GBtn`,
`Ring`, `StateGlyph`, `RootCtx`, `usePresence`, `clock`, `split`). Layers' `measure.mjs` is run against this build as
it is. Nothing from `Layers.tsx`, `Session.tsx`,
`Sidebar.tsx` or `Settings.tsx`: every A is their markup written again here, so the board does not move when
those files gain switches. It does depend on the names of Layers' classes; a renamed class would un-style an A.

## 7. What could not be shown well

- **Motion in a still.** The captures of the two motion pages are single frames. The pages themselves are the
  record.
- **The pane's collapse at true size, three at once.** Shown as drawings together and on the real pane one at a
  time.
- **The context mark returning near full** (2.8 B) and a usage mark near its limit: the fixtures hold one value
  each, and a second value would be invented content.
- **A removed line** in the diff: the fixture's edit only adds.
- **A question and a plan in their own sessions.** The fixtures hold one transcript, another session's, so C and D of
  2.14 and 2.15 stand without the transcript they would end, and neither is on Together (that session is running,
  not waiting). The capsule itself is not drawn above the cards of A and B. After an answer the board shows one
  mark and one word where the buttons were; what the transcript keeps of an answered question was not designed.
- **Menu D from the composer**: the library does not put glass on glass, so it opens from a fill on a block.

## To ship this in the app

Per pick, against "The app today" in the brief; each is small beside the two glass roots Layers already asks for.

- **Message as a tint, queued message as its outline**: one bubble component with three states (waiting, sent,
  and today's plain one), no glass registration for messages.
- **Thinking folded in**: the transcript's grouping has to attach a thought to the run that follows it; a thought
  with no run keeps a line.
- **Diff as code only**: the edit row loses its head; its file becomes a caption row of the kind tool runs use.
  The highlighter's own added and removed marks have to become the bar.
- **Running command as a capsule**: a surface whose box animates between two measured widths; the virtualised
  list has to re-measure the row when it opens.
- **Agents as chips**: the line is fed by agent state, not by the start event alone.
- **Model on approach, context away**: two rules of visibility on existing controls, and a threshold setting.
- **Two buttons**: stop and send stop sharing one element.
- **One drop**: a new glyph; the popover is unchanged.
- **Counts on the field** need the deeper green and red in light (§5).
- **A question and a plan in the composer**: the composer takes a state per waiting kind (a strip of chips with
  steps; an action that is Approve or Send back), fed by the same data as the capsule's card, and the card takes
  the same chips. The plan itself is ordinary assistant prose with a heading.
