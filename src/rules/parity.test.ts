// Mirrors key fixtures from src/tests/test_rules_para_2024_2028.py in the
// main call-scheduler repo: one golden fixture per hard rule (a schedule
// designed to trigger it, and a neighbor designed not to), specifically to
// catch drift between this ported TS validator and the Python original it
// was translated from.
import { describe, expect, it } from 'vitest'
import type { AssignedShift, CallType, CombinedCallPrimary } from './types'
import { RuleContext } from './types'
import { buildRuleset } from './para_2024_2028'
import { selfCheck } from './selfCheck'
import { addDays, pymod, pythonWeekday } from './dates'

const RULESET = buildRuleset()

function shift(
  date: string | Date,
  opts: { callType?: CallType; startHour?: number; durationHours?: number; residentId?: string; id?: string } = {},
): AssignedShift {
  const { callType = 'in_house', startHour = 17, durationHours = 15, residentId = 'r1', id } = opts
  const dateStr = typeof date === 'string' ? date : formatYmd(date)
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(y, m - 1, d, startHour)
  const end = new Date(start.getTime() + durationHours * 3_600_000)
  return {
    shiftInstanceId: id ?? `${dateStr}_${callType}_${startHour}h`,
    residentId, callType, date: dateStr, startDt: start, endDt: end,
  }
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nextWeekday(start: Date, weekday: number): Date {
  return addDays(start, pymod(weekday - pythonWeekday(start), 7))
}

function datesFrom(start: Date, count: number, stepDays: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i * stepDays))
}

function saturdayShift(base: Date, weeksOffset: number, callType: CallType = 'in_house'): AssignedShift {
  const saturday = addDays(nextWeekday(base, 5), weeksOffset * 7)
  return shift(saturday, { callType, startHour: 8, durationHours: 9 })
}

function ruleCheck(ruleId: string, shifts: AssignedShift[], residentId = 'r1', ctx?: RuleContext) {
  const rule = RULESET.find(r => r.id === ruleId)
  if (!rule) throw new Error(`no such rule ${ruleId}`)
  return rule.check(shifts, residentId, rule.params, ctx ?? new RuleContext())
}

describe('IH-NO-CONSECUTIVE (Art 23.05(b))', () => {
  it('violates on consecutive in-house call days', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02')]
    const violations = ruleCheck('IH-NO-CONSECUTIVE', shifts)
    expect(violations.some(v => v.ruleId === 'IH-NO-CONSECUTIVE')).toBe(true)
    expect(violations[0].dates).toEqual(['2025-09-01', '2025-09-02'])
  })
  it('passes with a gap', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-03')]
    expect(ruleCheck('IH-NO-CONSECUTIVE', shifts)).toEqual([])
  })
  it('reports each prohibited adjacent pair', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02'), shift('2025-09-03')]
    const violations = ruleCheck('IH-NO-CONSECUTIVE', shifts)
    expect(violations).toHaveLength(2)
    expect(violations[0].dates).toEqual(['2025-09-01', '2025-09-02'])
    expect(violations[1].dates).toEqual(['2025-09-02', '2025-09-03'])
  })
  it('does not apply to regular duty', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02', { callType: 'regular', startHour: 8, durationHours: 9 })]
    expect(ruleCheck('IH-NO-CONSECUTIVE', shifts)).toEqual([])
  })
  it('violates when followed by a home call shift', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02', { callType: 'home' })]
    const violations = ruleCheck('IH-NO-CONSECUTIVE', shifts)
    expect(violations.some(v => v.ruleId === 'IH-NO-CONSECUTIVE')).toBe(true)
  })
  it('anchors on a home call shift too', () => {
    // An adjacent home-call/in-house-call pair is the prohibited combination.
    const shifts = [shift('2025-09-01', { callType: 'home' }), shift('2025-09-02')]
    const violations = ruleCheck('IH-NO-CONSECUTIVE', shifts)
    expect(violations.some(v => v.ruleId === 'IH-NO-CONSECUTIVE')).toBe(true)
  })
  it('allows consecutive home call days', () => {
    const shifts = [shift('2025-09-01', { callType: 'home' }), shift('2025-09-02', { callType: 'home' })]
    expect(ruleCheck('IH-NO-CONSECUTIVE', shifts)).toEqual([])
  })
  it('does not infer activated backup as in-house call', () => {
    const shifts = [shift('2025-09-01', { callType: 'backup' }), shift('2025-09-02')]
    expect(ruleCheck('IH-NO-CONSECUTIVE', shifts)).toEqual([])
  })
  it('day call into night call the same day is not a violation', () => {
    const day = shift('2025-09-06', { startHour: 8, durationHours: 9, id: 'day' })
    const night = shift('2025-09-06', { startHour: 17, durationHours: 15, id: 'night' })
    expect(ruleCheck('IH-NO-CONSECUTIVE', [day, night])).toEqual([])
  })
  it('does not treat next-day regular duty as call', () => {
    const day = shift('2025-09-06', { startHour: 8, durationHours: 9, id: 'day' })
    const night = shift('2025-09-06', { startHour: 17, durationHours: 15, id: 'night' })
    const regular = shift('2025-09-07', { callType: 'regular', startHour: 8, durationHours: 9 })
    expect(ruleCheck('IH-NO-CONSECUTIVE', [day, night, regular])).toEqual([])
  })
})

