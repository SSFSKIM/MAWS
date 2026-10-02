// R0 question 4, the owner's state (mods-common.mjs gateArm): the switch "1" in the scratch user settings' env block, as
// ~/.claude/settings.json sets it, and the rollout switch cached as served off in the scratch .claude.json, as the
// owner's ~/.claude.json caches it (`cachedGrowthBookFeatures.tengu_plugin_hooks_modules: false`, read 2026-10-01).
// The two arms before ran with a cold cache, where the accessor's default (on) decides; this one asks whether the
// cached served value turns the switch off, and whether "1" still overrides it.
import {gateArm,GATE} from './mods-common.mjs';
export default ()=>gateArm('mods-gate-served-off',{settings:{env:{[GATE]:'1'}},globalConfig:{cachedGrowthBookFeatures:{tengu_plugin_hooks_modules:false}},question:'R0 Q4 the switch "1" in settings with the rollout switch cached as served off'});
