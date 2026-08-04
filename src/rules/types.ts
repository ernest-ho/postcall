// Ported from src/models.py + src/rules/__init__.py in the main call-scheduler
// repo: check()-only subset (no CP-SAT encode()/ShiftSlot/RuleRegistry, since
// this standalone tool only ever validates, never generates a schedule).

// 'backup' is an ACTIVATED backup call shift (LOU General Pediatrics UofA
// 2026-2027) — a resident on standby who actually gets called in. The LOU
// converts its stipend from home call to in-house call, so it's treated as
// in-house-equivalent for the shared duty-hour/rest/no-consecutive rules
// (see para_2024_2028.ts), but kept separate from 'in_house' for the
// 28-day/10-day/weekend call maximums, which the LOU caps independently via
// its own points system (not modeled — see para_2024_2028_peds_uofa_lou.ts).
export type CallType = 'in_house' | 'home' | 'night_float' | 'regular' | 'backup'

export interface AssignedShift {
  shiftInstanceId: string
  residentId: string
  callType: CallType
  date: string // YYYY-MM-DD
  startDt: Date
  endDt: Date
}

export type Severity = 'hard' | 'fairness'

export interface Violation {
  ruleId: string
  articleRef: string
  residentId: string
  detail: string
  severity: Severity
  // The exact calendar dates responsible, as structured data (not something
  // the UI has to guess by parsing `detail`). Empty for whole-block-count
  // violations (e.g. "worked 3 weekends this block") that aren't tied to a
  // single specific day.
  dates: string[]
}

export class RuleContext {
  vacationDays: Map<string, Set<string>>
  daysOnService: Map<string, number>
  overriddenRuleIds: Map<string, Set<string>>

  constructor(opts: {
    vacationDays?: Map<string, Set<string>>
    daysOnService?: Map<string, number>
    overriddenRuleIds?: Map<string, Set<string>>
  } = {}) {
    this.vacationDays = opts.vacationDays ?? new Map()
    this.daysOnService = opts.daysOnService ?? new Map()
    this.overriddenRuleIds = opts.overriddenRuleIds ?? new Map()
  }

  isWaived(residentId: string, ruleId: string): boolean {
    return this.overriddenRuleIds.get(residentId)?.has(ruleId) ?? false
  }
}

export type CheckFn = (
  shifts: AssignedShift[],
  residentId: string,
  params: Record<string, unknown>,
  ctx: RuleContext,
) => Violation[]

export interface RuleDef {
  id: string
  articleRef: string
  title: string
  callTypes: Set<CallType>
  kind: Severity
  params: Record<string, unknown>
  check: CheckFn
  // A short, original plain-language explanation of what the rule actually
  // does, not a quote from the agreement. For the exact legal wording, the
  // Rules page links out to PARA's own published agreement instead of
  // reproducing article text here.
  explanation: string
}

export interface RuleSet {
  version: string
  name: string
  rules: RuleDef[]
}
