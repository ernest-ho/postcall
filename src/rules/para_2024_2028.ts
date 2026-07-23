// Ported from src/rules/para_2024_2028.py (main call-scheduler repo): the
// check()-only subset. The Python source also defines an encode() per hard
// rule for the CP-SAT schedule generator; those are solver-only and are
// deliberately NOT ported here, since this standalone tool only ever
// validates a resident-entered schedule, never generates one.
//
// Fairness-category rules (FAIR-*) are also omitted: their check() in the
// Python source is a permanent no-op (`_no_check`, always returns []), so
// including them here would change nothing about validate()'s output.
import type { AssignedShift, CallType, CheckFn, RuleDef, Violation } from './types'
import * as proration from './proration'
import * as vacation from './vacation'
import * as windows from './windows'

const VERSION = 'para_2024_2028'

function byType(shifts: AssignedShift[], callType: CallType): AssignedShift[] {
  return shifts.filter(s => s.callType === callType)
}

// Turns a windows.ts RuleHit (detail text + the exact affected dates) into a
// Violation, or [] if there was no hit; keeps every check function below to
// one line instead of repeating this shape 18 times.
function toViolations(hit: windows.RuleHit | null, ruleId: string, articleRef: string, residentId: string): Violation[] {
  return hit ? [{ ruleId, articleRef, residentId, detail: hit.detail, severity: 'hard', dates: hit.dates }] : []
}

// Same, but for the rules that report every distinct instance rather than
// just the first (e.g. all 3 gaps among 4 consecutive shifts, not just one).
function toViolationsAll(hits: windows.RuleHit[], ruleId: string, articleRef: string, residentId: string): Violation[] {
  return hits.map(hit => ({ ruleId, articleRef, residentId, detail: hit.detail, severity: 'hard' as const, dates: hit.dates }))
}

// --- In-house call (Art 23.05) ---

const checkIhMax28d: CheckFn = (shifts, residentId, _params, ctx) => {
  const relevant = byType(shifts, 'in_house')
  const cap = proration.maxInHouseForDays(ctx.daysOnService.get(residentId) ?? 28)
  return toViolations(windows.slidingWindowCountViolation(relevant, 28, cap), 'IH-MAX-28D', 'PARA 2024-2028, Art 23.05(a)', residentId)
}

const checkIhMax10d: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'in_house')
  return toViolations(windows.slidingWindowCountViolation(relevant, 10, 4), 'IH-MAX-10D', 'PARA 2024-2028, Art 23.05(a)', residentId)
}

// `shifts` here includes every call type this rule scopes to (see its
// RuleDef below): in-house call anchors the guarantee, but home call, night
// float, or a regular shift starting too soon after violates it just as
// much as another in-house call would, so the gap check runs against all
// of them.
const checkIhNoConsecutive: CheckFn = (shifts, residentId, _params, _ctx) => {
  const ihShifts = byType(shifts, 'in_house')
  return toViolationsAll(windows.guaranteedRestAfterViolation(ihShifts, shifts, 10), 'IH-NO-CONSECUTIVE', 'PARA 2024-2028, Art 23.05(b)', residentId)
}

const checkIhWeekendBlocks: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'in_house')
  return toViolations(windows.maxWeekendsWorkedViolation(relevant, 2), 'IH-WEEKEND-BLOCKS', 'PARA 2024-2028, Art 23.05(c)', residentId)
}

const checkIhConsecWeekends: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'in_house')
  return toViolationsAll(windows.maxConsecutiveWeekendsViolations(relevant, 2), 'IH-CONSEC-WEEKENDS', 'PARA 2024-2028, Art 23.05(c)', residentId)
}

// --- Home call (Art 23.06) ---

