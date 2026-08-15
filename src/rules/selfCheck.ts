// Ported from self_check() in src/api/services.py (main call-scheduler repo)
// the standalone entry point: takes a resident's own entered shifts (not
// tied to any admin-generated schedule) plus their vacation dates, and
// returns PARA violations using the same validate() used everywhere else.
import type { CallType, CombinedCallPrimary, DutyModel, Violation } from './types'
import { RuleContext } from './types'
import { getRuleset, RULESETS } from './rulesets'
import { validate } from './validator'

export interface SelfCheckShiftInput {
  id?: string
  callType: CallType
  date: string // YYYY-MM-DD
  startDt: string // ISO datetime, e.g. "2026-07-01T17:00:00"
  endDt: string // ISO datetime
}

function inferCombinedCallPrimary(shifts: Array<{ callType: CallType }>): CombinedCallPrimary | undefined {
  const homeCount = shifts.filter(s => s.callType === 'home').length
  const inHouseCount = shifts.filter(s => s.callType === 'in_house').length
  if (homeCount === 0 || inHouseCount === 0) return undefined
  // Equal counts are valid against the same Art. 23.07 boundary at every
  // possible count, so either table produces the same pass/fail result.
  return homeCount >= inHouseCount ? 'home' : 'in_house'
}

export function selfCheck(
  shifts: SelfCheckShiftInput[],
  vacationDates: string[],
  overrides: string[] = [],
  rulesetVersion: string = RULESETS[0].version,
  dutyModel: DutyModel = 'standard',
): Violation[] {
  const residentId = 'self'
  const assigned = shifts.map((s, i) => ({
    shiftInstanceId: s.id ?? `self_${i}`,
    residentId,
    callType: s.callType,
    date: s.date,
    startDt: new Date(s.startDt),
    endDt: new Date(s.endDt),
  }))

  // Pro-ration (Art 23.05/23.06) reduces the days-on-service count by
  // vacation days; self-check assumes a full 28-day block otherwise, so a
  // resident who entered vacation days must have those excluded here too,
  // or IH-MAX-28D/HC-MAX-28D would check against the wrong (too generous) cap.
  const vacationSet = new Set(vacationDates)
  const daysOnService = Math.max(0, 28 - vacationSet.size)

  const ctx = new RuleContext({
    vacationDays: new Map([[residentId, vacationSet]]),
    daysOnService: new Map([[residentId, daysOnService]]),
    overriddenRuleIds: new Map([[residentId, new Set(overrides)]]),
    combinedCallPrimary: (() => {
      const primary = inferCombinedCallPrimary(assigned)
      return primary ? new Map([[residentId, primary]]) : new Map()
    })(),
    dutyModel: new Map([[residentId, dutyModel]]),
  })

  return validate(assigned, getRuleset(rulesetVersion), ctx)
}
