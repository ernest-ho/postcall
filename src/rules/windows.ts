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
import type { AssignedShift, CallType } from './types'
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

const CALL_LIKE_TYPES: readonly CallType[] = ['in_house', 'home', 'backup']

// Whether a shift of nextType, touching/overlapping the end of a shift of
// prevType, continues the SAME call block for guaranteedRestAfterViolation's
// purposes, rather than starting a fresh one.
//
// Call-like into call-like (e.g. an in-house day shift straight into that
// same resident's in-house night shift) is one continuous call day, not a
// post-call boundary  -  Art 23.01(f) treats combined day+night call as a
// single duty stretch. Regular into call-like is the classic accepted
// "normal day extending into on-call" pattern (see mergeDutyBlocks).
// Anything else touching a call-like shift  -  most importantly a call-like
// shift flowing OUT into a regular (or night-float) shift  -  is exactly the
// post-call boundary this rule exists to catch, so it must NOT merge.
function extendsCallBlock(prevType: CallType, nextType: CallType): boolean {
  if (CALL_LIKE_TYPES.includes(prevType) && CALL_LIKE_TYPES.includes(nextType)) return true
  if (prevType === 'regular' && CALL_LIKE_TYPES.includes(nextType)) return true
  return prevType === 'regular' && nextType === 'regular'
}

function mergeCallBlocks(shifts: AssignedShift[]): AssignedShift[][] {
  const ordered = [...shifts].sort((a, b) => a.startDt.getTime() - b.startDt.getTime())
  const blocks: AssignedShift[][] = []
  for (const s of ordered) {
    const last = blocks[blocks.length - 1]
    const lastShift = last?.[last.length - 1]
    if (
      last && lastShift
      && s.startDt.getTime() <= Math.max(...last.map(b => b.endDt.getTime()))
      && extendsCallBlock(lastShift.callType, s.callType)
    ) {
      last.push(s)
    } else {
      blocks.push([s])
    }
  }
  return blocks
}

