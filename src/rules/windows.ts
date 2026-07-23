// Ported from src/rules/windows.py (main call-scheduler repo). Generic,
// reusable rule primitives shared by every concrete PARA rule check, kept
// as a faithful line-by-line port so this stays easy to diff against the
// Python source if the agreement's thresholds ever change there.
//
// Each violation-detecting function returns both a human-readable `detail`
// string AND the exact calendar `dates` responsible, as structured data
// rather than something the UI has to guess at by regex-parsing the detail
// text (which can't tell "the actual violating days" apart from context
// dates like a window's outer bounds).
import type { AssignedShift } from './types'
import { addDays, dateRange, diffDays, formatDateOnly, formatDateTime, formatHours, parseDateOnly, pythonWeekday } from './dates'

export interface RuleHit {
  detail: string
  dates: string[]
}

function dates(shifts: AssignedShift[]): string[] {
  return [...new Set(shifts.map(s => s.date))].sort()
}

export function slidingWindowCountViolation(
  shifts: AssignedShift[], windowDays: number, maxCount: number,
): RuleHit | null {
  const ds = dates(shifts)
  if (ds.length === 0) return null
  const parsed = ds.map(parseDateOnly)
  for (const start of parsed) {
    const windowEnd = addDays(start, windowDays - 1)
    const inWindow = parsed.filter(d => d >= start && d <= windowEnd)
    if (inWindow.length > maxCount) {
      return {
        detail: (
          `${inWindow.length} shifts between ${formatDateOnly(start)} and ${formatDateOnly(windowEnd)} ` +
          `(${windowDays}-day window), max allowed is ${maxCount}`
        ),
        // The actual shift dates that fall in the window, not the window's
        // outer bounds; those can be sparser than the window itself.
        dates: inWindow.map(formatDateOnly),
      }
    }
  }
  return null
}

// Returns every maximal consecutive run exceeding maxRun (not just the
// first): a schedule can have two separate violating runs weeks apart, and
// each is its own distinct instance worth its own row in the violations panel.
export function maxConsecutiveRunViolations(shifts: AssignedShift[], maxRun: number): RuleHit[] {
  const ds = dates(shifts)
  if (ds.length < 2) return []
  const parsed = ds.map(parseDateOnly).sort((a, b) => a.getTime() - b.getTime())
  // A lone, non-adjacent shift (runLen == 1) is never itself a violation:
  // "consecutive" requires at least 2 adjacent days, so maxRun == 0 (no
  // consecutive shifts at all) still tolerates isolated single shifts.
  const effectiveMax = Math.max(maxRun, 1)

  // Group into maximal consecutive runs first, so a violation reports the
  // TRUE full extent of the run, not just the point where the threshold was
  // first crossed (3 actual consecutive days must say "3", not stop
  // counting at "2" the moment it exceeds the cap).
  const runs: Date[][] = [[parsed[0]]]
  for (let i = 1; i < parsed.length; i++) {
    if (diffDays(parsed[i], parsed[i - 1]) === 1) {
      runs[runs.length - 1].push(parsed[i])
    } else {
      runs.push([parsed[i]])
    }
  }

  const hits: RuleHit[] = []
  for (const run of runs) {
    if (run.length > effectiveMax) {
      const start = run[0]
      const end = run[run.length - 1]
      hits.push({
        detail: (
          `${run.length} consecutive shift-days from ${formatDateOnly(start)} to ${formatDateOnly(end)}, ` +
          `max ${maxRun} consecutive allowed`
        ),
        dates: run.map(formatDateOnly),
      })
    }
  }
  return hits
}

