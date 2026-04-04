import clsx from 'clsx'

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center py-16 px-6 text-center',
        className
      )}
    >
      {icon && (
        <div className="mb-4 text-content-muted">
          {typeof icon === 'string' ? (
            <span className="text-32">{icon}</span>
          ) : (
            icon
          )}
        </div>
      )}
      {title && (
        <h3 className="text-14 font-semibold text-content-primary mb-1">
          {title}
        </h3>
      )}
      {description && (
        <p className="text-13 text-content-muted max-w-[280px]">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
