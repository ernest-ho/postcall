// Ported from src/rules/windows.py (main call-scheduler repo). Generic,
// reusable rule primitives shared by every concrete PARA rule check, kept
// as a faithful line-by-line port so this stays easy to diff against the
// Python source if the agreement's thresholds ever change there.
import type { AssignedShift } from './types'
import { addDays, diffDays, formatDateOnly, formatDateTime, parseDateOnly, pythonWeekday } from './dates'

function dates(shifts: AssignedShift[]): string[] {
  return [...new Set(shifts.map(s => s.date))].sort()
}

export function slidingWindowCountViolation(
  shifts: AssignedShift[], windowDays: number, maxCount: number,
): string | null {
  const ds = dates(shifts)
  if (ds.length === 0) return null
  const parsed = ds.map(parseDateOnly)
  for (const start of parsed) {
    const windowEnd = addDays(start, windowDays - 1)
    const count = parsed.filter(d => d >= start && d <= windowEnd).length
    if (count > maxCount) {
      return (
        `${count} shifts between ${formatDateOnly(start)} and ${formatDateOnly(windowEnd)} ` +
        `(${windowDays}-day window), max allowed is ${maxCount}`
      )
    }
  }
  return null
}

export function maxConsecutiveRunViolation(shifts: AssignedShift[], maxRun: number): string | null {
  const ds = dates(shifts)
  if (ds.length < 2) return null
  const parsed = ds.map(parseDateOnly).sort((a, b) => a.getTime() - b.getTime())
  // A lone, non-adjacent shift (runLen == 1) is never itself a violation:
  // "consecutive" requires at least 2 adjacent days, so maxRun == 0 (no
  // consecutive shifts at all) still tolerates isolated single shifts.
  const effectiveMax = Math.max(maxRun, 1)

  let runLen = 1
  for (let i = 1; i < parsed.length; i++) {
    if (diffDays(parsed[i], parsed[i - 1]) === 1) {
      runLen += 1
    } else {
      runLen = 1
    }
    if (runLen > effectiveMax) {
      return (
        `${runLen} consecutive shift-days ending ${formatDateOnly(parsed[i])}, ` +
        `max ${maxRun} consecutive allowed`
      )
    }
  }
  return null
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

export function restGapViolation(shifts: AssignedShift[], minHours: number): string | null {
  const ordered = [...shifts].sort((a, b) => a.startDt.getTime() - b.startDt.getTime())
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1]
    if (b.startDt < a.endDt) {
      return (
        `Overlapping duty: shift on ${a.date} runs until ${formatDateTime(a.endDt)}, overlapping ` +
        `a shift starting ${formatDateTime(b.startDt)} on ${b.date}`
      )
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
      return (
        `Only ${gapHours.toFixed(1)}h rest between duty ending ${formatDateTime(aEnd)} and ` +
        `duty starting ${formatDateTime(bStart)}, minimum is ${minHours}h`
      )
    }
  }
  return null
}

export function maxDutyLengthViolation(shifts: AssignedShift[], maxHours: number): string | null {
  for (const block of mergeDutyBlocks(shifts)) {
    const [start, end] = blockSpan(block)
    const durationHours = (end.getTime() - start.getTime()) / 3_600_000
    if (durationHours > maxHours) {
      return (
        `Continuous duty block from ${formatDateTime(start)} to ${formatDateTime(end)} runs ` +
        `${durationHours.toFixed(1)}h, max is ${maxHours}h`
      )
    }
  }
  return null
}

export function weeklyHoursAvgViolation(
  shifts: AssignedShift[], windowWeeks: number, maxAvgHours: number,
): string | null {
  if (shifts.length === 0) return null
  const ordered = [...shifts].sort((a, b) => a.startDt.getTime() - b.startDt.getTime())
  const spanDays = windowWeeks * 7
  for (const anchor of ordered) {
    const windowEnd = addDays(anchor.startDt, spanDays)
    const totalHours = ordered
      .filter(s => s.startDt >= anchor.startDt && s.startDt < windowEnd)
      .reduce((sum, s) => sum + (s.endDt.getTime() - s.startDt.getTime()) / 3_600_000, 0)
    const avg = totalHours / windowWeeks
    if (avg > maxAvgHours) {
      return (
        `Average ${avg.toFixed(1)}h/week over the ${windowWeeks} weeks from ` +
        `${formatDateOnly(anchor.startDt)}, max is ${maxAvgHours}h/week`
      )
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

export function maxWeekendsWorkedViolation(shifts: AssignedShift[], maxWeekends: number): string | null {
  const worked = weekendsWorked(shifts)
  if (worked.size > maxWeekends) {
    return `Worked ${worked.size} weekends this block, max allowed is ${maxWeekends}`
  }
  return null
}

export function maxConsecutiveWeekendsViolation(shifts: AssignedShift[], maxConsecutive: number): string | null {
  const worked = [...weekendsWorked(shifts)].map(parseDateOnly).sort((a, b) => a.getTime() - b.getTime())
  if (worked.length === 0) return null
  let runLen = 1
  for (let i = 1; i < worked.length; i++) {
    if (diffDays(worked[i], worked[i - 1]) === 7) {
      runLen += 1
    } else {
      runLen = 1
    }
    if (runLen > maxConsecutive) {
      return (
        `${runLen} consecutive weekends worked ending ${formatDateOnly(worked[i])}, ` +
        `max ${maxConsecutive} allowed`
      )
    }
  }
  return null
}
