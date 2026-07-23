import { useState, useMemo } from 'react'
import { Building2, ChevronDown, ChevronLeft, ChevronRight, Home, Moon, Plus, Stethoscope, Trash2, Umbrella, type LucideIcon } from 'lucide-react'
import { selfCheck } from '../rules/selfCheck'
import type { CallType, Violation } from '../rules/types'

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

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  let h = parseInt(hStr, 10)
  const period = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${mStr} ${period}`
}

function to24h(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  let h = hour12 % 12
  if (period === 'PM') h += 12
  return `${pad(h)}:${pad(minute)}`
}

function from24h(hhmm: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  const [hStr, mStr] = hhmm.split(':')
  const h = parseInt(hStr, 10)
  const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM'
  let hour12 = h % 12
  if (hour12 === 0) hour12 = 12
  return { hour12, minute: parseInt(mStr, 10), period }
}

function AmPmTimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { hour12, minute, period } = from24h(value)
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      <select
        value={hour12}
        onChange={e => onChange(to24h(parseInt(e.target.value, 10), minute, period))}
        style={{ fontSize: '0.7rem', padding: '2px', margin: 0, width: '32%' }}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <select
        value={minute}
        onChange={e => onChange(to24h(hour12, parseInt(e.target.value, 10), period))}
        style={{ fontSize: '0.7rem', padding: '2px', margin: 0, width: '34%' }}
      >
        {[0, 15, 30, 45].map(m => (
          <option key={m} value={m}>{pad(m)}</option>
        ))}
      </select>
      <select
        value={period}
        onChange={e => onChange(to24h(hour12, minute, e.target.value as 'AM' | 'PM'))}
        style={{ fontSize: '0.7rem', padding: '2px', margin: 0, width: '34%' }}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}

export default function SelfCheckPage() {
  const [entriesByDate, setEntriesByDate] = useState<Record<string, Entry[]>>({})
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [draftType, setDraftType] = useState<EntryType>('ih_night')
  const [draftStart, setDraftStart] = useState('17:00')
  const [draftEnd, setDraftEnd] = useState('08:00')
  const [draftEndNextDay, setDraftEndNextDay] = useState(true)
  const [violations, setViolations] = useState<Violation[] | null>(null)
  const [compliant, setCompliant] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  const now = useMemo(() => new Date(), [])
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1) // 1-12
  const [direction, setDirection] = useState<'left' | 'right' | null>(null)
  const today = useMemo(() => dateStr(new Date()), [])

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

  const openAddForm = (date: string) => {
    setAddingFor(date)
    setTypeMenuOpen(false)
    const defaults = DEFAULT_TIMES.ih_night
    setDraftType('ih_night')
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
    setAddingFor(null)
    setTypeMenuOpen(false)
  }

  const removeEntry = (date: string, key: string) => {
    setEntriesByDate(prev => ({ ...prev, [date]: getEntries(date).filter(e => e.key !== key) }))
  }

  const runCheck = () => {
    setError('')
    setViolations(null)
    setCompliant(null)

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
      setError('Add at least one shift on the calendar before checking.')
      return
    }

    // Runs entirely in the browser: no server, no network round trip.
    const result = selfCheck(shifts, vacationDates)
    setViolations(result)
    setCompliant(result.length === 0)
  }

  const clearAll = () => {
    setEntriesByDate({})
    setAddingFor(null)
    setViolations(null)
    setCompliant(null)
    setError('')
  }

  const markedCount = Object.values(entriesByDate).filter(entries => entries.length > 0).length

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

    return (
      <div
        key={date}
        className={`day-cell${isWeekend ? ' weekend' : ''}`}
        style={{ minHeight: 100, position: 'relative', opacity: isOtherMonth ? 0.45 : 1 }}
      >
        <div className={`font-bold mb-1 text-sm ${isToday ? 'text-brand-600 dark:text-brand-300' : ''}`}>
          {dayOfMonth}
          {isToday && ' • today'}
        </div>

        <button
          onClick={() => (addingFor === date ? setAddingFor(null) : openAddForm(date))}
          title="Add shift or vacation"
          className="absolute top-2 right-2 z-[2] flex items-center justify-center rounded-full p-0 bg-brand-50 text-brand-600 border-brand-100 shadow-none dark:bg-brand-900/60 dark:text-brand-300 dark:border-brand-700"
          style={{ width: 22, height: 22 }}
        >
          <Plus size={14} />
        </button>

        {incoming.map(e => {
          const Icon = TYPE_ICON[e.type]
          return (
            <div
              key={`cont-${e.key}`}
              className={`flex items-center gap-1 rounded border border-dashed border-stone-400 mb-1 px-1 py-0.5 text-[0.68rem] opacity-85 ${TYPE_CLASSES[e.type]}`}
            >
              <Icon size={11} /> until {formatTime12h(e.end)}
            </div>
          )
        })}

        {sortedEntries.map(e => {
          const Icon = TYPE_ICON[e.type]
          return (
            <div
              key={e.key}
              title={TYPE_LABEL[e.type]}
              className={`flex justify-between items-center gap-1 rounded border border-stone-200 dark:border-stone-700 mb-1 px-1 py-0.5 text-xs ${TYPE_CLASSES[e.type]}`}
            >
              <span className="flex items-center gap-1">
                <Icon size={13} className="shrink-0" />
                {e.type === 'vacation' ? (
                  <span>{TYPE_LABEL[e.type]}</span>
                ) : (
                  <span>
                    {formatTime12h(e.start)}–{formatTime12h(e.end)}{e.endNextDay ? ' →' : ''}
                  </span>
                )}
              </span>
              <button
                onClick={() => removeEntry(date, e.key)}
                title="Remove"
                className="bg-transparent! text-stone-400 hover:text-danger-600! hover:bg-danger-50! border-none rounded-md p-0.5 cursor-pointer shrink-0 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}

        {addingFor === date && (
          <div
            className="absolute z-10 bg-white border border-stone-300 rounded-xl p-1.5 shadow-lg dark:bg-stone-800 dark:border-stone-600"
            style={{ top: 34, right: 8, width: 150 }}
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
                  {(Object.keys(TYPE_LABEL) as EntryType[]).map(t => {
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
                <div className="text-[0.65rem] text-stone-500 dark:text-stone-400 mb-0.5">Start</div>
                <AmPmTimeSelect value={draftStart} onChange={setDraftStart} />
                <div className="text-[0.65rem] text-stone-500 dark:text-stone-400 my-0.5">End</div>
                <AmPmTimeSelect value={draftEnd} onChange={setDraftEnd} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.65rem', fontWeight: 'normal', margin: '4px 0' }}>
                  <input type="checkbox" checked={draftEndNextDay}
                    onChange={e => setDraftEndNextDay(e.target.checked)} style={{ margin: 0 }} />
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
      <h1>Self-Check</h1>
      <p className="mb-5 text-stone-500 dark:text-stone-400">
        Add shifts and vacation days on the calendar below, then check them against the PARA
        agreement's hard rules. Nothing you enter leaves your browser.
      </p>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
          <h2 style={{ marginBottom: 0 }}>Calendar</h2>
          <button className="secondary" onClick={jumpToToday}>Jump to Today</button>
        </div>

        <div className="flex gap-3 flex-wrap mb-3 text-xs">
          {(Object.keys(TYPE_LABEL) as EntryType[]).map(t => {
            const Icon = TYPE_ICON[t]
            return (
              <span key={t} className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${TYPE_CLASSES[t]}`}>
                <Icon size={12} />
                {TYPE_LABEL[t]}
              </span>
            )
          })}
        </div>

        <div className="text-center font-bold text-lg mb-3">
          {new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' })} {year}
        </div>

        <div className="relative">
          {/* Anchored to the card's own edges, not this wrapper's; offset by
              the card's padding (24px) plus half the button so it straddles
              the card border itself, freeing the grid to use the full
              card width instead of reserving a button gutter. */}
          <button
            onClick={() => goToMonth(-1)}
            title="Previous month"
            className="absolute z-10 flex items-center justify-center rounded-full bg-brand-200 text-brand-800 border-brand-300 hover:bg-brand-300! hover:border-brand-400! dark:bg-brand-700 dark:text-white dark:border-brand-600 dark:hover:bg-brand-600! dark:hover:border-brand-500!"
            style={{ left: -40, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, padding: 0 }}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => goToMonth(1)}
            title="Next month"
            className="absolute z-10 flex items-center justify-center rounded-full bg-brand-200 text-brand-800 border-brand-300 hover:bg-brand-300! hover:border-brand-400! dark:bg-brand-700 dark:text-white dark:border-brand-600 dark:hover:bg-brand-600! dark:hover:border-brand-500!"
            style={{ right: -40, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, padding: 0 }}
          >
            <ChevronRight size={18} />
          </button>

          <div
            key={`${year}-${month}`}
            className={direction === 'right' ? 'slide-in-right' : direction === 'left' ? 'slide-in-left' : ''}
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
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="primary" onClick={runCheck}>Check My Schedule</button>
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
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Article</th>
                <th>Severity</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {violations.map((v, i) => (
                <tr key={`${v.ruleId}-${i}`}>
                  <td className="font-mono text-sm">{v.ruleId}</td>
                  <td>{v.articleRef}</td>
                  <td>
                    <span className={`badge ${v.severity === 'hard' ? 'required' : 'soft'}`}>
                      {v.severity}
                    </span>
                  </td>
                  <td>{v.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
