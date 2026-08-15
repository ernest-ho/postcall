import { createContext, useContext, useState, ReactNode } from 'react'
import { RULESETS, type RulesetInfo } from '../rules/rulesets'
import type { DutyModel } from '../rules/types'

interface RulesetContextType {
  rulesets: RulesetInfo[]
  rulesetVersion: string
  setRulesetVersion: (version: string) => void
  dutyModel: DutyModel
  setDutyModel: (model: DutyModel) => void
}

const RULESET_STORAGE_KEY = 'postcall.ruleset_version'
const DUTY_MODEL_STORAGE_KEY = 'postcall.duty_model'

const RulesetContext = createContext<RulesetContextType | undefined>(undefined)

export function RulesetProvider({ children }: { children: ReactNode }) {
  // Lifted here (not local per-page state) so switching between the
  // Self-Check and Rules tabs keeps whichever ruleset was selected, instead
  // of each page resetting to the default on mount.
  const [rulesetVersion, setRulesetVersionState] = useState(
    () => localStorage.getItem(RULESET_STORAGE_KEY) || RULESETS[0].version,
  )
  const [dutyModel, setDutyModelState] = useState<DutyModel>(() =>
    localStorage.getItem(DUTY_MODEL_STORAGE_KEY) === 'shift_based' ? 'shift_based' : 'standard',
  )

  const setRulesetVersion = (version: string) => {
    setRulesetVersionState(version)
    localStorage.setItem(RULESET_STORAGE_KEY, version)
  }

  const setDutyModel = (model: DutyModel) => {
    setDutyModelState(model)
    localStorage.setItem(DUTY_MODEL_STORAGE_KEY, model)
  }

  return (
    <RulesetContext.Provider value={{ rulesets: RULESETS, rulesetVersion, setRulesetVersion, dutyModel, setDutyModel }}>
      {children}
    </RulesetContext.Provider>
  )
}

export function useRuleset() {
  const context = useContext(RulesetContext)
  if (!context) {
    throw new Error('useRuleset must be used within RulesetProvider')
  }
  return context
}
