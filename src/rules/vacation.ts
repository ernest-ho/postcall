// Ported from src/rules/vacation.py (main call-scheduler repo). Art 20.05:
// vacation/call-scheduling interaction: no on-call duty may be scheduled
// the day before or during a resident's vacation, and no on-call on the
// weekend immediately before/after a run of 5+ consecutive weekday
// vacation days.
import type { AssignedShift, RuleContext, Violation } from './types'
import { addDays, diffDays, formatDateOnly, parseDateOnly, pymod, pythonWeekday } from './dates'

// Returns (start, end) date pairs for runs of 5+ consecutive weekdays
// (Mon-Fri) that are all on vacation.
export function consecutiveWeekdayVacationRuns(vacationDates: Set<string>): Array<[Date, Date]> {
  const parsed = [...vacationDates].map(parseDateOnly).sort((a, b) => a.getTime() - b.getTime())
  const runs: Array<[Date, Date]> = []
  let i = 0
  while (i < parsed.length) {
    let j = i
    while (
      j + 1 < parsed.length &&
      diffDays(parsed[j + 1], parsed[j]) === 1 &&
      pythonWeekday(parsed[j + 1]) < 5
    ) {
      j += 1
    }
    const weekdayRun = parsed.slice(i, j + 1).filter(d => pythonWeekday(d) < 5)
    if (weekdayRun.length >= 5) {
      runs.push([weekdayRun[0], weekdayRun[weekdayRun.length - 1]])
    }
    i = j + 1
  }
  return runs
}

export function checkVacationBlackout(
  shifts: AssignedShift[], residentId: string, ctx: RuleContext,
): Violation[] {
  const vacationDates = ctx.vacationDays.get(residentId) ?? new Set<string>()
  if (vacationDates.size === 0) return []

  const violations: Violation[] = []

  for (const s of shifts) {
    const shiftDate = parseDateOnly(s.date)
    const dayAfter = addDays(shiftDate, 1) // shift is the day immediately before vacation starts
    if (vacationDates.has(s.date) || vacationDates.has(formatDateOnly(dayAfter))) {
      violations.push({
        ruleId: 'VAC-NO-CALL-BLACKOUT',
        articleRef: 'PARA 2024-2028, Art 20.05',
        residentId,
        detail: `On-call assigned ${s.date}, which is on or immediately before approved vacation`,
        severity: 'hard',
        dates: [s.date],
      })
    }
  }

  for (const [runStart, runEnd] of consecutiveWeekdayVacationRuns(vacationDates)) {
    const beforeWeekendFri = addDays(runStart, -(pymod(pythonWeekday(runStart) - 4, 7) || 7))
    const afterWeekendFri = addDays(runEnd, pymod(4 - pythonWeekday(runEnd), 7))
    const beforeKey = formatDateOnly(beforeWeekendFri)
    const afterKey = formatDateOnly(afterWeekendFri)

    for (const s of shifts) {
      const shiftDate = parseDateOnly(s.date)
      const wd = pythonWeekday(shiftDate)
      if (wd === 5 || wd === 6) { // Sat or Sun
        const friOfWeekend = addDays(shiftDate, -(wd - 4))
        const friKey = formatDateOnly(friOfWeekend)
        if (friKey === beforeKey || friKey === afterKey) {
          violations.push({
            ruleId: 'VAC-WEEKEND-ADJACENCY',
            articleRef: 'PARA 2024-2028, Art 20.05',
            residentId,
            detail: (
              `On-call assigned ${s.date}, a weekend adjacent to the ` +
              `${formatDateOnly(runStart)}-${formatDateOnly(runEnd)} vacation run`
            ),
            severity: 'hard',
            // Just the call date itself, not the vacation run: the vacation
            // days aren't the problem, the call on the adjacent weekend is.
            dates: [s.date],
          })
        }
      }
    }
  }
  return violations
}
