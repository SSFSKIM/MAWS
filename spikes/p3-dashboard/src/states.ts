// P3-E2 M1 spike: the named error and warning wording of the parent's §2 "Error and stale states", as the renderer
// draws them in place. M2 owns the product module (`src/artifacts/dashboard/states.ts`); these strings are its seed.

export const states = {
  noDataset: (id: string) => `no dataset "${id}"`,
  noColumn: (id: string, column: string) => `dataset "${id}" has no column "${column}"`,
  notType: (n: number, rows: number, column: string, type: string) => `${n} of ${rows} values in ${column} are not ${type}`,
  unreadable: (id: string) => `the file of "${id}" could not be read`,
  missing: (n: number, column: string) => `${n} ${n === 1 ? 'row has' : 'rows have'} no ${column}; not drawn`,
  needs: (view: string, what: string) => `a ${view} view needs ${what}`,
  empty: 'no rows to draw',
  seriesCap: (shown: number, total: number) => `${total} series; the first ${shown} are drawn`,
};
