// Ported from src/rules/para_2024_2028.py (main call-scheduler repo): the
// check()-only subset. The Python source also defines an encode() per hard
// rule for the CP-SAT schedule generator; those are solver-only and are
// deliberately NOT ported here, since this standalone tool only ever
// validates a resident-entered schedule, never generates one.
//
// Fairness-category rules (FAIR-*) are also omitted: their check() in the
// Python source is a permanent no-op (`_no_check`, always returns []), so
// including them here would change nothing about validate()'s output.
import type { AssignedShift, CallType, CheckFn, CombinedCallPrimary, DutyModel, RuleContext, RuleDef, Violation } from './types'
import * as proration from './proration'
import * as vacation from './vacation'
import * as windows from './windows'
import { addDays, diffDays, formatDateOnly, parseDateOnly } from './dates'

const VERSION = 'para_2024_2028'

function byType(shifts: AssignedShift[], callType: CallType): AssignedShift[] {
  return shifts.filter(s => s.callType === callType)
}

function dutyModel(ctx: RuleContext, residentId: string): DutyModel {
  return ctx.dutyModel.get(residentId) ?? 'standard'
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded}hr`
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
  return toViolations(windows.slidingWindowCountViolation(relevant, 9, 4), 'IH-MAX-10D', 'PARA 2024-2028, Art 23.05(e)', residentId)
}

// Art 23.05(b) is a calendar-day call assignment limit, not a rest-gap
// rule: no in-house call day, nor an adjacent IH/home-call combination.
export function makeCheckIhNoConsecutive(): CheckFn {
  return (shifts, residentId, _params, _ctx) => {
    const byDate = new Map<string, Set<CallType>>()
    for (const s of shifts.filter(s => s.callType === 'in_house' || s.callType === 'home')) {
      const types = byDate.get(s.date) ?? new Set<CallType>()
      types.add(s.callType)
      byDate.set(s.date, types)
    }
    const dates = [...byDate.keys()].sort()
    const hits: windows.RuleHit[] = []
    for (let i = 1; i < dates.length; i++) {
      const previous = dates[i - 1]
      const current = dates[i]
      if (diffDays(parseDateOnly(current), parseDateOnly(previous)) !== 1) continue
      const previousTypes = byDate.get(previous)!
      const currentTypes = byDate.get(current)!
      if (previousTypes.has('in_house') || currentTypes.has('in_house')) {
        hits.push({
          detail: `In-house call, or an in-house/home-call combination, is assigned on consecutive days ${previous} and ${current}`,
          dates: [previous, current],
        })
      }
    }
    return toViolationsAll(hits, 'IH-NO-CONSECUTIVE', 'PARA 2024-2028, Art 23.05(b)', residentId)
  }
}

const checkIhNoConsecutive: CheckFn = makeCheckIhNoConsecutive()

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

// --- Combined in-house and home call (Art. 23.07) ---

const COMBINED_CALL_CAPS: Record<CombinedCallPrimary, Array<{ home: number; inHouse: number }>> = {
  home: [
    { home: 9, inHouse: 0 }, { home: 8, inHouse: 1 }, { home: 7, inHouse: 2 },
    { home: 6, inHouse: 2 }, { home: 5, inHouse: 3 }, { home: 4, inHouse: 4 },
  ],
  in_house: [
    { home: 0, inHouse: 7 }, { home: 1, inHouse: 6 }, { home: 2, inHouse: 5 }, { home: 4, inHouse: 4 },
  ],
}

function hasCombinedCall(shifts: AssignedShift[]): boolean {
  return shifts.some(s => s.callType === 'in_house') && shifts.some(s => s.callType === 'home')
}

function combinedCallWindowViolation(shifts: AssignedShift[], primary: CombinedCallPrimary): windows.RuleHit | null {
  const dates = [...new Set(shifts.map(s => s.date))].map(parseDateOnly).sort((a, b) => a.getTime() - b.getTime())
  for (const start of dates) {
    const end = addDays(start, 27)
    const inWindow = shifts.filter(s => {
      const date = parseDateOnly(s.date)
      return date >= start && date <= end
    })
    const home = inWindow.filter(s => s.callType === 'home').length
    const inHouse = inWindow.filter(s => s.callType === 'in_house').length
    if (home === 0 || inHouse === 0) continue
    if (COMBINED_CALL_CAPS[primary].some(cap => home <= cap.home && inHouse <= cap.inHouse)) continue
    return {
      detail: (
        `${home} home-call and ${inHouse} in-house-call shifts from ${formatDateOnly(start)} to ` +
        `${formatDateOnly(end)} exceed the Art. 23.07 ${primary === 'home' ? 'primarily home-call' : 'primarily in-house-call'} table`
      ),
      dates: [...new Set(inWindow.map(s => s.date))].sort(),
    }
  }
  return null
}

const checkCombinedCallPrimaryRequired: CheckFn = (shifts, residentId, _params, ctx) => {
  if (!hasCombinedCall(shifts) || ctx.combinedCallPrimary.has(residentId)) return []
  return [{
    ruleId: 'COMBINED-CALL-PRIMARY-REQUIRED', articleRef: 'PARA 2024-2028, Art 23.07(a)', residentId,
    detail: 'This schedule combines in-house and home call; select whether the rotation is primarily home call or primarily in-house call to apply the required cap table.',
    severity: 'hard', dates: [...new Set(shifts.map(s => s.date))].sort(),
  }]
}

const checkCombinedCallCaps: CheckFn = (shifts, residentId, _params, ctx) => {
  const primary = ctx.combinedCallPrimary.get(residentId)
  if (!primary || !hasCombinedCall(shifts)) return []
  return toViolations(combinedCallWindowViolation(shifts, primary), 'COMBINED-CALL-CAPS', 'PARA 2024-2028, Art 23.07(a)', residentId)
}

const checkCombinedWeekendBlocks: CheckFn = (shifts, residentId, _params, ctx) => {
  if (!ctx.combinedCallPrimary.has(residentId) || !hasCombinedCall(shifts)) return []
  return toViolations(windows.maxWeekendsWorkedViolation(shifts, 2), 'COMBINED-CALL-WEEKEND-BLOCKS', 'PARA 2024-2028, Art 23.07(c)', residentId)
}

const checkCombinedConsecWeekends: CheckFn = (shifts, residentId, _params, ctx) => {
  if (!ctx.combinedCallPrimary.has(residentId) || !hasCombinedCall(shifts)) return []
  return toViolationsAll(windows.maxConsecutiveWeekendsViolations(shifts, 2), 'COMBINED-CALL-CONSEC-WEEKENDS', 'PARA 2024-2028, Art 23.07(c)', residentId)
}

// --- Night float: no numeric provision in the agreement; only the shared
// weekend entitlement rules apply (consecutive nights are allowed). ---

// --- Standard and shift-based duty (Art. 23.02 / 23.03) ---

const checkStandardWeekdayClinicalHours: CheckFn = (shifts, residentId, _params, ctx) => {
  if (dutyModel(ctx, residentId) !== 'standard') return []
  const byDate = new Map<string, AssignedShift[]>()
  for (const shift of shifts) {
    const day = shift.startDt.getDay()
    if (day === 0 || day === 6) continue
    const list = byDate.get(shift.date) ?? []
    list.push(shift)
    byDate.set(shift.date, list)
  }
  for (const [date, dayShifts] of byDate) {
    const hours = dayShifts.reduce((sum, s) => sum + (s.endDt.getTime() - s.startDt.getTime()) / 3_600_000, 0)
    if (hours > 12) {
      return [{
        ruleId: 'STANDARD-MAX-WEEKDAY-CLINICAL-HOURS', articleRef: 'PARA 2024-2028, Art 23.02(b)', residentId,
        detail: `${formatHours(hours)} of scheduled clinical duty on weekday ${date}, max is 12hr unless scheduled as on-call`,
        severity: 'hard', dates: [date],
      }]
    }
  }
  return []
}

const checkStandardWeekendWork: CheckFn = (shifts, residentId, _params, ctx) => {
  if (dutyModel(ctx, residentId) !== 'standard') return []
  const weekendShifts = shifts.filter(s => windows.touchesCalendarWeekendDay(s.startDt, s.endDt))
  if (weekendShifts.length === 0) return []
  return [{
    ruleId: 'STANDARD-NO-WEEKEND-SHIFTS', articleRef: 'PARA 2024-2028, Art 23.02(c)', residentId,
    detail: 'Standard-duty rotations cannot include scheduled non-call work on Saturday or Sunday; use a shift-based duty model or record the duty as on-call.',
    severity: 'hard', dates: [...new Set(weekendShifts.map(s => s.date))].sort(),
  }]
}

const checkShiftBasedWeeklyHours: CheckFn = (shifts, residentId, _params, ctx) => {
  if (dutyModel(ctx, residentId) !== 'shift_based') return []
  return toViolations(windows.weeklyScheduledHoursViolation(shifts, 60), 'SHIFT-BASED-MAX-WEEKLY-HOURS', 'PARA 2024-2028, Art 23.03(b)(i)', residentId)
}

const checkShiftBasedAdditionalCall: CheckFn = (shifts, residentId, _params, ctx) => {
  if (dutyModel(ctx, residentId) !== 'shift_based' || shifts.length === 0) return []
  return [{
    ruleId: 'SHIFT-BASED-NO-ADDITIONAL-CALL', articleRef: 'PARA 2024-2028, Art 23.03(b)(ii)', residentId,
    detail: 'A shift-based rotation cannot require additional on-call duty.', severity: 'hard',
    dates: [...new Set(shifts.map(s => s.date))].sort(),
  }]
}

const checkShiftBasedWeekendBlocks: CheckFn = (shifts, residentId, _params, ctx) => {
  if (dutyModel(ctx, residentId) !== 'shift_based') return []
  return toViolations(windows.maxWeekendsWorkedViolation(shifts, 2), 'SHIFT-BASED-WEEKEND-BLOCKS', 'PARA 2024-2028, Art 23.03(c)', residentId)
}

// --- Shared hours/rest rules (Art 23.01, 23.04): apply to every call type. ---

export function makeCheckRestMinGap(minHours: number): CheckFn {
  return (shifts, residentId, _params, _ctx) =>
    toViolationsAll(windows.restGapViolations(shifts, minHours), 'REST-MIN-GAP', 'PARA 2024-2028, Art 23.01(d)', residentId)
}

const checkRestMinGap: CheckFn = makeCheckRestMinGap(8)

const checkMaxDutyLength: CheckFn = (shifts, residentId, _params, _ctx) =>
  toViolations(windows.maxDutyLengthViolation(shifts, 26), 'MAX-DUTY-LENGTH', 'PARA 2024-2028, Art 23.01(f)/(g)', residentId)

const checkMaxWeeklyHours: CheckFn = (shifts, residentId, _params, _ctx) =>
  toViolations(windows.weeklyHoursAvgViolation(shifts, 4, 80), 'MAX-WEEKLY-HOURS', 'PARA 2024-2028, Art 23.01(e)', residentId)

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
  const combinedTypes = new Set<CallType>(['in_house', 'home'])
  const scheduledDutyTypes = new Set<CallType>(['regular', 'night_float'])
  const additionalCallTypes = new Set<CallType>(['in_house', 'home', 'backup'])
  const sharedTypes = new Set<CallType>(['in_house', 'home', 'night_float', 'regular', 'backup'])
  const vacTypes = new Set<CallType>(['in_house', 'home', 'night_float', 'regular', 'backup'])

  return [
    { id: 'IH-MAX-28D', articleRef: 'PARA 2024-2028, Art 23.05(a)', title: 'Max in-house call per 28-day block', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhMax28d,
      explanation: 'The number of in-house call shifts a resident can be assigned in a 28-day block is capped, and the cap is reduced if they had approved leave during that block.' },
    { id: 'IH-MAX-10D', articleRef: 'PARA 2024-2028, Art 23.05(e)', title: 'Max in-house call per period under 10 days', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhMax10d,
      explanation: 'A resident can be assigned at most 4 in-house call shifts in any period of fewer than 10 consecutive days.' },
    { id: 'IH-NO-CONSECUTIVE', articleRef: 'PARA 2024-2028, Art 23.05(b)', title: 'No consecutive in-house or combined call days', callTypes: new Set<CallType>(['in_house', 'home']), kind: 'hard', params: {}, check: checkIhNoConsecutive,
      explanation: 'In-house call cannot be assigned on two consecutive calendar days; an in-house/home-call pair on adjacent days is also prohibited. Consecutive home-call days are governed separately.' },
    { id: 'IH-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.05(c)', title: 'Max 2 weekends worked in 4 weeks', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhWeekendBlocks,
      explanation: 'A resident can be assigned in-house call on no more than 2 weekends in any 4-week period.' },
    { id: 'IH-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.05(c)', title: 'Max 2 consecutive weekends worked', callTypes: ihTypes, kind: 'hard', params: {}, check: checkIhConsecWeekends,
      explanation: 'A resident can\'t be assigned in-house call on more than 2 weekends in a row.' },

    { id: 'HC-MAX-28D', articleRef: 'PARA 2024-2028, Art 23.06(a)', title: 'Max home call per 28-day block', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcMax28d,
      explanation: 'The number of home call shifts a resident can be assigned in a 28-day block is capped, and the cap is reduced if they had approved leave during that block.' },
    { id: 'HC-MAX-CONSECUTIVE', articleRef: 'PARA 2024-2028, Art 23.06(b)', title: 'Max 3 consecutive home call shifts', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcMaxConsecutive,
      explanation: 'A resident can be assigned at most 3 home call shifts in a row before a break is required.' },
    { id: 'HC-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.06(c)', title: 'Max 2 weekends worked in 4 weeks', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcWeekendBlocks,
      explanation: 'A resident can be assigned home call on no more than 2 weekends in any 4-week period.' },
    { id: 'HC-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.06(c)', title: 'Max 2 consecutive weekends worked', callTypes: hcTypes, kind: 'hard', params: {}, check: checkHcConsecWeekends,
      explanation: 'A resident can\'t be assigned home call on more than 2 weekends in a row.' },

    { id: 'COMBINED-CALL-PRIMARY-REQUIRED', articleRef: 'PARA 2024-2028, Art 23.07(a)', title: 'Select primary combined-call rotation type', callTypes: combinedTypes, kind: 'hard', params: {}, check: checkCombinedCallPrimaryRequired,
      explanation: 'When a schedule contains both in-house and home call, the applicable Art. 23.07 cap table depends on whether the rotation is primarily home call or primarily in-house call.' },
    { id: 'COMBINED-CALL-CAPS', articleRef: 'PARA 2024-2028, Art 23.07(a)', title: 'Combined in-house and home-call cap', callTypes: combinedTypes, kind: 'hard', params: {}, check: checkCombinedCallCaps,
      explanation: 'Combined-call assignments must fit one row of the primary rotation\'s Art. 23.07 cap table within the 28-day rotation window.' },
    { id: 'COMBINED-CALL-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.07(c)', title: 'Max 2 combined-call weekends in 4 weeks', callTypes: combinedTypes, kind: 'hard', params: {}, check: checkCombinedWeekendBlocks,
      explanation: 'A combined-call rotation can include no more than 2 worked weekends in any 4-week period.' },
    { id: 'COMBINED-CALL-CONSEC-WEEKENDS', articleRef: 'PARA 2024-2028, Art 23.07(c)', title: 'Max 2 consecutive combined-call weekends', callTypes: combinedTypes, kind: 'hard', params: {}, check: checkCombinedConsecWeekends,
      explanation: 'A combined-call rotation cannot include more than 2 consecutive worked weekends.' },

    { id: 'STANDARD-MAX-WEEKDAY-CLINICAL-HOURS', articleRef: 'PARA 2024-2028, Art 23.02(b)', title: 'Max 12h standard weekday clinical duty', callTypes: scheduledDutyTypes, kind: 'hard', params: {}, check: checkStandardWeekdayClinicalHours,
      explanation: 'For a standard-duty rotation, entered regular-shift duration is treated as clinical duty and cannot exceed 12 hours on a weekday. On-call duty is recorded separately and is not included in this check.' },
    { id: 'STANDARD-NO-WEEKEND-SHIFTS', articleRef: 'PARA 2024-2028, Art 23.02(c)', title: 'No standard-duty work on Saturday or Sunday', callTypes: scheduledDutyTypes, kind: 'hard', params: {}, check: checkStandardWeekendWork,
      explanation: 'A standard-duty rotation cannot include scheduled non-call work on Saturday or Sunday. The current standalone input does not include named-holiday dates, so those must be reviewed separately.' },
    { id: 'SHIFT-BASED-MAX-WEEKLY-HOURS', articleRef: 'PARA 2024-2028, Art 23.03(b)(i)', title: 'Max 60h scheduled shifts per week', callTypes: scheduledDutyTypes, kind: 'hard', params: {}, check: checkShiftBasedWeeklyHours,
      explanation: 'A shift-based rotation can include at most 60 hours of scheduled regular or night-float shifts in any rolling 7-day period.' },
    { id: 'SHIFT-BASED-NO-ADDITIONAL-CALL', articleRef: 'PARA 2024-2028, Art 23.03(b)(ii)', title: 'No additional on-call on a shift-based rotation', callTypes: additionalCallTypes, kind: 'hard', params: {}, check: checkShiftBasedAdditionalCall,
      explanation: 'A resident on a shift-based rotation must not be required to take additional in-house, home, or activated backup call.' },
    { id: 'SHIFT-BASED-WEEKEND-BLOCKS', articleRef: 'PARA 2024-2028, Art 23.03(c)', title: 'Max 2 shift-based weekends in 4 weeks', callTypes: scheduledDutyTypes, kind: 'hard', params: {}, check: checkShiftBasedWeekendBlocks,
      explanation: 'A shift-based rotation may include scheduled shifts on no more than 2 weekends in any 4-week period.' },

    { id: 'REST-MIN-GAP', articleRef: 'PARA 2024-2028, Art 23.01(d)', title: 'Minimum 8h rest between in-house duty shifts', callTypes: ihTypes, kind: 'hard', params: {}, check: checkRestMinGap,
      explanation: 'In-house duty-hour shifts need at least 8 hours of rest between duty periods. The current input model cannot distinguish every standard or shift-based in-house duty arrangement.' },
    { id: 'MAX-DUTY-LENGTH', articleRef: 'PARA 2024-2028, Art 23.01(f)/(g)', title: 'Max 24h duty + 2h handover', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkMaxDutyLength,
      explanation: 'A single continuous stretch of duty can\'t run longer than 24 hours plus a 2-hour handover, 26 hours total.' },
    { id: 'MAX-WEEKLY-HOURS', articleRef: 'PARA 2024-2028, Art 23.01(e)', title: 'Max 80h/week averaged over 4 weeks', callTypes: sharedTypes, kind: 'hard', params: {}, check: checkMaxWeeklyHours,
      explanation: 'Average weekly duty hours, measured over any rolling 4-week span, can\'t exceed 80 hours.' },
    { id: 'VAC-NO-CALL-BLACKOUT', articleRef: 'PARA 2024-2028, Art 20.05', title: 'No prohibited duty before/during vacation', callTypes: vacTypes, kind: 'hard', params: {}, check: checkVacBlackout,
      explanation: 'No duty may be scheduled during vacation. The preceding day cannot contain on-call duty or a shift that continues past midnight.' },
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
