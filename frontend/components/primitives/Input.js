import { forwardRef } from 'react'
import clsx from 'clsx'

const Input = forwardRef(function Input(
  {
    label,
    helper,
    error,
    className,
    inputClassName,
    id,
    ...props
  },
  ref
) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-12 font-medium text-content-secondary"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={clsx(
          'h-8 px-3 rounded-md text-13',
          'bg-base-elevated text-content-primary',
          'border placeholder:text-content-muted',
          'focus:outline-none focus:ring-2 focus:ring-offset-1',
          'focus:ring-signal-500/40 focus:ring-offset-base',
          'sig-transition',
          error
            ? 'border-live focus:ring-live/40'
            : 'border-border hover:border-border-strong',
          inputClassName
        )}
        {...props}
      />
      {(error || helper) && (
        <span
          className={clsx(
            'text-11',
            error ? 'text-live' : 'text-content-muted'
          )}
        >
          {error || helper}
        </span>
      )}
    </div>
  )
})

export default Input
