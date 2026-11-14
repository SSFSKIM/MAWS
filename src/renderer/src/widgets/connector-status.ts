// A connector's status in words (UX wave U11a, §C "Status words"), one function for every surface that lists a session's
// connectors: the Connectors dialog, a terminal session's dialog, the "+" › Connectors submenu and Customize's live list.
// Connected, Sign in needed and Connecting… are Customize's own words (customize/connectors/copy.ts), so they have one
// home. A disabled connector says nothing where a switch is drawn (the switch says it) and "Off" where none is; any
// status §C does not name keeps the engine's own word.
import { CONNECTORS } from '../customize/connectors/copy';
import { MCP } from './copy';

export function connectorStatusWords(status: string, opts?: { switchDrawn?: boolean }): string {
  switch (status) {
    case 'connected':
      return CONNECTORS.connected;
    case 'needs-auth':
      return CONNECTORS.needed;
    case 'failed':
      return MCP.failed;
    case 'pending':
      return CONNECTORS.connecting;
    case 'disabled':
      return opts?.switchDrawn === true ? '' : MCP.off;
    default:
      return status;
  }
}
