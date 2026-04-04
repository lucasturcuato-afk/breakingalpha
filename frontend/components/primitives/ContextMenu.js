import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import clsx from 'clsx'

export function ContextMenu({ children }) {
  return <ContextMenuPrimitive.Root>{children}</ContextMenuPrimitive.Root>
}

export function ContextMenuTrigger({ children, ...props }) {
  return (
    <ContextMenuPrimitive.Trigger asChild {...props}>
      {children}
    </ContextMenuPrimitive.Trigger>
  )
}

export function ContextMenuContent({ className, children, ...props }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={clsx(
          'z-50 min-w-[180px] p-1 rounded-lg',
          'bg-base-overlay border border-border',
          'shadow-overlay',
          'animate-in fade-in-0 zoom-in-95',
          className
        )}
        {...props}
      >
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  )
}

export function ContextMenuItem({ className, danger = false, children, ...props }) {
  return (
    <ContextMenuPrimitive.Item
      className={clsx(
        'flex items-center gap-2 px-2.5 h-8 rounded-md text-13 cursor-pointer',
        'outline-none select-none',
        'sig-transition',
        danger
          ? 'text-live data-[highlighted]:bg-live/10'
          : 'text-content-secondary data-[highlighted]:bg-base-elevated data-[highlighted]:text-content-primary',
        className
      )}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Item>
  )
}

export function ContextMenuSeparator({ className }) {
  return (
    <ContextMenuPrimitive.Separator
      className={clsx('h-px my-1 bg-border-subtle', className)}
    />
  )
}

export function ContextMenuLabel({ className, children }) {
  return (
    <ContextMenuPrimitive.Label
      className={clsx(
        'px-2.5 py-1.5 text-11 font-medium text-content-muted uppercase tracking-wider',
        className
      )}
    >
      {children}
    </ContextMenuPrimitive.Label>
  )
}
