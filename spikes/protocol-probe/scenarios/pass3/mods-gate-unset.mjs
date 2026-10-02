// R0 question 4, the switch unset (mods-common.mjs gateArm): no CLAUDE_CODE_ENABLE_FUNCTION_HOOKS in the process
// environment or the scratch settings.
import {gateArm} from './mods-common.mjs';
export default ()=>gateArm('mods-gate-unset',{question:'R0 Q4 the function-hooks switch unset'});
