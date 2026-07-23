import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { CalendarClock, Moon, ShieldCheck, Sun } from 'lucide-react'
import SelfCheckPage from './pages/SelfCheckPage'
import RulesPage from './pages/RulesPage'

// HashRouter, not BrowserRouter: GitHub Pages serves static files with no
// server-side rewrite, so a direct link to /rules would 404 on refresh with
// history-based routing. Hash routes (/#/rules) always resolve since the
// fragment never reaches the server.
// No separate "Self-Check" entry: the logo itself is the way back to it.
const NAV_ITEMS = [
  { to: '/rules', label: 'Rules', icon: ShieldCheck },
]

function NavLink({ to, label, icon: Icon }: { to: string; label: string; icon: typeof ShieldCheck }) {
  const location = useLocation()
  const isActive = location.pathname === to
  return (
    <Link to={to} className={isActive ? 'active' : ''}>
      <Icon size={15} />
      {label}
    </Link>
  )
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  return { dark, toggle: () => setDark(d => !d) }
}

function ThemeToggle() {
  const { dark, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="theme-toggle"
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  )
}

function App() {
  return (
    <HashRouter>
      <nav className="app-nav">
        <Link to="/" className="app-brand" title="Self-Check">
          <CalendarClock size={20} className="text-brand-600 dark:text-brand-300" />
          PostCall
        </Link>
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} label={item.label} icon={item.icon} />
        ))}
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<SelfCheckPage />} />
          <Route path="/rules" element={<RulesPage />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

export default App