// For each CONTINUOUS CALL BLOCK (see mergeCallBlocks) that contains at
// least one anchor shift (e.g. an in-house call shift), flags a violation if
// the gap to the next duty block is under minHours. The guarantee is a
// minimum rest period, not a completely duty-free next calendar day: a
// regular shift or another call shift starting 10+ hours after the block
// ends is fine, but starting sooner (including with zero gap) is not.
//
// Anchoring on merged call BLOCKS rather than individual raw shifts matters:
// a weekend's in-house day shift (e.g. 08:00-17:00) flowing straight into
// that same resident's in-house night shift (17:00-08:00) is one continuous
// ~24h call day, not a "post-call" boundary  -  Art 23.01(f) explicitly treats
// combined day+night call as a single duty stretch. Only once the WHOLE
// merged call block ends does the post-call rest guarantee apply; anchoring
// on the day shift's own end would wrongly flag the very next duty (the
// night shift) as a zero-gap violation.
//
// Unlike the generic mergeDutyBlocks, mergeCallBlocks never lets a call-like
// shift merge INTO a following regular/night-float shift  -  that boundary
// (the call ending, ordinary duty resuming with no break at all) is exactly
// the violation this guarantee exists to catch, so it deliberately does NOT
// exempt a zero-hour gap there the way restViolates does for the general
// rest-min-gap rule.
//
// One hit per anchor block with insufficient following rest (mirrors
// restGapViolations' per-block style), not grouped into day-chains.
//
// Exception: a backup-to-backup transition is never a violation here. Two
// back-to-back weekend backup call activations (LOU General Pediatrics
// UofA 2026-2027), often only ~9h apart, are that LOU's own expected
// pattern  -  BACKUP-WEEKEND-POST-CALL is its compensating safeguard, not
// this shared in-house guarantee.
export function guaranteedRestAfterViolation(
  anchorShifts: AssignedShift[], allShifts: AssignedShift[], minHours: number,
): RuleHit[] {
  const anchorIds = new Set(anchorShifts.map(s => s.shiftInstanceId))
  const blocks = mergeCallBlocks(allShifts)
  const hits: RuleHit[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!block.some(s => anchorIds.has(s.shiftInstanceId))) continue
    const nextBlock = blocks[i + 1]
    if (!nextBlock) continue
    if (block[block.length - 1].callType === 'backup' && nextBlock[0].callType === 'backup') continue
    const blockEnd = new Date(Math.max(...block.map(s => s.endDt.getTime())))
    const nextShift = nextBlock.reduce((a, b) => (a.startDt.getTime() <= b.startDt.getTime() ? a : b))
    const gapHours = (nextShift.startDt.getTime() - blockEnd.getTime()) / 3_600_000
    if (gapHours < minHours) {
      hits.push({
        detail: (
          `Only ${formatHours(gapHours)} rest after in-house call ending ${formatDateTime(blockEnd)}, ` +
          `before duty starting ${formatDateTime(nextShift.startDt)} on ${nextShift.date}, minimum is ${formatHours(minHours)}`
        ),
        dates: [...new Set([block[block.length - 1].date, nextShift.date])],
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
    // Same exception at a backup-to-backup boundary (LOU General Pediatrics
    // UofA 2026-2027): back-to-back weekend backup activations are that
    // LOU's own expected pattern, safeguarded by BACKUP-WEEKEND-POST-CALL.
    if (blockA[blockA.length - 1].callType === 'backup' && blockB[0].callType === 'backup') {
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

// Art. 23.03(b)(i): a shift-based rotation may contain at most 60 hours of
// scheduled shifts in a week. With no authoritative week-boundary stored in
// the self-check, use every rolling seven-day window so a violation cannot be
// hidden by choosing a convenient week start.
export function weeklyScheduledHoursViolation(shifts: AssignedShift[], maxHours: number): RuleHit | null {
  if (shifts.length === 0) return null
  const ordered = [...shifts].sort((a, b) => a.startDt.getTime() - b.startDt.getTime())
  for (const anchor of ordered) {
    const windowEnd = addDays(anchor.startDt, 7)
    const inWindow = ordered.filter(s => s.startDt >= anchor.startDt && s.startDt < windowEnd)
    const totalHours = inWindow.reduce((sum, s) => sum + (s.endDt.getTime() - s.startDt.getTime()) / 3_600_000, 0)
    if (totalHours > maxHours) {
      return {
        detail: (
          `${formatHours(totalHours)} of scheduled shifts from ${formatDateOnly(anchor.startDt)} to ` +
          `${formatDateOnly(addDays(windowEnd, -1))}, max is ${formatHours(maxHours)} in a 7-day period`
        ),
        dates: [...new Set(inWindow.map(s => s.date))],
      }
    }
  }
  return null
}

// Art. 23.02(c) uses calendar weekend days, Saturday and Sunday, rather than
// Art. 23.04's separate Friday 18:00 to Monday 06:00 on-call weekend.
export function touchesCalendarWeekendDay(startDt: Date, endDt: Date): boolean {
  const current = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate())
  const lastMoment = new Date(endDt.getTime() - 1)
  const last = new Date(lastMoment.getFullYear(), lastMoment.getMonth(), lastMoment.getDate())
  while (current <= last) {
    const day = pythonWeekday(current)
    if (day === 5 || day === 6) return true
    current.setDate(current.getDate() + 1)
  }
  return false
}

// Art 23.04: weekend = Friday 18:00 to Monday 06:00. A duty counts when it
// intersects that interval, not only when it happens to start within it.
export function weekendKey(startDt: Date, endDt: Date = new Date(startDt.getTime() + 1)): string | null {
  // A duty can begin before Friday evening or end after Monday 06:00. Check
  // nearby Friday buckets rather than deriving one from its start time.
  const startDay = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate())
  for (let offset = -4; offset <= 1; offset++) {
    const candidate = addDays(startDay, offset)
    if (pythonWeekday(candidate) !== 4) continue
    const weekendStart = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate(), 18)
    const weekendEnd = addDays(weekendStart, 3)
    weekendEnd.setHours(6, 0, 0, 0)
    if (startDt < weekendEnd && endDt > weekendStart) return formatDateOnly(candidate)
  }
  return null
}

export function weekendsWorked(shifts: AssignedShift[]): Set<string> {
  const keys = new Set<string>()
  for (const s of shifts) {
    const k = weekendKey(s.startDt, s.endDt)
    if (k !== null) keys.add(k)
  }
  return keys
}

export function maxWeekendsWorkedViolation(shifts: AssignedShift[], maxWeekends: number): RuleHit | null {
  const worked = [...weekendsWorked(shifts)].map(parseDateOnly).sort((a, b) => a.getTime() - b.getTime())
  for (const start of worked) {
    const end = addDays(start, 21) // Four Friday-to-Friday weekend buckets.
    const inWindow = worked.filter(d => d >= start && d <= end)
    if (inWindow.length > maxWeekends) {
      return {
        detail: (
          `Worked ${inWindow.length} weekends from ${formatDateOnly(start)} to ` +
          `${formatDateOnly(end)}; max ${maxWeekends} in any 4-week period`
        ),
        dates: inWindow.map(formatDateOnly),
      }
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