const checkHcMax28d: CheckFn = (shifts, residentId, _params, ctx) => {
  const relevant = byType(shifts, 'home')
  const cap = proration.maxHomeCallForDays(ctx.daysOnService.get(residentId) ?? 28)
  return toViolations(windows.slidingWindowCountViolation(relevant, 28, cap), 'HC-MAX-28D', 'PARA 2024-2028, Art 23.06(a)', residentId)
}

const checkHcMax10d: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'home')
  return toViolations(windows.slidingWindowCountViolation(relevant, 10, 4), 'HC-MAX-10D', 'PARA 2024-2028, Art 23.06(a)', residentId)
}

const checkHcMaxConsecutive: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'home')
  return toViolationsAll(windows.maxConsecutiveRunViolations(relevant, 3), 'HC-MAX-CONSECUTIVE', 'PARA 2024-2028, Art 23.06(b)', residentId)
}

const checkHcWeekendBlocks: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'home')
  return toViolations(windows.maxWeekendsWorkedViolation(relevant, 2), 'HC-WEEKEND-BLOCKS', 'PARA 2024-2028, Art 23.06(c)', residentId)
}

const checkHcConsecWeekends: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'home')
  return toViolationsAll(windows.maxConsecutiveWeekendsViolations(relevant, 2), 'HC-CONSEC-WEEKENDS', 'PARA 2024-2028, Art 23.06(c)', residentId)
}

// --- Night float: no numeric provision in the agreement; only the shared
// weekend entitlement rules apply (consecutive nights are allowed). ---

const checkNfWeekendBlocks: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'night_float')
  return toViolations(
    windows.maxWeekendsWorkedViolation(relevant, 2), 'NF-WEEKEND-BLOCKS',
    'PARA 2024-2028, Art 23 (weekend entitlement, applied to night float)', residentId,
  )
}

const checkNfConsecWeekends: CheckFn = (shifts, residentId, _params, _ctx) => {
  const relevant = byType(shifts, 'night_float')
  return toViolationsAll(
    windows.maxConsecutiveWeekendsViolations(relevant, 2), 'NF-CONSEC-WEEKENDS',
    'PARA 2024-2028, Art 23 (weekend entitlement, applied to night float)', residentId,
  )
}

// --- Shared hours/rest rules (Art 23.01, 23.04): apply to every call type. ---

const checkRestMinGap: CheckFn = (shifts, residentId, _params, _ctx) =>
  toViolationsAll(windows.restGapViolations(shifts, 10), 'REST-MIN-GAP', 'PARA 2024-2028, Art 23.01(d)', residentId)

const checkMaxDutyLength: CheckFn = (shifts, residentId, _params, _ctx) =>
  toViolations(windows.maxDutyLengthViolation(shifts, 26), 'MAX-DUTY-LENGTH', 'PARA 2024-2028, Art 23.01(f)/(g)', residentId)

const checkMaxWeeklyHours: CheckFn = (shifts, residentId, _params, _ctx) =>
  toViolations(windows.weeklyHoursAvgViolation(shifts, 4, 80), 'MAX-WEEKLY-HOURS', 'PARA 2024-2028, Art 23.01(e)', residentId)

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
      dates: [], // Whole-block count, not tied to any specific day.
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

// Fairness categories aren't pass/fail; they're weighted terms in a
// schedule-generation solver's objective, not constraints that can be
// "violated." This standalone tool has no generator, so they're listed here
// purely for the Rules reference page (matching what the admin app shows),
// with a permanent no-op check.
const noCheck: CheckFn = () => []

