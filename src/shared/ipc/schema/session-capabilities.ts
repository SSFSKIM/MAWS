// A session's agent capabilities on its machine (P5 O5 M5; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces
// §I; acceptance 9): per tool name, whether the session's agent has it there and, when not, why in a sentence the
// renderer and O7's remote rows show as written. `mawsd` answers `session.capabilities` cold (no spine) from its render
// seam's state and its cua sockets' (`artifact_screenshot`, `artifact_export`, `browser`), and posts
// `session.capabilitiesChanged` to every ready client and the endpoint at each flip. Keyed by any string, as lane A's
// control capabilities are (`ControlCapabilitySchema`): a key a sibling adds (O4's) is kept, never refused. P5 O17 M5:
// the browser entry's `viewed` (`local`, in the app's pane; `screencast`, the render host's headless browser), which the
// loose entry keeps.
import type * as z from 'zod';
import { ControlCapabilitiesSchema, ControlCapabilitySchema } from './lane-a';

export const SessionCapabilitySchema = ControlCapabilitySchema;
export const SessionCapabilitiesSchema = ControlCapabilitiesSchema;
export type SessionCapability = z.infer<typeof SessionCapabilitySchema>;
export type SessionCapabilities = z.infer<typeof SessionCapabilitiesSchema>;

// The tool names `mawsd` reports today (O4 adds its own keys)
export const SESSION_CAPABILITY_TOOLS = ['artifact_screenshot', 'artifact_export', 'browser'] as const;
