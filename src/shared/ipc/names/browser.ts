// X2 `browser.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/browser.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
export const commands = [
  'browser.tabs.list', 'browser.tabs.open', 'browser.tabs.close', 'browser.tabs.select', 'browser.tabs.navigate', 'browser.tabs.zoom',
  'browser.tabs.find', 'browser.tabs.dismiss', 'browser.tabs.devtools', 'browser.tabs.revealDownload', 'browser.view.place',
  'browser.view.cover', 'browser.control.handBack', 'browser.history.suggest', 'browser.profiles.list',
] as const;

export const events = [
  'browser.tabs.changed', 'browser.view.covered', 'browser.control.changed', 'browser.chrome.command', 'browser.download.refused', 'browser.notice',
] as const;
