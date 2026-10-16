// The source sheet's Copy (P3-E2 M3): rows as spreadsheet TSV, reversible. A field is written as it is unless it holds a
// tab, a line break or a double quote; then it is quoted with its quotes doubled, as Sheets, Excel and Numbers read it
// back as the same text.
export const tsvField = (text: string): string => (/[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

/** Rows of fields as TSV, one record per line, the last line ended. */
export const toTsv = (rows: readonly (readonly string[])[]): string => rows.map((row) => row.map(tsvField).join('\t')).join('\n') + '\n';
