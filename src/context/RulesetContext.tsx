import { createContext, useContext, useState, ReactNode } from 'react'
import { RULESETS, type RulesetInfo } from '../rules/rulesets'

interface RulesetContextType {
  rulesets: RulesetInfo[]
  rulesetVersion: string
  setRulesetVersion: (version: string) => void
}

const RULESET_STORAGE_KEY = 'postcall.ruleset_version'

const RulesetContext = createContext<RulesetContextType | undefined>(undefined)

export function RulesetProvider({ children }: { children: ReactNode }) {
  // Lifted here (not local per-page state) so switching between the
  // Self-Check and Rules tabs keeps whichever ruleset was selected, instead
  // of each page resetting to the default on mount.
  const [rulesetVersion, setRulesetVersionState] = useState(
    () => localStorage.getItem(RULESET_STORAGE_KEY) || RULESETS[0].version,
  )

  const setRulesetVersion = (version: string) => {
    setRulesetVersionState(version)
    localStorage.setItem(RULESET_STORAGE_KEY, version)
  }

  return (
    <RulesetContext.Provider value={{ rulesets: RULESETS, rulesetVersion, setRulesetVersion }}>
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
