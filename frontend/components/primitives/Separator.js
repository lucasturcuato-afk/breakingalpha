import clsx from 'clsx'

export default function Separator({
  orientation = 'horizontal',
  className,
  ...props
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={clsx(
        'shrink-0 bg-border-subtle',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...props}
    />
  )
}
