import { forwardRef } from 'react'
import clsx from 'clsx'

const variantStyles = {
  surface: 'bg-base-surface border-border-subtle',
  elevated: 'bg-base-elevated border-border',
}

const paddings = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

const Card = forwardRef(function Card(
  {
    variant = 'surface',
    padding = 'md',
    hover = false,
    className,
    children,
    as: Tag = 'div',
    ...props
  },
  ref
) {
  return (
    <Tag
      ref={ref}
      className={clsx(
        'rounded-lg border',
        variantStyles[variant],
        paddings[padding],
        hover && 'sig-transition hover:border-border-strong hover:bg-base-elevated cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  )
})

export function CardHeader({ className, children, ...props }) {
  return (
    <div className={clsx('flex items-center justify-between gap-4', className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }) {
  return (
    <h3
      className={clsx('text-14 font-semibold text-content-primary', className)}
      {...props}
    >
      {children}
    </h3>
  )
}

export function CardContent({ className, children, ...props }) {
  return (
    <div className={clsx('text-13 text-content-secondary', className)} {...props}>
      {children}
    </div>
  )
}

export default Card
