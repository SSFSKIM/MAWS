// cua board #90: the extensions action bar (its spec's "The extensions action bar"; Interfaces "Extensions"). Each
// extension loaded in an imported profile's partition is one action in the navigation row: its icon (the manifest's
// action or browser_action `default_icon`, else its `icons`, read by main as a data URL), its title as the tooltip,
// whether it has a popup MAWS can host and an options page MAWS can open as a tab. The list is per partition, in
// Settings' order of the profile's extensions, recomputed on every load and unload and never persisted. Every string
// here is the extension's own and is shown as text; the icon only as an image.
import * as z from 'zod';
import { ExtensionIdSchema, IMPORT_NAME_MAX } from './import';

export const EXTENSION_ICON_SIZE = 32; // px: the icon picked is the largest at or under this
export const EXTENSION_ICON_MAX_BYTES = 256 * 1024; // an icon file larger than this is no icon
const ICON_DATA_URL_MAX = 64 + Math.ceil(EXTENSION_ICON_MAX_BYTES / 3) * 4;
// The popup's size, as Chrome bounds it (and electron-chrome-extensions after it): what `preferred-size-changed` asks,
// clamped.
export const EXTENSION_POPUP_MIN = { width: 25, height: 25 } as const;
export const EXTENSION_POPUP_MAX = { width: 800, height: 600 } as const;
// The action icons fold into the puzzle button when they would leave the address field narrower than this.
export const ACTIONS_FOLD_ADDRESS_MIN_PX = 160;

export const ExtensionActionSchema = z.strictObject({
  extensionId: ExtensionIdSchema,
  name: z.string().max(IMPORT_NAME_MAX), // the extension's name as Settings lists it
  title: z.string().max(IMPORT_NAME_MAX), // the action's `default_title`, else the name
  icon: z.string().startsWith('data:image/').max(ICON_DATA_URL_MAX).nullable(), // null: the generic puzzle piece
  hasPopup: z.boolean(), // a `default_popup` MAWS hosts under the icon; false: the button is present but inert
  hasOptions: z.boolean(), // `options_ui.page` or `options_page`, opened as an internal tab
});
export type ExtensionAction = z.infer<typeof ExtensionActionSchema>;

// The title an extension's options tab shows, in its tab and in its address field.
export const optionsTabTitle = (name: string): string => `${name} · Options`;
