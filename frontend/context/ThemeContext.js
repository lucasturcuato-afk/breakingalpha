import { createContext, useContext } from 'react'

export const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {} })

export function useTheme() {
  return useContext(ThemeContext)
}
