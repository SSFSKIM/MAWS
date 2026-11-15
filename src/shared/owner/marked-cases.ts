// Shared by the suites of the marks' one reading (not a test file itself): invented texts, each with the message spans
// the mod's `parseMarked` reads in it (`to-human/hooks/mods/to-human.tsx` 144, at 0.8.2), worked out by its rules. A
// mark inside a Markdown container (emphasis, a list item, a quote, a table cell) is a span of its own, the
// container's words outside the mark are the record's, and each run of text under one mark is a span. Each span here
// is plain words, so its drawing's text is the span's text.
export const MARKED_CASES: readonly (readonly [name: string, text: string, spans: readonly string[]])[] = [
  ['a paragraph', 'Narration first. <message>For you.</message> Narration after.', ['For you.']],
  ['an emphasis', '**Narration <message>Bold one.</message> narration.**', ['Bold one.']],
  ['a list item, beside another', '- Narration <message>Item one.</message> narration.\n- Narration row.', ['Item one.']],
  ['a quote', '> Narration <message>Quoted.</message> narration.', ['Quoted.']],
  ['a table cell', '| Name | Note |\n| --- | --- |\n| a | Narration <message>In a cell.</message> narration |', ['In a cell.']],
  ['a list inside a quote', '> - Narration <insight>Deep.</insight> narration.', ['Deep.']],
  ['a nested mark', '<message>Outer <insight>Inner.</insight> tail.</message> narration', ['Outer', 'Inner.', 'tail.']],
  ['two adjacent marks', 'Narration <message>First.</message> <message>Second.</message> narration.', ['First.', 'Second.']],
  ['the older mark names', '<to-human>Older.</to-human>\n\n<essential>Must.</essential>\n\nNarration <need-input>Which?</need-input> narration', ['Older.', 'Must.', 'Which?']],
];