describe('HC-MAX-CONSECUTIVE (Art 23.06(b))', () => {
  it('violates at 4 in a row', () => {
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 4, 1).map(d => shift(d, { callType: 'home' }))
    expect(ruleCheck('HC-MAX-CONSECUTIVE', shifts).some(v => v.ruleId === 'HC-MAX-CONSECUTIVE')).toBe(true)
  })
  it('passes at 3 in a row', () => {
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 3, 1).map(d => shift(d, { callType: 'home' }))
    expect(ruleCheck('HC-MAX-CONSECUTIVE', shifts)).toEqual([])
  })
})

describe('Combined in-house and home call (Art 23.07)', () => {
  function combinedShifts(homeCount: number, inHouseCount: number): AssignedShift[] {
    const dates = datesFrom(new Date(2025, 8, 1), homeCount + inHouseCount, 2)
    return dates.map((date, index) => shift(date, { callType: index < homeCount ? 'home' : 'in_house' }))
  }

  function combinedContext(primary: CombinedCallPrimary): RuleContext {
    return new RuleContext({ combinedCallPrimary: new Map([['r1', primary]]) })
  }

  it('requires a primary rotation type when both call types are present', () => {
    const violations = ruleCheck('COMBINED-CALL-PRIMARY-REQUIRED', combinedShifts(1, 1))
    expect(violations).toHaveLength(1)
  })

  it('enforces the primarily home-call cap table', () => {
    const violations = ruleCheck('COMBINED-CALL-CAPS', combinedShifts(8, 2), 'r1', combinedContext('home'))
    expect(violations.some(v => v.ruleId === 'COMBINED-CALL-CAPS')).toBe(true)
    expect(ruleCheck('COMBINED-CALL-CAPS', combinedShifts(7, 2), 'r1', combinedContext('home'))).toEqual([])
  })

  it('enforces the primarily in-house-call cap table', () => {
    const violations = ruleCheck('COMBINED-CALL-CAPS', combinedShifts(3, 5), 'r1', combinedContext('in_house'))
    expect(violations.some(v => v.ruleId === 'COMBINED-CALL-CAPS')).toBe(true)
  })

  it('counts in-house and home call together for weekend limits', () => {
    const base = new Date(2025, 8, 1)
    const shifts = [
      saturdayShift(base, 0, 'in_house'),
      saturdayShift(base, 2, 'home'),
      saturdayShift(base, 3, 'in_house'),
    ]
    const violations = ruleCheck('COMBINED-CALL-WEEKEND-BLOCKS', shifts, 'r1', combinedContext('home'))
    expect(violations.some(v => v.ruleId === 'COMBINED-CALL-WEEKEND-BLOCKS')).toBe(true)
  })

  it('infers the primary table in self-check instead of requiring a manual selection', () => {
    const shifts = combinedShifts(1, 1).map(s => ({
      callType: s.callType, date: s.date,
      startDt: s.startDt.toISOString().slice(0, 19), endDt: s.endDt.toISOString().slice(0, 19),
    }))
    const violations = selfCheck(shifts, [])
    expect(violations.some(v => v.ruleId === 'COMBINED-CALL-PRIMARY-REQUIRED')).toBe(false)
  })
})

