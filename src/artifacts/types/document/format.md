# Document: format reference

A rich-text document: headings, lists, tables, images, comments and chips, edited block by block by you and the user together.

## Structure

A document holds one or more tabs; a tab is a sequence of top-level blocks. The user adds, renames and orders tabs; you read one tab at a time and edit any of them.

You read and write a tab as GitHub-flavoured Markdown plus the dialect below. The dialect is lossless: everything the editor can store reads back exactly as it was, so a block you rewrite keeps everything you did not change.

**Block ids.** Every block has an id, shown as `^id`:

- at the end of the line of a one-line block (a paragraph, a heading) and of a list item's first line;
- on its own line after a block of several lines (a list, a quote, a table, code, a callout, math, a diagram);
- as `<!-- ^id -->` at the end of a table row. Cells have no ids of their own: `set_cell` takes the table's id and the cell's row and column, both counted from 0 with the header row as row 0.

Paragraphs, headings and list items inside a quote or a callout show their ids too, as do list items inside a cell; a container nested inside another (a list inside a quote) and a cell's paragraphs do not.

When you write markdown, a `^id` you copy from your read keeps that block (its comments and its authorship stay with it); a block you write without one gets a new id, which the result returns. Never invent ids for new blocks.

**Comments in a read.** An open comment's passage is wrapped in `<c:ID>` and `</c:ID>`, each closing tag naming its thread, so overlapping comments need no nesting. These milestones are only for reading: when you write, leave them out (they are ignored if you copy them). The read ends with a footer after `---` listing the open threads of the range (`c:ID on ^block · "quote" · N messages`) and orphaned ones whose passage was deleted (`c:ID orphaned, near ^block`), and counts the resolved ones and those outside the range.

## Elements and attributes

