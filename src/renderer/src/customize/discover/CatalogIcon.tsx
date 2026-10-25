// A catalog item's icon tile: the directory's icon as main fetched it (data, through the catalog egress rule; the
// renderer fetches nothing, Decision Log 7(b)), else a monogram of the name, which every other icon host also gets.
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { monogramOf } from './present';
import { useCatalogIcon } from './read';

const SIZES = { md: 'size-10 text-ui rounded-md', lg: 'size-14 text-prose rounded-lg' } as const;

// Decision Log 10: an icon is only ever an <img> of image data (never inline SVG, innerHTML or <object>), the one SVG
// context in which a script runs nothing and an external reference loads nothing; any other answer is a monogram.
const IMAGE_DATA = /^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

export function CatalogIcon({ item, size }: { item: CatalogItem; size: keyof typeof SIZES }) {
  const icon = useCatalogIcon(item.iconUrl);
  const data = icon.data && IMAGE_DATA.test(icon.data) ? icon.data : null;
  return (
    <span aria-hidden data-catalog-icon={data ? 'image' : 'monogram'} className={`flex ${SIZES[size]} shrink-0 items-center justify-center overflow-hidden border border-border bg-bg font-medium text-fg-muted`}>
      {data ? <img src={data} alt="" className="size-full object-contain" draggable={false} /> : monogramOf(item.name)}
    </span>
  );
}
