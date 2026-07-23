// Ported from src/rules/para_2024_2028.py (main call-scheduler repo): the
// check()-only subset. The Python source also defines an encode() per hard
// rule for the CP-SAT schedule generator; those are solver-only and are
// deliberately NOT ported here, since this standalone tool only ever
// validates a resident-entered schedule, never generates one.
//
// Fairness-category rules (FAIR-*) are also omitted: their check() in the
// Python source is a permanent no-op (`_no_check`, always returns []), so
// including them here would change nothing about validate()'s output.
import type { AssignedShift, CallType, CheckFn, RuleDef } from './types'
import * as proration from './proration'
import * as vacation from './vacation'
import * as windows from './windows'

const VERSION = 'para_2024_2028'

function byType(shifts: AssignedShift[], callType: CallType): AssignedShift[] {
  return shifts.filter(s => s.callType === callType)
}

// --- In-house call (Art 23.05) ---

const checkIhMax28d: CheckFn = (shifts, residentId, _params, ctx) => {
  const relevant = byType(shifts, 'in_house')
  const cap = proration.maxInHouseForDays(ctx.daysOnService.get(residentId) ?? 28)
  const detail = windows.slidingWindowCountViolation(relevant, 28, cap)
  return detail
    ? [{ ruleId: 'IH-MAX-28D', articleRef: 'PARA 2024-2028, Art 23.05(a)', residentId, detail, severity: 'hard' }]
    : []
}

const checkIhMax10d: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'in_house')
  const detail = windows.slidingWindowCountViolation(relevant, 10, 4)
  return detail
    ? [{ ruleId: 'IH-MAX-10D', articleRef: 'PARA 2024-2028, Art 23.05(a)', residentId, detail, severity: 'hard' }]
    : []
}

const checkIhNoConsecutive: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'in_house')
  const detail = windows.maxConsecutiveRunViolation(relevant, 0)
  return detail
    ? [{ ruleId: 'IH-NO-CONSECUTIVE', articleRef: 'PARA 2024-2028, Art 23.05(b)', residentId, detail, severity: 'hard' }]
    : []
}

const checkIhWeekendBlocks: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'in_house')
  const detail = windows.maxWeekendsWorkedViolation(relevant, 2)
  return detail
    ? [{ ruleId: 'IH-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.05(c)', residentId, detail, severity: 'hard' }]
    : []
}

const checkIhConsecWeekends: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'in_house')
  const detail = windows.maxConsecutiveWeekendsViolation(relevant, 2)
  return detail
    ? [{ ruleId: 'IH-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.05(c)', residentId, detail, severity: 'hard' }]
    : []
}

// --- Home call (Art 23.06) ---

const checkHcMax28d: CheckFn = (shifts, residentId, _params, ctx) => {
  const relevant = byType(shifts, 'home')
  const cap = proration.maxHomeCallForDays(ctx.daysOnService.get(residentId) ?? 28)
  const detail = windows.slidingWindowCountViolation(relevant, 28, cap)
  return detail
    ? [{ ruleId: 'HC-MAX-28D', articleRef: 'PARA 2024-2028, Art 23.06(a)', residentId, detail, severity: 'hard' }]
    : []
}

const checkHcMax10d: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'home')
  const detail = windows.slidingWindowCountViolation(relevant, 10, 4)
  return detail
    ? [{ ruleId: 'HC-MAX-10D', articleRef: 'PARA 2024-2028, Art 23.06(a)', residentId, detail, severity: 'hard' }]
    : []
}

const checkHcMaxConsecutive: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'home')
  const detail = windows.maxConsecutiveRunViolation(relevant, 3)
  return detail
    ? [{ ruleId: 'HC-MAX-CONSECUTIVE', articleRef: 'PARA 2024-2028, Art 23.06(b)', residentId, detail, severity: 'hard' }]
    : []
}