| Block | Markdown |
|---|---|
| Paragraph | text |
| Heading 1 to 3 | `# `, `## `, `### ` |
| Bulleted list | `- item` |
| Numbered list | `1. item` (one space after the marker) |
| Lettered or roman list | `a.  item`, `A.  item`, `i.  item`, `IV.  item`: two to four spaces after the marker; with one space it is ordinary text (`Dr. Smith`, `A. Lincoln`) |
| Task list | `- [ ] open`, `- [x] done` |
| Quote | `> text` |
| Code | a fenced block with its language, ```` ```ts ````; fenced with more backticks than any run inside |
| Table | GFM when GFM can say all of it, else structure blocks (below) |
| Divider | `---` |
| Callout | `:::callout {tone="note"}` … `:::` with markdown inside; tones `note`, `tip`, `warn`, `danger` |
| Display math | `$$` on its own line, the LaTeX, `$$` on its own line |
| Diagram | `:::diagram` … `:::` around mermaid source |
| Chart | `:::chart {spec="…"}` … `:::` around its source (drawn as a placeholder for now) |
| Placeholder | `:::pending {intent="what will go here"} :::`, a section you mean to fill; replace it with `replace_block` |
| Image | `![alt](https://…)`; an uploaded asset or an address Markdown cannot hold as `<img src="…" alt="…" asset="…"/>` |

Inline: `**bold**`, `*italic*`, `++underline++`, `~~strike~~`, `` `code` ``, `[text](https://… "title")` (an address with spaces or brackets in `<…>`), `==highlight==` or `<mark color="#fde68a">text</mark>`, inline math `$$E = mc^2$$` (or `<math latex="…"/>` for LaTeX that form cannot hold), a line break inside a paragraph as two spaces at the end of the line.

Chips are inline:

- a date: `<chip kind="date" iso="2026-11-02"/>`
- a mention of a person, a session or an artifact: `<chip kind="mention" type="person" ref="owner" label="Owner"/>` (`type` is `person`, `session` or `artifact`)
- a status menu: `<chip kind="dropdown" value="Doing" options='["Todo","Doing","Done"]'/>`

**Tables.** A table is plain GFM when it has a header row, one plain paragraph per cell, no merged cells or widths and one alignment per column. Any other table is written as nested structure blocks, each closed by `:::`: `:::table`, then `:::row <!-- ^id -->` per row, then `:::header` or `:::cell` per cell with the cell's markdown inside and its attributes in braces (`{colspan="2" rowspan="1" colwidth="120,80" align="center"}`). A table is written in one form or the other, never mixed. Read before you rewrite a table: copy its form.

**Escapes.** Text that would read as markup is escaped with a backslash; a space or tab at the edge of formatted text is written `&#32;` or `&#9;`; an empty paragraph holds one no-break space. You only need these when you write such text yourself.

## Limits

- `artifact_edit`: at most 100 ops per batch; `replace_text`'s `old` and `new` and a cell's markdown at most 20,000 characters each; `replace_block`'s and `insert`'s markdown at most 1,000,000 characters, as is `artifact_create`'s `content`.
- Keep a block's text under 20,000 characters: split long passages into paragraphs.
- A tab holds at most 2,000 top-level blocks: a batch, or a create's content, that would leave a tab with more is refused (a tab the user typed past it can still be edited without growing it). Start another document, or ask the user for a new tab.
- A document holds at most 50 tabs; the user adds them.
- `artifact_read` returns 1 to 1,000 top-level blocks per call, 200 by default; read on from the `next` id it returns.
- An image or other asset is at most 16 MiB.

## Examples

A tab as `artifact_read` returns it (two comments overlap on "design review"; one is orphaned):

```markdown
# Launch plan ^h1

The plan ships <c:t1>**quarterly** with <c:t2>design review</c:t1> notes</c:t2>. ^p1

---
Comments: 3 open (1 orphaned)
- c:t1 on ^p1 · "quarterly with design review" · 2 messages
- c:t2 on ^p1 · "design review notes" · 1 message
- c:t3 orphaned, near ^p1 · "ships in March" · 1 message
```

Blocks of several kinds, as you would write them:

```markdown
# Launch plan ^h1

The plan ships **quarterly**. Due <chip kind="date" iso="2026-11-02"/>, owner <chip kind="mention" type="person" ref="owner" label="Owner"/>, status <chip kind="dropdown" value="Doing" options='["Todo","Doing","Done"]'/>. ^p1

- First item ^li1
- Second item ^li2
^ul1

a.  Alpha ^la
b.  Beta ^lb
^ll1

- [ ] Open task ^t1
- [x] Done task ^t2
^tl1

:::callout {tone="warn"}
Check the **budget** first. ^cp1
:::
^co1

:::diagram
graph TD
  A --> B
:::
^d1

:::pending {intent="Write the risks section"} :::
^pe1
```

A table GFM can hold (the header row has an id too):

```markdown
| Name  | Value | <!-- ^r0 -->
| ----- | ----- |
| alpha | 1     | <!-- ^r1 -->
| beta  | 2     | <!-- ^r2 -->
^tb1
```

A table it cannot (a merged header cell, a list in a cell):

```markdown
:::table
:::row <!-- ^r1 -->
:::header {colspan="2"}
Quarter
:::
:::
:::row <!-- ^r2 -->
:::cell
Q1
:::
:::cell
- one ^x1
- two ^x2
:::
:::
:::
^tb2
```

One `artifact_edit` batch: a sentence rewritten by its quote, a section inserted after a heading, a cell set, a placeholder filled, the edit posted as the answer to thread `t1`:

```json
{
  "artifact": "launch-plan",
  "baseRevision": 41,
  "answering": "t1",
  "ops": [
    { "op": "replace_text", "block": "p1", "old": "ships **quarterly**", "new": "ships **every month**" },
    { "op": "insert", "after": "h1", "markdown": "## Goals\n\nShip the beta to 50 teams." },
    { "op": "set_cell", "table": "tb1", "row": 2, "col": 1, "markdown": "3" },
    { "op": "replace_block", "id": "pe1", "markdown": "## Risks\n\nThe vendor may slip." }
  ]
}
```