describe('Standard and shift-based duty (Art 23.02 / 23.03)', () => {
  function dutyContext(model: 'standard' | 'shift_based'): RuleContext {
    return new RuleContext({ dutyModel: new Map([['r1', model]]) })
  }

  it('uses standard duty by default and caps weekday clinical duty at 12 hours', () => {
    const regular = shift('2025-09-01', { callType: 'regular', startHour: 7, durationHours: 13 })
    const violations = ruleCheck('STANDARD-MAX-WEEKDAY-CLINICAL-HOURS', [regular])
    expect(violations.some(v => v.ruleId === 'STANDARD-MAX-WEEKDAY-CLINICAL-HOURS')).toBe(true)
  })

  it('prohibits scheduled non-call work on a standard-duty weekend', () => {
    const regular = shift('2025-09-06', { callType: 'regular', startHour: 8, durationHours: 8 })
    const violations = ruleCheck('STANDARD-NO-WEEKEND-SHIFTS', [regular])
    expect(violations.some(v => v.ruleId === 'STANDARD-NO-WEEKEND-SHIFTS')).toBe(true)
  })

  it('allows weekend scheduled shifts but caps a shift-based rotation at 60 hours in 7 days', () => {
    const shifts = datesFrom(new Date(2025, 8, 1), 5, 1)
      .map(date => shift(date, { callType: 'regular', startHour: 7, durationHours: 13 }))
    const violations = ruleCheck('SHIFT-BASED-MAX-WEEKLY-HOURS', shifts, 'r1', dutyContext('shift_based'))
    expect(violations.some(v => v.ruleId === 'SHIFT-BASED-MAX-WEEKLY-HOURS')).toBe(true)
  })

  it('prohibits additional call while on a shift-based rotation', () => {
    const call = shift('2025-09-01', { callType: 'in_house' })
    const violations = ruleCheck('SHIFT-BASED-NO-ADDITIONAL-CALL', [call], 'r1', dutyContext('shift_based'))
    expect(violations.some(v => v.ruleId === 'SHIFT-BASED-NO-ADDITIONAL-CALL')).toBe(true)
  })

  it('caps shift-based scheduled work at two weekends in four weeks', () => {
    const base = new Date(2025, 8, 1)
    const shifts = [0, 2, 3].map(offset => saturdayShift(base, offset, 'regular'))
    const violations = ruleCheck('SHIFT-BASED-WEEKEND-BLOCKS', shifts, 'r1', dutyContext('shift_based'))
    expect(violations.some(v => v.ruleId === 'SHIFT-BASED-WEEKEND-BLOCKS')).toBe(true)
  })
})

describe('IH-MAX-10D (max 4 in a period under 10 consecutive days)', () => {
  it('violates at 5 in a 9-day span', () => {
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 5, 2).map(d => shift(d))
    expect(ruleCheck('IH-MAX-10D', shifts).some(v => v.ruleId === 'IH-MAX-10D')).toBe(true)
  })
  it('dates are the actual shift days, not the window\'s outer bounds', () => {
    // The returned dates are the five actual shift days, not all dates in the window.
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 5, 2).map(d => shift(d))
    const violations = ruleCheck('IH-MAX-10D', shifts)
    expect(violations[0].dates).toEqual(['2025-09-01', '2025-09-03', '2025-09-05', '2025-09-07', '2025-09-09'])
  })
  it('passes at 4 in a 9-day span', () => {
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 4, 2).map(d => shift(d))
    expect(ruleCheck('IH-MAX-10D', shifts)).toEqual([])
  })
})

describe('Weekend rules (Art 23.05(c) / 23.06(c))', () => {
  const base = new Date(2025, 8, 1)

  it('IH-WEEKEND-BLOCKS violates at 3 weekends in four weeks', () => {
    const shifts = [0, 2, 3].map(w => saturdayShift(base, w))
    expect(ruleCheck('IH-WEEKEND-BLOCKS', shifts).some(v => v.ruleId === 'IH-WEEKEND-BLOCKS')).toBe(true)
  })
  it('IH-WEEKEND-BLOCKS passes at 2 weekends', () => {
    const shifts = [0, 2].map(w => saturdayShift(base, w))
    expect(ruleCheck('IH-WEEKEND-BLOCKS', shifts)).toEqual([])
  })
  it('IH-WEEKEND-BLOCKS allows 3 weekends across five weeks', () => {
    const shifts = [0, 2, 4].map(w => saturdayShift(base, w))
    expect(ruleCheck('IH-WEEKEND-BLOCKS', shifts)).toEqual([])
  })
  it('IH-CONSEC-WEEKENDS violates at 3 in a row', () => {
    const shifts = [0, 1, 2].map(w => saturdayShift(base, w))
    expect(ruleCheck('IH-CONSEC-WEEKENDS', shifts).some(v => v.ruleId === 'IH-CONSEC-WEEKENDS')).toBe(true)
  })
  it('IH-CONSEC-WEEKENDS passes at 2 in a row', () => {
    const shifts = [0, 1].map(w => saturdayShift(base, w))
    expect(ruleCheck('IH-CONSEC-WEEKENDS', shifts)).toEqual([])
  })
  it('NF weekend rules apply the same as IH/HC', () => {
    const violating = [0, 2, 3].map(w => saturdayShift(base, w, 'night_float'))
    const passing = [0, 2].map(w => saturdayShift(base, w, 'night_float'))
    expect(ruleCheck('NF-WEEKEND-BLOCKS', violating).some(v => v.ruleId === 'NF-WEEKEND-BLOCKS')).toBe(true)
    expect(ruleCheck('NF-WEEKEND-BLOCKS', passing)).toEqual([])
  })
})

