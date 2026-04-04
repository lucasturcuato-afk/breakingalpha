import clsx from 'clsx'
import { ShellProvider } from './ShellContext'
import NavRail from './NavRail'
import TopBar from './TopBar'
import CopilotRail from './CopilotRail'
import GlobalCommand from './GlobalCommand'

function ShellLayout({ children, breadcrumb }) {
  return (
    <div className="sig flex h-screen overflow-hidden">
      <NavRail />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar breadcrumb={breadcrumb} />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <CopilotRail />
      <GlobalCommand />
    </div>
  )
}

export default function AppShell({ children, breadcrumb }) {
  return (
    <ShellProvider>
      <ShellLayout breadcrumb={breadcrumb}>
        {children}
      </ShellLayout>
    </ShellProvider>
  )
}
