# The mods review (2026-10-03)

Panel review-code at level xhigh (finders sol/high, verifier sol/high: sweep plus five lens scalpels, one binding verifier) over the mods surface as one whole: the diff between master 90e4978b with the five mods landings (R0 ce90983a, R1 bf5f0d06, R2 5024214b, R3 c0c9d159, M1 fa9e0ee2) reverted (scratch repo /tmp/maws-review/mods2, base f4eba61f) and master itself: 144 files, 8,269 insertions, 601 deletions; docs, fixtures and snapshots kept out. Lenses: protocol fidelity, renderer safety, lifecycle and races, transcript integration, tests and fixtures honesty. Pool: 18 candidates from six lanes; verdict `incorrect`; 15 confirmed, all P2; none dismissed, none to the tracker (every one is a behaviour a mod or the owner would hit).

| id | file:lines | finding | wave |
|---|---|---|---|
| scalpel-1#1 | `src/renderer/src/engine-surface/actions.ts:38-39` | Apply the element returned by the focus round trip | FX1 |
| scalpel-1#2 | `src/renderer/src/engine-surface/SurfaceSite.tsx:90-96` | Report keyed element geometry for plugin scroll targets | FX1 |
| scalpel-1#4 | `src/renderer/src/engine-surface/SurfaceTree.tsx:173-181` | Honor autofocus when a plugin site takes the keyboard | FX1 |
| scalpel-1#5 | `src/renderer/src/engine-surface/SurfaceSite.tsx:113-116` | Avoid echoing plugin focus pushes as person gestures | FX1 |
| scalpel-1#6 | `src/renderer/src/engine-surface/SurfaceSite.tsx:94-96` | Apply scroll answers from layout reports too | FX1 |
| scalpel-1#7 | `src/renderer/src/engine-surface/registry.ts:76-78` | Supply a measured viewport to production render sites | FX1 |
| scalpel-2#1 | `src/renderer/src/engine-surface/SurfaceTree.tsx:251-253` | Compute the longest backtick run without spreading every match | FX1 |
| scalpel-2#2 | `src/renderer/src/engine-surface/SurfaceTree.tsx:291` | Normalize SVG source before URI-encoding it | FX1 |
| scalpel-2#3 | `src/renderer/src/engine-surface/SurfaceTree.tsx:189-196` | Align surface field values with the IPC length limit | FX1 |
| scalpel-3#1 | `src/renderer/src/engine-surface/panes.ts:64` | Select newly shown panes without inventing a focus request | FX2 |
| scalpel-3#2 | `src/renderer/src/engine-surface/panes.ts:132-136` | Clear pre-ready pane rosters when initialization ends | FX2 |
| scalpel-3#3 | `src/engine-host/surface.ts:70-73` | Invalidate pending attaches when the session ends | FX2 |
| scalpel-4#1 | `src/renderer/src/engine-surface/registry.ts:88-90` | Release withheld rows when their render request fails | FX1 |
| scalpel-4#2 | `src/renderer/src/transcript/surface/Rows.tsx:59-60` | Keep folded probe derivation independent of unrelated token batches | FX3 |
| scalpel-5#1 | `e2e/transcript.spec.ts:859-863` | Validate action payloads before accepting replayed effects | FX3 |

Waves: FX1 engine-surface protocol and safety (actions, SurfaceSite, SurfaceTree, registry, tree; adds a per-site error boundary that falls back to MAWS's own drawing); FX2 panes and attach lifecycle (panes.ts, PaneTool, engine-host surface.ts); FX3 transcript probe derivation and replay honesty (transcript/surface/Rows.tsx, e2e/transcript.spec.ts, replay-transport matching). Full comments in `findings.json`; the panel's log in `panel-log.txt`.
