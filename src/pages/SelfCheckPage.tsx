import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react'
import { AlertTriangle, Building2, ChevronDown, ChevronLeft, ChevronRight, Home, Moon, Plus, Stethoscope, Trash2, Umbrella, type LucideIcon } from 'lucide-react'
import { selfCheck } from '../rules/selfCheck'
import type { CallType, Violation } from '../rules/types'
import { buildRuleset } from '../rules/para_2024_2028'

type EntryType = 'ih_night' | 'ih_day' | 'hc_night' | 'hc_day' | 'nf_night' | 'regular' | 'vacation'
type ShiftType = Exclude<EntryType, 'vacation'>

interface Entry {
  key: string
  type: EntryType
  start: string // HH:MM, 24h; unused for vacation
  end: string // HH:MM, 24h; unused for vacation
  endNextDay: boolean // unused for vacation
}

const TYPE_LABEL: Record<EntryType, string> = {
  ih_night: 'Night Shift',
  ih_day: 'Day Shift',
  hc_night: 'Home Call Night',
  hc_day: 'Home Call Day',
  nf_night: 'Night Float',
  regular: 'Regular Shift',
  vacation: 'Vacation',
}

// Icon shape = call type (where the duty happens): Building2 for in-house
// (you're in the hospital), Home for home call, Moon for night float (its
// own thing, no day twin), Stethoscope for regular clinic duty. Color = time
// of day (night violet vs day amber), so the two axes stay independent and
// in-house/home-call read as visually distinct even within the same time slot.
const TYPE_ICON: Record<EntryType, LucideIcon> = {
  ih_night: Building2,
  ih_day: Building2,
  hc_night: Home,
  hc_day: Home,
  nf_night: Moon,
  regular: Stethoscope,
  vacation: Umbrella,
}

const TYPE_CLASSES: Record<EntryType, string> = {
  ih_night: 'bg-night-100 text-night-700 dark:bg-night-800/50 dark:text-night-200',
  ih_day: 'bg-day-100 text-day-700 dark:bg-day-800/50 dark:text-day-200',
  hc_night: 'bg-night-50 text-night-600 dark:bg-night-900/50 dark:text-night-300',
  hc_day: 'bg-day-50 text-day-600 dark:bg-day-900/50 dark:text-day-300',
  nf_night: 'bg-night-100 text-night-700 dark:bg-night-800/50 dark:text-night-200',
  regular: 'bg-day-100 text-day-700 dark:bg-day-800/50 dark:text-day-200',
  vacation: 'bg-vacation-100 text-vacation-700 dark:bg-vacation-900/50 dark:text-vacation-100',
}

const CALL_TYPE: Record<ShiftType, CallType> = {
  ih_night: 'in_house',
  ih_day: 'in_house',
  hc_night: 'home',
  hc_day: 'home',
  nf_night: 'night_float',
  regular: 'regular',
}

// Defaults when a type is picked in the add form; all fields stay editable
// before confirming. Regular (non-call) duty defaults to a typical 8am-5pm
// clinic day but varies by rotation, unlike the call-shift templates.
const DEFAULT_TIMES: Record<ShiftType, { start: string; end: string; endNextDay: boolean }> = {
  ih_night: { start: '17:00', end: '08:00', endNextDay: true },
  ih_day: { start: '08:00', end: '17:00', endNextDay: false },
  hc_night: { start: '17:00', end: '08:00', endNextDay: true },
  hc_day: { start: '08:00', end: '17:00', endNextDay: false },
  // Same template as in-house night (17:00-08:00). Two directly back-to-back
  // night-float nights are explicitly exempted from REST-MIN-GAP (see
  // src/rules/windows.ts), so this timing is fine for consecutive nights.
  nf_night: { start: '17:00', end: '08:00', endNextDay: true },
  regular: { start: '08:00', end: '17:00', endNextDay: false },
}

const RULE_TITLES: Record<string, string> = Object.fromEntries(buildRuleset().map(r => [r.id, r.title]))

