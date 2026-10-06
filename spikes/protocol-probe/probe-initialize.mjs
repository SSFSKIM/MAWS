// The probes' default initialize payload: the app's (src/shared/engine/initialize.ts) without `sdkMcpServers`. MAWS
// declares its `maws` server at every launch and serves it from the engine host; a probe serves no MCP server, so
// declaring one would have the engine open a handshake the probe never answers. A scenario that serves one (pass3's
// p1-sdk-mcp.mjs) passes `sdkMcpServers` itself. Kept apart from harness.mjs so it loads with nothing but this import.
import {appInitialize} from '../../src/shared/engine/initialize.ts';

export function probeInitialize(trust){
 const {sdkMcpServers:_served,...payload}=appInitialize(trust);
 return payload;
}
