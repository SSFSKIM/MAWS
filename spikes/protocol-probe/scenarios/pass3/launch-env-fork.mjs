// C12 M5, the launch-environment probe (launch-env-common.mjs): the product's print-mode launch with the fork gate set,
// as X6 launched until C12.
import {printArm} from './launch-env-common.mjs';
export default ()=>printArm('launch-env-fork',{CLAUDE_CODE_FORK_SUBAGENT:'true'});
