// Mirrors key fixtures from src/tests/test_rules_para_2024_2028.py in the
// main call-scheduler repo: one golden fixture per hard rule (a schedule
// designed to trigger it, and a neighbor designed not to), specifically to
// catch drift between this ported TS validator and the Python original it
// was translated from.
import { describe, expect, it } from 'vitest'
import type { AssignedShift, CallType } from './types'
import { RuleContext } from './types'
import { buildRuleset } from './para_2024_2028'
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
  it('violates on back-to-back days (only 9h between them, under the 10h guarantee)', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02')]
    const violations = ruleCheck('IH-NO-CONSECUTIVE', shifts)
    expect(violations.some(v => v.ruleId === 'IH-NO-CONSECUTIVE')).toBe(true)
    expect(violations[0].dates).toEqual(['2025-09-01', '2025-09-02'])
  })
  it('passes with a gap', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-03')]
    expect(ruleCheck('IH-NO-CONSECUTIVE', shifts)).toEqual([])
  })
  it('reports every gap, not just the first (a gap check, not a day-run check)', () => {
    // 3 consecutive in-house call days have 2 gaps between them (09-01→09-02
    // and 09-02→09-03), each its own distinct violation worth its own row.
    const shifts = [shift('2025-09-01'), shift('2025-09-02'), shift('2025-09-03')]
    const violations = ruleCheck('IH-NO-CONSECUTIVE', shifts)
    expect(violations).toHaveLength(2)
    expect(violations[0].dates).toEqual(['2025-09-01', '2025-09-02'])
    expect(violations[1].dates).toEqual(['2025-09-02', '2025-09-03'])
  })
  it('violates when followed by a regular shift with zero gap (the guarantee is 10h rest, not a duty-free calendar day)', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02', { callType: 'regular', startHour: 8, durationHours: 9 })]
    const violations = ruleCheck('IH-NO-CONSECUTIVE', shifts)
    expect(violations.some(v => v.ruleId === 'IH-NO-CONSECUTIVE')).toBe(true)
  })
  it('passes when a regular shift starts a full 10h after the in-house call ends', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02', { callType: 'regular', startHour: 18, durationHours: 9 })]
    expect(ruleCheck('IH-NO-CONSECUTIVE', shifts)).toEqual([])
  })
  it('violates when followed by a home call shift', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02', { callType: 'home' })]
    const violations = ruleCheck('IH-NO-CONSECUTIVE', shifts)
    expect(violations.some(v => v.ruleId === 'IH-NO-CONSECUTIVE')).toBe(true)
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

describe('IH-MAX-10D / HC-MAX-10D (max 4 per 10 days)', () => {
  it('violates at 5 in a 10-day span', () => {
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 5, 2).map(d => shift(d))
    expect(ruleCheck('IH-MAX-10D', shifts).some(v => v.ruleId === 'IH-MAX-10D')).toBe(true)
  })
  it('dates are the actual shift days, not the window\'s outer bounds', () => {
    // Shifts every other day: 9-01, 9-03, 9-05, 9-07, 9-09 - 5 shifts inside
    // the Sept 1-10 window, but the window's own bounds (9-01 to 9-10) are
    // NOT all shift days; only the 5 sparse dates actually are.
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 5, 2).map(d => shift(d))
    const violations = ruleCheck('IH-MAX-10D', shifts)
    expect(violations[0].dates).toEqual(['2025-09-01', '2025-09-03', '2025-09-05', '2025-09-07', '2025-09-09'])
  })
  it('passes at 4 in a 10-day span', () => {
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 4, 2).map(d => shift(d))
    expect(ruleCheck('IH-MAX-10D', shifts)).toEqual([])
  })
})

