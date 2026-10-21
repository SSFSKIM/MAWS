// A clock time as the app writes it (L129: every time the renderer shows goes through `formatClock`), in the one display
// locale whatever the machine's (`@shared/app/date-format`, English throughout, P4 Decision Log 4): 2:02 PM, with ICU's
// narrow no-break space before the day period.
export const CLOCK = String.raw`\d{1,2}:\d{2}\s[AP]M`;