describe('REST-MIN-GAP (Art 23.01(d))', () => {
  it('violates with less than 8h rest', () => {
    const a = shift('2025-09-01', { startHour: 17, durationHours: 15 }) // ends 09-02 08:00
    const b = shift('2025-09-02', { startHour: 12, durationHours: 9, id: 'b' }) // starts 4h later
    expect(ruleCheck('REST-MIN-GAP', [a, b]).some(v => v.ruleId === 'REST-MIN-GAP')).toBe(true)
  })
  it('passes at exactly 8h', () => {
    const a = shift('2025-09-01', { startHour: 17, durationHours: 15 })
    const b = shift('2025-09-02', { startHour: 16, durationHours: 9, id: 'b' })
    expect(ruleCheck('REST-MIN-GAP', [a, b])).toEqual([])
  })
  it('reports every insufficient gap among 4 consecutive shifts, not just the first', () => {
    // Each 17-hour shift has a 7-hour gap before the next one.
    const shifts = [1, 2, 3, 4].map(day =>
      shift(`2025-09-0${day}`, { startHour: 13, durationHours: 17, id: `s${day}` }))
    const violations = ruleCheck('REST-MIN-GAP', shifts)
    expect(violations).toHaveLength(3)
    expect(violations.every(v => v.ruleId === 'REST-MIN-GAP')).toBe(true)
  })
  it('back-to-back night float is exempt even with a short gap', () => {
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 4, 1).map(d => shift(d, { callType: 'night_float', startHour: 17, durationHours: 15 }))
    expect(ruleCheck('REST-MIN-GAP', shifts)).toEqual([])
  })
  it('overlapping night-float shifts still violate', () => {
    const a = shift('2025-09-01', { callType: 'night_float', startHour: 17, durationHours: 15, id: 'a' })
    const b = shift('2025-09-02', { callType: 'night_float', startHour: 6, durationHours: 15, id: 'b' })
    expect(ruleCheck('REST-MIN-GAP', [a, b]).some(v => v.ruleId === 'REST-MIN-GAP')).toBe(true)
  })
  it('night float into a different call type still needs rest', () => {
    const nf = shift('2025-09-01', { callType: 'night_float', startHour: 17, durationHours: 15, id: 'nf' })
    const ih = shift('2025-09-02', { callType: 'in_house', startHour: 12, durationHours: 9, id: 'ih' })
    expect(ruleCheck('REST-MIN-GAP', [nf, ih]).some(v => v.ruleId === 'REST-MIN-GAP')).toBe(true)
  })
})

describe('MAX-DUTY-LENGTH (Art 23.01(f)/(g))', () => {
  it('violates over 26h continuous duty', () => {
    const a = shift('2025-09-01', { startHour: 17, durationHours: 27 })
    expect(ruleCheck('MAX-DUTY-LENGTH', [a]).some(v => v.ruleId === 'MAX-DUTY-LENGTH')).toBe(true)
  })
})

