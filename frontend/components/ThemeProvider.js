import { useState, useEffect, useCallback } from 'react'
import { ThemeContext } from '../context/ThemeContext'

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    // Read from classList (already applied by _document.js inline script)
    const current = document.documentElement.classList.contains('light') ? 'light' : 'dark'
    setTheme(current)
    // Enable smooth transitions after initial paint to avoid FOUC
    requestAnimationFrame(() => {
      document.documentElement.classList.add('theme-transition')
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.remove('dark', 'light')
      document.documentElement.classList.add(next)
      localStorage.setItem('ba-theme', next)
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