// For each anchor shift (e.g. an in-house call shift), flags a violation if
// the gap to the resident's immediately next chronological shift — of any
// call type, not just another anchor-type shift — is under minHours. The
// guarantee is a minimum rest period, not a completely duty-free next
// calendar day: a regular shift or another call shift starting 10+ hours
// later is fine, but starting sooner (including with zero gap) is not.
//
// Deliberately does NOT exempt a zero-hour gap the way restViolates does for
// the general rest-min-gap rule: a normal working day flowing straight into
// an on-call shift is expected (mergeDutyBlocks), but an in-house call shift
// flowing straight into the next duty with no break at all is exactly the
// violation this guarantee exists to catch.
//
// One hit per anchor shift with insufficient following rest (mirrors
// restGapViolations' per-instance style, since this is a gap check, not a
// day-run check), not grouped into day-chains.
export function guaranteedRestAfterViolation(
  anchorShifts: AssignedShift[], allShifts: AssignedShift[], minHours: number,
): RuleHit[] {
  const ordered = [...allShifts].sort((a, b) => a.startDt.getTime() - b.startDt.getTime())
  const hits: RuleHit[] = []
  for (const anchor of anchorShifts) {
    const later = ordered.filter(s => s.startDt.getTime() > anchor.startDt.getTime())
    if (later.length === 0) continue
    const next = later.reduce((a, b) => (a.startDt.getTime() <= b.startDt.getTime() ? a : b))
    const gapHours = (next.startDt.getTime() - anchor.endDt.getTime()) / 3_600_000
    if (gapHours < minHours) {
      hits.push({
        detail: (
          `Only ${formatHours(gapHours)} rest after in-house call ending ${formatDateTime(anchor.endDt)}, ` +
          `before duty starting ${formatDateTime(next.startDt)} on ${next.date}, minimum is ${formatHours(minHours)}`
        ),
        dates: [...new Set([anchor.date, next.date])],
      })
    }
  }
  return hits
}

export function mergeDutyBlocks(shifts: AssignedShift[]): AssignedShift[][] {
  const ordered = [...shifts].sort((a, b) => a.startDt.getTime() - b.startDt.getTime())
  const blocks: AssignedShift[][] = []
  for (const s of ordered) {
    const last = blocks[blocks.length - 1]
    if (last && s.startDt <= new Date(Math.max(...last.map(b => b.endDt.getTime())))) {
      last.push(s)
    } else {
      blocks.push([s])
    }
  }
  return blocks
}

function blockSpan(block: AssignedShift[]): [Date, Date] {
  return [block[0].startDt, new Date(Math.max(...block.map(s => s.endDt.getTime())))]
}

// A gap of exactly 0 is two shifts touching: one continuous duty block
// (governed by MAX-DUTY-LENGTH, not a rest violation). Anything else under
// minHours is a violation, including negative gaps (genuine overlap).
export function restViolates(gapHours: number, minHours: number): boolean {
  return gapHours !== 0 && gapHours < minHours
}

// Returns every insufficient-rest instance (not just the first): 4
// consecutive shifts have 3 gaps between them, and each is its own distinct
// violation worth its own row, not just the first one found.
export function restGapViolations(shifts: AssignedShift[], minHours: number): RuleHit[] {
  const hits: RuleHit[] = []
  const ordered = [...shifts].sort((a, b) => a.startDt.getTime() - b.startDt.getTime())
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1]
    if (b.startDt < a.endDt) {
      hits.push({
        detail: (
          `Overlapping duty: shift on ${a.date} runs until ${formatDateTime(a.endDt)}, overlapping ` +
          `a shift starting ${formatDateTime(b.startDt)} on ${b.date}`
        ),
        dates: [...new Set([a.date, b.date])],
      })
    }
  }

  const blocks = mergeDutyBlocks(shifts)
  for (let i = 0; i < blocks.length - 1; i++) {
    const blockA = blocks[i], blockB = blocks[i + 1]
    // Back-to-back night-float duty blocks are explicitly allowed; no
    // PARA-mandated rest minimum applies at a NF-to-NF boundary.
    if (blockA[blockA.length - 1].callType === 'night_float' && blockB[0].callType === 'night_float') {
      continue
    }
    const [, aEnd] = blockSpan(blockA)
    const [bStart] = blockSpan(blockB)
    const gapHours = (bStart.getTime() - aEnd.getTime()) / 3_600_000
    if (restViolates(gapHours, minHours)) {
      hits.push({
        detail: (
          `Only ${formatHours(gapHours)} rest between duty ending ${formatDateTime(aEnd)} and ` +
          `duty starting ${formatDateTime(bStart)}, minimum is ${formatHours(minHours)}`
        ),
        dates: [...new Set([formatDateOnly(aEnd), formatDateOnly(bStart)])],
      })
    }
  }
  return hits
}

