// R0 question 4, the switch set to 0 (mods-common.mjs gateArm): CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=0 in the process
// environment, the scratch settings {}.
import {gateArm,GATE} from './mods-common.mjs';
export default ()=>gateArm('mods-gate-off',{vars:{[GATE]:'0'},question:'R0 Q4 the function-hooks switch set to 0'});