describe('Weekend rules (Art 23.05(c) / 23.06(c))', () => {
  const base = new Date(2025, 8, 1)

  it('IH-WEEKEND-BLOCKS violates at 3 weekends', () => {
    const shifts = [0, 2, 4].map(w => saturdayShift(base, w))
    expect(ruleCheck('IH-WEEKEND-BLOCKS', shifts).some(v => v.ruleId === 'IH-WEEKEND-BLOCKS')).toBe(true)
  })
  it('IH-WEEKEND-BLOCKS passes at 2 weekends', () => {
    const shifts = [0, 2].map(w => saturdayShift(base, w))
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
    const violating = [0, 2, 4].map(w => saturdayShift(base, w, 'night_float'))
    const passing = [0, 2].map(w => saturdayShift(base, w, 'night_float'))
    expect(ruleCheck('NF-WEEKEND-BLOCKS', violating).some(v => v.ruleId === 'NF-WEEKEND-BLOCKS')).toBe(true)
    expect(ruleCheck('NF-WEEKEND-BLOCKS', passing)).toEqual([])
  })
})

describe('REST-MIN-GAP (Art 23.01(d)) incl. night-float exception', () => {
  it('violates with less than 10h rest', () => {
    const a = shift('2025-09-01', { startHour: 17, durationHours: 15 }) // ends 09-02 08:00
    const b = shift('2025-09-02', { startHour: 12, durationHours: 9, id: 'b' }) // starts 4h later
    expect(ruleCheck('REST-MIN-GAP', [a, b]).some(v => v.ruleId === 'REST-MIN-GAP')).toBe(true)
  })
  it('passes at exactly 10h', () => {
    const a = shift('2025-09-01', { startHour: 17, durationHours: 15 })
    const b = shift('2025-09-02', { startHour: 18, durationHours: 9, id: 'b' })
    expect(ruleCheck('REST-MIN-GAP', [a, b])).toEqual([])
  })
  it('reports every insufficient gap among 4 consecutive shifts, not just the first', () => {
    // Each shift is 17:00-08:00 (15h), giving a 9h gap to the next one --
    // 4 shifts means 3 gaps, and all 3 are under the 10h minimum.
    const shifts = [1, 2, 3, 4].map(day =>
      shift(`2025-09-0${day}`, { startHour: 17, durationHours: 15, id: `s${day}` }))
    const violations = ruleCheck('REST-MIN-GAP', shifts)
    expect(violations).toHaveLength(3)
    expect(violations.every(v => v.ruleId === 'REST-MIN-GAP')).toBe(true)
  })
  it('back-to-back night float is exempt even with a short gap', () => {
    const start = new Date(2025, 8, 1)
    const shifts = datesFrom(start, 4, 1).map(d => shift(d, { callType: 'night_float', startHour: 17, durationHours: 15 }))
    expect(ruleCheck('REST-MIN-GAP', shifts)).toEqual([])
  })
  it('overlapping night-float shifts still violate (exception is for gaps, not overlap)', () => {
    const a = shift('2025-09-01', { callType: 'night_float', startHour: 17, durationHours: 15, id: 'a' })
    const b = shift('2025-09-02', { callType: 'night_float', startHour: 6, durationHours: 15, id: 'b' })
    expect(ruleCheck('REST-MIN-GAP', [a, b]).some(v => v.ruleId === 'REST-MIN-GAP')).toBe(true)
  })
  it('night float into a different call type still needs full rest', () => {
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
  it('passes when far from vacation', () => {
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(['2025-09-05'])]]) })
    const a = shift('2025-09-10')
    expect(ruleCheck('VAC-NO-CALL-BLACKOUT', [a], 'r1', ctx)).toEqual([])
  })
  it('flags the weekend immediately after a 5-day weekday vacation run', () => {
    const monday = nextWeekday(new Date(2025, 8, 1), 0)
    const vacationRun = Array.from({ length: 5 }, (_, i) => formatYmd(addDays(monday, i)))
    const ctx = new RuleContext({ vacationDays: new Map([['r1', new Set(vacationRun)]]) })
    const followingSaturday = addDays(monday, 5)
    const a = shift(followingSaturday, { startHour: 8, durationHours: 9 })
    expect(ruleCheck('VAC-WEEKEND-ADJACENCY', [a], 'r1', ctx).some(v => v.ruleId === 'VAC-WEEKEND-ADJACENCY')).toBe(true)
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