const checkHcWeekendBlocks: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'home')
  const detail = windows.maxWeekendsWorkedViolation(relevant, 2)
  return detail
    ? [{ ruleId: 'HC-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.06(c)', residentId, detail, severity: 'hard' }]
    : []
}

const checkHcConsecWeekends: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'home')
  const detail = windows.maxConsecutiveWeekendsViolation(relevant, 2)
  return detail
    ? [{ ruleId: 'HC-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.06(c)', residentId, detail, severity: 'hard' }]
    : []
}

// --- Night float: no numeric provision in the agreement; only the shared
// weekend entitlement rules apply (consecutive nights are allowed). ---

const checkNfWeekendBlocks: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'night_float')
  const detail = windows.maxWeekendsWorkedViolation(relevant, 2)
  return detail
    ? [{
      ruleId: 'NF-WEEKEND-BLOCKS',
      articleRef: 'PARA 2024-2028, Art 23 (weekend entitlement, applied to night float)',
      residentId, detail, severity: 'hard',
    }]
    : []
}

const checkNfConsecWeekends: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'night_float')
  const detail = windows.maxConsecutiveWeekendsViolation(relevant, 2)
  return detail
    ? [{
      ruleId: 'NF-CONSEC-WEEKENDS',
      articleRef: 'PARA 2024-2028, Art 23 (weekend entitlement, applied to night float)',
      residentId, detail, severity: 'hard',
    }]
    : []
}

// --- Shared hours/rest rules (Art 23.01, 23.04): apply to every call type. ---

const checkRestMinGap: CheckFn = (shifts, residentId, _params, _ctx) => {
  const detail = windows.restGapViolation(shifts, 10)
  return detail
    ? [{ ruleId: 'REST-MIN-GAP', articleRef: 'PARA 2024-2028, Art 23.01(d)', residentId, detail, severity: 'hard' }]
    : []
}

const checkMaxDutyLength: CheckFn = (shifts, residentId, _params, _ctx) => {
  const detail = windows.maxDutyLengthViolation(shifts, 26)
  return detail
    ? [{ ruleId: 'MAX-DUTY-LENGTH', articleRef: 'PARA 2024-2028, Art 23.01(f)/(g)', residentId, detail, severity: 'hard' }]
    : []
}

const checkMaxWeeklyHours: CheckFn = (shifts, residentId, _params, _ctx) => {
  const detail = windows.weeklyHoursAvgViolation(shifts, 4, 80)
  return detail
    ? [{ ruleId: 'MAX-WEEKLY-HOURS', articleRef: 'PARA 2024-2028, Art 23.01(e)', residentId, detail, severity: 'hard' }]
    : []
}

const checkWeekendsOff: CheckFn = (shifts, residentId, params, _ctx) => {
  const worked = windows.weekendsWorked(shifts)
  const totalPossible = (params.totalWeekendBucketsInBlock as number | undefined) ?? 4
  const requiredOff = 2
  if (worked.size > Math.max(0, totalPossible - requiredOff)) {
    return [{
      ruleId: 'WEEKENDS-OFF',
      articleRef: 'PARA 2024-2028, Art 20/23 (block weekend entitlement)',
      residentId,
      detail: (
        `Worked ${worked.size} of ${totalPossible} weekends this block; must have ` +
        `${requiredOff} complete weekends off`
      ),
      severity: 'hard',
    }]
  }
  return []
}

// --- Vacation interaction (Art 20.05) ---
// check_vacation_blackout() computes both blackout and weekend-adjacency
// violations together (they share the vacation-run scan); each rule's
// check() filters to its own ruleId so validate() never double-reports the
// same weekend-adjacency violation under both rule ids.

const checkVacBlackout: CheckFn = (shifts, residentId, _params, ctx) =>
  vacation.checkVacationBlackout(shifts, residentId, ctx).filter(v => v.ruleId === 'VAC-NO-CALL-BLACKOUT')