export function buildRuleset(): RuleDef[] {
  const ihTypes = new Set<CallType>(['in_house'])
  const hcTypes = new Set<CallType>(['home'])
  const nfTypes = new Set<CallType>(['night_float'])
  const sharedTypes = new Set<CallType>(['in_house', 'home', 'night_float', 'regular'])
  const vacTypes = new Set<CallType>(['in_house', 'home', 'night_float'])

  return [
    { id: 'IH-MAX-28D', articleRef: 'PARA 2024-2028, Art 23.05(a)', title: 'Max in-house call per 28-day block', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhMax28d,
      explanation: 'The number of in-house call shifts a resident can be assigned in a 28-day block is capped, and the cap is reduced if they had approved leave during that block.' },
    { id: 'IH-MAX-10D', articleRef: 'PARA 2024-2028, Art 23.05(a)', title: 'Max in-house call per 10-day period', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhMax10d,
      explanation: 'A resident can be assigned at most 4 in-house call shifts within any 10-day period.' },
    { id: 'IH-NO-CONSECUTIVE', articleRef: 'PARA 2024-2028, Art 23.05(b)', title: 'Guaranteed post-call rest', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkIhNoConsecutive,
      explanation: 'After an in-house call shift, a resident is guaranteed at least 10 hours of rest before their next duty — another call shift (in-house, home, or night float) or a regular shift starting too soon after violates it, even with no gap at all.' },
    { id: 'IH-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.05(c)', title: 'Max 2 weekends worked per block', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhWeekendBlocks,
      explanation: 'A resident can be assigned in-house call on at most 2 weekends within a 28-day block.' },
    { id: 'IH-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.05(c)', title: 'Max 2 consecutive weekends worked', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhConsecWeekends,
      explanation: 'A resident can\'t be assigned in-house call on more than 2 weekends in a row.' },

    { id: 'HC-MAX-28D', articleRef: 'PARA 2024-2028, Art 23.06(a)', title: 'Max home call per 28-day block', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcMax28d,
      explanation: 'The number of home call shifts a resident can be assigned in a 28-day block is capped, and the cap is reduced if they had approved leave during that block.' },
    { id: 'HC-MAX-10D', articleRef: 'PARA 2024-2028, Art 23.06(a)', title: 'Max home call per 10-day period', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcMax10d,
      explanation: 'A resident can be assigned at most 4 home call shifts within any 10-day period.' },
    { id: 'HC-MAX-CONSECUTIVE', articleRef: 'PARA 2024-2028, Art 23.06(b)', title: 'Max 3 consecutive home call shifts', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcMaxConsecutive,
      explanation: 'A resident can be assigned at most 3 home call shifts in a row before a break is required.' },
    { id: 'HC-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.06(c)', title: 'Max 2 weekends worked per block', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcWeekendBlocks,
      explanation: 'A resident can be assigned home call on at most 2 weekends within a 28-day block.' },
    { id: 'HC-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.06(c)', title: 'Max 2 consecutive weekends worked', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcConsecWeekends,
      explanation: 'A resident can\'t be assigned home call on more than 2 weekends in a row.' },

    { id: 'NF-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23 (weekend entitlement, applied to night float)', title: 'Max 2 weekends worked per block', callTypes: nfTypes, kind: 'hard', params: {}, check: checkNfWeekendBlocks,
      explanation: 'A night-float resident can be scheduled to work at most 2 weekends within a 28-day block.' },
    { id: 'NF-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23 (weekend entitlement, applied to night float)', title: 'Max 2 consecutive weekends worked', callTypes: nfTypes, kind: 'hard', params: {}, check: checkNfConsecWeekends,
      explanation: 'A night-float resident can\'t be scheduled to work more than 2 weekends in a row.' },

    { id: 'REST-MIN-GAP', articleRef: 'PARA 2024-2028, Art 23.01(d)', title: 'Minimum 10h rest between duty periods', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkRestMinGap,
      explanation: 'Residents need at least 10 hours off between the end of one duty period and the start of the next.' },
    { id: 'MAX-DUTY-LENGTH', articleRef: 'PARA 2024-2028, Art 23.01(f)/(g)', title: 'Max 24h duty + 2h handover', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkMaxDutyLength,
      explanation: 'A single continuous stretch of duty can\'t run longer than 24 hours plus a 2-hour handover, 26 hours total.' },
    { id: 'MAX-WEEKLY-HOURS', articleRef: 'PARA 2024-2028, Art 23.01(e)', title: 'Max 80h/week averaged over 4 weeks', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkMaxWeeklyHours,
      explanation: 'Average weekly duty hours, measured over any rolling 4-week span, can\'t exceed 80 hours.' },
    { id: 'WEEKENDS-OFF', articleRef: 'PARA 2024-2028, Art 20/23', title: '2 complete weekends off per block', callTypes: vacTypes, kind: 'hard', params: {}, check: checkWeekendsOff,
      explanation: 'Every resident must have at least 2 full weekends completely free of on-call duty within each 28-day block.' },

    { id: 'VAC-NO-CALL-BLACKOUT', articleRef: 'PARA 2024-2028, Art 20.05', title: 'No call day-before/during vacation', callTypes: vacTypes, kind: 'hard', params: {}, check: checkVacBlackout,
      explanation: 'No on-call duty may fall on the day before a resident\'s vacation starts, or during the vacation itself.' },
    { id: 'VAC-WEEKEND-ADJACENCY', articleRef: 'PARA 2024-2028, Art 20.05(b)', title: 'Only one weekend adjacent to 5-day vacation run may be worked', callTypes: vacTypes, kind: 'hard', params: {}, check: checkVacWeekendAdjacency,
      explanation: 'If a resident takes 5 or more consecutive weekdays of vacation, they\'re guaranteed at least one of the two adjacent weekends (immediately before or immediately after) free of on-call duty. Being scheduled on one of them is fine; both is not.' },

    // Fairness weight categories, locally tunable burden preferences in the
    // admin app, not agreement-mandated rules, so no articleRef.
    { id: 'FAIR-IH-WEEKDAY', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'In-house weekday night burden weight', callTypes: ihTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Controls how strongly the scheduler tries to spread in-house weeknight call shifts evenly across residents.' },
    { id: 'FAIR-IH-WEEKEND', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'In-house weekend shift burden weight', callTypes: ihTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Controls how strongly the scheduler tries to spread in-house weekend call shifts evenly across residents.' },
    { id: 'FAIR-HC-WEEKDAY', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'Home call weekday night burden weight', callTypes: hcTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Controls how strongly the scheduler tries to spread home-call weeknight shifts evenly across residents.' },
    { id: 'FAIR-HC-WEEKEND', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'Home call weekend shift burden weight', callTypes: hcTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Controls how strongly the scheduler tries to spread home-call weekend shifts evenly across residents.' },
    { id: 'FAIR-NF-WEEKDAY', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'Night float weekday shift burden weight', callTypes: nfTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Controls how strongly the scheduler tries to spread night-float weeknight shifts evenly across residents.' },
    { id: 'FAIR-NF-WEEKEND', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'Night float weekend shift burden weight', callTypes: nfTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Controls how strongly the scheduler tries to spread night-float weekend shifts evenly across residents.' },
    { id: 'FAIR-CONSEC-PAIR', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'Consecutive shift-day penalty (the only discouragement against back-to-back night float nights, since PARA sets no hard consecutive-night cap for it)', callTypes: vacTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Adds extra weight against scheduling the same resident for back-to-back call shifts, since PARA doesn\'t set a hard cap on consecutive night-float nights the way it does for in-house call.' },
    { id: 'FAIR-PROJECTED-SPREAD', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'Academic-year projected burden spread weight', callTypes: vacTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Controls how strongly the scheduler evens out each resident\'s running total burden for the academic year, not just this block.' },
    { id: 'FAIR-BLOCK-SPREAD', articleRef: 'Local fairness policy (not PARA-mandated)', title: 'Within-block burden spread weight', callTypes: vacTypes, kind: 'fairness', params: {}, check: noCheck,
      explanation: 'Controls how strongly the scheduler evens out burden among residents within this one block alone.' },
  ]
}

export const VERSION_ID = VERSION
