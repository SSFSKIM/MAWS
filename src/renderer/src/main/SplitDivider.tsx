// The divider between the two panes (residue *Split*): M2's `Resizer` over `splitRatio`, kept between 25 % and 75 %
// of the main region. The resizer works in pixels, so the ratio is scaled by the region's width; before the region
// has a width (a first render, a test) a nominal 1000 px stands in.
import { Resizer } from '../app/Resizer';
import { useLayout } from '../stores/layout';
import { paneDomId } from './Pane';

const NOMINAL_WIDTH = 1000;

export function SplitDivider({ width }: { width: number }) {
  const ratio = useLayout((s) => s.main.splitRatio);
  const w = width > 0 ? width : NOMINAL_WIDTH;
  return (
    <div className="relative w-px shrink-0 bg-border">
      <Resizer
        label="Resize panes"
        controls={paneDomId(0)}
        value={Math.round(ratio * w)}
        min={Math.ceil(0.25 * w)}
        max={Math.floor(0.75 * w)}
        defaultValue={Math.round(0.5 * w)}
        onChange={(px) => useLayout.getState().setSplitRatio(px / w)}
        className="absolute inset-y-0 -left-0.75"
      />
    </div>
  );
}
