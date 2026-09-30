// C12 M5, the launch-environment probe (launch-env-common.mjs): the product's print-mode launch with the task tools
// opted in and the fork gate unset.
import {printArm} from './launch-env-common.mjs';
export default ()=>printArm('launch-env-todo',{CLAUDE_CODE_ENABLE_TODO_TOOLS:'1'});
