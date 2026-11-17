// UX wave U6b-3a: a folder cut at its start (stub: the cases come first).
export type Measure = (text: string) => number;
type RawMeasure = (font: string, text: string) => number;
let raw: RawMeasure = () => 0;
export function folderFromEnd(folder: string, _room: number, _measure: Measure): string | null {
  return folder;
}
export function measureIn(font: string): Measure {
  return (text) => raw(font, text);
}
export function measureWith(next: RawMeasure | null): void {
  raw = next ?? (() => 0);
}
