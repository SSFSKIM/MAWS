// The action ids build F knows (`f1852de3a`, the build before the UX wave; the wave's root, UC-14; its U6 file, UC-6
// "Stored rebindings"). F's reader of `settings.json` is closed over these: one other id under `keymap` fails its whole
// read of the client settings, so it shows the defaults and refuses every write of them. While F may still run on the
// same profile the stored keymap's keys are these ids (`SettingsSchema` in `../ipc/schema/settings.ts`), and a row whose
// id is not among them takes no rebinding (`isRebindable` in `./actions.ts`). A literal list, in F's table order, never
// derived from `ACTIONS`, which grows with every row the wave adds. Delete this file, and the rule with it, when F is no
// longer a build to go back to (the owner's word).
import type { ActionId } from './actions';

export const BUILD_F_ACTION_IDS = [
  'session.new', 'tab.close', 'tab.reopen', 'tab.overview', 'artifacts.open', 'tab.select', 'tab.next', 'tab.previous',
  'tab.stripNext', 'tab.stripPrevious', 'region.focusNext', 'region.focusPrevious', 'sidebar.focus', 'pane.split',
  'pane.focusOther', 'sidebar.toggle', 'panel.toggle', 'surface.terminal', 'surface.review', 'surface.browser',
  'surface.files', 'surface.source-control', 'surface.subagents', 'surface.background', 'surface.session-info',
  'surface.ask-sheet', 'panel.maximize', 'panel.float', 'main.expandArtifactPane', 'artifact.moveToPanel',
  'artifact.moveToTab', 'theme.light', 'theme.dark', 'theme.system', 'palette.open', 'session.previous',
  'session.next', 'session.markUnread', 'attention.next', 'shortcuts.open', 'diagnostics.open', 'request.accept',
  'request.decline', 'composer.send', 'composer.cycleMode', 'composer.stop', 'composer.focus', 'settings.open',
  'accounts.open', 'gateway.openClaudeUsage', 'composer.dictate', 'file.save', 'file.commentLine', 'transcript.toggleReport',
  'markup.start', 'comments.expand', 'comments.minimize', 'comments.hide',
] as const satisfies readonly [ActionId, ...ActionId[]];
