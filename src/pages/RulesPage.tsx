import { Building2, ExternalLink, Home, Moon, Siren, Stethoscope, type LucideIcon } from 'lucide-react'
import type { CallType, DutyModel } from '../rules/types'
import { getRuleset } from '../rules/rulesets'
import { useRuleset } from '../context/RulesetContext'

const CALL_TYPE_LABEL: Record<CallType, string> = {
  in_house: 'In-house',
  home: 'Home call',
  night_float: 'Night float',
  backup: 'Backup Activated',
  regular: 'Regular',
}

// Same icon-per-call-type mapping as the Self-Check calendar, so a call
// type reads the same way everywhere in the app.
const CALL_TYPE_ICON: Record<CallType, LucideIcon> = {
  in_house: Building2,
  home: Home,
  night_float: Moon,
  backup: Siren,
  regular: Stethoscope,
}

// PARA's own published agreement, verified live (not guessed): this is
// where the exact legal wording lives, so the app can explain each rule in
// plain language without reproducing the agreement's text itself.
const AGREEMENT_URL = 'https://www.para-ab.ca/agreement/agreement/'

export default function RulesPage() {
  const { rulesets, rulesetVersion, setRulesetVersion, dutyModel, setDutyModel } = useRuleset()
  const rules = getRuleset(rulesetVersion)
  const hardRules = rules.filter(r => r.kind === 'hard').sort((a, b) => a.articleRef.localeCompare(b.articleRef))
  const fairnessRules = rules.filter(r => r.kind === 'fairness').sort((a, b) => a.articleRef.localeCompare(b.articleRef))

  const renderRows = (list: typeof rules) => (
    <div>
      {list.map(rule => (
        <div key={rule.id} className="py-4 border-b border-stone-100 dark:border-stone-800 last:border-b-0">
          <div className="flex justify-between items-start gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50 mb-0.5">{rule.title}</h3>
            </div>
            {rule.callTypes.size > 0 && (
              <div className="flex items-center gap-1.5 text-stone-600 dark:text-stone-300 shrink-0">
                {[...rule.callTypes].map(ct => {
                  const Icon = CALL_TYPE_ICON[ct]
                  return (
                    <span key={ct} title={CALL_TYPE_LABEL[ct] || ct}>
                      {Icon ? <Icon size={16} /> : CALL_TYPE_LABEL[ct] || ct}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
          {/* Full width (under both the title and the icons), not confined
              to either column: id is shrink-0 (never wraps or moves) and
              article gets all remaining space, wrapping its own text in
              place rather than the whole row dropping down, since it's the
              one on the right with room to give. */}
          <div className="flex items-baseline gap-2 text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            <span className="font-mono shrink-0">{rule.id}</span>
            <span className="flex-1 min-w-0 text-right">{rule.articleRef}</span>
          </div>
          <p className="text-sm text-stone-600 dark:text-stone-300 mt-2">{rule.explanation}</p>
        </div>
      ))}
    </div>
  )

  return (
    <div>
      <h1>PARA Rules Reference</h1>

      {(rulesets.length > 1 || rulesetVersion === 'para_2024_2028') && (
        <div className="card">
          <div className="flex flex-col gap-4 sm:flex-row">
            {rulesets.length > 1 && (
              <div className="form-group flex-1" style={{ marginBottom: 0 }}>
                <label className="schedule-setting-label">Ruleset</label>
                <select className="schedule-setting-select" value={rulesetVersion} onChange={e => setRulesetVersion(e.target.value)}>
                  {rulesets.map(rs => (
                    <option key={rs.version} value={rs.version}>{rs.name}</option>
                  ))}
                </select>
              </div>
            )}
            {rulesetVersion === 'para_2024_2028' && (
              <div className="form-group flex-1" style={{ marginBottom: 0 }}>
                <label className="schedule-setting-label">Duty model</label>
                <select className="schedule-setting-select" value={dutyModel} onChange={e => setDutyModel(e.target.value as DutyModel)}>
                  <option value="standard">Standard duty</option>
                  <option value="shift_based">Shift-based duty</option>
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card bg-day-50! text-day-700! dark:bg-day-900/40! dark:text-day-100!">
        These rules are drawn directly from the PARA Resident Physician Agreement (Article 20 and 23),
        or, when a Letter of Understanding ruleset is selected above, the specific variances that LOU
        negotiates on top of it.
        <strong> Hard rules are what the Self-Check calendar checks your entered shifts against.</strong>{' '}
        Fairness rules are soft scheduling preferences used only by the admin scheduling tool this project
        is derived from; they don't affect your self-check results, but are listed here for reference. Each
        explanation below is written in plain language, not quoted from the agreement; for the exact legal
        wording,{' '}
        <a
          href={AGREEMENT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-day-700! dark:text-day-100! underline"
        >
          read PARA's agreement directly <ExternalLink size={12} />
        </a>.
      </div>

      {rulesetVersion === 'para_2024_2028' && (
        <div className="card">
          <h2>Duty models</h2>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Standard duty is weekday daytime work. Shift-based duty is the rotation&apos;s scheduled coverage work, permits weekend shifts, and applies the 60-hour weekly cap and no-additional-call rule.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Hard Rules ({hardRules.length})</h2>
        {hardRules.length === 0 ? <p>No hard rules found.</p> : renderRows(hardRules)}
      </div>

      <div className="card">
        <h2>Fairness Rules ({fairnessRules.length})</h2>
        {fairnessRules.length === 0 ? <p>No fairness rules found.</p> : renderRows(fairnessRules)}
      </div>
    </div>
  )
}
