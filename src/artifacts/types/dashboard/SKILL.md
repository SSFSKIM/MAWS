# Dashboard: guide

A document whose chart and table blocks draw datasets: data files you bound, each view labelled with its source and snapshot time.

## When to use this kind

Use a dashboard when the user should see real data drawn: charts and tables over files you wrote or were given, with prose around them that the user may comment on and edit. Its views are drawn by MAWS from a declarative spec, never by your code, and every view says which file and which upload it shows. For prose alone use a `document`; for a page you design with your own scripts and styles, `html`.

## Creating one

1. Write the data as a `.csv`, `.tsv` or `.json` file under your working directory (the format reference says what each may hold).
2. Call `artifact_create` with `kind: "dashboard"`, a `title`, and `content`: markdown in the document's format with a chart block per view (the format reference's `:::chart` form; its fence body is the dataset id you will bind). A handle names it in later calls.
3. Call `artifact_dataset` with the dashboard, the `baseRevision` the create answered, the dataset `id` your blocks name, the file's `path` and a `title`. The host reads and checks the file and binds it in one step; the answer gives the columns with their types, the row count and the new revision. Bind each dataset your blocks name.
4. Read back with `artifact_read`: the `datasets` list shows what is bound, `viewWarnings` what a spec dropped or cannot draw.

Write the views the reader needs, each with a `title` that says what it shows. A view naming a dataset that is not bound yet shows `no dataset "<id>"` until you bind it.

## Reading and editing

Change prose and views with `artifact_edit` as in a document: a view is one block, rewritten whole with `replace_block` (copy its `^id`, keep its fence body) or added with `insert`. A spec key MAWS cannot use is dropped from what it stores and reported in the edit's `viewWarnings`.

Replace a dataset with the same `artifact_dataset` call and a new file: every view naming its id redraws it, a title or description you leave out stays, and the earlier snapshot stays in history. `remove: true` drops the binding; views naming it say so. The call is refused `conflict` only when another session replaced or removed that same dataset since your `baseRevision`: read again and decide. A file that does not parse is refused naming the line and the reason, and nothing is written. A `ref` instead of `path` rebinds a file the dashboard already holds.

Live data comes from a read-only MCP tool instead of a file. Configure it with `artifact_dataset` and `source: {kind: "query", server, tool, args}` (the server and tool as this session's MCP servers name them, `schedule` in seconds to refresh it while the dashboard is shown, `staleAfter` in seconds to mark old rows stale); nothing is called, and its views say `not fetched`. Ask the user to allow the tool from the dashboard's datasets: you cannot grant it. Then `refresh: true` with the dashboard, `baseRevision` and `id` alone fetches it once through your own session's connection to that server. The answer gives the rows' columns and count, or the error the refresh recorded while the earlier rows stay; a refusal says why nothing was fetched (no grant, or no live connection to the server), and a `conflict` that the dataset was replaced or removed meanwhile (read the dashboard again). Configuring the same server, tool and args again with another `schedule`, `staleAfter`, title or description keeps the fetched rows; a changed `rowKey` must key them; another server, tool or args starts it `not fetched`.

Snapshots are immutable: to correct data, write a corrected file and bind it again; never edit numbers into the prose to fix a view. To export the views, `artifact_export` the dashboard as `pdf`, `html`, `docx` or `md`: each view is drawn with its label and snapshot time (Markdown writes each view's data as a table).

## Comments

A comment on a view is a thread on its block, quoting `chart: <caption>` or `table: <caption>` (the dataset id when the view has no title); it follows the block when it moves and is kept, orphaned, if the block is deleted. Answer and resolve it as in a document (`artifact_comments`, `artifact_reply`, `artifact_resolve`, or `answering` on an edit).

## Working with a design system

A dashboard is drawn in its governing design system, figures included: their text, rules and ink come from the system. Do not try to colour a view; series are told apart by form and labelled, so a spec has no colour or style keys.

## Before you finish

Read back once: every dataset your views name is bound, `viewWarnings` is empty or you know why, and no view shows a state such as a missing column. Tell the user which files the views show and when they were bound; refer to the dashboard by its title.
