// Mirrors src/tests/test_rules_para_2024_2028_peds_uofa_lou.py in the main
// call-scheduler repo: golden fixtures for the General Pediatrics UofA
// 2026-2027 LOU ruleset's IH-MAX-10D night-float exemption and the new
// NF-WEEKLY-MAX / BACKUP-WEEKEND-POST-CALL rules.
import { describe, expect, it } from 'vitest'
import type { AssignedShift, CallType } from './types'
import { RuleContext } from './types'
import { buildRuleset } from './para_2024_2028_peds_uofa_lou'
import { addDays } from './dates'

const RULESET = buildRuleset()

function shift(
  date: string,
  opts: { callType?: CallType; startHour?: number; durationHours?: number; residentId?: string; id?: string } = {},
): AssignedShift {
  const { callType = 'in_house', startHour = 17, durationHours = 15, residentId = 'r1', id } = opts
  const [y, m, d] = date.split('-').map(Number)
  const start = new Date(y, m - 1, d, startHour)
  const end = new Date(start.getTime() + durationHours * 3_600_000)
  return { shiftInstanceId: id ?? `${date}_${callType}_${startHour}h`, residentId, callType, date, startDt: start, endDt: end }
}

function ruleCheck(ruleId: string, shifts: AssignedShift[], residentId = 'r1', ctx?: RuleContext) {
  const rule = RULESET.find(r => r.id === ruleId)
  if (!rule) throw new Error(`no such rule ${ruleId}`)
  return rule.check(shifts, residentId, rule.params, ctx ?? new RuleContext())
}

function datesFrom(startStr: string, count: number, stepDays: number): string[] {
  const [y, m, d] = startStr.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  return Array.from({ length: count }, (_, i) => {
    const dt = addDays(start, i * stepDays)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  })
}

describe('ruleset registry', () => {
  it('builds without throwing', () => {
    expect(() => buildRuleset()).not.toThrow()
  })
  it('every hard rule has check', () => {
    for (const rule of RULESET.filter(r => r.kind === 'hard')) {
      expect(rule.check).toBeTruthy()
    }
  })
  it('has no duplicate rule ids', () => {
    const ids = RULESET.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('has no home call rules (this program has no home call rotation)', () => {
    const ids = RULESET.map(r => r.id)
    expect(ids.some(id => id.startsWith('HC-') || id.startsWith('FAIR-HC-'))).toBe(false)
  })
})

describe('REST-MIN-GAP (LOU): 8h minimum rest', () => {
  it('a 9h gap passes under the LOU\'s 8h protection', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02', { callType: 'home', startHour: 17, durationHours: 9 })]
    expect(ruleCheck('REST-MIN-GAP', shifts)).toEqual([])
  })
  it('a 7h gap still violates under the LOU\'s 8h protection', () => {
    const shifts = [shift('2025-09-01'), shift('2025-09-02', { callType: 'home', startHour: 15, durationHours: 9 })]
    const violations = ruleCheck('REST-MIN-GAP', shifts)
    expect(violations.length).toBe(1)
    expect(violations[0].ruleId).toBe('REST-MIN-GAP')
  })
})

describe('IH-MAX-10D (LOU): night-float rotation exempts the under-10-day cap', () => {
  it('still violates far from any NF rotation', () => {
    const shifts = datesFrom('2025-09-01', 5, 2).map(d => shift(d))
    const violations = ruleCheck('IH-MAX-10D', shifts)
    expect(violations.length).toBe(1)
    expect(violations[0].ruleId).toBe('IH-MAX-10D')
  })

  it('is exempt when in-house calls fall within the NF rotation window', () => {
    const ihShifts = datesFrom('2025-09-01', 5, 2).map(d => shift(d))
    const nfShift = shift('2025-09-05', { callType: 'night_float' })
    expect(ruleCheck('IH-MAX-10D', [...ihShifts, nfShift])).toEqual([])
  })

  it('is exempt when the NF rotation is the week before', () => {
    const nfShift = shift('2025-09-01', { callType: 'night_float' })
    const ihShifts = datesFrom('2025-09-08', 5, 2).map(d => shift(d))
    expect(ruleCheck('IH-MAX-10D', [...ihShifts, nfShift])).toEqual([])
  })

  it('still violates when the NF rotation is too far away', () => {
    const nfShift = shift('2025-09-01', { callType: 'night_float' })
    const ihShifts = datesFrom('2025-09-21', 5, 2).map(d => shift(d))
    const violations = ruleCheck('IH-MAX-10D', [...ihShifts, nfShift])
    expect(violations.length).toBe(1)
  })
})

describe('NF-WEEKLY-MAX (LOU): max 4 overnight NF shifts per rolling 7 days', () => {
  it('violates at 5 in a row', () => {
    const shifts = datesFrom('2025-09-01', 5, 1).map(d => shift(d, { callType: 'night_float' }))
    const violations = ruleCheck('NF-WEEKLY-MAX', shifts)
    expect(violations.length).toBe(1)
    expect(violations[0].ruleId).toBe('NF-WEEKLY-MAX')
  })
  it('does not violate at the cap', () => {
    const shifts = datesFrom('2025-09-01', 4, 1).map(d => shift(d, { callType: 'night_float' }))
    expect(ruleCheck('NF-WEEKLY-MAX', shifts)).toEqual([])
  })
})

// 2025-09-05 is a Friday; 09-06 Saturday, 09-07 Sunday, 09-08 Monday.
describe('BACKUP-WEEKEND-POST-CALL (LOU): 2+ separate weekend activations guarantee a duty-free Monday', () => {
  it('violates with two separate activations and Monday duty', () => {
    const shifts = [
      shift('2025-09-06', { callType: 'backup' }),
      shift('2025-09-07', { callType: 'backup' }),
      shift('2025-09-08', { callType: 'regular', startHour: 8, durationHours: 9 }),
    ]
    const violations = ruleCheck('BACKUP-WEEKEND-POST-CALL', shifts)
    expect(violations.length).toBe(1)
    expect(violations[0].dates).toEqual(['2025-09-08'])
  })

  it('passes when Monday is free', () => {
    const shifts = [
      shift('2025-09-06', { callType: 'backup' }),
      shift('2025-09-07', { callType: 'backup' }),
    ]
    expect(ruleCheck('BACKUP-WEEKEND-POST-CALL', shifts)).toEqual([])
  })

  it('passes for a single merged 26h day-night activation', () => {
    const shifts = [
      shift('2025-09-06', { callType: 'backup', startHour: 8, durationHours: 9 }),
      shift('2025-09-06', { callType: 'backup', startHour: 17, durationHours: 15, id: 'sat_night' }),
      shift('2025-09-08', { callType: 'regular', startHour: 8, durationHours: 9 }),
    ]
    expect(ruleCheck('BACKUP-WEEKEND-POST-CALL', shifts)).toEqual([])
  })
})
