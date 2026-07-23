// Small local-time date helpers used throughout the ported rules. Both
// date-only strings ("YYYY-MM-DD") and full datetimes are treated as naive
// local time throughout, matching the Python source, which uses tz-less
// datetimes end to end. Mixing UTC-parsed date-only strings with
// local-parsed datetime strings (a well-known JS `Date` parsing quirk) would
// silently reintroduce timezone bugs, so every parse here goes through these
// helpers instead of bare `new Date(...)`.

export function parseDateOnly(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day) // local midnight
}

export function formatDateOnly(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

// Whole-day difference between two local-midnight dates.
export function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000)
}

// Python's datetime.weekday() is Mon=0..Sun=6; JS's Date.getDay() is
// Sun=0..Sat=6. Rules ported from Python weekday arithmetic go through this
// so they can be transliterated literally instead of re-deriving the mapping
// (and its off-by-one risk) in every file that needs a weekday.
export function pythonWeekday(d: Date): number {
  return (d.getDay() + 6) % 7
}

// Python's `%` always returns a result with the sign of the divisor (so
// `x % 7` is always in [0, 6] even for negative x); JS's `%` keeps the sign
// of the dividend instead. Ported weekday arithmetic uses this to stay
// literally transliteratable from the Python source.
export function pymod(a: number, b: number): number {
  return ((a % b) + b) % b
}

export function formatDateTime(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}:${s}`
}
