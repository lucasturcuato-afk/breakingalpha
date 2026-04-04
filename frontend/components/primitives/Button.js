import { forwardRef } from 'react'
import clsx from 'clsx'

const base = [
  'inline-flex items-center justify-center gap-2',
  'font-medium whitespace-nowrap select-none',
  'rounded-md transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
  'focus-visible:ring-signal-500 focus-visible:ring-offset-base',
  'disabled:pointer-events-none disabled:opacity-40',
].join(' ')

const variants = {
  primary: [
    'bg-signal-500 text-base',
    'hover:bg-signal-400',
    'active:bg-signal-600',
  ].join(' '),
  secondary: [
    'bg-base-elevated text-content-primary',
    'border border-border',
    'hover:bg-base-overlay hover:border-border-strong',
    'active:bg-base-elevated',
  ].join(' '),
  ghost: [
    'text-content-secondary',
    'hover:bg-base-elevated hover:text-content-primary',
    'active:bg-base-overlay',
  ].join(' '),
  danger: [
    'bg-live text-white',
    'hover:bg-red-500',
    'active:bg-red-600',
  ].join(' '),
}

const sizes = {
  sm: 'h-7 px-2.5 text-12',
  md: 'h-8 px-3 text-13',
  lg: 'h-9 px-4 text-14',
}

const iconOnlySizes = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-9 w-9',
}

const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconOnly = false,
    className,
    children,
    disabled,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        base,
        variants[variant],
        iconOnly ? iconOnlySizes[size] : sizes[size],
        className
      )}
      {...props}
    >
      {loading ? (
        <svg
          className="animate-spin h-3.5 w-3.5"
          viewBox="0 0 16 16"
          fill="none"
        >
          <circle
            cx="8" cy="8" r="6"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="2"
          />
          <path
            d="M14 8a6 6 0 00-6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      {children}
    </button>
  )
})

export default Button
