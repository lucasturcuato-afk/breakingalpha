import clsx from 'clsx'

export default function Skeleton({
  width,
  height = '1rem',
  rounded = 'md',
  className,
  ...props
}) {
  const radiusMap = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  }

  return (
    <div
      className={clsx(
        'animate-pulse bg-base-elevated',
        radiusMap[rounded],
        className
      )}
      style={{ width, height }}
      aria-hidden="true"
      {...props}
    />
  )
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="0.75rem"
          width={i === lines - 1 ? '60%' : '100%'}
          rounded="sm"
        />
      ))}
    </div>
  )
}

export function SkeletonRow({ className }) {
  return (
    <div className={clsx('flex items-center gap-3 py-2.5', className)}>
      <Skeleton width="2rem" height="2rem" rounded="md" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Skeleton height="0.75rem" width="40%" rounded="sm" />
        <Skeleton height="0.625rem" width="70%" rounded="sm" />
      </div>
      <Skeleton width="3.5rem" height="0.75rem" rounded="sm" />
    </div>
  )
}
