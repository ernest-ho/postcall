// Ported from src/rules/para_2024_2028_peds_uofa_lou.py (main call-scheduler
// repo): the check()-only subset (no CP-SAT encode(), same reasoning as
// para_2024_2028.ts — this standalone tool only ever validates).
//
// LOU: General Pediatrics UofA 2026-2027, Alternative Duty Schedule (Art
// 23.08). Source: docs/reference/LOU - General Pediatrics UofA 2026-2027.docx
// in the main call-scheduler repo. Selectable instead of the base
// para_2024_2028 ruleset, for the General Pediatrics (Stollery Children's
// Hospital) night float program only.
//
// Derived from para_2024_2028's buildRuleset() with these changes:
//   - IH-NO-CONSECUTIVE (Art 23.05(b)) is overridden: this LOU protects only
//     8 hours of post-call rest, not the base agreement's 10.
//   - REST-MIN-GAP (Art 23.01(d)) is overridden the same way: the general
//     minimum rest between any two duty periods is also 8 hours here, not 10.
//   - IH-MAX-10D (Art 23.05(e)) is overridden: waived during a resident's
//     own night float rotation and the week immediately before and after it.
//   - NF-WEEKLY-MAX is added: max 4 overnight NF shifts per rolling 7 days.
//   - BACKUP-WEEKEND-POST-CALL is added: 2+ separate backup activations in
//     one weekend (Fri 18:00-Mon 06:00) guarantees a duty-free Monday. A
//     single merged 26h day-night activation doesn't count as "2 separate."
//   - All HC-* rules (home call, Art 23.06) are dropped: this program has no
//     home call rotation at all (only in-house, night float, and backup).
//
// An activated backup shift is CallType 'backup': its stipend converts from
// home call to in-house call on activation, so it's already folded into the
// base ruleset's shared duty-hour/rest/no-consecutive rules as an
// in-house-equivalent type there (see para_2024_2028.ts) — but NOT folded
// into IH-MAX-28D/10D or the in-house weekend caps, since the LOU caps
// backup activity separately via its own points system.
//
// NOT modeled (flagged deliberately, not silently dropped):
//   - The backup-call points system itself (per-block cap of 14/18/20
//     points) — only the Monday-off consequence of 2+ weekend activations
//     is checked, not a raw activation-count cap.
//   - Reciprocity (the resident who triggered backup must cover one of the
//     backup resident's shifts later that block) — a relationship between
//     two different residents' shifts, which self-check (one resident's own
//     schedule) has no way to represent.
//   - The stipend conversion itself is a payroll detail, not a scheduling
//     constraint.
import type { AssignedShift, CallType, CheckFn, RuleDef, Violation } from './types'
import * as windows from './windows'
import { buildRuleset as buildBase, makeCheckIhNoConsecutive, makeCheckRestMinGap } from './para_2024_2028'
import { addDays, parseDateOnly, formatDateOnly } from './dates'

export const VERSION = 'para_2024_2028_peds_uofa_lou'

const IH_NO_CONSECUTIVE_ARTICLE = 'LOU General Pediatrics UofA 2026-2027 (Art 23.05(b), 8h post-call rest)'
const REST_MIN_GAP_ARTICLE = 'LOU General Pediatrics UofA 2026-2027 (Art 23.01(d), 8h minimum rest)'
const IH_MAX_10D_ARTICLE = 'LOU General Pediatrics UofA 2026-2027 (waives PARA 2024-2028 Art 23.05(e) during NF)'
const NF_WEEKLY_MAX_ARTICLE = 'LOU General Pediatrics UofA 2026-2027'
const BACKUP_WEEKEND_POST_CALL_ARTICLE = 'LOU General Pediatrics UofA 2026-2027'

const HC_RULE_IDS = new Set([
  'HC-MAX-28D', 'HC-MAX-10D', 'HC-MAX-CONSECUTIVE', 'HC-WEEKEND-BLOCKS', 'HC-CONSEC-WEEKENDS',
  'FAIR-HC-WEEKDAY', 'FAIR-HC-WEEKEND',
])

function toViolations(hit: windows.RuleHit | null, ruleId: string, articleRef: string, residentId: string): Violation[] {
  return hit ? [{ ruleId, articleRef, residentId, detail: hit.detail, severity: 'hard', dates: hit.dates }] : []
}

function toViolationsAll(hits: windows.RuleHit[], ruleId: string, articleRef: string, residentId: string): Violation[] {
  return hits.map(hit => ({ ruleId, articleRef, residentId, detail: hit.detail, severity: 'hard' as const, dates: hit.dates }))
}

// Every calendar date within 7 days either side of an NF shift date — the
// LOU's "NF rotation and the week immediately before and after" window.
function nfProtectedDates(nfDates: Set<string>): Set<string> {
  const protectedDates = new Set<string>()
  for (const d of nfDates) {
    const anchor = parseDateOnly(d)
    for (let offset = -7; offset <= 7; offset++) {
      protectedDates.add(formatDateOnly(addDays(anchor, offset)))
    }
  }
  return protectedDates
}

