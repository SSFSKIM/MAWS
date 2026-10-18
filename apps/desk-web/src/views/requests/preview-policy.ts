// The desk's policy for a question option's preview frame. The desktop's frame inherits the app's policy, which loads
// nothing remote; the desk's page sets none, so the frame carries its own: model-written text must never reach the
// network from the browser. Set once, at start (main.tsx), through MAWS's seam.
import { setPreviewPolicy } from '../../../../../src/renderer/src/request-card/preview/SandboxedPreview';

export const DESK_PREVIEW_POLICY = ["default-src 'none'", "style-src 'unsafe-inline'", 'img-src data:'].join('; ');

export function installPreviewPolicy(): void {
  setPreviewPolicy(DESK_PREVIEW_POLICY);
}
