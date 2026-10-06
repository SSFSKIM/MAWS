// The bridge script (E2 execution document, Design §10): MAWS's own script, which the `maws-deliverable:` handler puts
// as the first element of every artifact's HTML it serves (`protocol.ts`, `insertBridgeScript`), so it runs before the
// artifact's own scripts, inline under the artifact's policy. The frame is an opaque origin, so whatever needs the
// page's cooperation (M6's element picker for comment mode) happens here. A delivered HTML file never carries it.
// M3 lays the seam: the script's place in the page; M6 writes the picker into this string.
export const BRIDGE_SCRIPT = '"use strict";';
