// A clock time as the app writes it, on whatever locale the test machine runs (L129: every time the renderer shows goes
// through `formatClock`, the system locale's hour and minute): 14:02, 2:02 PM (with ICU's narrow no-break space), 오후 2:02.
export const CLOCK = String.raw`(?:\S+\s)?\d{1,2}:\d{2}(?:\s\S+)?`;
