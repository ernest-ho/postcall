// Ported from src/rules/proration.py (main call-scheduler repo). Art 23.05
// (in-house) / 23.06 (home call) pro-ration: call maximums are a stepped
// day-bracket table keyed on days-on-service, not a continuous formula.
//
// NOTE: only two rows of the in-house table are independently confirmed
// against the source text: "1-6 days -> 1 call" and "31-34 days -> 8 calls."
// The intermediate bracket boundaries are a reasonable interpolation, not
// verified line-by-line against the PDF, and the home-call table has no
// independently confirmed rows at all. Same caveat as the Python source.

const IN_HOUSE_BRACKETS: Array<[number, number, number]> = [
  [1, 6, 1], // confirmed against source text
  [7, 10, 2],
  [11, 13, 3],
  [14, 17, 4],
  [18, 20, 5],
  [21, 24, 6],
  [25, 30, 7], // includes day 28 (full block) at the base cap of 7
  [31, 34, 8], // confirmed against source text (beyond a 28-day block)
]

const HOME_CALL_BRACKETS: Array<[number, number, number]> = [
  [1, 3, 1],
  [4, 6, 2],
  [7, 10, 3],
  [11, 13, 4],
  [14, 17, 5],
  [18, 20, 6],
  [21, 24, 7],
  [25, 27, 8],
  [28, 28, 9],
]

function bracketLookup(daysOnService: number, brackets: Array<[number, number, number]>): number {
  if (daysOnService <= 0) return 0
  for (const [lo, hi, cap] of brackets) {
    if (daysOnService >= lo && daysOnService <= hi) return cap
  }
  return brackets[brackets.length - 1][2]
}

export function maxInHouseForDays(daysOnService: number): number {
  return bracketLookup(daysOnService, IN_HOUSE_BRACKETS)
}

export function maxHomeCallForDays(daysOnService: number): number {
  return bracketLookup(daysOnService, HOME_CALL_BRACKETS)
}
