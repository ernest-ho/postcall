// Ported from src/rules/validator.py (main call-scheduler repo): the same
// validate() used by admin generation, swap checks, and self-check in the
// original app, now the single source of truth for this standalone tool too.
import type { AssignedShift, RuleContext, RuleDef, Violation } from './types'

export function validate(shifts: AssignedShift[], ruleset: RuleDef[], ctx: RuleContext): Violation[] {
  const residentIds = [...new Set(shifts.map(s => s.residentId))].sort()
  const violations: Violation[] = []

  for (const residentId of residentIds) {
    const residentShifts = shifts.filter(s => s.residentId === residentId)
    for (const rule of ruleset) {
      if (ctx.isWaived(residentId, rule.id)) continue
      const inScope = residentShifts.filter(s => rule.callTypes.has(s.callType))
      violations.push(...rule.check(inScope, residentId, rule.params, ctx))
    }
  }

  return violations
}
