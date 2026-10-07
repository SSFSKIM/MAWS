// X2 `browser.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/browser.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
export const commands = [
  'browser.tabs.list', 'browser.tabs.open', 'browser.tabs.close', 'browser.tabs.select', 'browser.tabs.navigate', 'browser.tabs.zoom',
  'browser.tabs.find', 'browser.tabs.dismiss', 'browser.tabs.devtools', 'browser.tabs.revealDownload', 'browser.view.place',
  'browser.view.cover', 'browser.control.handBack', 'browser.history.suggest', 'browser.profiles.list',
  // E4d start
  'browser.comment.set',
  // E4d end
  // E4b start
  'browser.import.profiles', 'browser.import.chooseUserData', 'browser.import.inspect', 'browser.import.discard', 'browser.import.start',
  'browser.import.cancel', 'browser.import.list', 'browser.import.remove', 'browser.import.setExtension',
  // E4b end
] as const;

export const events = [
  'browser.tabs.changed', 'browser.view.covered', 'browser.control.changed', 'browser.chrome.command', 'browser.download.refused', 'browser.notice',
  // E4d start
  'browser.comment.changed', 'browser.comment.picked',
  // E4d end
  // E4b start
  'browser.import.progress', 'browser.import.finished', 'browser.import.changed',
  // E4b end
] as const;
