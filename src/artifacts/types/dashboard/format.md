# Dashboard: format reference

A document whose chart and table blocks draw datasets: data files you bound, each view labelled with its source and snapshot time.

## Structure

A dashboard is a document (the document format reference holds for its tabs, blocks, ids, comments and edits) plus its datasets. A dataset is a named, immutable snapshot of one CSV, TSV or JSON file, bound with `artifact_dataset`; its id is 1 to 64 letters, digits, `_` or `-`. A view is a chart block whose fence body is the dataset id and whose `spec-json` is the view spec:

```text
:::chart {spec-json='{"view":"bar","x":"region","y":"total","title":"Sales by region"}'}
sales
:::
```

The spec is a JSON object in single quotes; inside it write `&#39;` for an apostrophe, `&amp;` for `&`, `&lt;` and `&gt;` for `<` and `>`. A table bound to data is a chart block with `"view":"table"`, not a markdown table: a markdown table is text you write, a table view shows the data.

Every view draws the snapshot its dataset's descriptor names at the version shown, under a source label: the dataset's title, `from <file>`, `updated <time> by <who>` (times in UTC). Rebinding the id to a new file redraws every view that names it; the prose and comments around them stay. A view whose dataset or column is missing draws the reason in place and keeps its caption, comments and block id.

A live dataset's source is a query: a read-only MCP tool (`server · tool` in its label) whose JSON result is a flat-object array, or an object with a `rows` array, read as a JSON file is. Its label says `not fetched` until the first refresh, then the fetch time; a refresh that fails keeps the previous rows and shows the error; `staleAfter` past the fetch time adds `stale since <time>`; with no live session that has the server it shows `paused: no live session`. Only the owner grants the tool. Each refresh is a new immutable snapshot; history keeps what its versions show, and live refresh keeps the latest two snapshots beyond those.

`artifact_read` lists the datasets after the blocks (`datasets`: id, title, file, columns with types, rows, rowKey, updated, state) and, when a spec has a problem, `viewWarnings` per block id.

## Elements and attributes

**Data files.** CSV and TSV: a header row of unique, non-empty names, then one record per row (RFC 4180 quoting: a field in double quotes may hold the delimiter, line breaks and `""`); UTF-8, an optional BOM. JSON: an array of flat objects; a key missing from a record is an empty cell. An empty cell is null. A column's type (`number`, `date`, `boolean`, `string`, `null`) is inferred from all of its non-empty values: numbers are finite and strictly written (`007` stays text), dates ISO (`2026-10-16`, or a date-time with a zone such as `2026-10-16T09:30:00Z`). Values that do not fit their column's type are kept as written and counted in the answer and under the views (`2 of 40 values in total are not number`). `rowKey` names a column whose values are unique and non-empty.

**View spec.** Every key but `view` is optional; a key the grammar does not know, or a value it refuses, is dropped and reported (`viewWarnings`, and a note under the view).

| Key | Value |
|---|---|
| `view` | `bar`, `line`, `area`, `scatter`, `pie` or `table` |
| `x` | the column along the x axis, or a pie's slices |
| `y` | a column, or a list of up to 8, drawn as numbers; a pie takes exactly one, its sizes |
| `series` | a column whose values split the rows into series |
| `agg` | `sum`, `mean`, `count`, `min` or `max`: groups the rows by `x` (and `series`) and aggregates each `y`; `count` counts rows and needs no `y` |
| `filter` | a list of `{"column", "op", "value"}`, every one kept: `op` is `eq`, `ne`, `lt`, `gt`, or `in` with a list of up to 256 values; the number `1` and the text `"1"` are different values |
| `sort` | `{"by": <column>, "dir": "asc" or "desc"}`, applied after aggregating |
| `limit` | keeps the first n rows, last |
| `columns` | a table's columns, in order |
| `format` | per column: `number`, `percent` (0.25 shows `25%`), `date` or `text` (a year column as `text` reads `2024`, not `2,024`) |
| `title` | the caption above the view; without it, `Bar chart of sales` |

The rows are filtered, then grouped and aggregated (only with `agg`; without it every row is drawn), sorted, then limited. After aggregating, a measure is named by its `y`, `count` for the counted rows. A bar, line, area or scatter needs `x` and `y`; a pie needs `x` and `y` or `agg: "count"`. A row without a number to draw is left out and counted under the view, never drawn as 0. Up to six series are told apart by line dashes, marker shapes and fills, with a legend; more draw as small multiples, one labelled panel per series, up to 24. Without `agg`, the bars of rows that repeat a category in one series stand side by side in that series' place, in the rows' order, each with its own value; `agg` combines them into one. A pie draws at most six slices: past six it says `<n> slices; the five largest are shown individually and the rest are drawn as one`.

A table view shows its first 25 rows, or `limit` rows up to 100, and says `first 25 of 140 rows` when there are more. The source sheet the user opens from a label shows every row, raw and transformed.

**States** drawn in place: `no dataset "<id>"`, `dataset "<id>" has no column "<name>"`, `unknown view "<kind>"`, `a bar view needs a y column`, `the file of "<id>" could not be read`, `too many series: <n>; filter or aggregate`, `<column> has a numeric range that cannot be drawn`.

## Limits

- A dataset file is at most 16,777,216 bytes (16 MiB), 200,000 rows and 256 columns; a column name at most 256 characters.
- A dashboard holds at most 64 datasets.
- A query's `schedule` is 30 to 86,400 seconds (absent: refreshed only when asked); `staleAfter` a positive whole number of seconds; its `args` at most 65,536 bytes of JSON.
- A view spec: a `title` of at most 200 characters, up to 8 `y` columns, up to 256 values in an `in` filter, `limit` up to 200,000.
- A table view shows at most 100 rows; exports show the same rows.
- Everything in the document format reference's limits holds for a dashboard's tabs and edits.

## Examples

A data file, `sales.csv`, in the working directory:

```csv
region,quarter,total
North,2026-Q1,120
South,2026-Q1,98
North,2026-Q2,135
South,2026-Q2,104
```

A dashboard's content, as `artifact_create` takes it:

```markdown
# Sales review

Totals by region for the first half.

:::chart {spec-json='{"view":"bar","x":"region","y":"total","agg":"sum","sort":{"by":"total","dir":"desc"},"title":"Total sales by region"}'}
sales
:::

:::chart {spec-json='{"view":"line","x":"quarter","y":"total","series":"region","title":"Sales by quarter"}'}
sales
:::

:::chart {spec-json='{"view":"table","columns":["quarter","region","total"],"sort":{"by":"quarter","dir":"asc"},"title":"All sales"}'}
sales
:::
```

The binding, after the create (with `handle: "sales-review"`) answered revision 1:

```json
{"artifact": "sales-review", "baseRevision": 1, "id": "sales", "path": "sales.csv", "title": "Sales"}
```

It answers the columns (`region` string, `quarter` string, `total` number), `rows: 4` and the new revision. Adding `"rowKey": "quarter"` would be refused, nothing written: `quarter` repeats.
