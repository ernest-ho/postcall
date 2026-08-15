// Ported from src/rules/proration.py (main call-scheduler repo). Art 23.05
// (in-house) / 23.06 (home call) pro-ration: call maximums are a stepped
// day-bracket table keyed on days-on-service, not a continuous formula.
//
// These brackets are transcribed from the Art. 23.05(a) and 23.06(a)
// tables in the PARA 2024-2028 agreement.

const IN_HOUSE_BRACKETS: Array<[number, number, number]> = [
  [1, 6, 1], // confirmed against source text
  [7, 10, 2],
  [11, 14, 3],
  [15, 18, 4],
  [19, 22, 5],
  [23, 26, 6],
  [27, 30, 7],
  [31, 34, 8], // Only the first and last rotation may exceed 28 days.
]

const HOME_CALL_BRACKETS: Array<[number, number, number]> = [
  [1, 5, 1],
  [6, 8, 2],
  [9, 11, 3],
  [12, 14, 4],
  [15, 17, 5],
  [18, 20, 6],
  [21, 23, 7],
  [24, 26, 8],
  [27, 29, 9],
  [30, 32, 10],
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
