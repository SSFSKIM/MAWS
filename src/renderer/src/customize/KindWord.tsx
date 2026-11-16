// The word that ends a row of My items, All (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// §E): "Plugin", "Mod", "Skill" or "Connector", in one cell whose width is the widest word's, so that the words of every
// kind stand in one column. It goes before a row's last control (a plugin's menu, a mod's switch); a skill's and a
// connector's row, which have no such control, end in it and then in `NoLastControl`, an empty cell of that control's
// width. The cell's width comes from the widest word drawn invisibly, with no height, under the row's own word (an
// invisible generated text is neither read aloud nor part of the row's text).
import type { ItemKind } from './image/tile';
import { PAGE } from './copy';

export function KindWord({ kind }: { kind: ItemKind }) {
  return (
    <span data-kind-word={kind} className="inline-flex shrink-0 flex-col text-ui-sm text-fg-muted after:invisible after:h-0 after:overflow-hidden after:content-['Connector']">
      {PAGE.kindWord[kind]}
    </span>
  );
}

/** The width of a row's last control (a plugin's menu, a mod's switch: 1.75rem), held where a row has none. */
export function NoLastControl() {
  return <span aria-hidden="true" className="w-7 shrink-0" />;
}