// Display order for the legend: day shifts before night shifts, in-house
// before home call, vacation last since it's not a call type at all.
const LEGEND_ORDER: EntryType[] = ['regular', 'ih_day', 'hc_day', 'ih_night', 'hc_night', 'nf_night', 'vacation']

// Regular (non-call) daytime duty only happens on weekdays; on a weekend,
// any daytime duty is in-house day call instead — they're mutually
// exclusive by day of week, so the add-shift picker only ever offers one
// or the other for a given date.
function isTypeAllowedOnDay(type: EntryType, isWeekend: boolean): boolean {
  if (type === 'regular' && isWeekend) return false
  if (type === 'ih_day' && !isWeekend) return false
  return true
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const POPOVER_WIDTH = 172
// Fallback only, used for the very first position calculation before the
// popover has actually rendered and can be measured for real — an
// overestimate here was leaving a large gap when the popover flipped to
// open above the button.
const POPOVER_FALLBACK_HEIGHT = 220

let keyCounter = 0
function nextKey() {
  keyCounter += 1
  return `entry-${keyCounter}`
}

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

function dateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dateKey(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function addDays(dateString: string, delta: number): string {
  const dt = new Date(`${dateString}T00:00:00`)
  dt.setDate(dt.getDate() + delta)
  return dateStr(dt)
}

// Drops the ":00" for on-the-hour times ("5 PM") to keep calendar entries
// compact; exact minutes are kept when they matter ("5:30 PM").
function formatTime12hParts(hhmm: string): { main: string; period: string } {
  const [hStr, mStr] = hhmm.split(':')
  let h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  const period = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return { main: m === 0 ? `${h}` : `${h}:${pad(m)}`, period }
}

// AM/PM rendered smaller and muted relative to the hour itself, the way a
// clock face de-emphasizes it — keeps a calendar entry compact without
// losing the information.
function TimeLabel({ value }: { value: string }) {
  const { main, period } = formatTime12hParts(value)
  return (
    <>
      {main}
      <span className="text-[0.55em] opacity-70">{period}</span>
    </>
  )
}

// The rule engine's violation details embed plain "YYYY-MM-DD[ HH:MM:SS]"
// timestamps: this reformats them for display only, into something a
// resident can actually read at a glance, without changing what the engine
// itself produces. (The calendar highlight below uses violation.dates
// directly, not these regexes — dates are structured data from the rule
// engine, not something parsed back out of this display text.)
const ISO_DATETIME_RE = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):\d{2}/g
const ISO_DATE_RE = /(\d{4})-(\d{2})-(\d{2})/g

function humanizeDetail(detail: string): string {
  let result = detail.replace(ISO_DATETIME_RE, (_, y, m, d, h, min) => {
    const dt = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min))
    const dateStr = dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${dateStr}, ${timeStr}`
  })
  result = result.replace(ISO_DATE_RE, (_, y, m, d) => {
    const dt = new Date(Number(y), Number(m) - 1, Number(d))
    return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  })
  return result
}

// Short form for the standalone date/date-range element next to each
// violation row, e.g. "Jul 22, 2026" or "Jul 22–23, 2026".
function formatDateShort(iso: string): string {
  const dt = new Date(`${iso}T00:00:00`)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateRange(dates: string[]): string {
  if (dates.length === 0) return ''
  const sorted = [...dates].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === last) return formatDateShort(first)

  const [fy, fm, fd] = first.split('-').map(Number)
  const [ly, lm, ld] = last.split('-').map(Number)
  if (fy === ly && fm === lm) {
    const monthLabel = new Date(fy, fm - 1, fd).toLocaleDateString('en-US', { month: 'short' })
    return `${monthLabel} ${fd}–${ld}, ${fy}`
  }
  return `${formatDateShort(first)} – ${formatDateShort(last)}`
}

export default function SelfCheckPage() {
  const [entriesByDate, setEntriesByDate] = useState<Record<string, Entry[]>>({})
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)
  // The button that opened the current popover, so its position can be
  // re-measured (rather than relying on a stale snapshot) whenever the page
  // scrolls or the popover's own content changes size.
  const anchorElRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [draftType, setDraftType] = useState<EntryType>('ih_night')
  const [draftStart, setDraftStart] = useState('17:00')
  const [draftEnd, setDraftEnd] = useState('08:00')
  const [draftEndNextDay, setDraftEndNextDay] = useState(true)
  // Remembers the last type actually added, so opening the popover again
  // defaults to what this resident was just entering instead of always
  // resetting to a night shift.
  const [lastUsedType, setLastUsedType] = useState<EntryType>('ih_night')
  const [violations, setViolations] = useState<Violation[] | null>(null)
  const [compliant, setCompliant] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  // Recomputes the popover's position from the anchor button's CURRENT
  // screen location (not a stale snapshot) — called on open, whenever the
  // popover's own content changes size, and on scroll/resize, so it keeps
  // tracking its date cell instead of drifting or opening with a gap sized
  // for a height it never actually has.
  const updatePopoverPosition = () => {
    const anchor = anchorElRef.current
    if (!anchor) return
    const anchorRect = anchor.getBoundingClientRect()
    const margin = 8

    let left = anchorRect.right - POPOVER_WIDTH
    left = Math.max(margin, Math.min(left, window.innerWidth - POPOVER_WIDTH - margin))

    const popoverHeight = popoverRef.current?.offsetHeight ?? POPOVER_FALLBACK_HEIGHT
    let top = anchorRect.bottom + 6
    if (top + popoverHeight > window.innerHeight - margin) {
      top = anchorRect.top - popoverHeight - 6
    }
    top = Math.max(margin, top)

    setPopoverPos({ top, left })
  }

  // Runs before paint (not after) so a newly-opened popover measures at its
  // real rendered height immediately, instead of flashing at the fallback
  // position for a frame. Also re-runs when the type changes (vacation has
  // no time inputs, so it's much shorter) or the type dropdown opens (which
  // adds a list of its own), since either changes the popover's height.
  useLayoutEffect(() => {
    if (addingFor === null) return
    updatePopoverPosition()
  }, [addingFor, draftType, typeMenuOpen])

  // Scroll doesn't bubble, so a capturing window listener is the only way
  // to hear about scrolling on any descendant (like .calendar-scroll's own
  // horizontal scroll), not just the window itself.
  useEffect(() => {
    if (addingFor === null) return
    window.addEventListener('scroll', updatePopoverPosition, true)
    window.addEventListener('resize', updatePopoverPosition)
    return () => {
      window.removeEventListener('scroll', updatePopoverPosition, true)
      window.removeEventListener('resize', updatePopoverPosition)
    }
  }, [addingFor])

  const now = useMemo(() => new Date(), [])
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1) // 1-12
  const [direction, setDirection] = useState<'left' | 'right' | null>(null)
  const today = useMemo(() => dateStr(new Date()), [])

  // Edge fades for the calendar's horizontal scroll: visible only on the
  // side that actually has more content to scroll to, so a cut-off week
  // reads as "there's more" rather than a harsh clipped edge. Opacity is
  // continuous (proportional to remaining scroll distance, not a boolean
  // flip), so it eases in/out over the last FADE_RAMP_PX of scrolling
  // instead of abruptly appearing/vanishing right at the boundary.
  const calendarScrollRef = useRef<HTMLDivElement | null>(null)
  const [leftFadeOpacity, setLeftFadeOpacity] = useState(0)
  const [rightFadeOpacity, setRightFadeOpacity] = useState(0)
  const FADE_RAMP_PX = 48

  const updateScrollFades = () => {
    const el = calendarScrollRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 0) {
      setLeftFadeOpacity(0)
      setRightFadeOpacity(0)
      return
    }
    setLeftFadeOpacity(Math.max(0, Math.min(1, el.scrollLeft / FADE_RAMP_PX)))
    setRightFadeOpacity(Math.max(0, Math.min(1, (maxScroll - el.scrollLeft) / FADE_RAMP_PX)))
  }

  // Re-check whenever the grid's own content could have changed size
  // (switching months, or the viewport being resized).
  useEffect(() => {
    updateScrollFades()
    window.addEventListener('resize', updateScrollFades)
    return () => window.removeEventListener('resize', updateScrollFades)
  }, [year, month])

  const getEntries = (date: string): Entry[] => entriesByDate[date] || []

  const goToMonth = (delta: number) => {
    setDirection(delta > 0 ? 'right' : 'left')
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setMonth(m)
    setYear(y)
  }

  const jumpToToday = () => {
    const ty = now.getFullYear()
    const tm = now.getMonth() + 1
    if (ty === year && tm === month) return
    setDirection(ty > year || (ty === year && tm > month) ? 'right' : 'left')
    setYear(ty)
    setMonth(tm)
  }

  // Leading/trailing cells show the actual adjacent-month dates (dimmed),
  // like a normal calendar, rather than sitting empty.
  const calendarCells = useMemo(() => {
    const firstOfMonth = new Date(year, month - 1, 1)
    const startWeekday = firstOfMonth.getDay() // 0 = Sunday
    const daysInMonth = new Date(year, month, 0).getDate()
    const firstOfMonthStr = dateKey(year, month, 1)
    const lastOfMonthStr = dateKey(year, month, daysInMonth)

    const cells: { date: string; isOtherMonth: boolean }[] = []
    for (let i = startWeekday; i > 0; i--) {
      cells.push({ date: addDays(firstOfMonthStr, -i), isOtherMonth: true })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: dateKey(year, month, d), isOtherMonth: false })
    }
    let trailing = 1
    while (cells.length % 7 !== 0) {
      cells.push({ date: addDays(lastOfMonthStr, trailing), isOtherMonth: true })
      trailing++
    }
    return cells
  }, [year, month])

  // Fixed (viewport-relative) rather than anchored to the day cell, so it
  // can't get clipped by the calendar's horizontal-scroll container or run
  // off the edge of the screen when opened from a cell near the border —
  // position is computed from the button's own screen location and clamped
  // to stay fully on-screen.
  const openAddForm = (date: string, anchorEl: HTMLElement) => {
    anchorElRef.current = anchorEl
    setAddingFor(date)
    setTypeMenuOpen(false)

    const weekday = new Date(`${date}T00:00:00`).getDay()
    const isWeekend = weekday === 0 || weekday === 6
    // The remembered last-used type might not apply to this date (e.g. it
    // was a weekday "Regular Shift" and this cell is a weekend) — fall back
    // to the day-appropriate counterpart instead of a now-invalid type.
    const type = isTypeAllowedOnDay(lastUsedType, isWeekend)
      ? lastUsedType
      : (isWeekend ? 'ih_day' : 'regular')

    setDraftType(type)
    if (type === 'vacation') return
    const defaults = DEFAULT_TIMES[type]
    setDraftStart(defaults.start)
    setDraftEnd(defaults.end)
    setDraftEndNextDay(defaults.endNextDay)
  }

  const onDraftTypeChange = (type: EntryType) => {
    setDraftType(type)
    setTypeMenuOpen(false)
    if (type === 'vacation') return
    const defaults = DEFAULT_TIMES[type]
    setDraftStart(defaults.start)
    setDraftEnd(defaults.end)
    setDraftEndNextDay(defaults.endNextDay)
  }

  const confirmAdd = (date: string) => {
    const entry: Entry =
      draftType === 'vacation'
        ? { key: nextKey(), type: 'vacation', start: '00:00', end: '00:00', endNextDay: false }
        : { key: nextKey(), type: draftType, start: draftStart, end: draftEnd, endNextDay: draftEndNextDay }
    setEntriesByDate(prev => ({ ...prev, [date]: [...getEntries(date), entry] }))
    setLastUsedType(draftType)
    setAddingFor(null)
    setTypeMenuOpen(false)
    // Any calendar edit can invalidate the last check's results (a
    // violation might reference a shift that no longer exists), so clear
    // them rather than risk showing stale red highlights.
    setViolations(null)
    setCompliant(null)
  }

  const removeEntry = (date: string, key: string) => {
    setEntriesByDate(prev => ({ ...prev, [date]: getEntries(date).filter(e => e.key !== key) }))
    setViolations(null)
    setCompliant(null)
  }

  // Runs automatically on every calendar edit instead of waiting for a
  // manual "Check My Schedule" click. No debounce needed: selfCheck() runs
  // entirely in the browser (no network round trip), so it's cheap enough
  // to re-run on every add/remove.
  useEffect(() => {
    const shifts = Object.entries(entriesByDate).flatMap(([date, entries]) =>
      entries
        .filter((e): e is Entry & { type: ShiftType } => e.type !== 'vacation')
        .map(e => {
          const endDate = e.endNextDay ? addDays(date, 1) : date
          return {
            callType: CALL_TYPE[e.type],
            date,
            startDt: `${date}T${e.start}:00`,
            endDt: `${endDate}T${e.end}:00`,
          }
        })
    )

    const vacationDates = Object.entries(entriesByDate)
      .filter(([, entries]) => entries.some(e => e.type === 'vacation'))
      .map(([date]) => date)

    if (shifts.length === 0) {
      setViolations(null)
      setCompliant(null)
      setError('')
      return
    }

    const result = selfCheck(shifts, vacationDates)
    setViolations(result)
    setCompliant(result.length === 0)
    setError('')
  }, [entriesByDate])

  const clearAll = () => {
    setEntriesByDate({})
    setAddingFor(null)
    setViolations(null)
    setCompliant(null)
    setError('')
  }

  const markedCount = Object.values(entriesByDate).filter(entries => entries.length > 0).length

  // Not every violation names a specific day (e.g. "worked 3 weekends this
  // block" is a whole-block count, not tied to one date) — those have an
  // empty v.dates and just won't get a calendar highlight.
  const violationsByDate = useMemo(() => {
    const map = new Map<string, Violation[]>()
    for (const v of violations ?? []) {
      for (const d of v.dates) {
        const existing = map.get(d)
        if (existing) existing.push(v)
        else map.set(d, [v])
      }
    }
    return map
  }, [violations])

  const renderDayCell = (date: string, isOtherMonth: boolean) => {
    const entries = getEntries(date)
    const weekday = new Date(`${date}T00:00:00`).getDay()
    const isWeekend = weekday === 0 || weekday === 6
    const isToday = date === today
    const dayOfMonth = parseInt(date.slice(8, 10), 10)

    // Overnight shifts started the previous day appear here too, as a
    // continuation, so a 17:00-08:00 shift visibly extends into the next
    // day's cell instead of looking like it's contained entirely in one day.
    const prevDate = addDays(date, -1)
    const incoming = getEntries(prevDate).filter(e => e.type !== 'vacation' && e.endNextDay)

    const sortedEntries = [...entries].sort((a, b) => a.start.localeCompare(b.start))
    const dayViolations = violationsByDate.get(date)

    return (
      <div
        key={date}
        className={`day-cell${isWeekend ? ' weekend' : ''}${dayViolations ? ' border-danger-500! dark:border-danger-500!' : ''}`}
        style={{ minHeight: 100, position: 'relative' }}
      >
        {/* Dimming for other-month days only wraps the day's own content, not
            the add-button/popover below: `opacity` creates a new stacking
            context, so a popover nested inside a dimmed ancestor would both
            render translucent AND get trapped under adjacent full-opacity
            cells regardless of its own z-index. */}
        <div className="day-cell-content" style={{ opacity: isOtherMonth ? 0.45 : 1 }}>
          {/* pr-6 reserves room for the absolutely-positioned add button in
              the top-right corner, so a long "23 • today" label plus the
              violation badge wraps instead of running underneath it. */}
          <div className={`flex items-center gap-1 font-bold mb-1 text-sm flex-wrap pr-6 ${isToday ? 'text-brand-600 dark:text-brand-300' : ''}`}>
            <span>{dayOfMonth}{isToday && ' • today'}</span>
            {dayViolations && (
              <span
                title={`Violates: ${[...new Set(dayViolations.map(v => v.ruleId))].join(', ')}`}
                className="flex items-center justify-center rounded-full bg-danger-100 text-danger-700 dark:bg-danger-900/70 dark:text-danger-200 shrink-0"
                style={{ width: 18, height: 18 }}
              >
                <AlertTriangle size={11} />
              </span>
            )}
          </div>

          {incoming.map(e => {
            const Icon = TYPE_ICON[e.type]
            return (
              <div
                key={`cont-${e.key}`}
                className={`flex items-center gap-1 rounded border border-dashed border-stone-400 mb-1 px-1 py-0.5 text-[0.68rem] opacity-85 ${TYPE_CLASSES[e.type]}`}
              >
                <Icon size={11} className="shrink-0" />
                <span>until <TimeLabel value={e.end} /></span>
              </div>
            )
          })}

          {sortedEntries.map(e => {
            const Icon = TYPE_ICON[e.type]
            return (
              <div
                key={e.key}
                title={TYPE_LABEL[e.type]}
                className={`shift-entry rounded border border-stone-200 dark:border-stone-700 mb-1 text-xs ${TYPE_CLASSES[e.type]}`}
              >
                <Icon size={13} className="shift-entry-icon shrink-0" />
                {e.type === 'vacation' ? (
                  <span className="shift-entry-time">{TYPE_LABEL[e.type]}</span>
                ) : (
                  <span className="shift-entry-time">
                    <span className="shift-entry-time-value"><TimeLabel value={e.start} /></span>
                    <span className="shift-entry-dash">–</span>
                    <span className="shift-entry-time-value">
                      <TimeLabel value={e.end} />
                      {e.endNextDay && <span className="text-[0.8em] opacity-60"> →</span>}
                    </span>
                  </span>
                )}
                <button
                  onClick={() => removeEntry(date, e.key)}
                  title="Remove"
                  className="shift-entry-trash bg-transparent! text-stone-400 hover:text-danger-600! hover:bg-danger-50! border-none rounded-md p-0 cursor-pointer transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>

        <button
          onClick={e => (addingFor === date ? setAddingFor(null) : openAddForm(date, e.currentTarget))}
          title="Add shift or vacation"
          className={`absolute top-2 right-2 z-[2] flex items-center justify-center rounded-full p-0 bg-brand-50 text-brand-600 border-brand-100 shadow-none dark:bg-brand-900/60 dark:text-brand-300 dark:border-brand-700 transition-opacity hover:opacity-100${isOtherMonth ? ' opacity-45' : ''}`}
          style={{ width: 22, height: 22 }}
        >
          <Plus size={14} />
        </button>

        {addingFor === date && (
          <div
            ref={popoverRef}
            className="fixed z-10 bg-white border border-stone-300 rounded-xl p-1.5 shadow-lg dark:bg-stone-800 dark:border-stone-600"
            style={{ top: popoverPos?.top ?? 0, left: popoverPos?.left ?? 0, width: POPOVER_WIDTH }}
          >
            <div className="relative mb-1">
              {(() => {
                const SelectedIcon = TYPE_ICON[draftType]
                return (
                  <button
                    type="button"
                    onClick={() => setTypeMenuOpen(o => !o)}
                    className={`w-full flex items-center justify-between gap-1 rounded px-1.5 py-1 text-[0.7rem] ${TYPE_CLASSES[draftType]}`}
                  >
                    <span className="flex items-center gap-1">
                      <SelectedIcon size={12} />
                      {TYPE_LABEL[draftType]}
                    </span>
                    <ChevronDown size={12} />
                  </button>
                )
              })()}

              {typeMenuOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-stone-300 rounded-lg shadow-lg overflow-hidden dark:bg-stone-800 dark:border-stone-600">
                  {LEGEND_ORDER
                    .filter(t => isTypeAllowedOnDay(t, isWeekend))
                    .map(t => {
                      const Icon = TYPE_ICON[t]
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => onDraftTypeChange(t)}
                          className={`w-full flex items-center gap-1 px-1.5 py-1 text-[0.7rem] text-left rounded-none ${TYPE_CLASSES[t]}`}
                        >
                          <Icon size={12} />
                          {TYPE_LABEL[t]}
                        </button>
                      )
                    })}
                </div>
              )}
            </div>

            {draftType !== 'vacation' && (
              <>
                {/* Stacked, not side-by-side: a native time input needs more
                    room than half this popover's width can offer, and at
                    that width its own internals (clock icon, AM/PM segment)
                    were spilling past the input's border. Full width fixes
                    that regardless of how narrow the popover is. */}
                <div className="text-[0.65rem] text-stone-500 dark:text-stone-400 mb-0.5">Start</div>
                <input
                  type="time"
                  value={draftStart}
                  onChange={e => setDraftStart(e.target.value)}
                  className="w-full text-xs"
                  style={{ padding: '3px 4px', margin: 0, marginBottom: 4 }}
                />
                <div className="text-[0.65rem] text-stone-500 dark:text-stone-400 mb-0.5">End</div>
                <input
                  type="time"
                  value={draftEnd}
                  onChange={e => setDraftEnd(e.target.value)}
                  className="w-full text-xs"
                  style={{ padding: '3px 4px', margin: 0 }}
                />
                <label className="flex items-center gap-1.5 font-normal my-1 cursor-pointer text-[0.65rem] text-stone-600 dark:text-stone-300">
                  <span className="switch switch-sm">
                    <input type="checkbox" checked={draftEndNextDay}
                      onChange={e => setDraftEndNextDay(e.target.checked)} />
                    <span className="slider" />
                  </span>
                  Ends next day
                </label>
              </>
            )}

            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button className="primary" style={{ padding: '2px 6px', fontSize: '0.7rem' }} onClick={() => confirmAdd(date)}>Add</button>
              <button className="secondary" style={{ padding: '2px 6px', fontSize: '0.7rem' }} onClick={() => { setAddingFor(null); setTypeMenuOpen(false) }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <p className="mb-5 text-stone-500 dark:text-stone-400">
        Add shifts and vacation days on the calendar below, then check them against the PARA
        agreement's hard rules. Nothing you enter leaves your browser.
      </p>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
          <h2 style={{ marginBottom: 0 }}>
            {new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' })} {year}
          </h2>
          <div className="flex items-center gap-2">
            {/* Mirrors the floating prev/next buttons below, but inline —
                those are hidden on mobile since there's no room for them to
                straddle the card border without sitting outside the
                viewport, so this is the only way to page months there. */}
            <button className="secondary sm:hidden p-2" onClick={() => goToMonth(-1)} title="Previous month">
              <ChevronLeft size={16} />
            </button>
            <button className="secondary sm:hidden p-2" onClick={() => goToMonth(1)} title="Next month">
              <ChevronRight size={16} />
            </button>
            <button className="secondary" onClick={jumpToToday}>Jump to Today</button>
          </div>
        </div>

        <div className="relative">
          {/* Offset by the card's padding plus half the button so it
              straddles the card border itself, freeing the grid to use the
              full card width instead of reserving a button gutter. Hidden
              on mobile (see the inline pair above) since that offset would
              land outside the viewport there. */}
          <button
            onClick={() => goToMonth(-1)}
            title="Previous month"
            className="hidden sm:flex absolute z-10 items-center justify-center rounded-full bg-brand-200 text-brand-800 border-brand-300 hover:bg-brand-300! hover:border-brand-400! dark:bg-brand-700 dark:text-white dark:border-brand-600 dark:hover:bg-brand-600! dark:hover:border-brand-500! -left-10 top-1/2 -translate-y-1/2 w-8 h-8 p-0"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => goToMonth(1)}
            title="Next month"
            className="hidden sm:flex absolute z-10 items-center justify-center rounded-full bg-brand-200 text-brand-800 border-brand-300 hover:bg-brand-300! hover:border-brand-400! dark:bg-brand-700 dark:text-white dark:border-brand-600 dark:hover:bg-brand-600! dark:hover:border-brand-500! -right-10 top-1/2 -translate-y-1/2 w-8 h-8 p-0"
          >
            <ChevronRight size={18} />
          </button>

          <div
            key={`${year}-${month}`}
            ref={calendarScrollRef}
            onScroll={updateScrollFades}
            className={`calendar-scroll ${direction === 'right' ? 'slide-in-right' : direction === 'left' ? 'slide-in-left' : ''}`}
          >
            <div className="schedule-grid" style={{ marginBottom: 8 }}>
              {WEEKDAY_LABELS.map(label => (
                <div key={label} className="day-header">{label}</div>
              ))}
            </div>
            <div className="schedule-grid">
              {calendarCells.map(cell => renderDayCell(cell.date, cell.isOtherMonth))}
            </div>
          </div>

          {/* left/right nudged 1px past the true edge (rather than exactly
              flush) so the fade's fluid, non-integer clamp() width can't
              leave a hairline sub-pixel-rounding seam of full-opacity
              content between itself and the scroll container's edge. */}
          <div
            aria-hidden
            className="calendar-edge-fade pointer-events-none absolute z-[5] inset-y-0 bg-gradient-to-r from-white dark:from-stone-900 to-white/0 dark:to-stone-900/0"
            style={{ opacity: leftFadeOpacity, left: -1 }}
          />
          <div
            aria-hidden
            className="calendar-edge-fade pointer-events-none absolute z-[5] inset-y-0 bg-gradient-to-l from-white dark:from-stone-900 to-white/0 dark:to-stone-900/0"
            style={{ opacity: rightFadeOpacity, right: -1 }}
          />
        </div>

        <div className="flex gap-3 flex-wrap mt-4 text-xs">
          {LEGEND_ORDER.map(t => {
            const Icon = TYPE_ICON[t]
            return (
              <span key={t} className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${TYPE_CLASSES[t]}`}>
                <Icon size={12} />
                {TYPE_LABEL[t]}
              </span>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="secondary" onClick={clearAll}>Clear All</button>
        <span className="text-sm text-stone-500 dark:text-stone-400">{markedCount} day(s) marked</span>
      </div>

      {error && (
        <div className="card bg-danger-50! text-danger-700! dark:bg-danger-900/40! dark:text-danger-100!">
          {error}
        </div>
      )}

      {violations && compliant === true && (
        <div className="card bg-success-50! text-success-700! dark:bg-success-900/40! dark:text-success-100!">
          <strong>No PARA violations found.</strong> This schedule is compliant with all hard rules checked.
        </div>
      )}

      {violations && violations.length > 0 && (
        <div className="card">
          <h2>Violations Found ({violations.length})</h2>
          <div>
            {violations.map((v, i) => {
              const dateLabel = formatDateRange(v.dates)
              return (
                <div key={`${v.ruleId}-${i}`} className="py-4 border-b border-stone-100 dark:border-stone-800 last:border-b-0">
                  <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50 mb-0.5">
                        {RULE_TITLES[v.ruleId] || v.ruleId}
                      </h3>
                    </div>
                    {dateLabel && (
                      <div className="text-right shrink-0 font-mono text-sm font-semibold text-danger-700 dark:text-danger-300">
                        {dateLabel}
                      </div>
                    )}
                  </div>
                  {/* Full width (under both the title and the date), not
                      confined to either column: id is shrink-0 (never wraps
                      or moves) and article gets all remaining space,
                      wrapping its own text in place rather than the whole
                      row dropping down, since it's the one on the right
                      with room to give. */}
                  <div className="flex items-baseline gap-2 text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                    <span className="font-mono shrink-0">{v.ruleId}</span>
                    <span className="flex-1 min-w-0 text-right">{v.articleRef}</span>
                  </div>
                  <p className="text-sm text-stone-600 dark:text-stone-300 mt-2">{humanizeDetail(v.detail)}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
