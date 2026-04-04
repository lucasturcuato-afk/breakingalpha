import clsx from 'clsx'

const variants = {
  default: 'bg-base-elevated text-content-secondary border-border-subtle',
  signal: 'bg-signal-muted text-signal-400 border-signal-500/20',
  live: 'bg-live/10 text-live border-live/20',
  draft: 'bg-draft/10 text-draft border-draft/20',
  ai: 'bg-ai-muted text-ai border-ai/20',
  meta: 'bg-meta/10 text-meta border-meta/20',
}

const sizes = {
  sm: 'h-5 px-1.5 text-11',
  md: 'h-[22px] px-2 text-12',
}

export default function Badge({
  variant = 'default',
  size = 'sm',
  children,
  className,
  ...props
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-medium rounded border whitespace-nowrap',
        'font-mono tabular-nums',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