describe('VAC-NO-CALL-BLACKOUT / VAC-WEEKEND-ADJACENCY (Art 20.05)', () => {
  it('violates for a shift on the vacation day itself', () => {
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(['2025-09-05'])]]) })
    const a = shift('2025-09-05')
    expect(ruleCheck('VAC-NO-CALL-BLACKOUT', [a], 'r1', ctx).some(v => v.ruleId === 'VAC-NO-CALL-BLACKOUT')).toBe(true)
  })
  it('violates for a shift the day before vacation', () => {
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(['2025-09-05'])]]) })
    const a = shift('2025-09-04')
    expect(ruleCheck('VAC-NO-CALL-BLACKOUT', [a], 'r1', ctx).some(v => v.ruleId === 'VAC-NO-CALL-BLACKOUT')).toBe(true)
  })
  it('allows regular daytime duty the day before vacation', () => {
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(['2025-09-05'])]]) })
    const daytime = shift('2025-09-04', { callType: 'regular', startHour: 8, durationHours: 9 })
    expect(ruleCheck('VAC-NO-CALL-BLACKOUT', [daytime], 'r1', ctx)).toEqual([])
  })
  it('prohibits regular duty that continues past midnight before vacation', () => {
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(['2025-09-05'])]]) })
    const overnight = shift('2025-09-04', { callType: 'regular', startHour: 17, durationHours: 15 })
    expect(ruleCheck('VAC-NO-CALL-BLACKOUT', [overnight], 'r1', ctx).some(v => v.ruleId === 'VAC-NO-CALL-BLACKOUT')).toBe(true)
  })
  it('passes when far from vacation', () => {
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(['2025-09-05'])]]) })
    const a = shift('2025-09-10')
    expect(ruleCheck('VAC-NO-CALL-BLACKOUT', [a], 'r1', ctx)).toEqual([])
  })
  it('passes when only the following weekend is worked (one of two is guaranteed, not both)', () => {
    const monday = nextWeekday(new Date(2025, 8, 1), 0)
    const vacationRun = Array.from({ length: 5 }, (_, i) => formatYmd(addDays(monday, i)))
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(vacationRun)]]) })
    const followingSaturday = addDays(monday, 5)
    const a = shift(followingSaturday, { startHour: 8, durationHours: 9 })
    expect(ruleCheck('VAC-WEEKEND-ADJACENCY', [a], 'r1', ctx)).toEqual([])
  })
  it('counts duty that crosses Friday 18:00 as weekend work', () => {
    const monday = nextWeekday(new Date(2025, 8, 1), 0)
    const vacationRun = Array.from({ length: 5 }, (_, i) => formatYmd(addDays(monday, i)))
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(vacationRun)]]) })
    const fridayOverlap = shift(addDays(monday, -3), { startHour: 17, durationHours: 2, id: 'friday-overlap' })
    const followingSaturday = shift(addDays(monday, 5), { startHour: 8, durationHours: 9, id: 'following' })
    expect(ruleCheck('VAC-WEEKEND-ADJACENCY', [fridayOverlap, followingSaturday], 'r1', ctx)).toHaveLength(2)
  })
  it('violates when both adjacent weekends are worked', () => {
    const monday = nextWeekday(new Date(2025, 8, 1), 0)
    const vacationRun = Array.from({ length: 5 }, (_, i) => formatYmd(addDays(monday, i)))
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(vacationRun)]]) })
    const precedingSaturday = addDays(monday, -2)
    const followingSaturday = addDays(monday, 5)
    const shifts = [
      shift(precedingSaturday, { startHour: 8, durationHours: 9, id: 'before' }),
      shift(followingSaturday, { startHour: 8, durationHours: 9, id: 'after' }),
    ]
    const violations = ruleCheck('VAC-WEEKEND-ADJACENCY', shifts, 'r1', ctx)
    expect(violations).toHaveLength(2)
    expect(violations.every(v => v.ruleId === 'VAC-WEEKEND-ADJACENCY')).toBe(true)
  })
  it('does not flag a distant weekend', () => {
    const monday = nextWeekday(new Date(2025, 8, 1), 0)
    const vacationRun = Array.from({ length: 5 }, (_, i) => formatYmd(addDays(monday, i)))
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(vacationRun)]]) })
    const distantSaturday = addDays(monday, 19)
    const a = shift(distantSaturday, { startHour: 8, durationHours: 9 })
    expect(ruleCheck('VAC-WEEKEND-ADJACENCY', [a], 'r1', ctx)).toEqual([])
  })
})

describe('Proration (Art 23.05/23.06)', () => {
  it('IH-MAX-28D caps at 7 for a full 28-day block', () => {
    const start = new Date(2025, 8, 1)
    // Sept 1, 5, 9, 13, 17, 21, 25: 7 shifts, all within the Sept 1-28 window.
    const compliant = datesFrom(start, 7, 4).map(d => shift(d))
    expect(ruleCheck('IH-MAX-28D', compliant)).toEqual([])
    // An 8th shift still inside that same 28-day window pushes it over the cap.
    const tooMany = [...compliant, shift(addDays(start, 26), { id: 'extra' })]
    expect(ruleCheck('IH-MAX-28D', tooMany).some(v => v.ruleId === 'IH-MAX-28D')).toBe(true)
  })
})