const checkIhMax10dNfExempt: CheckFn = (shifts, residentId, _params, _ctx) => {
  const nfDates = new Set(shifts.filter(s => s.callType === 'night_float').map(s => s.date))
  const protectedDates = nfProtectedDates(nfDates)
  const relevant = shifts.filter(s => s.callType === 'in_house' && !protectedDates.has(s.date))
  return toViolations(windows.slidingWindowCountViolation(relevant, 10, 4), 'IH-MAX-10D', IH_MAX_10D_ARTICLE, residentId)
}

const checkNfWeeklyMax: CheckFn = (shifts, residentId, _params, _ctx) => {
  const nfShifts = shifts.filter(s => s.callType === 'night_float')
  return toViolations(windows.slidingWindowCountViolation(nfShifts, 7, 4), 'NF-WEEKLY-MAX', NF_WEEKLY_MAX_ARTICLE, residentId)
}

const checkBackupWeekendPostCall: CheckFn = (shifts, residentId, _params, _ctx) => {
  const backupShifts = shifts.filter(s => s.callType === 'backup')
  const allDates = new Set(shifts.map(s => s.date))
  const byWeekend = new Map<string, AssignedShift[]>()
  for (const s of backupShifts) {
    const key = windows.weekendKey(s.startDt)
    if (key !== null) {
      const list = byWeekend.get(key) ?? []
      list.push(s)
      byWeekend.set(key, list)
    }
  }

  const hits: windows.RuleHit[] = []
  for (const [fridayKey, wkShifts] of [...byWeekend.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const blocks = windows.mergeDutyBlocks(wkShifts)
    if (blocks.length < 2) continue
    const monday = formatDateOnly(addDays(parseDateOnly(fridayKey), 3))
    if (allDates.has(monday)) {
      hits.push({
        detail: (
          `Activated for ${blocks.length} separate backup call shifts on the weekend of ${fridayKey}, ` +
          `which guarantees a completely duty-free Monday (${monday})`
        ),
        dates: [monday],
      })
    }
  }
  return toViolationsAll(hits, 'BACKUP-WEEKEND-POST-CALL', BACKUP_WEEKEND_POST_CALL_ARTICLE, residentId)
}

export function buildRuleset(): RuleDef[] {
  const base = buildBase().filter(r =>
    r.id !== 'IH-MAX-10D' && r.id !== 'IH-NO-CONSECUTIVE' && r.id !== 'REST-MIN-GAP' && !HC_RULE_IDS.has(r.id))

  base.push({
    id: 'IH-NO-CONSECUTIVE', articleRef: IH_NO_CONSECUTIVE_ARTICLE, title: 'Guaranteed post-call rest (8h)',
    callTypes: new Set<CallType>(['in_house', 'home', 'night_float', 'regular', 'backup']), kind: 'hard', params: {},
    check: makeCheckIhNoConsecutive(8),
    explanation: 'After an in-house call shift (or an activated backup call shift), a resident is guaranteed at least 8 hours of rest before their next duty — another call shift (in-house, home, night float, or backup) or a regular shift starting too soon after violates it, even with no gap at all. The General Pediatrics UofA 2026-2027 LOU protects 8 hours here, not the base agreement\'s 10.',
  })
  base.push({
    id: 'REST-MIN-GAP', articleRef: REST_MIN_GAP_ARTICLE, title: 'Minimum 8h rest between duty periods',
    callTypes: new Set<CallType>(['in_house', 'home', 'night_float', 'regular', 'backup']), kind: 'hard', params: {},
    check: makeCheckRestMinGap(8),
    explanation: 'Residents need at least 8 hours off between the end of one duty period and the start of the next. The General Pediatrics UofA 2026-2027 LOU protects 8 hours here, not the base agreement\'s 10.',
  })
  base.push({
    id: 'IH-MAX-10D', articleRef: IH_MAX_10D_ARTICLE, title: 'Max in-house call per 10-day period (NF rotation exempt)',
    callTypes: new Set<CallType>(['in_house', 'night_float']), kind: 'hard', params: {}, check: checkIhMax10dNfExempt,
    explanation: 'A resident can be assigned at most 4 in-house call shifts within any 10-day period, except during their own night float rotation and the week immediately before or after it — the General Pediatrics UofA 2026-2027 LOU waives the cap for that window.',
  })
  base.push({
    id: 'NF-WEEKLY-MAX', articleRef: NF_WEEKLY_MAX_ARTICLE, title: 'Max 4 night float shifts per 7-day period',
    callTypes: new Set<CallType>(['night_float']), kind: 'hard', params: {}, check: checkNfWeeklyMax,
    explanation: 'A resident on night float can\'t be assigned more than 4 overnight night float shifts in any rolling 7-day period, resetting at the start of the first shift.',
  })
  base.push({
    id: 'BACKUP-WEEKEND-POST-CALL', articleRef: BACKUP_WEEKEND_POST_CALL_ARTICLE, title: 'Post-call Monday after 2+ weekend backup activations',
    callTypes: new Set<CallType>(['in_house', 'home', 'night_float', 'regular', 'backup']), kind: 'hard', params: {}, check: checkBackupWeekendPostCall,
    explanation: 'A resident activated for 2 or more separate backup call shifts in one weekend (not counting a single continuous 26-hour day-night activation) is guaranteed a completely duty-free Monday to recover.',
  })

  return base
}
