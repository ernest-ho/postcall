import { useEffect, useState } from 'react'
import { CalendarClock, Moon, Sun } from 'lucide-react'
import SelfCheckPage from './pages/SelfCheckPage'

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
    <>
      <nav className="app-nav">
        <span className="app-brand">
          <CalendarClock size={20} className="text-brand-600" />
          PostCall
        </span>
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </nav>
      <div className="container">
        <SelfCheckPage />
      </div>
    </>
  )
}

export default App
