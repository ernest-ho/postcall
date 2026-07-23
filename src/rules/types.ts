// Ported from src/models.py + src/rules/__init__.py in the main call-scheduler
// repo: check()-only subset (no CP-SAT encode()/ShiftSlot/RuleRegistry, since
// this standalone tool only ever validates, never generates a schedule).

export type CallType = 'in_house' | 'home' | 'night_float' | 'regular'

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
}

export interface RuleSet {
  version: string
  name: string
  rules: RuleDef[]
}
