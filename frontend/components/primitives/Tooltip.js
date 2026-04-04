import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import clsx from 'clsx'

export function TooltipProvider({ children, delayDuration = 200 }) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export default function Tooltip({
  content,
  side = 'top',
  align = 'center',
  children,
  className,
}) {
  if (!content) return children

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={clsx(
            'z-50 px-2.5 py-1.5 rounded-md',
            'bg-base-overlay text-12 text-content-primary',
            'border border-border',
            'shadow-elevated',
            'animate-in fade-in-0 zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            className
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-base-overlay" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
