import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const ShellContext = createContext(null)

export function ShellProvider({ children }) {
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  const toggleNav = useCallback(() => setNavCollapsed(v => !v), [])
  const toggleCopilot = useCallback(() => setCopilotOpen(v => !v), [])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandOpen(v => !v)
      }
      if (e.key === 'b' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        toggleNav()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleNav])

  return (
    <ShellContext.Provider
      value={{
        navCollapsed,
        setNavCollapsed,
        toggleNav,
        copilotOpen,
        setCopilotOpen,
        toggleCopilot,
        commandOpen,
        setCommandOpen,
      }}
    >
      {children}
    </ShellContext.Provider>
  )
}

export function useShell() {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used within ShellProvider')
  return ctx
}
