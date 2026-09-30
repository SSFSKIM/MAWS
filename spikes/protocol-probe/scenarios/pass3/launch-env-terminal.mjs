// C12 M5, the launch-environment probe (launch-env-common.mjs): the terminal half, the pinned binary interactive in a
// PTY with neither variable, as the owner's terminal runs it.
import {terminalArm} from './launch-env-common.mjs';
export default ()=>terminalArm('launch-env-terminal');
