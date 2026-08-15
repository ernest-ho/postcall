// Ported from src/config.py's get_ruleset()/list_ruleset_versions() (main
// call-scheduler repo): the registry of selectable rulesets. Each entry's
// buildRuleset() is a pure function (no CP-SAT), so there's no need for
// config.py's build-once cache  -  callers just call getRuleset() directly.
import type { RuleDef } from './types'
import { buildRuleset as buildBase, VERSION_ID as BASE_VERSION } from './para_2024_2028'
import { buildRuleset as buildLou, VERSION as LOU_VERSION } from './para_2024_2028_peds_uofa_lou'

export interface RulesetInfo {
  version: string
  name: string
}

export const RULESETS: RulesetInfo[] = [
  { version: BASE_VERSION, name: 'PARA 2024-2028' },
  { version: LOU_VERSION, name: 'PARA Pediatrics' },
]

const BUILDERS: Record<string, () => RuleDef[]> = {
  [BASE_VERSION]: buildBase,
  [LOU_VERSION]: buildLou,
}

export function getRuleset(version: string): RuleDef[] {
  const builder = BUILDERS[version]
  if (!builder) throw new Error(`Unknown ruleset version: ${version}`)
  return builder()
}