const checkVacWeekendAdjacency: CheckFn = (shifts, residentId, _params, ctx) =>
  vacation.checkVacationBlackout(shifts, residentId, ctx).filter(v => v.ruleId === 'VAC-WEEKEND-ADJACENCY')

export function buildRuleset(): RuleDef[] {
  const ihTypes = new Set<CallType>(['in_house'])
  const hcTypes = new Set<CallType>(['home'])
  const nfTypes = new Set<CallType>(['night_float'])
  const sharedTypes = new Set<CallType>(['in_house', 'home', 'night_float', 'regular'])
  const vacTypes = new Set<CallType>(['in_house', 'home', 'night_float'])

  return [
    { id: 'IH-MAX-28D', articleRef: 'PARA 2024-2028, Art 23.05(a)', title: 'Max in-house call per 28-day block', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhMax28d },
    { id: 'IH-MAX-10D', articleRef: 'PARA 2024-2028, Art 23.05(a)', title: 'Max in-house call per 10-day period', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhMax10d },
    { id: 'IH-NO-CONSECUTIVE', articleRef: 'PARA 2024-2028, Art 23.05(b)', title: 'Guaranteed post-call day off', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhNoConsecutive },
    { id: 'IH-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.05(c)', title: 'Max 2 weekends worked per block', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhWeekendBlocks },
    { id: 'IH-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.05(c)', title: 'Max 2 consecutive weekends worked', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhConsecWeekends },

    { id: 'HC-MAX-28D', articleRef: 'PARA 2024-2028, Art 23.06(a)', title: 'Max home call per 28-day block', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcMax28d },
    { id: 'HC-MAX-10D', articleRef: 'PARA 2024-2028, Art 23.06(a)', title: 'Max home call per 10-day period', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcMax10d },
    { id: 'HC-MAX-CONSECUTIVE', articleRef: 'PARA 2024-2028, Art 23.06(b)', title: 'Max 3 consecutive home call shifts', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcMaxConsecutive },
    { id: 'HC-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.06(c)', title: 'Max 2 weekends worked per block', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcWeekendBlocks },
    { id: 'HC-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.06(c)', title: 'Max 2 consecutive weekends worked', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcConsecWeekends },

    { id: 'NF-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23 (weekend entitlement, applied to night float)', title: 'Max 2 weekends worked per block', callTypes: nfTypes, kind: 'hard', params: {}, check: checkNfWeekendBlocks },
    { id: 'NF-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23 (weekend entitlement, applied to night float)', title: 'Max 2 consecutive weekends worked', callTypes: nfTypes, kind: 'hard', params: {}, check: checkNfConsecWeekends },

    { id: 'REST-MIN-GAP', articleRef: 'PARA 2024-2028, Art 23.01(d)', title: 'Minimum 10h rest between duty periods', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkRestMinGap },
    { id: 'MAX-DUTY-LENGTH', articleRef: 'PARA 2024-2028, Art 23.01(f)/(g)', title: 'Max 24h duty + 2h handover', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkMaxDutyLength },
    { id: 'MAX-WEEKLY-HOURS', articleRef: 'PARA 2024-2028, Art 23.01(e)', title: 'Max 80h/week averaged over 4 weeks', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkMaxWeeklyHours },
    { id: 'WEEKENDS-OFF', articleRef: 'PARA 2024-2028, Art 20/23', title: '2 complete weekends off per block', callTypes: vacTypes, kind: 'hard', params: {}, check: checkWeekendsOff },

    { id: 'VAC-NO-CALL-BLACKOUT', articleRef: 'PARA 2024-2028, Art 20.05', title: 'No call day-before/during vacation', callTypes: vacTypes, kind: 'hard', params: {}, check: checkVacBlackout },
    { id: 'VAC-WEEKEND-ADJACENCY', articleRef: 'PARA 2024-2028, Art 20.05', title: 'No call weekend adjacent to 5-day vacation run', callTypes: vacTypes, kind: 'hard', params: {}, check: checkVacWeekendAdjacency },
  ]
}

export const VERSION_ID = VERSION