export function maxDutyLengthViolation(shifts: AssignedShift[], maxHours: number): RuleHit | null {
  for (const block of mergeDutyBlocks(shifts)) {
    const [start, end] = blockSpan(block)
    const durationHours = (end.getTime() - start.getTime()) / 3_600_000
    if (durationHours > maxHours) {
      return {
        detail: (
          `Continuous duty block from ${formatDateTime(start)} to ${formatDateTime(end)} runs ` +
          `${formatHours(durationHours)}, max is ${formatHours(maxHours)}`
        ),
        dates: dateRange(start, end),
      }
    }
  }
  return null
}

export function weeklyHoursAvgViolation(
  shifts: AssignedShift[], windowWeeks: number, maxAvgHours: number,
): RuleHit | null {
  if (shifts.length === 0) return null
  const ordered = [...shifts].sort((a, b) => a.startDt.getTime() - b.startDt.getTime())
  const spanDays = windowWeeks * 7
  for (const anchor of ordered) {
    const windowEnd = addDays(anchor.startDt, spanDays)
    const inWindow = ordered.filter(s => s.startDt >= anchor.startDt && s.startDt < windowEnd)
    const totalHours = inWindow.reduce((sum, s) => sum + (s.endDt.getTime() - s.startDt.getTime()) / 3_600_000, 0)
    const avg = totalHours / windowWeeks
    if (avg > maxAvgHours) {
      return {
        detail: (
          `Average ${formatHours(avg)}/week over the ${windowWeeks} weeks from ` +
          `${formatDateOnly(anchor.startDt)}, max is ${formatHours(maxAvgHours)}/week`
        ),
        dates: [...new Set(inWindow.map(s => s.date))],
      }
    }
  }
  return null
}

// Art 23.04: weekend = Friday 18:00 to Monday 06:00. Returns the Friday's
// date (YYYY-MM-DD) as the bucket key if startDt falls in that window, else null.
export function weekendKey(startDt: Date): string | null {
  const weekday = pythonWeekday(startDt) // Mon=0 ... Sun=6
  const dateOnly = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate())
  let friday: Date
  if (weekday === 4 && startDt.getHours() >= 18) { // Friday evening
    friday = dateOnly
  } else if (weekday === 5) { // Saturday
    friday = addDays(dateOnly, -1)
  } else if (weekday === 6) { // Sunday
    friday = addDays(dateOnly, -2)
  } else if (weekday === 0 && startDt.getHours() < 6) { // Monday before 06:00
    friday = addDays(dateOnly, -3)
  } else {
    return null
  }
  return formatDateOnly(friday)
}

export function weekendsWorked(shifts: AssignedShift[]): Set<string> {
  const keys = new Set<string>()
  for (const s of shifts) {
    const k = weekendKey(s.startDt)
    if (k !== null) keys.add(k)
  }
  return keys
}

export function maxWeekendsWorkedViolation(shifts: AssignedShift[], maxWeekends: number): RuleHit | null {
  const worked = weekendsWorked(shifts)
  if (worked.size > maxWeekends) {
    return {
      detail: `Worked ${worked.size} weekends this block, max allowed is ${maxWeekends}`,
      // A whole-block count, not tied to any specific day.
      dates: [],
    }
  }
  return null
}

// Returns every maximal violating weekend-run (not just the first): a block
// can have two separate over-cap stretches of consecutive weekends.
export function maxConsecutiveWeekendsViolations(shifts: AssignedShift[], maxConsecutive: number): RuleHit[] {
  const worked = [...weekendsWorked(shifts)].map(parseDateOnly).sort((a, b) => a.getTime() - b.getTime())
  if (worked.length === 0) return []
  const runs: Date[][] = [[worked[0]]]
  for (let i = 1; i < worked.length; i++) {
    if (diffDays(worked[i], worked[i - 1]) === 7) {
      runs[runs.length - 1].push(worked[i])
    } else {
      runs.push([worked[i]])
    }
  }
  const hits: RuleHit[] = []
  for (const run of runs) {
    if (run.length > maxConsecutive) {
      hits.push({
        detail: (
          `${run.length} consecutive weekends worked ending ${formatDateOnly(run[run.length - 1])}, ` +
          `max ${maxConsecutive} allowed`
        ),
        // The weekend-bucket Friday for each involved weekend.
        dates: run.map(formatDateOnly),
      })
    }
  }
  return hits
}
