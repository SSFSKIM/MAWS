// The probes' default initialize payload: the app's (src/shared/engine/initialize.ts) without `sdkMcpServers`. MAWS
// declares its `maws` server at every launch and serves it from the engine host; a probe serves none unless its scenario
// registers one (`probe.serve`, sdk-mcp.mjs), so by default it declares none. A server declared and not registered is
// refused by the harness's handshake (E11 W-E) rather than left unanswered. A scenario that serves one (pass3's
// p1-sdk-mcp.mjs) passes `sdkMcpServers` itself. Kept apart from harness.mjs so it loads with nothing but this import.
import {appInitialize} from '../../src/shared/engine/initialize.ts';

export function probeInitialize(trust){
 const {sdkMcpServers:_served,...payload}=appInitialize(trust);
 return payload;
}
